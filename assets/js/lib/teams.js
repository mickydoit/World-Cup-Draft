// The 48 nations qualified for the 2026 FIFA World Cup, with the real group
// draw (Washington D.C., 5 Dec 2025) and each team's FIFA world ranking
// (FIFA/ESPN, April 2026 — the last update before the tournament).
//
// The draft lists teams best-ranked first. Group fixtures (real pairings, dates
// and kick-off times) live in schedule2026.js and reference these teams by code.
//
// Listed in ranking order.
const QUALIFIED = [
  { name: 'France', code: 'FRA', ranking: 1, grp: 'I' },
  { name: 'Spain', code: 'ESP', ranking: 2, grp: 'H' },
  { name: 'Argentina', code: 'ARG', ranking: 3, grp: 'J' },
  { name: 'England', code: 'ENG', ranking: 4, grp: 'L' },
  { name: 'Portugal', code: 'POR', ranking: 5, grp: 'K' },
  { name: 'Brazil', code: 'BRA', ranking: 6, grp: 'C' },
  { name: 'Netherlands', code: 'NED', ranking: 7, grp: 'F' },
  { name: 'Morocco', code: 'MAR', ranking: 8, grp: 'C' },
  { name: 'Belgium', code: 'BEL', ranking: 9, grp: 'G' },
  { name: 'Germany', code: 'GER', ranking: 10, grp: 'E' },
  { name: 'Croatia', code: 'CRO', ranking: 11, grp: 'L' },
  { name: 'Colombia', code: 'COL', ranking: 13, grp: 'K' },
  { name: 'Senegal', code: 'SEN', ranking: 14, grp: 'I' },
  { name: 'Mexico', code: 'MEX', ranking: 15, grp: 'A' },
  { name: 'United States', code: 'USA', ranking: 16, grp: 'D' },
  { name: 'Uruguay', code: 'URU', ranking: 17, grp: 'H' },
  { name: 'Japan', code: 'JPN', ranking: 18, grp: 'F' },
  { name: 'Switzerland', code: 'SUI', ranking: 19, grp: 'B' },
  { name: 'Iran', code: 'IRN', ranking: 21, grp: 'G' },
  { name: 'Turkey', code: 'TUR', ranking: 22, grp: 'D' },
  { name: 'Ecuador', code: 'ECU', ranking: 23, grp: 'E' },
  { name: 'Austria', code: 'AUT', ranking: 24, grp: 'J' },
  { name: 'South Korea', code: 'KOR', ranking: 25, grp: 'A' },
  { name: 'Australia', code: 'AUS', ranking: 27, grp: 'D' },
  { name: 'Algeria', code: 'ALG', ranking: 28, grp: 'J' },
  { name: 'Egypt', code: 'EGY', ranking: 29, grp: 'G' },
  { name: 'Canada', code: 'CAN', ranking: 30, grp: 'B' },
  { name: 'Norway', code: 'NOR', ranking: 31, grp: 'I' },
  { name: 'Panama', code: 'PAN', ranking: 33, grp: 'L' },
  { name: 'Ivory Coast', code: 'CIV', ranking: 34, grp: 'E' },
  { name: 'Sweden', code: 'SWE', ranking: 38, grp: 'F' },
  { name: 'Paraguay', code: 'PAR', ranking: 40, grp: 'D' },
  { name: 'Czech Republic', code: 'CZE', ranking: 41, grp: 'A' },
  { name: 'Scotland', code: 'SCO', ranking: 43, grp: 'C' },
  { name: 'Tunisia', code: 'TUN', ranking: 44, grp: 'F' },
  { name: 'DR Congo', code: 'COD', ranking: 46, grp: 'K' },
  { name: 'Uzbekistan', code: 'UZB', ranking: 50, grp: 'K' },
  { name: 'Qatar', code: 'QAT', ranking: 55, grp: 'B' },
  { name: 'Iraq', code: 'IRQ', ranking: 57, grp: 'I' },
  { name: 'South Africa', code: 'RSA', ranking: 60, grp: 'A' },
  { name: 'Saudi Arabia', code: 'KSA', ranking: 61, grp: 'H' },
  { name: 'Jordan', code: 'JOR', ranking: 63, grp: 'J' },
  { name: 'Bosnia and Herzegovina', code: 'BIH', ranking: 65, grp: 'B' },
  { name: 'Cape Verde', code: 'CPV', ranking: 69, grp: 'H' },
  { name: 'Ghana', code: 'GHA', ranking: 74, grp: 'L' },
  { name: 'Curaçao', code: 'CUW', ranking: 82, grp: 'E' },
  { name: 'Haiti', code: 'HAI', ranking: 83, grp: 'C' },
  { name: 'New Zealand', code: 'NZL', ranking: 85, grp: 'G' },
];

export const TEAMS = QUALIFIED;

/** The 6 players (still editable in the admin setup). */
export const DEFAULT_PLAYERS = ['Papacostas', 'Kerr', 'DeWet', 'Barmentloo', 'Terpcou', 'Player 06'];

export const TEAMS_PER_PLAYER = 8; // 6 players x 8 = 48 drafted, 0 left undrafted
