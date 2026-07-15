// Inserts confirmed knockout bracket fixtures from ESPN into Supabase.
// Only creates rows that don't exist yet — does NOT touch scores, group-stage
// fixtures, picks, or anything the live-score sync owns.
//
//   DATABASE_URL="postgres://…" node scripts/sync-bracket.mjs

import { query } from '../src/db/index.js';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';

const SLUG_TO_STAGE = {
  'round-of-32': 'R32',
  'round-of-16': 'R16',
  'quarterfinals': 'QF',
  'semifinals': 'SF',
  'third-place': 'third',
  '3rd-place-match': 'third',
  'final': 'final',
};

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

async function fetchKnockoutFixtures() {
  const dates = [];
  const now = new Date();
  // Look back 1 day and ahead 14 days to catch all published bracket slots
  for (let d = -1; d <= 14; d++) {
    const dt = new Date(now);
    dt.setUTCDate(dt.getUTCDate() + d);
    dates.push(dt.toISOString().slice(0, 10).replace(/-/g, ''));
  }

  const fixtures = [];
  const seen = new Set();

  for (const date of dates) {
    try {
      const res = await fetch(`${BASE}?dates=${date}`);
      if (!res.ok) continue;
      const data = await res.json();
      for (const event of data.events || []) {
        const stage = SLUG_TO_STAGE[event.season?.slug];
        if (!stage || seen.has(event.id)) continue;
        seen.add(event.id);

        const comp = event.competitions?.[0];
        if (!comp) continue;
        const home = comp.competitors?.find((c) => c.homeAway === 'home');
        const away = comp.competitors?.find((c) => c.homeAway === 'away');
        if (!home || !away) continue;

        const homeName = ESPN_NAME_MAP[home.team?.displayName] || home.team?.displayName || '';
        const awayName = ESPN_NAME_MAP[away.team?.displayName] || away.team?.displayName || '';

        // Skip TBD slots — only insert once real teams are confirmed
        if (!homeName || !awayName || homeName.includes('Place') || awayName.includes('Place')) continue;

        fixtures.push({ stage, kickoff: comp.startDate || event.date, homeName, awayName });
      }
    } catch {
      // Skip failed dates silently
    }
  }

  return fixtures;
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — point it at your Supabase connection string.');
  process.exit(1);
}

try {
  const fixtures = await fetchKnockoutFixtures();
  console.log(`[bracket] ESPN has ${fixtures.length} knockout fixture(s) with confirmed teams`);

  const teamRows = (await query('SELECT id, name FROM teams')).rows;
  const idByName = new Map(teamRows.map((r) => [r.name.toLowerCase(), r.id]));

  let inserted = 0;
  let skipped = 0;

  for (const f of fixtures) {
    const homeId = idByName.get(f.homeName.toLowerCase());
    const awayId = idByName.get(f.awayName.toLowerCase());

    if (!homeId || !awayId) {
      console.warn(`[bracket] unmatched teams: "${f.homeName}" vs "${f.awayName}" — add to ESPN_NAME_MAP if needed`);
      continue;
    }

    // Check both orderings so we don't duplicate a manually-entered fixture
    const existing = (await query(
      `SELECT id FROM fixtures
        WHERE (home_team_id = $1 AND away_team_id = $2)
           OR (home_team_id = $2 AND away_team_id = $1)`,
      [homeId, awayId]
    )).rows[0];

    if (existing) { skipped += 1; continue; }

    await query(
      `INSERT INTO fixtures (stage, kickoff, home_team_id, away_team_id, status)
       VALUES ($1, $2, $3, $4, 'scheduled')`,
      [f.stage, f.kickoff, homeId, awayId]
    );
    inserted += 1;
    console.log(`[bracket] inserted ${f.stage}: ${f.homeName} vs ${f.awayName}`);
  }

  console.log(`[bracket] done — inserted=${inserted} already_present=${skipped}`);
  process.exit(0);
} catch (err) {
  console.error('[bracket] failed:', err.message);
  process.exit(1);
}
