import { query, withTransaction } from './db/index.js';
import { buildPickSequence, shuffle } from './lib/draft.js';
import { computeLadder, DEFAULT_STAGE_POINTS } from './lib/scoring.js';
import { TEAMS_PER_PLAYER } from './data/teams.js';

// --- basic reads ----------------------------------------------------------

export async function getSettings() {
  const { rows } = await query('SELECT * FROM settings WHERE id = 1');
  return rows[0];
}

export async function getPlayers() {
  const { rows } = await query('SELECT * FROM players ORDER BY id');
  return rows;
}

async function getPlayersInDraftOrder() {
  const { rows } = await query('SELECT * FROM players WHERE draft_slot IS NOT NULL ORDER BY draft_slot');
  return rows;
}

export async function getTeams() {
  // Ordered by FIFA ranking (best first) so the draft lists the strongest
  // available teams at the top.
  const { rows } = await query('SELECT * FROM teams ORDER BY ranking ASC NULLS LAST, name');
  return rows;
}

async function getPicksDetailed() {
  const { rows } = await query(`
    SELECT p.pick_number, p.round, p.player_id, p.team_id,
           t.name AS team_name, t.code AS team_code, t.grp AS team_grp, t.ranking AS team_ranking,
           pl.name AS player_name
    FROM picks p
    JOIN teams t ON t.id = p.team_id
    JOIN players pl ON pl.id = p.player_id
    ORDER BY p.pick_number`);
  return rows;
}

async function getOwnership() {
  const { rows } = await query('SELECT team_id, player_id FROM picks');
  const map = {};
  for (const r of rows) map[r.team_id] = r.player_id;
  return map;
}

async function getNominationsMap() {
  const { rows } = await query('SELECT fixture_id, team_id FROM nominations');
  const map = {};
  for (const r of rows) map[r.fixture_id] = r.team_id;
  return map;
}

async function count(table) {
  const { rows } = await query(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(rows[0].n);
}

// --- draft ----------------------------------------------------------------

export async function startDraft() {
  const players = (await query('SELECT id FROM players ORDER BY id')).rows.map((r) => r.id);
  if (players.length === 0) throw new Error('No players to draft');
  const order = shuffle(players);
  await withTransaction(async (client) => {
    for (let i = 0; i < order.length; i++) {
      await client.query('UPDATE players SET draft_slot = $1 WHERE id = $2', [i + 1, order[i]]);
    }
    await client.query("UPDATE settings SET draft_status = 'in_progress', draft_started_at = now() WHERE id = 1");
  });
}

export async function makePick(teamId) {
  return withTransaction(async (client) => {
    const settings = (await client.query('SELECT * FROM settings WHERE id = 1')).rows[0];
    if (settings.draft_status !== 'in_progress') throw new Error('Draft is not in progress');

    const playerIds = (
      await client.query('SELECT id FROM players WHERE draft_slot IS NOT NULL ORDER BY draft_slot')
    ).rows.map((r) => r.id);
    const sequence = buildPickSequence(playerIds, TEAMS_PER_PLAYER);

    const picksMade = Number((await client.query('SELECT COUNT(*) AS n FROM picks')).rows[0].n);
    const current = sequence[picksMade];
    if (!current) throw new Error('Draft is already complete');

    const taken = (await client.query('SELECT 1 FROM picks WHERE team_id = $1', [teamId])).rows.length;
    if (taken) throw new Error('That team has already been picked');

    await client.query(
      'INSERT INTO picks (pick_number, round, player_id, team_id) VALUES ($1, $2, $3, $4)',
      [current.pickNumber, current.round, current.playerId, teamId]
    );

    if (picksMade + 1 >= sequence.length) {
      await client.query("UPDATE settings SET draft_status = 'complete' WHERE id = 1");
    }
    return current;
  });
}

/** Everything the draft room view needs. */
export async function getDraftState() {
  const settings = await getSettings();
  const started = settings.draft_status !== 'not_started';
  const players = started ? await getPlayersInDraftOrder() : await getPlayers();
  const picks = await getPicksDetailed();
  const teams = await getTeams();

  const takenIds = new Set(picks.map((p) => p.team_id));
  const available = teams.filter((t) => !takenIds.has(t.id));

  // rosters: player id -> picks (in pick order)
  const rosters = new Map(players.map((p) => [p.id, []]));
  for (const pick of picks) {
    if (!rosters.has(pick.player_id)) rosters.set(pick.player_id, []);
    rosters.get(pick.player_id).push(pick);
  }

  let current = null;
  let upcoming = [];
  let totalPicks = 0;
  if (started) {
    const sequence = buildPickSequence(players.map((p) => p.id), TEAMS_PER_PLAYER);
    totalPicks = sequence.length;
    const nameById = Object.fromEntries(players.map((p) => [p.id, p.name]));
    const slot = picks.length;
    current = sequence[slot]
      ? { ...sequence[slot], playerName: nameById[sequence[slot].playerId] }
      : null;
    upcoming = sequence
      .slice(slot + 1, slot + 6)
      .map((s) => ({ ...s, playerName: nameById[s.playerId] }));
  }

  return {
    settings,
    players: players.map((p) => ({ ...p, roster: rosters.get(p.id) || [] })),
    available, // already ordered by FIFA ranking (best first)
    current,
    upcoming,
    picksMade: picks.length,
    totalPicks,
    teamsPerPlayer: TEAMS_PER_PLAYER,
  };
}

// --- fixtures & ladder -----------------------------------------------------

// Times are displayed in this zone. Change DISPLAY_TZ if the group isn't in AEST.
const DISPLAY_TZ = 'Australia/Sydney';
const DATE_FMT = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: DISPLAY_TZ });
const TIME_FMT = new Intl.DateTimeFormat('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: DISPLAY_TZ });

const STAGE_LABEL = { group: 'Group', R32: 'Round of 32', R16: 'Round of 16', QF: 'Quarter-final', SF: 'Semi-final', third: '3rd place', final: 'Final' };

/** Fixtures ordered by kickoff time and grouped by calendar day for display. */
export async function getFixturesView() {
  const players = await getPlayers();
  const nameById = Object.fromEntries(players.map((p) => [p.id, p.name]));

  const { rows } = await query(`
    SELECT f.id, f.stage, f.grp, f.matchday, f.status, f.kickoff,
           f.home_team_id, f.away_team_id, f.home_score, f.away_score, f.winner_team_id,
           ht.name AS home_name, ht.code AS home_code,
           at.name AS away_name, at.code AS away_code,
           hp.player_id AS home_owner_id,
           ap.player_id AS away_owner_id
    FROM fixtures f
    LEFT JOIN teams ht ON ht.id = f.home_team_id
    LEFT JOIN teams at ON at.id = f.away_team_id
    LEFT JOIN picks hp ON hp.team_id = f.home_team_id
    LEFT JOIN picks ap ON ap.team_id = f.away_team_id
    ORDER BY f.kickoff ASC NULLS LAST, f.id`);

  const fixtures = rows.map((r) => {
    const d = r.kickoff ? new Date(r.kickoff) : null;
    return {
      ...r,
      home_owner: r.home_owner_id ? nameById[r.home_owner_id] : null,
      away_owner: r.away_owner_id ? nameById[r.away_owner_id] : null,
      time_label: d ? TIME_FMT.format(d) : '',
      date_label: d ? DATE_FMT.format(d) : 'Date TBC',
      stage_label: r.stage === 'group' ? `Group ${r.grp}` : (STAGE_LABEL[r.stage] || r.stage),
    };
  });

  // Query is already chronological, so grouping by date keeps day order.
  const groups = {};
  for (const f of fixtures) (groups[f.date_label] ||= []).push(f);
  return Object.entries(groups).map(([title, items]) => ({ title, fixtures: items }));
}

// Knockout rounds in bracket order, with the expected match count and points.
const KO_ROUNDS = [
  { stage: 'R32', label: 'Round of 32', expected: 16, pts: 1 },
  { stage: 'R16', label: 'Round of 16', expected: 8, pts: 2 },
  { stage: 'QF', label: 'Quarter-finals', expected: 4, pts: 3 },
  { stage: 'SF', label: 'Semi-finals', expected: 2, pts: 4 },
  { stage: 'final', label: 'Final', expected: 1, pts: 5 },
];

const KO_STAGES = ['R32', 'R16', 'QF', 'SF', 'third', 'final'];

// Returns a predicate (teamId) => still in the tournament, given the knockout
// fixture rows. A team is out if it lost a finished knockout match, or — once
// the knockout bracket exists — it never made the bracket (i.e. it was
// eliminated when the group stage finished). The bracket is empty until the
// group stage ends, so during the group stage every team still counts.
function survivingTeams(koFixtures) {
  const qualified = new Set();
  for (const f of koFixtures) {
    if (f.home_team_id != null) qualified.add(f.home_team_id);
    if (f.away_team_id != null) qualified.add(f.away_team_id);
  }
  const bracketDrawn = qualified.size > 0;

  const eliminated = new Set();
  for (const f of koFixtures) {
    if (f.status !== 'finished' || f.winner_team_id == null) continue;
    const loser = f.winner_team_id === f.home_team_id ? f.away_team_id : f.home_team_id;
    if (loser != null) eliminated.add(loser);
  }

  return (teamId) => !eliminated.has(teamId) && (!bracketDrawn || qualified.has(teamId));
}

/** Knockout fixtures laid out as bracket rounds (padded with TBD slots). */
export async function getBracket() {
  const players = await getPlayers();
  const nameById = Object.fromEntries(players.map((p) => [p.id, p.name]));

  const { rows } = await query(`
    SELECT f.id, f.stage, f.status, f.kickoff,
           f.home_team_id, f.away_team_id, f.home_score, f.away_score, f.winner_team_id,
           ht.name AS home_name, at.name AS away_name,
           hp.player_id AS home_owner_id, ap.player_id AS away_owner_id
    FROM fixtures f
    LEFT JOIN teams ht ON ht.id = f.home_team_id
    LEFT JOIN teams at ON at.id = f.away_team_id
    LEFT JOIN picks hp ON hp.team_id = f.home_team_id
    LEFT JOIN picks ap ON ap.team_id = f.away_team_id
    WHERE f.stage = ANY($1)
    ORDER BY f.kickoff ASC NULLS LAST, f.id`, [KO_STAGES]);

  const decorate = (r) => {
    const d = r.kickoff ? new Date(r.kickoff) : null;
    return {
      id: r.id,
      stage: r.stage,
      status: r.status,
      home_name: r.home_name,
      away_name: r.away_name,
      home_owner: r.home_owner_id ? nameById[r.home_owner_id] : null,
      away_owner: r.away_owner_id ? nameById[r.away_owner_id] : null,
      home_score: r.home_score,
      away_score: r.away_score,
      home_is_winner: r.winner_team_id != null && r.winner_team_id === r.home_team_id,
      away_is_winner: r.winner_team_id != null && r.winner_team_id === r.away_team_id,
      date_label: d ? DATE_FMT.format(d) : '',
      time_label: d ? TIME_FMT.format(d) : '',
    };
  };

  const byStage = {};
  for (const r of rows) (byStage[r.stage] ||= []).push(decorate(r));

  const rounds = KO_ROUNDS.map((rd) => {
    const matches = (byStage[rd.stage] || []).slice();
    while (matches.length < rd.expected) matches.push({ tbd: true, stage: rd.stage });
    return { ...rd, matches };
  });

  return { rounds, thirdPlace: (byStage.third || [])[0] || null, hasAny: rows.length > 0 };
}

export async function getLadder() {
  const settings = await getSettings();
  const players = await getPlayers();
  const ownership = await getOwnership();
  const nominations = await getNominationsMap();

  const { rows } = await query("SELECT * FROM fixtures WHERE status = 'finished'");
  const fixtures = rows.map((r) => ({
    id: r.id,
    stage: r.stage,
    homeTeamId: r.home_team_id,
    awayTeamId: r.away_team_id,
    homeScore: r.home_score,
    awayScore: r.away_score,
    winnerTeamId: r.winner_team_id,
  }));

  const stagePoints = { ...DEFAULT_STAGE_POINTS, third: settings.score_third_place ? 1 : 0 };
  const totals = computeLadder(fixtures, { ownership, nominations, stagePoints });

  const { rows: koRows } = await query(
    `SELECT home_team_id, away_team_id, winner_team_id, status
     FROM fixtures WHERE stage IN ('R32', 'R16', 'QF', 'SF', 'third', 'final')`
  );
  const alive = survivingTeams(koRows);
  const teamCounts = {};
  for (const [teamId, playerId] of Object.entries(ownership)) {
    if (alive(Number(teamId))) teamCounts[playerId] = (teamCounts[playerId] || 0) + 1;
  }

  return players
    .map((p) => ({ ...p, points: totals[p.id] ?? 0, teamCount: teamCounts[p.id] ?? 0 }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
}

// --- admin -----------------------------------------------------------------

export async function getAdminData() {
  const [settings, players, groups] = await Promise.all([getSettings(), getPlayers(), getFixturesView()]);
  return { settings, players, groups };
}

export async function setScore(fixtureId, homeScore, awayScore, winnerTeamId) {
  await query(
    `UPDATE fixtures
        SET home_score = $1, away_score = $2, winner_team_id = $3,
            status = 'finished', updated_at = now()
      WHERE id = $4`,
    [homeScore, awayScore, winnerTeamId ?? null, fixtureId]
  );
}

export async function updatePlayerNames(body) {
  const players = await getPlayers();
  for (const p of players) {
    const value = body[`player_${p.id}`];
    if (value != null && value.trim()) {
      await query('UPDATE players SET name = $1 WHERE id = $2', [value.trim(), p.id]);
    }
  }
}

export async function setThirdPlace(on) {
  await query('UPDATE settings SET score_third_place = $1 WHERE id = 1', [on]);
}

const ESPN_STANDINGS_URL = 'https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings?season=2026';

const STANDINGS_NAME_MAP = {
  'Czechia': 'Czech Republic',
  'Bosnia-Herzegovina': 'Bosnia and Herzegovina',
  'Bosnia & Herzegovina': 'Bosnia and Herzegovina',
  'Congo DR': 'DR Congo',
  'DRC': 'DR Congo',
  'Türkiye': 'Turkey',
  'Korea Republic': 'South Korea',
  "Côte d'Ivoire": 'Ivory Coast',
  "Cote d'Ivoire": 'Ivory Coast',
};

/** Fetch confirmed qualifiers from ESPN standings — no token required. */
export async function getConfirmedQualifiers() {
  let standings;
  try {
    const res = await fetch(ESPN_STANDINGS_URL);
    if (!res.ok) return { qualified: [], possible: [] };
    standings = await res.json();
  } catch {
    return { qualified: [], possible: [] };
  }

  const { rows: pickRows } = await query(`
    SELECT t.name AS team_name, p.name AS player_name
    FROM picks pk
    JOIN teams t ON t.id = pk.team_id
    JOIN players p ON p.id = pk.player_id
  `);
  const ownerByTeam = new Map(pickRows.map((r) => [r.team_name.toLowerCase(), r.player_name]));

  const qualified = [];
  const possible = [];

  for (const group of standings.children || []) {
    for (const entry of group.standings?.entries || []) {
      const espnName = entry.team?.displayName || '';
      const name = STANDINGS_NAME_MAP[espnName] || espnName;
      const note = entry.note?.description || '';
      const owner = ownerByTeam.get(name.toLowerCase()) || null;
      if (note === 'Advance to Round of 32') {
        qualified.push({ name, group: group.name, owner });
      } else if (note === 'Best 8 advance') {
        possible.push({ name, group: group.name, owner });
      }
    }
  }

  return { qualified, possible };
}
