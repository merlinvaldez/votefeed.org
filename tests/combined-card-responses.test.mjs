import assert from 'node:assert/strict';
import test from 'node:test';
import { getCardResponseState, buildCardStanceRequest, reconcileCardStanceResult } from '../client/src/voteInteractions.js';
const card = { position: 'Yea', bill: { id: 7 }, members: [
  { bioguideId: 'S1', memberVoteId: 101, name: 'First', chamber: 'Senate' },
  { bioguideId: 'S2', memberVoteId: 102, name: 'Second', chamber: 'Senate' },
] };
const row = (index, stance) => ({ id: index + 1, bill_id: 7, rep_bioguide_id: card.members[index].bioguideId, member_vote_id: card.members[index].memberVoteId, stance });

test('neutral, unanimous, partial and mixed reflect exact individual answers', () => {
  for (const [rows, status, stance] of [
    [[], 'neutral', null], [[row(0, 'approve')], 'partial', null],
    [[row(0, 'approve'), row(1, 'disapprove')], 'mixed', null],
    [[row(0, 'approve'), row(1, 'approve')], 'approve', 'approve'],
    [[row(0, 'disapprove'), row(1, 'disapprove')], 'disapprove', 'disapprove'],
  ]) {
    const state = getCardResponseState(card, rows);
    assert.equal(state.status, status);
    assert.equal(state.stance, stance);
  }
  const wrong = [{ ...row(0, 'approve'), member_vote_id: 99 }, { ...row(1, 'approve'), member_vote_id: null }];
  assert.equal(getCardResponseState(card, wrong).status, 'neutral');
  assert.equal(getCardResponseState(card, [row(0, 'unknown')]).invalid, true);
  assert.equal(getCardResponseState(card, [row(0, null)]).invalid, false);
  assert.equal(getCardResponseState(card, [row(0, 'approve'), { ...row(0, 'disapprove'), id: 10 }]).answers[0].stance, 'disapprove');
});

test('one batch sets both from partial or mixed and clears only a unanimous selected stance', () => {
  for (const rows of [[], [row(0, 'approve')], [row(0, 'approve'), row(1, 'disapprove')]]) {
    const request = buildCardStanceRequest(card, rows, 'approve');
    assert.equal(request.stance, 'approve');
    assert.equal(request.members.length, 2);
  }
  assert.equal(buildCardStanceRequest(card, [row(0, 'approve'), row(1, 'approve')], 'approve').stance, null);
  assert.equal(buildCardStanceRequest(card, [row(0, 'approve'), row(1, 'approve')], 'disapprove').stance, 'disapprove');
  assert.throws(() => buildCardStanceRequest({ ...card, members: [card.members[0], card.members[0]] }, [], 'approve'));
});

test('reconciliation requires full exact confirmation and retains comments and unrelated answers', () => {
  const request = buildCardStanceRequest(card, [], 'approve');
  const unrelated = { ...row(0, 'disapprove'), id: 30, member_vote_id: 99 };
  const saved = [{ ...row(0, 'approve'), user_comment: 'Keep this' }, row(1, 'approve')];
  const previous = [row(0, 'disapprove'), unrelated];
  assert.deepEqual(reconcileCardStanceResult(previous, request, saved), [unrelated, ...saved]);
  for (const invalid of [[saved[0]], [saved[0], saved[0]], [saved[0], row(1, 'disapprove')], [saved[0], { ...saved[1], member_vote_id: 99 }]]) {
    assert.throws(() => reconcileCardStanceResult(previous, request, invalid));
    assert.equal(previous[0].stance, 'disapprove');
  }
  const clear = { ...request, stance: null };
  assert.equal(reconcileCardStanceResult(saved, clear, saved.map(r => ({ ...r, stance: null })))[0].user_comment, 'Keep this');
});
