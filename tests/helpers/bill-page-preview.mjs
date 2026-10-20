// Local-only UI fixture. Uses actual route/components with in-memory responses.
// Run: node tests/helpers/bill-page-preview.mjs
import { createServer } from "../../client/node_modules/vite/dist/node/index.js";
import react from "../../client/node_modules/@vitejs/plugin-react-swc/index.js";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../client", import.meta.url));
const people = [
  { bioguideid: "H", full_name: "House Member", chamber: "House of Representatives", state: "Alaska" },
  { bioguideid: "A", full_name: "Alice Smith", chamber: "Senate", state: "Alaska", official_website_url: "https://example.test/smith", office_phone: "202-555-0100" },
  { bioguideid: "B", full_name: "Robert Jones", chamber: "Senate", state: "Alaska", official_website_url: "https://example.test/jones", office_phone: "202-555-0101" },
];
const baseCard = (id, members, chamber, position, result) => ({ id, members, position,
  event: { chamber, congress: 119, session: 2, rollCall: 7 }, votedOn: "2026-10-01T12:00:00.000000Z",
  bill: { id: 7, congress: 119, type: "hr", number: 7 }, summary: { officialHtml: "<p>Official measure summary.</p>", simplifiedText: "improve public services" },
  result: { result, yes_count: chamber === "House" ? 220 : 40, no_count: chamber === "House" ? 200 : 60 } });
const members = people.map((person, index) => ({ bioguideId: person.bioguideid, name: person.full_name,
  memberVoteId: index + 1, chamber: index === 0 ? "House" : "Senate" }));
const answers = new Map();
const comments = new Map();
let nextId = 10;
const apiCalls = [];
const server = await createServer({ root, configFile: false, envDir: false,
  define: { "import.meta.env.VITE_API_URL": JSON.stringify("/test-api") },
  plugins: [{ name: "bill-ui-fixture", enforce: "pre",
    resolveId(source) {
      if (/AuthContext(?:\.jsx)?$/.test(source)) return "\0fixture-auth";
      if (source === "@clerk/clerk-react") return "\0fixture-avatar";
    },
    load(id) {
      if (id === "\0fixture-auth") return `const authFetch=(url,options)=>fetch(url,{...options,headers:{'Content-Type':'application/json',...options?.headers}}); export function useAuth(){return {token:new URLSearchParams(location.search).has('testUser')?'fixture':null,authFetch};}`;
      if (id === "\0fixture-avatar") return "export function UserAvatar(){return null;}";
      if (id.replaceAll('\\', '/').endsWith("/src/main.jsx")) return `
        import React from 'react'; import {createRoot} from 'react-dom/client';
        import {BrowserRouter,Routes,Route} from 'react-router-dom';
        import BillPage from './BillPageRoute.jsx'; import './index.css';
        createRoot(document.getElementById('root')).render(<BrowserRouter><main style={{maxWidth:1000,margin:'24px auto',padding:16}}><Routes><Route path="/bill/:billType/:billNumber" element={<BillPage/>}/></Routes></main></BrowserRouter>);`;
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith("/test-api")) return next();
        const url = new URL(req.url, "http://localhost");
        const path = url.pathname.replace("/test-api", "");
        apiCalls.push({ method: req.method, path, query: Object.fromEntries(url.searchParams) });
        const send = (data, status = 200) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(data)); };
        if (path === "/fixture-calls") return send(apiCalls);
        if (path.includes("/delegation/bills/")) {
          const split = url.searchParams.get("district") === "1";
          const senate = split ? [baseCard("senate-a", [members[1]], "Senate", "Yea", "Failed"), baseCard("senate-b", [members[2]], "Senate", "Not Voting", "Failed")]
            : [baseCard("senate", members.slice(1), "Senate", "Yea", "Failed")];
          return send({ bill: { id: 7, number: 7, bill_type: "hr", summary: "<p>This measure improves public services.</p>",
            aisummary: "improve public services", legislation_url: "https://www.congress.gov/bill/119th-congress/house-bill/7" },
            cards: [baseCard("house", [members[0]], "House", "Nay", "Passed"), ...senate],
            delegation: { houseMember: people[0], senators: people.slice(1) }, warnings: [] });
        }
        if (path === "/users/me") return send({ id: 1, first_name: "Fixture", state: "Alaska", district: 0 });
        if (path.includes("/comments/bills/")) return send({ comments: [] });
        if (path.includes("/interactions/users/")) return send(answers.get(url.searchParams.get("repBioguideId")) ?? null);
        if (req.method === "PUT" || req.method === "POST") {
          const chunks = []; for await (const chunk of req) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
          if (path === "/interactions/stances/batch") {
            const rows = body.members.map(member => ({ id: answers.get(member.rep_bioguide_id)?.id ?? nextId++,
              bill_id: body.bill_id, ...member, stance: body.stance }));
            rows.forEach(row => answers.set(row.rep_bioguide_id, row));
            return send({ interactions: rows });
          }
          apiCalls.at(-1).body = body;
          const existing = [...answers.values()].find(row => path.includes(`/${row.id}/`));
          if (path.endsWith("/comment/contact-drafts/group")) return send({ members: body.interactionIds.map(id => {
            const row = [...answers.values()].find(item => item.id === id);
            const person = people.find(item => item.bioguideid === row.rep_bioguide_id);
            return { memberId: person.bioguideid, interactionId: id, callScript: `Hello Senator ${person.full_name}. ${comments.get(existing.id).approved_text}`, messageTemplate: `Dear Senator ${person.full_name}, ${comments.get(existing.id).approved_text}` };
          }) });
          if (path.endsWith("/comment/submit")) {
            const priorComment = comments.get(existing.id) ?? {};
            const comment = { ...priorComment, id: priorComment.id ?? 50, draft_text: body.draft_text,
              approved_text: body.draft_text, moderation_status: "approved", updated_at: "2026-10-15T13:01:00Z" };
            comments.set(existing.id, comment); return send(comment);
          }
          if (path.endsWith("/comment")) {
            const comment = { id: 50, ...comments.get(existing.id), draft_text: body.draft_text, moderation_status: "draft", updated_at: "2026-10-15T13:00:00Z" };
            comments.set(existing.id, comment); return send(comment);
          }
          const row = existing ? { ...existing, ...body } : { ...body, id: nextId++ };
          answers.set(row.rep_bioguide_id, row);
          return send(row);
        }
        return send({ error: `Unimplemented fixture path ${path}` }, 404);
      });
    },
  }, react()], server: { host: "127.0.0.1", port: 4180, strictPort: true } });
await server.listen();
console.log("Bill UI fixture: http://127.0.0.1:4180/bill/hr/7?congress=119&chamber=Senate&state=Alaska&district=0&cardId=senate");
