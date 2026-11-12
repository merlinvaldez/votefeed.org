import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { generateQuickSummary } from "./quickSummary.ts";

// Publication marks durable retry work; historical unused bills are not backlog.
export async function refreshAiSummaries(supabase: SupabaseClient, apiKey: string | undefined) {
  if (!apiKey) return { generatedCount: 0, failedCount: 0 };
  const { data, error } = await supabase.from("bills")
    .select("id,summary").eq("ai_summary_needs_refresh", true)
    .not("summary", "is", null).neq("summary", "")
    .order("id", { ascending: true }).limit(1000);
  if (error) throw error;
  const candidates = data ?? [];
  const batchSize = 20;
  const batchCount = Math.max(1, Math.ceil(candidates.length / batchSize));
  const start = (Math.floor(Date.now() / 86_400_000) % batchCount) * batchSize;
  const selected = candidates.slice(start, start + batchSize);
  let generatedCount = 0;
  let failedCount = 0;
  let next = 0;
  const deadline = Date.now() + 50_000;
  await Promise.all(Array.from({ length: Math.min(4, selected.length) }, async () => {
    while (next < selected.length && Date.now() < deadline) {
      const bill = selected[next++];
      try {
        const text = await generateQuickSummary(apiKey, bill.summary);
        const { data: saved, error: writeError } = await supabase.from("bills")
          .update({ aisummary: text, ai_summary_needs_refresh: false }).eq("id", bill.id).eq("summary", bill.summary)
          .or("aisummary.is.null,aisummary.eq.").select("id");
        if (writeError) throw writeError;
        if (saved?.length) generatedCount += 1;
      } catch (error) {
        failedCount += 1;
        console.warn(`[sync-votes] AI summary deferred for bill ${bill.id}`, String(error));
      }
    }
  }));
  return { generatedCount, failedCount, deferredCount: candidates.length - next };
}
