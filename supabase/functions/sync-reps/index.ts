import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { json } from "../_shared/http.ts";

const CONGRESS_MEMBERS_URL = "https://api.congress.gov/v3/member";
const MIN_EXPECTED_HOUSE_MEMBERS = 400;
const MIN_EXPECTED_SENATE_MEMBERS = 90;
const UPSERT_BATCH_SIZE = 100;
const UPDATE_BATCH_SIZE = 100;
// Congress.gov omits the district for these at-large House members.
const AT_LARGE_JURISDICTIONS = new Set([
  "alaska",
  "american samoa",
  "delaware",
  "district of columbia",
  "guam",
  "northern mariana islands",
  "north dakota",
  "puerto rico",
  "south dakota",
  "vermont",
  "virgin islands",
  "wyoming",
]);

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
  congressionaldistrict: number | null;
  image_url: string | null;
  is_current_member: true;
  last_seen_at: string;
};

type CurrentHouseRep = {
  bioguideid: string;
  state: string;
  congressionaldistrict: number;
};

function districtKey(state: string, district: number) {
  return `${state.trim().toLowerCase()}:${district}`;
}

function getCurrentChamber(member: CongressMember) {
  const terms = member.terms?.item ?? [];
  return String(terms[terms.length - 1]?.chamber ?? "").trim();
}

function isCurrentHouseRep(
  member: RepUpsert,
): member is RepUpsert & { congressionaldistrict: number } {
  return member.chamber.toLowerCase().includes("house") &&
    Number.isInteger(member.congressionaldistrict);
}

function normalizeHouseDistrict(state: string, rawDistrict: unknown) {
  const rawValue = rawDistrict == null ? "" : String(rawDistrict).trim();
  if (!rawValue) {
    return AT_LARGE_JURISDICTIONS.has(state.trim().toLowerCase()) ? 0 : null;
  }

  const district = Number(rawValue);
  return Number.isSafeInteger(district) && district >= 0 ? district : null;
}

function toCurrentMember(
  member: CongressMember,
  seenAt: string,
): RepUpsert | null {
  const chamber = getCurrentChamber(member);
  const normalizedChamber = chamber.toLowerCase();
  const isHouse = normalizedChamber.includes("house");
  const isSenate = normalizedChamber.includes("senate");
  const district = isHouse
    ? normalizeHouseDistrict(member.state ?? "", member.district)
    : null;
  if (
    (!isHouse && !isSenate) ||
    !member.bioguideId ||
    !member.name ||
    !member.partyName ||
    !member.state ||
    (isHouse && district === null)
  ) {
    return null;
  }

  return {
    bioguideid: member.bioguideId,
    full_name: member.name,
    party: member.partyName,
    chamber,
    state: member.state,
    congressionaldistrict: isHouse ? district : null,
    image_url: member.depiction?.imageUrl ?? null,
    is_current_member: true,
    last_seen_at: seenAt,
  };
}

async function fetchCurrentMembers(apiKey: string, seenAt: string) {
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

  const currentMembers = members
    .map((member) => toCurrentMember(member, seenAt))
    .filter((rep): rep is RepUpsert => rep !== null);
  const houseReps = currentMembers.filter(isCurrentHouseRep);
  const senators = currentMembers.filter((member) =>
    member.chamber.toLowerCase().includes("senate")
  );
  if (houseReps.length < MIN_EXPECTED_HOUSE_MEMBERS) {
    throw new Error(
      `Refusing to deactivate representatives: Congress returned only ${houseReps.length} current House members`,
    );
  }
  if (senators.length < MIN_EXPECTED_SENATE_MEMBERS) {
    throw new Error(
      `Refusing to deactivate representatives: Congress returned only ${senators.length} current Senators`,
    );
  }

  const districtMembers = new Map<string, string>();
  for (const rep of houseReps) {
    const key = districtKey(rep.state, rep.congressionaldistrict);
    const existingBioguideId = districtMembers.get(key);
    if (existingBioguideId && existingBioguideId !== rep.bioguideid) {
      throw new Error(
        `Refusing to sync representatives: Congress returned multiple current House members for ${rep.state} district ${rep.congressionaldistrict}`,
      );
    }
    districtMembers.set(key, rep.bioguideid);
  }
  const senatorsPerState = new Map<string, number>();
  for (const senator of senators) {
    const state = senator.state.trim().toUpperCase();
    const count = (senatorsPerState.get(state) ?? 0) + 1;
    if (count > 2) {
      throw new Error(
        `Refusing to sync representatives: Congress returned more than two current Senators for ${state}`,
      );
    }
    senatorsPerState.set(state, count);
  }

  return { currentMembers, houseReps, senators };
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
    const { currentMembers, houseReps, senators } = await fetchCurrentMembers(
      congressApiKey,
      seenAt,
    );
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const currentDistrictMembers = new Map(
      houseReps.map((rep) => [
        districtKey(rep.state, rep.congressionaldistrict),
        rep.bioguideid,
      ]),
    );
    const { data: activeHouseReps, error: activeHouseRepsError } = await supabase
      .from("reps")
      .select("bioguideid,state,congressionaldistrict")
      .ilike("chamber", "%house%")
      .eq("is_current_member", true)
      .not("congressionaldistrict", "is", null);
    if (activeHouseRepsError) throw activeHouseRepsError;

    const displacedBioguideIds = ((activeHouseReps ?? []) as CurrentHouseRep[])
      .filter((rep) => {
        const incomingBioguideId = currentDistrictMembers.get(
          districtKey(rep.state, rep.congressionaldistrict),
        );
        return incomingBioguideId !== undefined &&
          incomingBioguideId !== rep.bioguideid;
      })
      .map((rep) => rep.bioguideid);

    for (
      let offset = 0;
      offset < displacedBioguideIds.length;
      offset += UPDATE_BATCH_SIZE
    ) {
      const { error } = await supabase
        .from("reps")
        .update({ is_current_member: false })
        .in(
          "bioguideid",
          displacedBioguideIds.slice(offset, offset + UPDATE_BATCH_SIZE),
        );
      if (error) throw error;
    }

    for (
      let offset = 0;
      offset < currentMembers.length;
      offset += UPSERT_BATCH_SIZE
    ) {
      const { error } = await supabase
        .from("reps")
        .upsert(currentMembers.slice(offset, offset + UPSERT_BATCH_SIZE), {
          onConflict: "bioguideid",
        });
      if (error) throw error;
    }

    const { data: deactivatedHouse, error: deactivateHouseError } = await supabase
      .from("reps")
      .update({ is_current_member: false })
      .ilike("chamber", "%house%")
      .eq("is_current_member", true)
      .or(`last_seen_at.is.null,last_seen_at.lt.${seenAt}`)
      .select("bioguideid");
    if (deactivateHouseError) throw deactivateHouseError;

    const { data: deactivatedSenate, error: deactivateSenateError } =
      await supabase
        .from("reps")
        .update({ is_current_member: false })
        .ilike("chamber", "%senate%")
        .eq("is_current_member", true)
        .or(`last_seen_at.is.null,last_seen_at.lt.${seenAt}`)
        .select("bioguideid");
    if (deactivateSenateError) throw deactivateSenateError;

    return json({
      currentHouseMemberCount: houseReps.length,
      currentSenatorCount: senators.length,
      deactivatedMemberCount:
        (deactivatedHouse?.length ?? 0) + (deactivatedSenate?.length ?? 0),
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
