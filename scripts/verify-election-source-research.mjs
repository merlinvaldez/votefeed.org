import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { STATES, normalizeRace, isReleaseRace } from '../server/src/elections/contracts.js';

// Offline artifact verification only: no provider calls, credentials, or database.
const root = new URL('../', import.meta.url);
const fixtureRoot = new URL('tests/fixtures/elections/discovery/2026-10-26/', root);
const json = async url => JSON.parse(await readFile(url, 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const inventory = await json(new URL('specs/elections-source-inventory.json', root));
assert.deepEqual(inventory.states.map(s => s.state).sort(), [...STATES].sort());
assert.equal(inventory.states.length, 50);
assert.equal(inventory.checkedOn, '2026-10-26');
for (const state of inventory.states) {
  assert.ok(state.authority && new URL(state.authorityDirectoryUrl));
  assert.deepEqual(Object.keys(state.offices).sort(), ['house', 'senate']);
  for (const [office,entry] of Object.entries(state.offices)) assert.equal(entry.coverage,
    ['WY','DE','NH','NE'].includes(state.state) || state.state==='MO' && office==='house' ? 'partial' : 'unsupported');
  if (!['WY','DE','ND','MO','NH','NE'].includes(state.state)) {
    assert.equal(state.sourceAuditStatus, 'unresearched');
    for (const field of ['artifactCheckedOn', 'candidateListUrl', 'calendarUrl', 'correctionsUrl']) assert.equal(state[field], null);
  }
}
const manifest = await json(new URL('manifest.json', fixtureRoot));
const files = new Map();
for (const capture of manifest.requests) {
  assert.equal(new URL(capture.url).searchParams.has('api_key'), false);
  assert.equal(capture.checkedOn, '2026-10-26');
  if (!capture.file) continue;
  assert.match(capture.file, /^[a-z0-9.-]+$/);
  assert.equal(files.has(capture.file), false);
  const bytes = await readFile(new URL(capture.file, fixtureRoot));
  assert.equal(capture.status, 200);
  assert.equal(bytes.length, capture.bytes);
  assert.equal(digest(bytes), capture.sha256, capture.file);
  files.set(capture.file, capture);
  if (capture.file.endsWith('.json')) JSON.parse(bytes.toString('utf8'));
}
for (const derived of manifest.derivedArtifacts) {
  assert.match(derived.file, /^[a-z0-9.-]+$/);
  const bytes = await readFile(new URL(derived.file, fixtureRoot));
  assert.equal(digest(bytes), derived.sha256, derived.file);
  assert.ok(derived.sources.every(file => files.has(file)));
}
const get = name => json(new URL(name, fixtureRoot));
const [page1, page2, house, senate, observations, committees] = await Promise.all([
  get('fec-wy-house-page-1.json'), get('fec-wy-house-page-2.json'), get('fec-wy-house-complete.json'),
  get('fec-wy-senate.json'), get('wy-federal-observations.json'), get('fec-hageman-committees.json'),
]);
const ids = response => response.results.map(row => row.candidate_id);
assert.equal(page1.pagination.pages, 7);
assert.equal(page2.pagination.page, 2);
assert.equal(page1.pagination.per_page, 2);
assert.equal(page2.pagination.per_page, 2);
assert.equal(house.pagination.pages, 1);
assert.equal(house.results.length, house.pagination.count);
assert.equal(senate.results.length, senate.pagination.count);
assert.equal(senate.pagination.pages, 1);
const pagedIds = [...ids(page1), ...ids(page2)];
assert.equal(new Set(pagedIds).size, 4);
assert.deepEqual(pagedIds, ids(house).slice(0, 4));
assert.equal(new Set(ids(house)).size, house.results.length);
assert.ok(house.results.every(row => row.state === 'WY' && row.office === 'H' && row.district === '00'));
assert.ok(senate.results.every(row => row.state === 'WY' && row.office === 'S'));
assert.ok([...house.results, ...senate.results].every(row => row.election_years.includes(2026)));
assert.equal(observations.notImportReady, true);
assert.equal(observations.observations.length, 6);
for (const item of observations.observations) {
  assert.equal(item.officialCandidateId, null);
  assert.equal(item.fecCandidateId, null);
  assert.equal(item.matchStatus, 'unresolved');
  assert.equal(item.recordLocator.artifactSha256, files.get(item.recordLocator.artifact).sha256);
  assert.ok(Number.isInteger(item.recordLocator.dataRow) && item.recordLocator.dataRow > 0);
  assert.ok(isReleaseRace(item.proposedRace));
  const race = normalizeRace(item.proposedRace);
  assert.equal(race.state, 'WY');
  assert.equal(race.electionDate, '2026-11-03');
  assert.equal(item.raw.Election, '2026 GENERAL ELECTION');
  assert.equal(item.raw['Office Sought'], race.office === 'house' ? 'UNITED STATES REPRESENTATIVE' : 'UNITED STATES SENATOR');
  assert.equal(race.office === 'house' ? race.district : race.senateSeat, race.office === 'house' ? 0 : 2);
  assert.equal(item.proposedCampaignUrl, item.raw['Web Address'] || null);
  assert.equal(item.siteStatus, item.proposedCampaignUrl ? 'proposed' : 'missing');
}
assert.equal(observations.observations.filter(item => item.proposedRace.office === 'house').length, 4);
assert.equal(observations.observations.filter(item => item.siteStatus === 'missing').length, 1);
assert.ok(committees.results.some(row => row.committee_id === 'C00788943'
  && row.candidate_ids.includes('S6WY00209') && row.website === 'WWW.HAGEMANFORWYOMING.COM'));
console.log(`Verified 50 states / 100 office entries (five states with partial coverage; ND retrieval gap), ${files.size} original source captures, pagination, and six Wyoming research observations. Run verify-election-onboarding.mjs for the expanded batch.`);
console.log('Offline evidence integrity only: run elections discovery tests separately; corrections, geography, and nationwide acceptance remain open.');
