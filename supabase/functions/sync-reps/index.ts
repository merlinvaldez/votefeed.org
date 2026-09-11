import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { json } from "../_shared/http.ts";

const CONGRESS_MEMBERS_URL = "https://api.congress.gov/v3/member";
const MIN_EXPECTED_HOUSE_MEMBERS = 400;
const UPSERT_BATCH_SIZE = 100;

type CongressTerm = {
  chamber?: string;
};

type CongressMember = {
  bioguideId?: string;
  name?: string;
  partyName?: string;
  state?: string;
  district?: number | string | null;
  depiction?: { imageUrl?: string };
  terms?: { item?: CongressTerm[] };
};

type RepUpsert = {
  bioguideid: string;
  full_name: string;
  party: string;
  chamber: string;
  state: string;
  congressionaldistrict: number;
  image_url: string | null;
  is_current_member: true;
  last_seen_at: string;
};

function getCurrentChamber(member: CongressMember) {
  return String(member.terms?.item?.[0]?.chamber ?? "").trim();
}

function toCurrentHouseRep(
  member: CongressMember,
  seenAt: string,
): RepUpsert | null {
  const chamber = getCurrentChamber(member);
  const district = Number(member.district);
  if (
    !chamber.toLowerCase().includes("house") ||
    !member.bioguideId ||
    !member.name ||
    !member.partyName ||
    !member.state ||
    !Number.isInteger(district)
  ) {
    return null;
  }

  return {
    bioguideid: member.bioguideId,
    full_name: member.name,
    party: member.partyName,
    chamber,
    state: member.state,
    congressionaldistrict: district,
    image_url: member.depiction?.imageUrl ?? null,
    is_current_member: true,
    last_seen_at: seenAt,
  };
}

async function fetchCurrentHouseMembers(apiKey: string, seenAt: string) {
  const members: CongressMember[] = [];
  const firstUrl = new URL(CONGRESS_MEMBERS_URL);
  firstUrl.searchParams.set("api_key", apiKey);
  firstUrl.searchParams.set("format", "json");
  firstUrl.searchParams.set("currentMember", "true");
  firstUrl.searchParams.set("limit", "250");

  let nextUrl: string | null = firstUrl.toString();
  while (nextUrl) {
    const response = await fetch(nextUrl);
    const details = await response.text();
    if (!response.ok) {
      throw new Error(
        `Congress member fetch failed ${response.status}: ${details}`,
      );
    }
    const payload = JSON.parse(details);
    members.push(...(payload.members ?? []));
    const paginationNext = payload.pagination?.next ?? null;
    if (!paginationNext) {
      nextUrl = null;
      continue;
    }
    const next = new URL(paginationNext);
    next.searchParams.set("api_key", apiKey);
    next.searchParams.set("format", "json");
    next.searchParams.set("currentMember", "true");
    nextUrl = next.toString();
  }

  const reps = members
    .map((member) => toCurrentHouseRep(member, seenAt))
    .filter((rep): rep is RepUpsert => rep !== null);
  if (reps.length < MIN_EXPECTED_HOUSE_MEMBERS) {
    throw new Error(
      `Refusing to deactivate representatives: Congress returned only ${reps.length} current House members`,
    );
  }
  return reps;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const congressApiKey = Deno.env.get("CONGRESS_API_KEY");
  if (!supabaseUrl || !serviceRoleKey || !congressApiKey) {
    return json({ error: "Missing function secrets" }, 500);
  }

  try {
    const seenAt = new Date().toISOString();
    const reps = await fetchCurrentHouseMembers(congressApiKey, seenAt);
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    for (let offset = 0; offset < reps.length; offset += UPSERT_BATCH_SIZE) {
      const { error } = await supabase
        .from("reps")
        .upsert(reps.slice(offset, offset + UPSERT_BATCH_SIZE), {
          onConflict: "bioguideid",
        });
      if (error) throw error;
    }

    const { data: deactivated, error: deactivateError } = await supabase
      .from("reps")
      .update({ is_current_member: false })
      .ilike("chamber", "%house%")
      .eq("is_current_member", true)
      .or(`last_seen_at.is.null,last_seen_at.lt.${seenAt}`)
      .select("bioguideid");
    if (deactivateError) throw deactivateError;

    return json({
      currentHouseMemberCount: reps.length,
      deactivatedMemberCount: deactivated?.length ?? 0,
      syncedAt: seenAt,
    });
  } catch (error) {
    console.error(error);
    return json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      500,
    );
  }
});
