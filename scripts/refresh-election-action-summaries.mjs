import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "../server/node_modules/dotenv/lib/main.js";
import { createCampaignSummaryRefreshProvider, SUMMARY_PROMPT_VERSION } from "../server/src/elections/refreshCampaignSummaries.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedProjectRef = "kddqnmenstoilnzwajnb";
const batchSize = 20;
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const preview = args.has("--preview");
if (apply && preview) throw new Error("Choose either --preview or --apply");

const serverEnv = dotenv.parse(await readFile(path.join(root, "server/.env")));
if (!serverEnv.DATABASE_URL) throw new Error("server/.env has no DATABASE_URL");
const databaseUrl = new URL(serverEnv.DATABASE_URL);
if (!databaseUrl.username.includes(expectedProjectRef)
  || !databaseUrl.hostname.includes("us-west-2")
  || !databaseUrl.hostname.endsWith(".pooler.supabase.com")) {
  throw new Error("Refusing to run: server/.env is not the guarded VoteFeed Dev database");
}
if (apply && !process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required to apply summary rewrites");

process.env.DATABASE_URL = serverEnv.DATABASE_URL;
process.env.DB_SSL = "true";
const { default: db } = await import("../server/src/db/client.js");
const { recordCampaignSummaryRefresh } = await import("../server/src/db/queries/elections.js");

const eligibleSql = [
  "SELECT p.id AS \"positionVersionId\",p.candidacy_id AS \"candidacyId\",ca.name AS \"candidateName\",",
  "  r.state,r.office,r.district,p.topic,p.claim_text AS \"claimText\",p.excerpt,p.summary AS \"currentSummary\"",
  "FROM campaign_position_versions p",
  "JOIN election_candidacies co ON co.id=p.candidacy_id",
  "JOIN election_candidates ca ON ca.id=co.candidate_id",
  "JOIN election_races r ON r.id=co.race_id",
  "JOIN campaign_sites w ON w.candidacy_id=co.id AND w.is_current",
  "WHERE p.state='published' AND p.validation->>'outcome'='valid'",
  "  AND co.eligibility='ballot-confirmed'",
  "  AND r.election_date >= date '2026-01-01' AND r.election_date < date '2027-01-01'",
  "  AND r.stage='general' AND r.contest_type IN ('regular','special')",
  "  AND w.status IN ('verified','ambiguous') AND w.review_after>now()",
  "  AND EXISTS(SELECT 1 FROM campaign_position_evidence pe JOIN campaign_sources es ON es.id=pe.snapshot_id",
  "    WHERE pe.position_version_id=p.id AND es.site_id=w.id AND es.candidacy_id=p.candidacy_id)",
  "  AND NOT EXISTS(SELECT 1 FROM campaign_position_evidence pe",
  "    JOIN campaign_processing_attempts pa ON pa.id=pe.attempt_id",
  "    WHERE pe.position_version_id=p.id AND pa.prompt_version=$1)",
  "ORDER BY ca.name,r.state,r.office,COALESCE(r.district,r.senate_seat),p.topic,p.id",
].join("\n");

const allDisplayableSql = [
  "SELECT count(*)::int AS total,",
  "  count(*) FILTER (WHERE latest.prompt_version=$1)::int AS actionFirst,",
  "  count(*) FILTER (WHERE latest.prompt_version IS DISTINCT FROM $1)::int AS remaining",
  "FROM campaign_position_versions p",
  "JOIN election_candidacies co ON co.id=p.candidacy_id",
  "JOIN election_races r ON r.id=co.race_id",
  "JOIN campaign_sites w ON w.candidacy_id=co.id AND w.is_current",
  "LEFT JOIN LATERAL (",
  "  SELECT pa.prompt_version FROM campaign_position_evidence pe",
  "  JOIN campaign_processing_attempts pa ON pa.id=pe.attempt_id",
  "  WHERE pe.position_version_id=p.id AND pe.presentation ? 'summary'",
  "  ORDER BY pa.created_at DESC,pa.id DESC LIMIT 1",
  ") latest ON true",
  "WHERE p.state='published' AND p.validation->>'outcome'='valid'",
  "  AND co.eligibility='ballot-confirmed'",
  "  AND r.election_date >= date '2026-01-01' AND r.election_date < date '2027-01-01'",
  "  AND r.stage='general' AND r.contest_type IN ('regular','special')",
  "  AND w.status IN ('verified','ambiguous') AND w.review_after>now()",
  "  AND EXISTS(SELECT 1 FROM campaign_position_evidence pe JOIN campaign_sources es ON es.id=pe.snapshot_id",
  "    WHERE pe.position_version_id=p.id AND es.site_id=w.id AND es.candidacy_id=p.candidacy_id)",
].join("\n");

try {
  const selected = (await db.query(eligibleSql, [SUMMARY_PROMPT_VERSION])).rows;
  console.log("Dev project ref: " + expectedProjectRef);
  console.log("Eligible published ballot-confirmed summaries needing refresh: " + selected.length);
  console.log("Prompt version: " + SUMMARY_PROMPT_VERSION);

  if (!apply && !preview) {
    console.log("Read-only preflight complete. Use --preview to generate sample copy or --apply to refresh all selected records.");
    process.exitCode = 0;
  } else {
    const provider = createCampaignSummaryRefreshProvider();
    if (preview) {
      const countArg = process.argv.find(value => value.startsWith("--preview-count="));
      const previewCount = Math.max(1, Math.min(batchSize, Number(countArg?.split("=")[1] ?? 8) || 8));
      const sample = selected.slice(0, previewCount);
      const rewritten = await provider.rewrite(sample);
      const byId = new Map(rewritten.map(item => [item.positionVersionId, item.summary]));
      for (const item of sample) {
        console.log(JSON.stringify({
          candidate: item.candidateName,
          state: item.state,
          topic: item.topic,
          currentSummary: item.currentSummary,
          rewrittenSummary: byId.get(item.positionVersionId),
        }));
      }
      console.log("Preview only; no database rows were changed.");
    } else {
      let written = 0;
      let skipped = 0;
      const batchCount = Math.ceil(selected.length / batchSize);
      for (let offset = 0, batchIndex = 0; offset < selected.length; offset += batchSize, batchIndex++) {
        const batch = selected.slice(offset, offset + batchSize);
        const rewritten = await provider.rewrite(batch);
        const result = await recordCampaignSummaryRefresh({
          model: provider.model,
          promptVersion: provider.promptVersion,
          items: rewritten,
        }, db);
        written += result.written;
        skipped += result.skipped;
        console.log("Saved batch " + (batchIndex + 1) + "/" + batchCount + ": " + result.written + " summaries; " + result.skipped + " no longer eligible.");
      }

      const audit = (await db.query(allDisplayableSql, [SUMMARY_PROMPT_VERSION])).rows[0];
      console.log(JSON.stringify({ written, skipped, currentlyDisplayable: audit.total, actionFirst: audit.actionfirst, remaining: audit.remaining }));
      if (audit.remaining !== 0) throw new Error("Refresh audit found displayable ballot summaries without the action-first presentation");
    }
  }
} finally {
  await db.end();
}
