import db from "../client.js";

const congressApiKey = process.env.CONGRESS_API_KEY;

async function fetchMemberContactDetails(bioguideId) {
  if (!bioguideId) {
    return {
      officialWebsiteUrl: null,
      officePhone: null,
    };
  }
  if (!congressApiKey) {
    throw new Error("Missing Congress API Key");
  }

  const detailsUrl = new URL(`https://api.congress.gov/v3/member/${bioguideId}`);
  detailsUrl.searchParams.set("api_key", congressApiKey);
  detailsUrl.searchParams.set("format", "json");

  const resp = await fetch(detailsUrl);
  if (!resp.ok) {
    const details = await resp.text();
    throw new Error(
      `getAllReps member details failed ${resp.status} for ${bioguideId} - ${details}`,
    );
  }

  const { member } = await resp.json();
  const officePhone =
    member?.addressInformation?.phoneNumber ??
    member?.addressInformation?.officeTelephone?.phoneNumber ??
    member?.addressInformation?.officeTelephone ??
    null;
  return {
    officialWebsiteUrl: member?.officialWebsiteUrl ?? null,
    officePhone,
  };
}

export async function getAllReps(runner = db) {
  const base = `http://localhost:${process.env.PORT || 4000}`;
  const repsUrl = new URL("reps", base);

  const resp = await fetch(repsUrl);
  if (!resp.ok) throw new Error(`getAllReps Query failed ${resp.status}`);
  const { members = [] } = await resp.json();
  const inserted = [];
  for (const rep of members) {
    const currentTerms = rep.terms?.item ?? [];
    const chamber = currentTerms[currentTerms.length - 1]?.chamber;
    if (!chamber) {
      throw new Error(
        `getAllReps Query returned no current chamber for ${rep.bioguideId ?? "unknown member"}`,
      );
    }
    const contact = await fetchMemberContactDetails(rep.bioguideId);
    const sql = `INSERT INTO reps
    (
      bioguideId,
      full_name,
      party,
      chamber,
      state,
      congressionalDistrict,
      image_url,
      official_website_url,
      office_phone,
      is_current_member,
      last_seen_at
    )
    VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, NOW())
    ON CONFLICT (bioguideId) DO UPDATE SET
    full_name= EXCLUDED.full_name,
    party= EXCLUDED.party,
    chamber= EXCLUDED.chamber,
    state= EXCLUDED.state,
    congressionalDistrict= EXCLUDED.congressionalDistrict,
    image_url = EXCLUDED.image_url,
    official_website_url = EXCLUDED.official_website_url,
    office_phone = EXCLUDED.office_phone,
    is_current_member = true,
    last_seen_at = NOW()
    RETURNING *`;
    const params = [
      rep.bioguideId,
      rep.name,
      rep.partyName,
      chamber,
      rep.state,
      rep.district,
      rep.depiction?.imageUrl ?? null,
      contact.officialWebsiteUrl,
      contact.officePhone,
    ];
    const {
      rows: [representative],
    } = await runner.query(sql, params);
    inserted.push(representative);
  }
  return inserted;
}

export async function findRepByDistrict(state, congressionalDistrict, runner = db) {
  const sql = ` SELECT * FROM reps 
  WHERE state=$1 AND congressionalDistrict=$2 
    AND chamber = 'House of Representatives'
    AND is_current_member = true
`;

  const {
    rows: [rep],
  } = await runner.query(sql, [state, congressionalDistrict]);
  return rep;
}

export async function findCurrentMembersByStateAndChamber(
  state,
  chamber,
  runner = db,
) {
  const normalizedState = String(state ?? "").trim().replace(/\s+/g, " ");
  const normalizedChamber = String(chamber ?? "").trim();
  const sql = `SELECT * FROM reps
    WHERE LOWER(BTRIM(state)) = LOWER($1)
      AND LOWER(chamber) = LOWER($2)
      AND is_current_member = true
    ORDER BY full_name ASC`;
  const { rows } = await runner.query(sql, [normalizedState, normalizedChamber]);
  return rows;
}

export async function findRepByBioguideId(bioguideId, runner = db) {
  const sql = `SELECT * FROM reps WHERE bioguideId=$1`;
  const {
    rows: [rep],
  } = await runner.query(sql, [bioguideId]);
  return rep;
}
