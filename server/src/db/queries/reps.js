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
      office_phone
    )
    VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (bioguideId) DO UPDATE SET
    full_name= EXCLUDED.full_name,
    party= EXCLUDED.party,
    chamber= EXCLUDED.chamber,
    state= EXCLUDED.state,
    congressionalDistrict= EXCLUDED.congressionalDistrict,
    image_url = EXCLUDED.image_url,
    official_website_url = EXCLUDED.official_website_url,
    office_phone = EXCLUDED.office_phone
    RETURNING *`;
    const params = [
      rep.bioguideId,
      rep.name,
      rep.partyName,
      rep.terms.item[0].chamber,
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

export async function findRepByDistrict(state, congressionalDistrict) {
  const sql = ` SELECT * FROM reps 
  WHERE state=$1 AND congressionalDistrict=$2 
`;

  const {
    rows: [rep],
  } = await db.query(sql, [state, congressionalDistrict]);
  return rep;
}

export async function findRepByBioguideId(bioguideId, runner = db) {
  const sql = `SELECT * FROM reps WHERE bioguideId=$1`;
  const {
    rows: [rep],
  } = await runner.query(sql, [bioguideId]);
  return rep;
}
