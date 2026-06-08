import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPickSequence, shuffle, pickAt } from './draft.js';
import { scoreFixture, computeLadder, DEFAULT_STAGE_POINTS } from './scoring.js';

// ---------------------------------------------------------------------------
// Draft order
// ---------------------------------------------------------------------------

test('snake draft: 6 players x 8 rounds = 48 picks, even rounds reversed', () => {
  const seq = buildPickSequence([1, 2, 3, 4, 5, 6], 8);
  assert.equal(seq.length, 48);
  // Round 1 forward
  assert.deepEqual(seq.slice(0, 6).map((p) => p.playerId), [1, 2, 3, 4, 5, 6]);
  // Round 2 reversed
  assert.deepEqual(seq.slice(6, 12).map((p) => p.playerId), [6, 5, 4, 3, 2, 1]);
  // Round 3 forward again
  assert.deepEqual(seq.slice(12, 18).map((p) => p.playerId), [1, 2, 3, 4, 5, 6]);
  // Everyone gets exactly 8 picks
  for (const id of [1, 2, 3, 4, 5, 6]) {
    assert.equal(seq.filter((p) => p.playerId === id).length, 8);
  }
});

test('shuffle is deterministic with an injected rng and preserves members', () => {
  const order = shuffle([1, 2, 3, 4, 5], () => 0); // always picks index 0
  assert.deepEqual([...order].sort(), [1, 2, 3, 4, 5]);
});

test('pickAt returns the current pick or null when complete', () => {
  const seq = buildPickSequence([1, 2], 2);
  assert.equal(pickAt(seq, 0).playerId, 1);
  assert.equal(pickAt(seq, 4), null);
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const ownership = { 10: 'A', 20: 'B', 30: 'A' }; // A owns teams 10 & 30, B owns 20

test('group win: winner owner gets 1, loser owner gets 0', () => {
  const pts = scoreFixture(
    { id: 1, stage: 'group', homeTeamId: 10, awayTeamId: 20, homeScore: 2, awayScore: 1 },
    { ownership }
  );
  assert.deepEqual(pts, { A: 1 });
});

test('group draw: both owners get 0.5', () => {
  const pts = scoreFixture(
    { id: 2, stage: 'group', homeTeamId: 10, awayTeamId: 20, homeScore: 1, awayScore: 1 },
    { ownership }
  );
  assert.deepEqual(pts, { A: 0.5, B: 0.5 });
});

test('knockout R16 win gives 2 points', () => {
  const pts = scoreFixture(
    { id: 3, stage: 'R16', homeTeamId: 10, awayTeamId: 20, winnerTeamId: 20 },
    { ownership }
  );
  assert.deepEqual(pts, { B: 2 });
});

test('knockout decided on penalties: advancing team takes full points (no 0.5)', () => {
  const pts = scoreFixture(
    { id: 4, stage: 'QF', homeTeamId: 10, awayTeamId: 20, homeScore: 1, awayScore: 1, winnerTeamId: 10 },
    { ownership }
  );
  assert.deepEqual(pts, { A: 3 });
});

test('own-vs-own group draw: owner gets 0.5', () => {
  const pts = scoreFixture(
    { id: 5, stage: 'group', homeTeamId: 10, awayTeamId: 30, homeScore: 0, awayScore: 0 },
    { ownership }
  );
  assert.deepEqual(pts, { A: 0.5 });
});

test('own-vs-own decisive result earns full win points (no nomination needed)', () => {
  const pts = scoreFixture(
    { id: 6, stage: 'group', homeTeamId: 10, awayTeamId: 30, homeScore: 2, awayScore: 0 },
    { ownership }
  );
  assert.deepEqual(pts, { A: 1 });
});

test('own-vs-own earns full points whichever of the player\'s teams wins', () => {
  const pts = scoreFixture(
    { id: 7, stage: 'group', homeTeamId: 10, awayTeamId: 30, homeScore: 0, awayScore: 2 },
    { ownership }
  );
  assert.deepEqual(pts, { A: 1 });
});

test('own-vs-own knockout earns the full round win points', () => {
  const pts = scoreFixture(
    { id: 8, stage: 'R16', homeTeamId: 10, awayTeamId: 30, winnerTeamId: 30 },
    { ownership }
  );
  assert.deepEqual(pts, { A: 2 });
});

test('undrafted team winning awards no points', () => {
  const pts = scoreFixture(
    { id: 9, stage: 'group', homeTeamId: 99, awayTeamId: 20, homeScore: 3, awayScore: 0 },
    { ownership } // team 99 is undrafted
  );
  assert.deepEqual(pts, {});
});

test('third-place playoff scores 1 point by default', () => {
  assert.equal(DEFAULT_STAGE_POINTS.third, 1);
  const pts = scoreFixture(
    { id: 10, stage: 'third', homeTeamId: 10, awayTeamId: 20, winnerTeamId: 10 },
    { ownership }
  );
  assert.deepEqual(pts, { A: 1 });
});

test('third-place playoff can be switched off via stagePoints override', () => {
  const pts = scoreFixture(
    { id: 11, stage: 'third', homeTeamId: 10, awayTeamId: 20, winnerTeamId: 10 },
    { ownership, stagePoints: { ...DEFAULT_STAGE_POINTS, third: 0 } }
  );
  assert.deepEqual(pts, {});
});

test('computeLadder sums across fixtures', () => {
  const fixtures = [
    { id: 1, stage: 'group', homeTeamId: 10, awayTeamId: 20, homeScore: 2, awayScore: 1 }, // A +1
    { id: 2, stage: 'group', homeTeamId: 20, awayTeamId: 10, homeScore: 1, awayScore: 1 }, // A+.5 B+.5
    { id: 3, stage: 'final', homeTeamId: 20, awayTeamId: 10, winnerTeamId: 20 },            // B +5
  ];
  assert.deepEqual(computeLadder(fixtures, { ownership }), { A: 1.5, B: 5.5 });
});
