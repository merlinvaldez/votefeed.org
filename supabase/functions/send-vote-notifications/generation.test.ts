import { generateQuickSummary } from "../_shared/quickSummary.ts";

Deno.test("title-based AI input is explicitly limited to facts in the title", async () => {
  const original = globalThis.fetch;
  let body: Record<string, string> | undefined;
  globalThis.fetch = ((_url: unknown, options: RequestInit) => {
    body = JSON.parse(String(options.body));
    return Promise.resolve(Response.json({ output: [{content:[{type:"output_text",text:"protect student athletes"}]}] }));
  }) as typeof fetch;
  try {
    const text = await generateQuickSummary("fake", "Protect Student Athletes Act", "title");
    if (text !== "protect student athletes") throw new Error("Invalid AI response");
    if (!body?.instructions.includes("do not infer details")) throw new Error("Missing title constraint");
    if (JSON.parse(body.input).bill_title !== "Protect Student Athletes Act") throw new Error("Missing title input");
  } finally { globalThis.fetch = original; }
});
