import assert from 'node:assert/strict';
import test from 'node:test';
import { getCardResponseTargets, buildMemberStancePayload, findVoteInteraction } from '../client/src/voteInteractions.js';

const card = { bill: { id: 7 }, members: [
  { bioguideId: 'S1', memberVoteId: 101, name: 'First Senator', chamber: 'Senate' },
  { bioguideId: 'S2', memberVoteId: 102, name: 'Second Senator', chamber: 'Senate' },
] };

test('card responses retain individual Senate identities and exact vote links', () => {
  const targets = getCardResponseTargets(card);
  assert.deepEqual(targets.map(t => buildMemberStancePayload(t, 'approve')), [
    { bill_id: 7, rep_bioguide_id: 'S1', member_vote_id: 101, stance: 'approve' },
    { bill_id: 7, rep_bioguide_id: 'S2', member_vote_id: 102, stance: 'approve' },
  ]);
  const interactions = [
    { id: 1, bill_id: 7, rep_bioguide_id: 'H', member_vote_id: 101 },
    { id: 2, bill_id: 7, rep_bioguide_id: 'S1', member_vote_id: 99 },
    { id: 3, bill_id: 7, rep_bioguide_id: 'S1', member_vote_id: 101 },
  ];
  assert.equal(findVoteInteraction(interactions, targets[0].billId, targets[0].memberId, targets[0].memberVoteId).id, 3);
  assert.equal(findVoteInteraction(interactions, targets[1].billId, targets[1].memberId, targets[1].memberVoteId), null);
});

test('legacy votes use their own member identity and never substitute a shared rep', () => {
  const [target] = getCardResponseTargets({ bill_id: 7, member_id: 'H', member_vote_id: 10, chamber: 'House' });
  assert.equal(buildMemberStancePayload(target, 'disapprove').rep_bioguide_id, 'H');
  const [missing] = getCardResponseTargets({ bill_id: 7, member_vote_id: 10 });
  assert.throws(() => buildMemberStancePayload(missing, 'approve'));
  assert.throws(() => buildMemberStancePayload({ ...target, memberVoteId: null }, 'approve'));
  assert.throws(() => buildMemberStancePayload(target, 'unknown'));
  assert.deepEqual(getCardResponseTargets({ bill: { id: 7 }, members: [] }), []);
});
