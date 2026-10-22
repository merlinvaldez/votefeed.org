import assert from "node:assert/strict";
import test from "node:test";
import { officialBillUrl } from "../supabase/functions/_shared/billUrl.ts";

test("official measure links cover all bill types and Congress ordinal boundaries", () => {
  const types = { hr: "house-bill", s: "senate-bill", hres: "house-resolution", sres: "senate-resolution",
    hjres: "house-joint-resolution", sjres: "senate-joint-resolution",
    hconres: "house-concurrent-resolution", sconres: "senate-concurrent-resolution" };
  for (const [type, path] of Object.entries(types)) {
    assert.equal(officialBillUrl(119, type, 4668), `https://www.congress.gov/bill/119th-congress/${path}/4668`);
  }
  for (const [congress, suffix] of [[111,"th"],[112,"th"],[113,"th"],[121,"st"],[122,"nd"],[123,"rd"]]) {
    assert.match(officialBillUrl(congress,"s",1), new RegExp(`/${congress}${suffix}-congress/`));
  }
  for (const args of [[119,"pn",1],[119,"s",0],[0,"s",1],[119,"s",1.5]]) {
    assert.throws(() => officialBillUrl(...args), /Invalid official bill identity/);
  }
});
