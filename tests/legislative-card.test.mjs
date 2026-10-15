import { createRequire } from "node:module";
const require = createRequire(new URL("../client/package.json", import.meta.url));
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../client/node_modules/vite/dist/node/index.js";
import react from "../client/node_modules/@vitejs/plugin-react-swc/index.js";
import { memberSurname, cardMemberNames } from "../client/src/legislativeCardNames.js";

test("member copy preserves compound surnames and drops suffixes", () => {
  for (const [name, expected] of [["Robert Garcia Jr.", "Garcia"], ["Garcia, Robert", "Garcia"],
    ["Chris Van Hollen", "Van Hollen"], ["Catherine Cortez Masto", "Cortez Masto"], ["Alex de la Cruz", "de la Cruz"], ["John Smith, Jr.", "Smith"], ["", "Unknown member"]]) {
    assert.equal(memberSurname(name), expected);
  }
  assert.equal(cardMemberNames([{name:"Chuck Schumer",chamber:"Senate"},{name:"Kirsten Gillibrand",chamber:"Senate"}]).surnames, "Schumer and Gillibrand");
});

test("rendered cards retain identity, truthful positions, selected states and semantic controls", async () => {
  const server = await createServer({ root: process.cwd() + "/client", configFile: false, envDir: false, cacheDir: "node_modules/.vite-card-tests",
    plugins: [react()], server: { middlewareMode: true }, appType: "custom" });
  try {
    const { default: Card } = await server.ssrLoadModule("/src/LegislativeVoteCard.jsx");
    const members = [{bioguideId:"A",party:"Democratic",name:"Chuck Schumer",chamber:"Senate",memberVoteId:1},
      {bioguideId:"B",party:"Republican",name:"Kirsten Gillibrand",chamber:"Senate",memberVoteId:2}];
    const vote = { id:"pair", members, bill:{id:7,congress:119,type:"hr",number:9576}, position:"Yea",
      legislation_type:"hr",legislationnumber:9576,voted_on:"2026-09-16T12:00:00Z",
      simplifiedText:"improve public services",officialSummary:"<p>Official text.</p>",vote_result:"Passed" };
    const props = {vote,interactions:[],isAuthed:true,stancePending:{},showOriginalByCard:{},aiLoadingByBill:{},aiSummaryByBill:{},aiErrorByBill:{}};
    const answer = (m, stance) => ({id:m.memberVoteId,bill_id:7,rep_bioguide_id:m.bioguideId,member_vote_id:m.memberVoteId,stance});
    const render = changes => renderToStaticMarkup(createElement(Card, {...props,...changes}));
    const neutral = render({});
    assert.match(neutral,/border-color:#2563eb/);
    assert.match(neutral,/border-color:#dc2626/);
    assert.match(neutral,/Sens\. Schumer and Gillibrand/);
    assert.match(neutral,/aria-label="Agree with Sens\. Chuck Schumer and Kirsten Gillibrand"/);
    assert.equal((neutral.match(/class="comments"/g)||[]).length,1);
    assert.doesNotMatch(neutral,/Passed|leg-vote|I agree with/);
    for (const stance of ["approve","disapprove"]) {
      const html = render({interactions:members.map(m=>answer(m,stance))});
      assert.match(html,new RegExp('active '+stance));
      assert.match(html,/aria-pressed="true"/);
    }
    for (const [status, interactions] of [["Mixed",members.map((m,i)=>answer(m,i?"disapprove":"approve"))],["Partial",[answer(members[0],"approve")]]]) {
      const html=render({interactions});
      assert.match(html,new RegExp(status+' response'));
      assert.match(html,/aria-describedby=/);
      assert.doesNotMatch(html,/active approve|active disapprove/);
    }
    for (const [position, wording] of [["Not Voting","did not vote"],["Present","were recorded as"]]) {
      assert.match(render({vote:{...vote,position}}),new RegExp(wording));
    }
    const house=render({vote:{...vote,members:[{...members[0],name:"Robert Garcia Jr.",chamber:"House"}]}});
    assert.match(house,/Rep\. Garcia/);
    assert.match(render({showOriginalByCard:{pair:true}}),/Official text/);
    assert.match(render({stancePending:{1:true}}),/aria-busy="true"/);
  } finally { await server.close(); }
});
