// ============================================================================
//  HIDDEN EXPERIMENTAL PAGE — #/bracket-test
//  Read-only radial bracket prototype (Figma "Test-bracket" design): 32 team
//  crests around a circle, winners stepping inward ring by ring to the trophy.
//  Renders from the same store.loadAll() data the rest of the app uses, plus
//  the ESPN scoreboard for topology/live state. Never writes to Supabase,
//  never touches the score/result pipeline.
//
//  Bracket structure comes from the explicit official-topology map below
//  (FIFA match numbers 73–104) — NOT from kickoff order, DB row ids,
//  bracket_pos, or array-index pairing.
// ============================================================================

// ---------------------------------------------------------------- topology
// Official FIFA 2026 knockout topology, verified 2 Jul 2026 against:
//   • ESPN core API matchNumber (…/events/{id}/competitions/{id})
//   • ESPN scoreboard placeholder names ("Round of 32 11 Winner" etc.)
//   • winner cross-check of the R16 matchups already resolved.
// Sources are [homeSource, awaySource] as official match numbers.
const SRC = {
  89: [74, 77], 90: [73, 75], 91: [76, 78], 92: [79, 80],
  93: [83, 84], 94: [81, 82], 95: [86, 88], 96: [85, 87],
  97: [89, 90], 98: [93, 94], 99: [91, 92], 100: [95, 96],
  101: [97, 98], 102: [99, 100],
  103: [101, 102], // third place — takes the LOSERS
  104: [101, 102],
};

// Stable ESPN event ids per official match number (season 2026).
const EVENT_IDS = {
  73: 760486, 74: 760489, 75: 760488, 76: 760487, 77: 760492, 78: 760490,
  79: 760491, 80: 760495, 81: 760494, 82: 760493, 83: 760496, 84: 760497,
  85: 760498, 86: 760500, 87: 760501, 88: 760499,
  89: 760503, 90: 760502, 91: 760504, 92: 760505, 93: 760506, 94: 760507,
  95: 760509, 96: 760508,
  97: 760510, 98: 760511, 99: 760512, 100: 760513,
  101: 760514, 102: 760515, 103: 760516, 104: 760517,
};

const stageOf = (m) => (m <= 88 ? 'R32' : m <= 96 ? 'R16' : m <= 100 ? 'QF' : m <= 102 ? 'SF' : m === 103 ? 'third' : 'final');
const STAGE_LABEL = { R32: 'Round of 32', R16: 'Round of 16', QF: 'Quarter-finals', SF: 'Semi-finals', third: '3rd place', final: 'Final' };
const ESPN_SLUG_TO_STAGE = {
  'round-of-32': 'R32', 'round-of-16': 'R16', 'quarterfinals': 'QF',
  'semifinals': 'SF', '3rd-place-match': 'third', 'final': 'final',
};

// Winner-path destinations, derived from SRC (never hand-maintained twice).
const FEEDS = {};
for (const [m, [h, a]] of Object.entries(SRC)) {
  if (Number(m) === 103) continue; // loser path — not the winner destination
  FEEDS[h] = { match: Number(m), slot: 'home' };
  FEEDS[a] = { match: Number(m), slot: 'away' };
}

// ESPN display name → DB team name (same map as scripts/sync-bracket.mjs).
const ESPN_NAME_MAP = {
  'Bosnia-Herzegovina': 'Bosnia and Herzegovina',
  'Bosnia & Herzegovina': 'Bosnia and Herzegovina',
  'Czechia': 'Czech Republic',
  'Congo DR': 'DR Congo',
  'DRC': 'DR Congo',
  'Türkiye': 'Turkey',
  'Korea Republic': 'South Korea',
  "Côte d'Ivoire": 'Ivory Coast',
  "Cote d'Ivoire": 'Ivory Coast',
};

// DB team name → circle-flag code (https://hatscripts.github.io/circle-flags).
const TEAM_ISO = {
  'South Africa': 'za', 'Canada': 'ca', 'Netherlands': 'nl', 'Morocco': 'ma',
  'Brazil': 'br', 'Japan': 'jp', 'Ivory Coast': 'ci', 'Norway': 'no',
  'Germany': 'de', 'Paraguay': 'py', 'France': 'fr', 'Sweden': 'se',
  'Mexico': 'mx', 'Ecuador': 'ec', 'England': 'gb-eng', 'DR Congo': 'cd',
  'United States': 'us', 'Bosnia and Herzegovina': 'ba', 'Belgium': 'be', 'Senegal': 'sn',
  'Portugal': 'pt', 'Croatia': 'hr', 'Spain': 'es', 'Austria': 'at',
  'Switzerland': 'ch', 'Algeria': 'dz', 'Argentina': 'ar', 'Cape Verde': 'cv',
  'Colombia': 'co', 'Ghana': 'gh', 'Australia': 'au', 'Egypt': 'eg',
};
const flagUrl = (name) => (TEAM_ISO[name] ? `https://hatscripts.github.io/circle-flags/flags/${TEAM_ISO[name]}.svg` : null);

// "Round of 32 11 Winner" → official match number (for the consistency check).
const PH_BASE = { 'Round of 32': 72, 'Round of 16': 88, 'Quarterfinal': 96, 'Semifinal': 100 };
const PH_RE = /^(Round of 32|Round of 16|Quarterfinal|Semifinal) (\d+) (Winner|Loser)$/;

const KO_STAGES = ['R32', 'R16', 'QF', 'SF', 'third', 'final'];
const DISPLAY_TZ = 'Australia/Sydney';
const FMT_DAY = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: DISPLAY_TZ });
const FMT_TIME = new Intl.DateTimeFormat('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: DISPLAY_TZ });
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- ESPN load
const ESPN_KO_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260628-20260719&limit=100';
const ESPN_LS_KEY = 'bt_espn_cache_v1';
let espnMem = { at: 0, events: null };

export function parseEspnEvents(json) {
  const out = {};
  for (const e of json.events || []) {
    const stage = ESPN_SLUG_TO_STAGE[e.season?.slug];
    if (!stage) continue;
    const comp = e.competitions?.[0];
    if (!comp) continue;
    const side = (ha) => {
      const c = (comp.competitors || []).find((x) => x.homeAway === ha);
      if (!c) return null;
      const raw = c.team?.displayName || '';
      const ph = PH_RE.exec(raw);
      return {
        rawName: raw,
        name: ph ? null : (ESPN_NAME_MAP[raw] || raw),
        logo: !ph && c.team?.logo ? c.team.logo : null,
        phRef: ph ? { match: PH_BASE[ph[1]] + Number(ph[2]), take: ph[3].toLowerCase() } : null,
        score: c.score != null && c.score !== '' ? Number(c.score) : null,
        winner: c.winner === true,
      };
    };
    const st = comp.status?.type || e.status?.type || {};
    out[String(e.id)] = {
      eventId: String(e.id), stage, date: comp.startDate || e.date || null,
      state: st.state || 'pre', clock: st.shortDetail || '',
      home: side('home'), away: side('away'),
    };
  }
  return out;
}

async function loadEspnEvents() {
  if (espnMem.events && Date.now() - espnMem.at < 55000) return { byId: espnMem.events, ok: true, fromCache: false };
  try {
    const res = await fetch(ESPN_KO_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const byId = parseEspnEvents(await res.json());
    espnMem = { at: Date.now(), events: byId };
    try { localStorage.setItem(ESPN_LS_KEY, JSON.stringify(byId)); } catch { /* ignore */ }
    return { byId, ok: true, fromCache: false };
  } catch (err) {
    // Offline / blocked: fall back to memory, then to the last good localStorage copy.
    if (espnMem.events) return { byId: espnMem.events, ok: false, fromCache: true };
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(ESPN_LS_KEY) : null;
      if (raw) return { byId: JSON.parse(raw), ok: false, fromCache: true };
    } catch { /* ignore */ }
    return { byId: {}, ok: false, fromCache: false };
  }
}

// ---------------------------------------------------------------- model
export function buildBracketTestModel(data, espnById, espnOk = true) {
  const teamByLower = new Map(data.teams.map((t) => [t.name.toLowerCase(), t]));
  const teamById = Object.fromEntries(data.teams.map((t) => [t.id, t]));
  const playerById = Object.fromEntries(data.players.map((p) => [p.id, p]));
  const ownerByTeamId = {};
  for (const pk of data.picks) ownerByTeamId[pk.team_id] = (playerById[pk.player_id] || {}).name || null;
  const teamIdFromEspnName = (name) => (name ? (teamByLower.get(name.toLowerCase()) || {}).id ?? null : null);

  // ESPN crest per team id (harvested from any event the team appears in).
  const logoByTeamId = {};
  for (const ev of Object.values(espnById)) {
    for (const s of [ev.home, ev.away]) {
      if (s && s.name && s.logo) {
        const tid = teamIdFromEspnName(s.name);
        if (tid != null && !logoByTeamId[tid]) logoByTeamId[tid] = s.logo;
      }
    }
  }

  // Real DB rows (teams assigned) keyed by unordered team pair; placeholders kept for id display.
  const koRows = data.fixtures.filter((f) => KO_STAGES.includes(f.stage));
  const realRows = koRows.filter((f) => f.home_team_id != null || f.away_team_id != null);
  const dbByPair = new Map();
  for (const r of realRows) {
    if (r.home_team_id == null || r.away_team_id == null) continue;
    const key = r.stage + ':' + Math.min(r.home_team_id, r.away_team_id) + '-' + Math.max(r.home_team_id, r.away_team_id);
    if (!dbByPair.has(key) || dbByPair.get(key).status === 'scheduled') dbByPair.set(key, r);
  }
  const placeholders = koRows.filter((f) => f.home_team_id == null && f.away_team_id == null);
  const placeholderFor = (stage, kickoffIso) => {
    if (!kickoffIso) return null;
    const t = Date.parse(kickoffIso);
    let best = null, bestDiff = 2 * 3600 * 1000 + 1;
    for (const p of placeholders) {
      if (p.stage !== stage || !p.kickoff) continue;
      const d = Math.abs(Date.parse(p.kickoff) - t);
      if (d < bestDiff) { best = p; bestDiff = d; }
    }
    return best;
  };

  const checks = { topologyMismatches: [], espnMissing: [], espnOk };
  const nodes = {};

  for (let m = 73; m <= 104; m++) {
    const stage = stageOf(m);
    const ev = espnById[String(EVENT_IDS[m])] || null;
    if (!ev) checks.espnMissing.push(m);

    // Consistency check: ESPN's own placeholder refs must agree with our map.
    if (ev && SRC[m]) {
      const expect = { home: SRC[m][0], away: SRC[m][1] };
      for (const s of ['home', 'away']) {
        const ph = ev[s] && ev[s].phRef;
        if (ph && ph.match !== expect[s]) {
          checks.topologyMismatches.push(`M${m} ${s}: map says M${expect[s]}, ESPN says M${ph.match}`);
        }
      }
    }

    const node = {
      matchId: m, stage, round: STAGE_LABEL[stage],
      espnEventId: EVENT_IDS[m], espnFound: !!ev,
      kickoff: (ev && ev.date) || null,
      homeSource: SRC[m] ? { match: SRC[m][0], take: m === 103 ? 'loser' : 'winner' } : null,
      awaySource: SRC[m] ? { match: SRC[m][1], take: m === 103 ? 'loser' : 'winner' } : null,
      feedsInto: FEEDS[m] || null,
      home: null, away: null,           // {teamId,name,owner,score,isWinner,provisional} | null
      homeTbd: '', awayTbd: '',
      status: 'scheduled', live: false, clock: '',
      dbFixtureId: null, dbApiId: null, phFixtureId: null,
      winnerTeamId: null, loserTeamId: null,
      provisionalWinnerTeamId: null, provisionalLoserTeamId: null,
      espnScore: ev && (ev.home?.score != null || ev.away?.score != null) ? `${ev.home?.score ?? '–'}-${ev.away?.score ?? '–'}` : null,
    };

    // --- resolve the two sides from explicit sources (or ESPN entry round) ---
    const resolveSide = (slot) => {
      const src = slot === 'home' ? node.homeSource : node.awaySource;
      const evSide = ev ? ev[slot] : null;
      let teamId = null, provisional = false;

      if (!src) {
        // R32 entry round: teams come straight from ESPN (real names only).
        teamId = teamIdFromEspnName(evSide && evSide.name);
      } else {
        const parent = nodes[src.match];
        const want = src.take === 'winner' ? 'winnerTeamId' : 'loserTeamId';
        const wantProv = src.take === 'winner' ? 'provisionalWinnerTeamId' : 'provisionalLoserTeamId';
        if (parent && parent[want] != null) teamId = parent[want];
        else if (parent && parent[wantProv] != null) { teamId = parent[wantProv]; provisional = true; }
        else if (evSide && evSide.name) { teamId = teamIdFromEspnName(evSide.name); provisional = teamId != null; }
        if (teamId == null) {
          const lbl = src.take === 'winner' ? 'Winner' : 'Loser';
          node[slot + 'Tbd'] = `${lbl} · M${src.match}`;
        }
      }
      if (teamId != null) {
        const t = teamById[teamId] || {};
        node[slot] = { teamId, name: t.name || '?', code: t.code || '', owner: ownerByTeamId[teamId] || null, score: null, isWinner: false, provisional };
      }
    };
    resolveSide('home');
    resolveSide('away');

    // --- attach the DB row (score/result authority) by team pair ---
    if (node.home && node.away) {
      const key = stage + ':' + Math.min(node.home.teamId, node.away.teamId) + '-' + Math.max(node.home.teamId, node.away.teamId);
      const row = dbByPair.get(key);
      if (row) {
        node.dbFixtureId = row.id;
        node.dbApiId = row.api_id ?? null;
        node.status = row.status || 'scheduled';
        if (!node.kickoff) node.kickoff = row.kickoff || null;
        // Orientation-safe: read each side's score by team id, not by home/away slot.
        const scoreOf = (tid) => (tid === row.home_team_id ? row.home_score : tid === row.away_team_id ? row.away_score : null);
        node.home.score = scoreOf(node.home.teamId);
        node.away.score = scoreOf(node.away.teamId);
        if (row.status === 'finished' && row.winner_team_id != null) {
          node.winnerTeamId = row.winner_team_id;
          node.loserTeamId = row.winner_team_id === node.home.teamId ? node.away.teamId : node.home.teamId;
          node.home.isWinner = node.home.teamId === row.winner_team_id;
          node.away.isWinner = node.away.teamId === row.winner_team_id;
        }
      }
    }

    // --- ESPN live/finished state fills the gaps (display + provisional only) ---
    if (ev) {
      if (ev.state === 'in') { node.live = true; node.clock = ev.clock; if (node.status === 'scheduled') node.status = 'live'; }
      const matchEvSide = (side) => {
        if (!side || !ev) return null;
        if (ev.home && ev.home.name && teamIdFromEspnName(ev.home.name) === side.teamId) return ev.home;
        if (ev.away && ev.away.name && teamIdFromEspnName(ev.away.name) === side.teamId) return ev.away;
        return null;
      };
      // No DB row yet (or not scored yet): show ESPN's score as provisional.
      if (node.dbFixtureId == null || (node.status !== 'finished' && node.home && node.home.score == null)) {
        for (const s of ['home', 'away']) {
          const evSide = matchEvSide(node[s]);
          if (node[s] && evSide && evSide.score != null && ev.state !== 'pre') {
            node[s].score = evSide.score;
            node[s].provisional = true;
          }
        }
      }
      // ESPN says decided but our DB has no winner yet → provisional propagation.
      if (ev.state === 'post' && node.winnerTeamId == null && node.home && node.away) {
        const evWinner = [ev.home, ev.away].find((x) => x && x.winner && x.name);
        const wid = evWinner ? teamIdFromEspnName(evWinner.name) : null;
        if (wid != null && (wid === node.home.teamId || wid === node.away.teamId)) {
          node.provisionalWinnerTeamId = wid;
          node.provisionalLoserTeamId = wid === node.home.teamId ? node.away.teamId : node.home.teamId;
        }
      }
    }

    node.phFixtureId = (placeholderFor(stage, node.kickoff) || {}).id ?? null;
    nodes[m] = node;
  }

  // Teams knocked out anywhere along the path (dimmed on the radial).
  const eliminated = new Set();
  for (const n of Object.values(nodes)) {
    if (n.stage === 'third') continue;
    const loser = n.loserTeamId ?? n.provisionalLoserTeamId;
    if (loser != null) eliminated.add(loser);
  }

  // --- layout wings, derived from the map (SF 101 = left, SF 102 = right) ---
  const wing = (sf) => {
    const qf = SRC[sf].slice();
    const r16 = qf.flatMap((q) => SRC[q]);
    const r32 = r16.flatMap((r) => SRC[r]);
    return { sf: [sf], qf, r16, r32 };
  };
  const layout = { left: wing(101), right: wing(102), final: 104, third: 103 };
  const wingOf = {};
  for (const side of ['left', 'right']) {
    for (const col of ['sf', 'qf', 'r16', 'r32']) for (const m of layout[side][col]) wingOf[m] = side;
  }

  const counts = {
    espnEvents: Object.keys(espnById).length,
    dbLinked: Object.values(nodes).filter((n) => n.dbFixtureId != null).length,
    decided: Object.values(nodes).filter((n) => n.winnerTeamId != null).length,
  };
  return { nodes, layout, wingOf, eliminated, logoByTeamId, checks, counts, generatedAt: new Date() };
}

// ---------------------------------------------------------------- radial SVG
// All geometry is computed from the topology map: 32 team badges on the outer
// ring (16 adjacent pairs), winner slots on inner rings at the mean angle of
// their feeders, trophy at the centre. No DOM measurement anywhere.
const R_SIZE = 720, R_C = 360;
const RING = { team: 316, R32: 244, R16: 180, QF: 118, SF: 74 };
const rad = (deg) => (deg * Math.PI) / 180;
const posAt = (deg, r) => [
  Math.round((R_C + r * Math.sin(rad(deg))) * 10) / 10,
  Math.round((R_C - r * Math.cos(rad(deg))) * 10) / 10,
];

function radialAngles(model) {
  const teamAngle = {}; // `${match}:${slot}` -> deg
  const rightTeams = model.layout.right.r32.flatMap((m) => [`${m}:home`, `${m}:away`]);
  const leftTeams = model.layout.left.r32.flatMap((m) => [`${m}:home`, `${m}:away`]);
  rightTeams.forEach((k, i) => { teamAngle[k] = 11.25 * (i + 0.5); });
  leftTeams.forEach((k, i) => { teamAngle[k] = 360 - 11.25 * (i + 0.5); });
  const matchAngle = {};
  const angleOf = (m) => {
    if (matchAngle[m] != null) return matchAngle[m];
    const a = SRC[m]
      ? (angleOf(SRC[m][0]) + angleOf(SRC[m][1])) / 2
      : (teamAngle[`${m}:home`] + teamAngle[`${m}:away`]) / 2;
    matchAngle[m] = a;
    return a;
  };
  for (const side of ['left', 'right']) for (const m of model.layout[side].sf) angleOf(m);
  return { teamAngle, matchAngle };
}

function svgBadge(team, x, y, size, cls, logoByTeamId) {
  const half = size / 2;
  // Round flag first (matches the radial reference); ESPN logo is the fallback
  // (their national-team "logos" are rectangular flags, so flag CDN wins).
  const flag = flagUrl(team.name);
  const crest = logoByTeamId[team.teamId] || null;
  const img = flag || crest;
  return `<circle cx="${x}" cy="${y}" r="${half + 1.5}" class="bt-badge-disc"/>
    <text x="${x}" y="${y + 3.5}" class="bt-team-code">${esc((team.code || team.name).slice(0, 3).toUpperCase())}</text>
    ${img ? `<image href="${esc(img)}" x="${x - half}" y="${y - half}" width="${size}" height="${size}" class="${cls || ''}"/>` : ''}`;
}

function svgFlagBadge(name, teamId, x, y, size, prov, model) {
  const half = size / 2;
  const flag = flagUrl(name) || model.logoByTeamId[teamId] || null;
  const t = { teamId, name, code: name };
  return `<g>
    <circle cx="${x}" cy="${y}" r="${half + 2}" class="bt-badge-ring ${prov ? 'bt-ring-prov' : ''}"/>
    ${flag ? `<image href="${esc(flag)}" x="${x - half}" y="${y - half}" width="${size}" height="${size}"/>`
      : svgBadge(t, x, y, size, '', model.logoByTeamId)}
  </g>`;
}

function nodeTitle(n) {
  const hn = n.home ? n.home.name : (n.homeTbd || 'TBD');
  const an = n.away ? n.away.name : (n.awayTbd || 'TBD');
  const sc = n.home && n.home.score != null && n.away && n.away.score != null ? ` ${n.home.score}-${n.away.score}` : '';
  const when = n.kickoff ? ` · ${FMT_DAY.format(new Date(n.kickoff))} ${FMT_TIME.format(new Date(n.kickoff))}` : '';
  return `M${n.matchId} · ${hn} v ${an}${sc}${when}`;
}

function renderRadial(model) {
  const { nodes } = model;
  const { teamAngle, matchAngle } = radialAngles(model);
  const winnerPos = (m) => posAt(matchAngle[m], RING[stageOf(m)]);
  let lines = '', slots = '', badges = '';

  const lineCls = (n, side) => {
    const decided = n.winnerTeamId != null || n.provisionalWinnerTeamId != null;
    if (decided) {
      const wid = n.winnerTeamId ?? n.provisionalWinnerTeamId;
      return n[side] && n[side].teamId === wid ? 'bt-l-won' : 'bt-l-lost';
    }
    return n[side] ? 'bt-l-known' : 'bt-l-tbd';
  };

  for (let m = 73; m <= 102; m++) {
    const n = nodes[m];
    const [wx, wy] = winnerPos(m);

    for (const side of ['home', 'away']) {
      const from = n.homeSource
        ? winnerPos(side === 'home' ? n.homeSource.match : n.awaySource.match)
        : posAt(teamAngle[`${m}:${side}`], RING.team - 24);
      lines += `<line x1="${from[0]}" y1="${from[1]}" x2="${wx}" y2="${wy}" class="${lineCls(n, side)}"/>`;
    }

    // Tap targets: an outer-ring flag opens ITS OWN game (past or upcoming);
    // an advanced winner flag one ring in opens the match it feeds into —
    // e.g. England next to DR Congo → M80, England's advanced flag → M92.
    const wid = n.winnerTeamId ?? n.provisionalWinnerTeamId;

    // Outer ring: the 16 R32 pairs as badges.
    if (!n.homeSource) {
      for (const side of ['home', 'away']) {
        const t = n[side];
        if (!t) continue;
        const [x, y] = posAt(teamAngle[`${m}:${side}`], RING.team);
        const out = model.eliminated.has(t.teamId);
        badges += `<g class="bt-node ${out ? 'bt-out' : ''}" data-bt-node="${m}"><title>${esc(nodeTitle(n))}</title>${svgBadge(t, x, y, 40, '', model.logoByTeamId)}</g>`;
      }
    }

    // Winner slot: flag badge once decided (tap → next match), dot while TBD.
    const prov = n.winnerTeamId == null && n.provisionalWinnerTeamId != null;
    const live = n.live ? `<circle cx="${wx}" cy="${wy}" r="18" class="bt-slot-live"/>` : '';
    const slotTarget = wid != null && FEEDS[m] ? FEEDS[m].match : m;
    const inner = wid != null
      ? svgFlagBadge((nodes[m].home && nodes[m].home.teamId === wid ? nodes[m].home : nodes[m].away).name, wid, wx, wy, 28, prov, model)
      : `<circle cx="${wx}" cy="${wy}" r="4" class="bt-slot-tbd"/>`;
    slots += `<g class="bt-node" data-bt-node="${slotTarget}"><title>${esc(nodeTitle(nodes[slotTarget]))}</title>${live}<circle cx="${wx}" cy="${wy}" r="17" class="bt-hit"/>${inner}</g>`;
  }

  // Final: both SF winner slots feed the centre.
  const fin = nodes[104];
  for (const side of ['home', 'away']) {
    const from = winnerPos(side === 'home' ? 101 : 102);
    lines += `<line x1="${from[0]}" y1="${from[1]}" x2="${R_C}" y2="${R_C}" class="${lineCls(fin, side)} bt-l-final"/>`;
  }
  const champId = fin.winnerTeamId ?? fin.provisionalWinnerTeamId;
  const champ = champId != null
    ? `<g class="bt-node" data-bt-node="104"><title>${esc(nodeTitle(fin))}</title>
        <text x="${R_C}" y="${R_C - 128}" class="bt-champ-label">CHAMPION</text>
        ${svgFlagBadge((fin.home && fin.home.teamId === champId ? fin.home : fin.away).name, champId, R_C, R_C - 100, 40, fin.winnerTeamId == null, model)}</g>`
    : '';
  // Official WC26 emblem (real trophy, transparent PNG committed to the repo).
  const centre = `
    <circle cx="${R_C}" cy="${R_C}" r="118" fill="url(#btGlow)"/>
    <g class="bt-node" data-bt-node="104"><title>${esc(nodeTitle(fin))}</title>
      <circle cx="${R_C}" cy="${R_C}" r="52" class="bt-hit"/>
      <image href="assets/img/bt-trophy.png" x="${R_C - 55}" y="${R_C - 55}" width="110" height="110"/>
    </g>
    ${champ}`;

  return `<div class="bt-radial${fin.home && fin.away ? ' bt-final-focus' : ''}"><svg viewBox="0 0 ${R_SIZE} ${R_SIZE}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="World Cup knockout bracket">
    <defs>
      <radialGradient id="btGlow"><stop offset="0%" stop-color="rgba(168,85,247,.32)"/><stop offset="55%" stop-color="rgba(168,85,247,.12)"/><stop offset="100%" stop-color="rgba(168,85,247,0)"/></radialGradient>
    </defs>
    <g class="bt-lines">${lines}</g>
    ${centre}
    ${slots}
    ${badges}
  </svg></div>`;
}

// ---------------------------------------------------------------- view bits
const dayLbl = (iso) => (iso ? FMT_DAY.format(new Date(iso)) : 'TBC');
const timeLbl = (iso) => (iso ? FMT_TIME.format(new Date(iso)) : '');

function sideHtml(side, tbdLabel) {
  if (!side) {
    return `<div class="bt-side bt-tbd"><span class="bt-team">${esc(tbdLabel || 'TBD')}</span><span class="bt-sc"></span></div>`;
  }
  const cls = ['bt-side', side.isWinner ? 'bt-win' : '', side.provisional ? 'bt-prov' : ''].join(' ');
  return `<div class="${cls}">
    <span class="bt-twrap"><span class="bt-team" title="${esc(side.name)}">${esc(side.name)}</span>${side.owner ? `<span class="bt-own">${esc(side.owner)}</span>` : ''}</span>
    <span class="bt-sc">${side.score != null ? side.score : ''}</span>
  </div>`;
}

function statusHtml(n) {
  if (n.live) return `<span class="bt-mstat bt-livechip"><span class="bt-dot"></span>${esc(n.clock || 'LIVE')}</span>`;
  if (n.status === 'finished') return `<span class="bt-mstat bt-ft">FT</span>`;
  return `<span class="bt-mstat">${esc(dayLbl(n.kickoff))} · ${esc(timeLbl(n.kickoff))}</span>`;
}

function matchCard(n, opts = {}) {
  const cls = ['bt-match', n.status === 'finished' ? 'bt-played' : '', n.live ? 'bt-islive' : ''].join(' ');
  const roundTag = opts.showRound ? `<span class="bt-mround">${esc(n.round)}</span>` : '';
  return `<div class="${cls}" data-match="${n.matchId}">
    <div class="bt-mhead"><span class="bt-mnum">M${n.matchId}</span>${roundTag}${statusHtml(n)}</div>
    ${sideHtml(n.home, n.homeTbd)}
    ${sideHtml(n.away, n.awayTbd)}
  </div>`;
}

// Round tabs + stacked cards (bracket order, never kickoff order).
const TABS = [
  { key: 'R32', label: 'R32' }, { key: 'R16', label: 'R16' },
  { key: 'QF', label: 'QF' }, { key: 'SF', label: 'SF' }, { key: 'final', label: 'FINAL' },
];
let btActiveTab = null;

function roundMatchIds(model, stageKey) {
  const L = model.layout.left, R = model.layout.right;
  if (stageKey === 'R32') return [...L.r32, ...R.r32];
  if (stageKey === 'R16') return [...L.r16, ...R.r16];
  if (stageKey === 'QF') return [...L.qf, ...R.qf];
  if (stageKey === 'SF') return [...L.sf, ...R.sf];
  return [model.layout.final, model.layout.third];
}

function renderRoundList(model, stageKey) {
  return roundMatchIds(model, stageKey).map((m) => matchCard(model.nodes[m])).join('');
}

function defaultTab(model) {
  for (const t of TABS) {
    const ids = roundMatchIds(model, t.key);
    if (ids.some((m) => model.nodes[m].status !== 'finished')) return t.key;
  }
  return 'final';
}

function renderMatchList(model) {
  const active = btActiveTab || defaultTab(model);
  const tabs = TABS.map((t) =>
    `<button class="bt-tab ${t.key === active ? 'bt-tab-on' : ''}" data-tab="${t.key}">${t.label}</button>`).join('');
  return `<details class="bt-listwrap"><summary>All matches — round by round</summary>
    <div class="bt-tabs">${tabs}</div>
    <div class="bt-mobile-list">${renderRoundList(model, active)}</div>
  </details>`;
}

// The match shown in the detail card before any tap: live game first, then
// the next unfinished kickoff, then the final.
function defaultDetailMatch(model) {
  const ns = Object.values(model.nodes);
  const live = ns.find((n) => n.live);
  if (live) return live.matchId;
  const upcoming = ns
    .filter((n) => n.status !== 'finished' && n.kickoff)
    .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff))[0];
  return upcoming ? upcoming.matchId : 104;
}

// ---------------------------------------------------------------- debug panel
function debugRows(model, stages) {
  const rows = [];
  for (let m = 73; m <= 104; m++) {
    const n = model.nodes[m];
    if (!stages.includes(n.stage)) continue;
    rows.push({
      match: 'M' + m, round: n.stage,
      espn: n.espnFound ? n.espnEventId : n.espnEventId + ' ✗',
      fixture: n.dbFixtureId ?? '—', api_id: n.dbApiId ?? '—', ph: n.phFixtureId ?? '—',
      homeSrc: n.homeSource ? (n.homeSource.take === 'loser' ? 'L' : 'W') + ' M' + n.homeSource.match : '—',
      awaySrc: n.awaySource ? (n.awaySource.take === 'loser' ? 'L' : 'W') + ' M' + n.awaySource.match : '—',
      home: n.home ? n.home.name + (n.home.provisional ? ' *' : '') : n.homeTbd || 'TBD',
      away: n.away ? n.away.name + (n.away.provisional ? ' *' : '') : n.awayTbd || 'TBD',
      score: n.home && n.home.score != null ? `${n.home.score}-${n.away ? n.away.score ?? '–' : '–'}` : (n.espnScore ? n.espnScore + ' (espn)' : '—'),
      status: n.status + (n.live ? ' ' + n.clock : ''),
      winner: n.winnerTeamId != null ? (n.home && n.home.teamId === n.winnerTeamId ? n.home.name : n.away.name)
        : (n.provisionalWinnerTeamId != null ? '(espn) ' + ((n.home && n.home.teamId === n.provisionalWinnerTeamId) ? n.home.name : n.away.name) : '—'),
      next: n.feedsInto ? `M${n.feedsInto.match} (${n.feedsInto.slot})` : '—',
    });
  }
  return rows;
}

function debugTable(title, rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  return `<h3>${esc(title)}</h3><div class="bt-dbg-scroll"><table class="bt-dbg-table">
    <thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c])}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

function renderDebugPanel(model) {
  const c = model.checks;
  const lines = [
    `ESPN fetch: ${c.espnOk ? 'OK' : 'FAILED (using cached copy if shown)'} · ${model.counts.espnEvents} events parsed`,
    `DB fixtures linked: ${model.counts.dbLinked} · decided (DB winner): ${model.counts.decided}`,
    `Topology vs ESPN placeholders: ${c.topologyMismatches.length ? '⚠ ' + c.topologyMismatches.join(' | ') : '✓ consistent'}`,
    c.espnMissing.length ? `⚠ ESPN events not found for: ${c.espnMissing.map((m) => 'M' + m).join(', ')}` : null,
    `Tip: run window.BT_DEBUG = true then refresh for console.table output.`,
  ].filter(Boolean);
  return `<details class="bt-debug"><summary>Debug panel — topology &amp; data sources</summary>
    <div class="bt-dbg-status">${lines.map((l) => `<div>${esc(l)}</div>`).join('')}</div>
    ${debugTable('Round of 16', debugRows(model, ['R16']))}
    ${debugTable('QF / SF / Final / 3rd', debugRows(model, ['QF', 'SF', 'final', 'third']))}
    ${debugTable('Round of 32 (entry round)', debugRows(model, ['R32']))}
  </details>`;
}

// ---------------------------------------------------------------- wiring
let handlersInstalled = false;
function installHandlers() {
  if (handlersInstalled || typeof document === 'undefined') return;
  handlersInstalled = true;
  document.addEventListener('click', (e) => {
    if (!window.__btModel) return;
    const tab = e.target.closest('.bt-tab');
    if (tab) {
      btActiveTab = tab.dataset.tab;
      const list = document.querySelector('.bt-mobile-list');
      if (list) list.innerHTML = renderRoundList(window.__btModel, btActiveTab);
      document.querySelectorAll('.bt-tab').forEach((x) => x.classList.toggle('bt-tab-on', x.dataset.tab === btActiveTab));
      return;
    }
    const node = e.target.closest('[data-bt-node]');
    if (node) {
      const m = Number(node.dataset.btNode);
      const detail = document.getElementById('bt-detail');
      if (detail && window.__btModel.nodes[m]) detail.innerHTML = matchCard(window.__btModel.nodes[m], { showRound: true });
      document.querySelectorAll('.bt-node.bt-sel').forEach((x) => x.classList.remove('bt-sel'));
      node.classList.add('bt-sel');
    }
  });
}

function ensureCss() {
  if (typeof document === 'undefined' || document.getElementById('bt-css')) return;
  const link = document.createElement('link');
  link.id = 'bt-css';
  link.rel = 'stylesheet';
  link.href = 'assets/css/bracket-test.css?v=6';
  document.head.appendChild(link);
}

// ---------------------------------------------------------------- entry
// Ladder embed: the radial + tap-detail card only (no chips/list/debug).
// Returns '' -safe HTML; caller wraps it in try/catch so the ladder page
// can never break on this section.
export async function renderLadderRadial(data) {
  ensureCss();
  installHandlers();
  const espn = await loadEspnEvents();
  const model = buildBracketTestModel(data, espn.byId, espn.ok);
  if (typeof window !== 'undefined') {
    window.__btModel = model;
    if (model.checks.topologyMismatches.length) console.warn('[bracket] topology mismatches:', model.checks.topologyMismatches);
  }
  return `
  <h2 class="lbh-bracket-ladder-hdr">Knockout Bracket</h2>
  <div class="bt-wrap bt-onladder">
    ${renderRadial(model)}
    <div class="bt-detail" id="bt-detail">${matchCard(model.nodes[defaultDetailMatch(model)], { showRound: true })}</div>
  </div>`;
}

export async function renderBracketTestPage(data) {
  ensureCss();
  installHandlers();
  const espn = await loadEspnEvents();
  const model = buildBracketTestModel(data, espn.byId, espn.ok);
  if (typeof window !== 'undefined') {
    window.__btModel = model;
    if (window.BT_DEBUG) {
      console.table(debugRows(model, ['R32']));
      console.table(debugRows(model, ['R16', 'QF', 'SF', 'final', 'third']));
    }
    if (model.checks.topologyMismatches.length) console.warn('[bracket-test] topology mismatches:', model.checks.topologyMismatches);
  }

  const chips = [
    `<span class="bt-chip ${espn.ok ? 'bt-ok' : 'bt-warn'}">ESPN ${espn.ok ? '✓' : espn.fromCache ? 'cache' : '✗'} · ${model.counts.espnEvents} events</span>`,
    `<span class="bt-chip">DB · ${model.counts.dbLinked} linked</span>`,
    `<span class="bt-chip ${model.checks.topologyMismatches.length ? 'bt-warn' : 'bt-ok'}">Topology ${model.checks.topologyMismatches.length ? '⚠' : '✓'}</span>`,
    `<span class="bt-chip">${esc(FMT_TIME.format(model.generatedAt))}</span>`,
  ].join('');

  return `<div class="bt-wrap">
    <h1>Bracket · Test</h1>
    <p class="hint">Experimental prototype — official-topology radial bracket. Tap any badge or slot for match details. Auto-refreshes every 60s.</p>
    <div class="bt-status">${chips}</div>
    ${renderRadial(model)}
    <div class="bt-detail" id="bt-detail">${matchCard(model.nodes[defaultDetailMatch(model)], { showRound: true })}</div>
    ${renderMatchList(model)}
    ${renderDebugPanel(model)}
  </div>`;
}

export { renderRadial };
