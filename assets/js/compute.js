// Pure view-model builders, ported from src/repo.js but operating on the plain
// arrays returned by store.loadAll() instead of SQL. Reuses the same tested
// rules engine (lib/scoring.js, lib/draft.js).

import { buildPickSequence } from './lib/draft.js?v=2';
import { computeLadder, DEFAULT_STAGE_POINTS } from './lib/scoring.js?v=3';
import { TEAMS_PER_PLAYER } from './lib/teams.js?v=2';

const DISPLAY_TZ = 'Australia/Sydney';
const DATE_FMT = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: DISPLAY_TZ });
const SHORT_DATE_FMT = new Intl.DateTimeFormat('en-AU', { day: '2-digit', month: '2-digit', timeZone: DISPLAY_TZ });
const TIME_FMT = new Intl.DateTimeFormat('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: DISPLAY_TZ });
const STAGE_LABEL = { group: 'Group', R32: 'Round of 32', R16: 'Round of 16', QF: 'Quarter-final', SF: 'Semi-final', third: '3rd place', final: 'Final' };

const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));
const ownershipMap = (picks) => Object.fromEntries(picks.map((p) => [p.team_id, p.player_id]));

const KO_STAGES = ['R32', 'R16', 'QF', 'SF', 'third', 'final'];

// Tips lock — and everyone's picks are then revealed — this long before kickoff.
const TIP_LOCK_MS = 60 * 60 * 1000; // 1 hour

// Returns a predicate (teamId) => still in the tournament.
// A team is out if it lost a finished knockout match, or — once the knockout
// bracket exists — it never made the bracket (i.e. it was eliminated when the
// group stage finished). The bracket is empty until the group stage ends, so
// during the group stage every team still counts as alive.
function survivingTeams(fixtures) {
  const ko = fixtures.filter((f) => KO_STAGES.includes(f.stage));

  // Teams appearing anywhere in the knockout bracket = the group qualifiers.
  const qualified = new Set();
  for (const f of ko) {
    if (f.home_team_id != null) qualified.add(f.home_team_id);
    if (f.away_team_id != null) qualified.add(f.away_team_id);
  }
  const bracketDrawn = qualified.size > 0;

  // Teams that lost a finished knockout match are knocked out.
  const eliminated = new Set();
  for (const f of ko) {
    if (f.status !== 'finished' || f.winner_team_id == null) continue;
    const loser = f.winner_team_id === f.home_team_id ? f.away_team_id : f.home_team_id;
    if (loser != null) eliminated.add(loser);
  }

  return (teamId) => !eliminated.has(teamId) && (!bracketDrawn || qualified.has(teamId));
}

function rankSort(a, b) {
  const ra = a.ranking ?? Infinity, rb = b.ranking ?? Infinity;
  return ra - rb || String(a.name).localeCompare(String(b.name));
}

// The decided outcome of a FINISHED fixture, for tip-checking. 'home' | 'draw' |
// 'away' | null (not finished / undecided). Group games are read from the score;
// knockouts use the advancing team (so penalty wins resolve correctly), falling
// back to the score if no winner was recorded.
function outcomeOf(f) {
  if (f.status !== 'finished') return null;
  if (!KO_STAGES.includes(f.stage)) {
    if (f.home_score == null || f.away_score == null) return null;
    if (f.home_score > f.away_score) return 'home';
    if (f.home_score < f.away_score) return 'away';
    return 'draw';
  }
  if (f.winner_team_id != null) {
    if (f.winner_team_id === f.home_team_id) return 'home';
    if (f.winner_team_id === f.away_team_id) return 'away';
  }
  if (f.home_score != null && f.away_score != null) {
    if (f.home_score > f.away_score) return 'home';
    if (f.home_score < f.away_score) return 'away';
  }
  return null;
}

export function getDraftState(data) {
  const { settings, picks, teams } = data;
  const started = settings.draft_status !== 'not_started';
  const players = started
    ? data.players.filter((p) => p.draft_slot != null).sort((a, b) => a.draft_slot - b.draft_slot)
    : [...data.players].sort((a, b) => a.id - b.id);

  const teamById = byId(teams);
  const playerById = byId(data.players);
  const takenIds = new Set(picks.map((p) => p.team_id));
  const available = teams.filter((t) => !takenIds.has(t.id)).sort(rankSort);

  const detailed = [...picks]
    .sort((a, b) => a.pick_number - b.pick_number)
    .map((p) => {
      const t = teamById[p.team_id] || {};
      return { ...p, team_name: t.name, team_code: t.code, team_grp: t.grp, team_ranking: t.ranking, player_name: (playerById[p.player_id] || {}).name };
    });

  const rosters = new Map(players.map((p) => [p.id, []]));
  for (const pick of detailed) {
    if (!rosters.has(pick.player_id)) rosters.set(pick.player_id, []);
    rosters.get(pick.player_id).push(pick);
  }

  let current = null, upcoming = [], totalPicks = 0;
  if (started) {
    const seq = buildPickSequence(players.map((p) => p.id), TEAMS_PER_PLAYER);
    totalPicks = seq.length;
    const nameById = Object.fromEntries(players.map((p) => [p.id, p.name]));
    const slot = picks.length;
    current = seq[slot] ? { ...seq[slot], playerName: nameById[seq[slot].playerId] } : null;
    upcoming = seq.slice(slot + 1, slot + 6).map((s) => ({ ...s, playerName: nameById[s.playerId] }));
  }

  return {
    settings,
    players: players.map((p) => ({ ...p, roster: rosters.get(p.id) || [] })),
    available,
    current,
    upcoming,
    picksMade: picks.length,
    totalPicks,
    teamsPerPlayer: TEAMS_PER_PLAYER,
  };
}

function decorateFixture(f, teamById, ownerNameByTeam) {
  const d = f.kickoff ? new Date(f.kickoff) : null;
  const home = teamById[f.home_team_id] || {};
  const away = teamById[f.away_team_id] || {};
  return {
    ...f,
    home_name: home.name, home_code: home.code,
    away_name: away.name, away_code: away.code,
    home_owner: ownerNameByTeam[f.home_team_id] || null,
    away_owner: ownerNameByTeam[f.away_team_id] || null,
    home_is_winner: f.winner_team_id != null && f.winner_team_id === f.home_team_id,
    away_is_winner: f.winner_team_id != null && f.winner_team_id === f.away_team_id,
    time_label: d ? TIME_FMT.format(d) : '',
    date_label: d ? DATE_FMT.format(d) : 'Date TBC',
    short_date_label: d ? SHORT_DATE_FMT.format(d) : '',
    stage_label: f.stage === 'group' ? `Group ${f.grp}` : (STAGE_LABEL[f.stage] || f.stage),
  };
}

function ownerNames(data) {
  const playerById = byId(data.players);
  const own = ownershipMap(data.picks);
  const out = {};
  for (const [teamId, playerId] of Object.entries(own)) out[teamId] = (playerById[playerId] || {}).name || null;
  return out;
}

const fxSort = (a, b) => {
  const ka = a.kickoff ? Date.parse(a.kickoff) : Infinity;
  const kb = b.kickoff ? Date.parse(b.kickoff) : Infinity;
  return ka - kb || a.id - b.id;
};

export function getFixturesView(data) {
  const teamById = byId(data.teams);
  const owners = ownerNames(data);
  const fixtures = [...data.fixtures].sort(fxSort).map((f) => decorateFixture(f, teamById, owners));
  const groups = {};
  for (const f of fixtures) (groups[f.date_label] ||= []).push(f);
  return Object.entries(groups).map(([title, items]) => ({
    title,
    fixtures: items,
    allPlayed: items.every(f => f.status === 'finished'),
    date_ts: items[0]?.kickoff ? Date.parse(items[0].kickoff) : null,
  }));
}

const KO_ROUNDS = [
  { stage: 'R32', label: 'Round of 32', expected: 16, pts: 1 },
  { stage: 'R16', label: 'Round of 16', expected: 8, pts: 2 },
  { stage: 'QF', label: 'Quarter-finals', expected: 4, pts: 3 },
  { stage: 'SF', label: 'Semi-finals', expected: 2, pts: 4 },
  { stage: 'final', label: 'Final', expected: 1, pts: 5 },
];

export function getBracket(data, r32Overlay = []) {
  const teamById = byId(data.teams);
  const owners = ownerNames(data);
  const ko = data.fixtures.filter((f) => KO_STAGES.includes(f.stage));
  const decorated = [...ko].sort(fxSort).map((f) => decorateFixture(f, teamById, owners));

  const byStage = {};
  for (const f of decorated) (byStage[f.stage] ||= []).push(f);

  const rounds = KO_ROUNDS.map((rd) => {
    const matches = (byStage[rd.stage] || []).slice();
    while (matches.length < rd.expected) {
      const idx = matches.length;
      const ov = (rd.stage === 'R32' && r32Overlay[idx]) || null;
      if (ov) {
        // Overlay a known R32 matchup — one or both sides may still be TBD
        const ownerFor = (name) => {
          if (!name) return null;
          const team = data.teams.find((t) => t.name.toLowerCase() === name.toLowerCase());
          if (!team) return null;
          const pick = data.picks.find((p) => p.team_id === team.id);
          if (!pick) return null;
          return (data.players.find((p) => p.id === pick.player_id) || {}).name || null;
        };
        matches.push({
          tbd: false, stage: rd.stage, status: 'scheduled',
          home_name: ov.home || null, away_name: ov.away || null,
          home_confirmed: !!ov.home, away_confirmed: !!ov.away,
          home_owner: ownerFor(ov.home), away_owner: ownerFor(ov.away),
          home_score: null, away_score: null,
          home_is_winner: false, away_is_winner: false,
        });
      } else {
        matches.push({ tbd: true, stage: rd.stage });
      }
    }
    return { ...rd, matches };
  });

  return { rounds, thirdPlace: (byStage.third || [])[0] || null, hasAny: ko.length > 0 };
}

export function getLadder(data) {
  const ownership = ownershipMap(data.picks);
  const finished = data.fixtures
    .filter((f) => f.status === 'finished')
    .map((f) => ({ id: f.id, stage: f.stage, homeTeamId: f.home_team_id, awayTeamId: f.away_team_id, homeScore: f.home_score, awayScore: f.away_score, winnerTeamId: f.winner_team_id }));

  const stagePoints = { ...DEFAULT_STAGE_POINTS, third: data.settings.score_third_place ? 1 : 0 };
  const totals = computeLadder(finished, { ownership, stagePoints });

  const alive = survivingTeams(data.fixtures);
  const teamCounts = {};
  for (const pick of data.picks) {
    if (alive(pick.team_id)) teamCounts[pick.player_id] = (teamCounts[pick.player_id] || 0) + 1;
  }

  const current = [...data.players]
    .map((p) => ({ ...p, points: totals[p.id] ?? 0, teamCount: teamCounts[p.id] ?? 0 }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

  // Movement: compare current rank to rank before the last completed matchday
  const finDates = [...new Set(
    data.fixtures.filter(f => f.status === 'finished' && f.kickoff).map(f => f.kickoff.slice(0, 10))
  )].sort();
  let prevRankById = null;
  if (finDates.length >= 2) {
    const lastDate = finDates[finDates.length - 1];
    const prevFin = data.fixtures
      .filter(f => f.status === 'finished' && f.kickoff && f.kickoff.slice(0, 10) < lastDate)
      .map(f => ({ id: f.id, stage: f.stage, homeTeamId: f.home_team_id, awayTeamId: f.away_team_id, homeScore: f.home_score, awayScore: f.away_score, winnerTeamId: f.winner_team_id }));
    const prevTotals = computeLadder(prevFin, { ownership, stagePoints });
    const prevRanked = [...data.players]
      .map(p => ({ id: p.id, name: p.name, pts: prevTotals[p.id] ?? 0 }))
      .sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
    prevRankById = Object.fromEntries(prevRanked.map((p, i) => [p.id, i + 1]));
  }

  return current.map((p, i) => ({
    ...p,
    movement: prevRankById ? (prevRankById[p.id] ?? null) - (i + 1) : null,
  }));
}

export function getGroupStandings(data) {
  const stand = {};
  for (const t of data.teams) {
    stand[t.id] = { id: t.id, name: t.name, code: t.code, grp: t.grp, P:0, W:0, D:0, L:0, GF:0, GA:0, GD:0, Pts:0 };
  }
  for (const f of data.fixtures) {
    if (f.stage !== 'group' || f.status !== 'finished' || f.home_score == null || f.away_score == null) continue;
    const h = stand[f.home_team_id], a = stand[f.away_team_id];
    if (!h || !a) continue;
    h.P++; a.P++;
    h.GF += f.home_score; h.GA += f.away_score;
    a.GF += f.away_score; a.GA += f.home_score;
    if (f.home_score > f.away_score) { h.W++; h.Pts += 3; a.L++; }
    else if (f.home_score < f.away_score) { a.W++; a.Pts += 3; h.L++; }
    else { h.D++; h.Pts++; a.D++; a.Pts++; }
  }
  for (const s of Object.values(stand)) s.GD = s.GF - s.GA;
  const grpMap = {};
  for (const s of Object.values(stand)) (grpMap[s.grp] ||= []).push(s);
  for (const teams of Object.values(grpMap)) {
    teams.sort((a, b) => b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF || a.name.localeCompare(b.name));
  }
  return Object.entries(grpMap).sort(([a], [b]) => a.localeCompare(b)).map(([grp, teams]) => ({ grp, teams }));
}

export function getTeamsView(data) {
  const teamById = byId(data.teams);
  const rosterByPlayer = {};
  for (const pick of data.picks) (rosterByPlayer[pick.player_id] ||= []).push(pick.team_id);
  return [...data.players]
    .sort((a, b) => (a.draft_slot ?? 99) - (b.draft_slot ?? 99) || a.name.localeCompare(b.name))
    .map((p) => ({
      ...p,
      teams: (rosterByPlayer[p.id] || []).map((tid) => teamById[tid]).filter(Boolean).sort(rankSort),
    }));
}

export function getPlayerView(data, playerId) {
  const teamById = byId(data.teams);
  const owners = ownerNames(data);
  const player = data.players.find((p) => p.id === playerId);
  if (!player) return null;
  const teamIds = new Set(data.picks.filter((p) => p.player_id === playerId).map((p) => p.team_id));
  return {
    player,
    teams: [...teamIds].map((tid) => teamById[tid]).filter(Boolean).sort(rankSort),
    fixtures: [...data.fixtures]
      .filter((f) => teamIds.has(f.home_team_id) || teamIds.has(f.away_team_id))
      .sort(fxSort)
      .map((f) => decorateFixture(f, teamById, owners)),
  };
}

export function getTeamView(data, teamId) {
  const teamById = byId(data.teams);
  const owners = ownerNames(data);
  const team = teamById[teamId];
  if (!team) return null;
  return {
    team,
    fixtures: [...data.fixtures]
      .filter((f) => f.home_team_id === teamId || f.away_team_id === teamId)
      .sort(fxSort)
      .map((f) => decorateFixture(f, teamById, owners)),
  };
}

// ---------------------------------------------------------------- Tipping
// Standings for the tipping game: 1 point per correct tip. `tipped` is how many
// finished matches a mate submitted a tip for (the denominator).
export function getTipLadder(data) {
  const outcomes = {};
  for (const f of data.fixtures) if (f.status === 'finished') outcomes[f.id] = outcomeOf(f);

  const stats = {};
  for (const p of data.players) stats[p.id] = { tipped: 0, points: 0 };
  for (const t of data.tips || []) {
    const outcome = outcomes[t.fixture_id];
    if (outcome == null) continue; // match not finished, or finished without a usable result yet
    (stats[t.player_id] ||= { tipped: 0, points: 0 }).tipped += 1;
    if (t.pick === outcome) stats[t.player_id].points += 1;
  }

  return [...data.players]
    .map((p) => ({ ...p, tipped: stats[p.id].tipped, points: stats[p.id].points }))
    .sort((a, b) => b.points - a.points || b.tipped - a.tipped || a.name.localeCompare(b.name));
}

// Tipping page model. Splits matches into `toTip` (still tippable) and `results`
// (locked or played), each grouped by date into day-block accordions like the
// fixtures page. Each mate's pick is hidden from the others until kickoff:
// `allTips` is only populated once a match is `locked`.
export function getTipsView(data, myId) {
  const teamById = byId(data.teams);
  const owners = ownerNames(data);
  const players = [...data.players].sort((a, b) => a.id - b.id);
  const now = Date.now();

  const tipsByFixture = {};
  for (const t of data.tips || []) (tipsByFixture[t.fixture_id] ||= []).push(t);

  const decorate = (f) => {
    const d = decorateFixture(f, teamById, owners);
    const ko = f.kickoff ? Date.parse(f.kickoff) : null;
    const locked = f.status === 'finished' || (ko != null && ko - TIP_LOCK_MS <= now);
    const fixtureTips = tipsByFixture[f.id] || [];
    const myTip = myId ? fixtureTips.find((t) => t.player_id === myId) : null;
    const outcome = outcomeOf(f);
    const allTips = locked
      ? players.map((p) => {
          const tp = fixtureTips.find((t) => t.player_id === p.id);
          const pick = tp ? tp.pick : null;
          return { name: p.name, pick, correct: pick != null && outcome != null && pick === outcome };
        })
      : null;
    return {
      ...d,
      locked,
      tipOptions: f.stage === 'group' ? ['home', 'draw', 'away'] : ['home', 'away'],
      myPick: myTip ? myTip.pick : null,
      tippedCount: fixtureTips.length,
      playerCount: players.length,
      outcome,
      allTips,
    };
  };

  const all = [...data.fixtures].sort(fxSort).map(decorate);

  // Group a flat fixture list into day blocks (one collapsible accordion each).
  const groupByDate = (list) => {
    const groups = {};
    for (const f of list) (groups[f.date_label] ||= []).push(f);
    return Object.entries(groups).map(([title, items]) => ({
      title,
      fixtures: items,
      date_ts: items[0]?.kickoff ? Date.parse(items[0].kickoff) : null,
      allPlayed: items.every((f) => f.status === 'finished'),
    }));
  };

  // `toTip` — still-tippable matches, soonest day first. `results` — locked or
  // played matches, most recent day first. Both lay out as day-block accordions.
  return {
    toTip: groupByDate(all.filter((f) => !f.locked)),
    results: groupByDate(all.filter((f) => f.locked)).reverse(),
  };
}

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

export function getQualifiers(data, standings) {
  if (!standings || !standings.children) return { qualified: [], possible: [] };

  const teamByName = new Map(data.teams.map((t) => [t.name.toLowerCase(), t]));
  const playerById = Object.fromEntries(data.players.map((p) => [p.id, p]));
  const ownerByTeamId = Object.fromEntries(data.picks.map((pk) => [pk.team_id, playerById[pk.player_id]?.name || null]));

  const qualified = [];
  const possible = [];

  for (const group of standings.children) {
    for (const entry of group.standings?.entries || []) {
      const espnName = entry.team?.displayName || '';
      const name = STANDINGS_NAME_MAP[espnName] || espnName;
      const note = entry.note?.description || '';
      const team = teamByName.get(name.toLowerCase());
      const owner = team ? (ownerByTeamId[team.id] || null) : null;
      if (note === 'Advance to Round of 32') qualified.push({ name, group: group.name, owner });
      else if (note === 'Best 8 advance') possible.push({ name, group: group.name, owner });
    }
  }

  return { qualified, possible };
}

const SLUG_TO_STAGE_ESPN = {
  'round-of-32': 'R32', 'round-of-16': 'R16',
  'quarterfinals': 'QF', 'semifinals': 'SF',
  'third-place': 'third', 'final': 'final',
};

/** Parse ESPN standings into winner/runnerUp per group (Group A, Group B, …) */
export function getGroupPositions(standings) {
  const positions = {};
  for (const group of (standings?.children || [])) {
    const qualified = (group.standings?.entries || [])
      .filter((e) => e.note?.description === 'Advance to Round of 32')
      .map((e) => ({
        name: STANDINGS_NAME_MAP[e.team?.displayName] || e.team?.displayName || '',
        pts: (e.stats?.find((s) => s.name === 'points')?.value) ?? 0,
        gd:  (e.stats?.find((s) => s.name === 'pointDifferential')?.value) ?? 0,
        gf:  (e.stats?.find((s) => s.name === 'pointsFor')?.value) ?? 0,
      }))
      .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    if (qualified.length >= 1) positions[group.name] = { winner: qualified[0].name, runnerUp: qualified[1]?.name || null };
  }
  return positions; // { "Group A": { winner: "Mexico", runnerUp: "South Korea" }, … }
}

/**
 * Resolve an ESPN placeholder slot name to an actual team name.
 * Returns null when the slot is still undecided (3rd-place tiebreaker etc.).
 */
export function resolveEspnSlot(displayName, groupPositions) {
  if (!displayName) return null;
  // Already a real team (not a placeholder)
  if (!displayName.includes('Place') && !displayName.includes('Winner')) {
    return STANDINGS_NAME_MAP[displayName] || displayName;
  }
  const winnerMatch = displayName.match(/^Group ([A-L]) Winner$/i);
  if (winnerMatch) return groupPositions[`Group ${winnerMatch[1]}`]?.winner || null;
  const runnerMatch = displayName.match(/^Group ([A-L]) 2nd Place$/i);
  if (runnerMatch) return groupPositions[`Group ${runnerMatch[1]}`]?.runnerUp || null;
  // Third-place aggregated slot — can't resolve yet
  return null;
}
