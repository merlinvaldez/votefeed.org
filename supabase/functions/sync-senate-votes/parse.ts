import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false });
const billTypes = new Set(["hr", "hres", "hjres", "hconres", "s", "sres", "sjres", "sconres"]);

const stringValue = (value: unknown) => String(value ?? "").trim();
const positiveInteger = (value: unknown) => {
  const text = stringValue(value);
  const number = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(number) || number < 1) {
    throw new Error(`Invalid positive integer: ${text}`);
  }
  return number;
};

const count = (value: unknown) => {
  const text = stringValue(value);
  if (text === "") return 0;
  if (!/^\d+$/.test(text)) throw new Error(`Invalid vote count: ${text}`);
  return Number(text);
};

const dateValue = (value: unknown) => {
  // Senate LIS dates are Eastern local time and do not include a zone.
  const localAsUtc = Date.parse(`${stringValue(value)} UTC`);
  if (!Number.isFinite(localAsUtc)) throw new Error(`Invalid Senate date: ${value}`);
  const zone = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  }).formatToParts(new Date(localAsUtc)).find((part) => part.type === "timeZoneName")?.value;
  const offset = zone?.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!offset) throw new Error(`Could not determine Eastern offset for ${value}`);
  const minutes = (Number(offset[2]) * 60 + Number(offset[3] ?? 0)) * (offset[1] === "+" ? 1 : -1);
  return new Date(localAsUtc - minutes * 60_000).toISOString();
};

export type SenateBill = { type: string; number: number; title: string | null };
export type SenatePosition = { lisId: string; state: string; lastName: string; vote: string };
export type ParsedSenateVote = {
  congress: number;
  session: number;
  roll: number;
  votedOn: string;
  modifiedOn: string | null;
  title: string;
  question: string;
  result: string;
  yes: number;
  no: number;
  notVoting: number;
  bill: SenateBill | null;
  positions: SenatePosition[];
};

export function parseSenateMenu(xml: string, congress: number, session: number): number[] {
  const root = parser.parse(xml)?.vote_summary;
  if (!root || positiveInteger(root.congress) !== congress ||
      positiveInteger(root.session) !== session) {
    throw new Error("Senate vote menu has the wrong Congress or session");
  }
  const votes = root.votes?.vote;
  const list = votes == null ? [] : Array.isArray(votes) ? votes : [votes];
  const rolls = list.map((vote) => positiveInteger(vote.vote_number));
  if (new Set(rolls).size !== rolls.length) throw new Error("Duplicate roll number in Senate menu");
  return rolls.sort((a, b) => a - b);
}

function billFromDocument(root: Record<string, unknown>): SenateBill | null {
  const document = (root.document ?? {}) as Record<string, unknown>;
  let type = stringValue(document.document_type).replace(/\./g, "").toLowerCase();
  let numberText = stringValue(document.document_number);
  let title = stringValue(document.document_title) || null;

  if (!billTypes.has(type) || !/^\d+$/.test(numberText)) {
    const amendment = (root.amendment ?? {}) as Record<string, unknown>;
    const underlying = stringValue(amendment.amendment_to_document_number)
      .match(/^(H\.R\.|H\.Res\.|H\.J\.Res\.|H\.Con\.Res\.|S\.|S\.Res\.|S\.J\.Res\.|S\.Con\.Res\.)\s*(\d+)$/i);
    if (!underlying) return null;
    type = underlying[1].replace(/\./g, "").toLowerCase();
    numberText = underlying[2];
    title = null;
  }
  if (!billTypes.has(type)) return null;
  return { type, number: positiveInteger(numberText), title };
}

export function parseSenateVote(xml: string, congress: number, session: number, roll: number): ParsedSenateVote {
  const root = parser.parse(xml)?.roll_call_vote;
  if (!root || positiveInteger(root.congress) !== congress ||
      positiveInteger(root.session) !== session || positiveInteger(root.vote_number) !== roll) {
    throw new Error(`Senate vote identity mismatch for roll ${roll}`);
  }
  const rawMembers = root.members?.member;
  const members = rawMembers == null ? [] : Array.isArray(rawMembers) ? rawMembers : [rawMembers];
  if (members.length === 0) throw new Error(`Roll ${roll} has no member positions`);
  const positions = members.map((member: Record<string, unknown>) => {
    const lisId = stringValue(member.lis_member_id);
    const state = stringValue(member.state);
    const lastName = stringValue(member.last_name);
    const vote = stringValue(member.vote_cast);
    if (!lisId || !state || !lastName || !["Yea", "Nay", "Present", "Not Voting", "Guilty", "Not Guilty"].includes(vote)) {
      throw new Error(`Incomplete member position in Senate roll ${roll}`);
    }
    return { lisId, state, lastName, vote };
  });
  if (new Set(positions.map((position) => position.lisId)).size !== positions.length) {
    throw new Error(`Duplicate member in Senate roll ${roll}`);
  }
  const totals = root.count ?? {};
  const yes = count(totals.yeas);
  const no = count(totals.nays);
  const notVoting = count(totals.absent) + count(totals.present);
  if (yes + no + notVoting !== positions.length) {
    throw new Error(`Roll ${roll} has ${positions.length} members but ${yes + no + notVoting} counted positions`);
  }
  return {
    congress,
    session,
    roll,
    votedOn: dateValue(root.vote_date),
    modifiedOn: stringValue(root.modify_date) ? dateValue(root.modify_date) : null,
    title: stringValue(root.vote_title),
    question: stringValue(root.vote_question_text || root.question),
    result: stringValue(root.vote_result),
    yes,
    no,
    notVoting,
    bill: billFromDocument(root),
    positions,
  };
}
