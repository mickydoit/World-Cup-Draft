// ESPN unofficial public API — no token required.
// Endpoint for FIFA World Cup: https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';

// ESPN display names → canonical names stored in the DB / fifaRankings.js
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

export function normalizeTeamName(displayName) {
  return ESPN_NAME_MAP[displayName] || displayName;
}

export function normalizeMatch(event) {
  const comp = event.competitions?.[0];
  if (!comp) return null;

  const status = comp.status?.type;
  const finished = status?.completed === true;
  const home = comp.competitors?.find((c) => c.homeAway === 'home');
  const away = comp.competitors?.find((c) => c.homeAway === 'away');
  if (!home || !away) return null;

  const homeScore = home.score != null && home.score !== '' ? Number(home.score) : null;
  const awayScore = away.score != null && away.score !== '' ? Number(away.score) : null;

  let winnerSide = null;
  if (finished) {
    if (home.winner === true) winnerSide = 'HOME_TEAM';
    else if (away.winner === true) winnerSide = 'AWAY_TEAM';
    else if (homeScore != null && awayScore != null && homeScore === awayScore) winnerSide = 'DRAW';
  }

  return {
    apiId: event.id,
    utcDate: comp.startDate || event.date,
    home: {
      apiId: null,
      name: normalizeTeamName(home.team?.displayName || ''),
      code: home.team?.abbreviation || null,
    },
    away: {
      apiId: null,
      name: normalizeTeamName(away.team?.displayName || ''),
      code: away.team?.abbreviation || null,
    },
    homeScore: finished ? homeScore : null,
    awayScore: finished ? awayScore : null,
    winnerSide,
    finished,
  };
}

export function normalizeMatches(json) {
  return (json?.events || [])
    .map(normalizeMatch)
    .filter(
      (m) =>
        m &&
        m.home.name &&
        m.away.name &&
        // Skip TBD placeholders like "Group A 1st Place"
        !m.home.name.includes('Place') &&
        !m.away.name.includes('Place')
    );
}

/**
 * Fetch recent World Cup matches from ESPN (no token required).
 * Fetches yesterday + today + next 2 days to capture in-progress and recent results.
 */
export async function fetchMatches(_token, fetchImpl = globalThis.fetch) {
  const dates = [];
  const now = new Date();
  for (let d = -1; d <= 2; d++) {
    const dt = new Date(now);
    dt.setUTCDate(dt.getUTCDate() + d);
    dates.push(dt.toISOString().slice(0, 10).replace(/-/g, ''));
  }

  const all = [];
  const seen = new Set();
  for (const date of dates) {
    try {
      const res = await fetchImpl(`${BASE}?dates=${date}`);
      if (!res.ok) continue;
      for (const m of normalizeMatches(await res.json())) {
        if (!seen.has(m.apiId)) {
          seen.add(m.apiId);
          all.push(m);
        }
      }
    } catch {
      // Skip failed dates — better to return partial data than throw
    }
  }
  return all;
}
