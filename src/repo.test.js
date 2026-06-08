// Integration test of the data layer + draft + scoring against the in-memory
// database (runs with no DATABASE_URL set, so db/index.js uses pg-mem).
import test from 'node:test';
import assert from 'node:assert/strict';
import { seed } from './db/seed.js';
import { getDraftState, startDraft, makePick, getLadder, getFixturesView, setScore } from './repo.js';
import { query } from './db/index.js';

test('full draft + scoring flow through the database', async () => {
  await seed();

  // Before the draft.
  let state = await getDraftState();
  assert.equal(state.settings.draft_status, 'not_started');
  assert.equal(state.players.length, 6);
  assert.equal(state.available.length, 48);

  // Start: randomise order, snake of 48 picks.
  await startDraft();
  state = await getDraftState();
  assert.equal(state.settings.draft_status, 'in_progress');
  assert.equal(state.totalPicks, 48);
  assert.ok(state.current, 'someone should be on the clock');

  // Run the whole draft, always taking the first available team.
  for (let i = 0; i < 48; i++) {
    const s = await getDraftState();
    assert.ok(s.current, `expected a current pick at step ${i}`);
    await makePick(s.available[0].id);
  }

  state = await getDraftState();
  assert.equal(state.settings.draft_status, 'complete');
  assert.equal(state.picksMade, 48);
  for (const p of state.players) {
    assert.equal(p.roster.length, 8, `${p.name} should have 8 teams`);
  }
  assert.equal(state.available.length, 0, 'all teams should be drafted');

  // Enter a group result between two DIFFERENT owners (draft order is random,
  // so find such a fixture rather than assuming one) -> one win point awarded.
  const target = (
    await query(`SELECT f.id, hp.player_id AS home_owner
                   FROM fixtures f
                   JOIN picks hp ON hp.team_id = f.home_team_id
                   JOIN picks ap ON ap.team_id = f.away_team_id
                  WHERE f.stage = 'group' AND hp.player_id <> ap.player_id
                  LIMIT 1`)
  ).rows[0];
  await setScore(target.id, 2, 0, null); // home win
  const ladder = await getLadder();
  const totalPoints = ladder.reduce((sum, p) => sum + p.points, 0);
  assert.equal(totalPoints, 1);
  assert.equal(ladder.find((p) => p.id === target.home_owner).points, 1);

  // Fixtures view is chronological and exposes owners once the draft is complete.
  const groups = await getFixturesView();
  const allFixtures = groups.flatMap((g) => g.fixtures);
  assert.ok(allFixtures.some((f) => f.home_owner), 'owner overlay should be populated');
  assert.ok(allFixtures.some((f) => f.time_label), 'fixtures should have kickoff times');
});
