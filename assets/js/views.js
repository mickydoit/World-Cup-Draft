// HTML renderers — direct ports of the original views/*.ejs templates, but as
// template strings. Interactive elements carry data-action attributes that
// app.js wires up. The app works the same; only the transport changed.

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- Ladder
export function renderLadder(ladder) {
  const initials = (name) => name ? name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() : '?';
  return `
  <h1>Ladder</h1>
  <div class="ladder-header">
    <span class="lh-rank">#</span>
    <span class="lh-avatar"></span>
    <span class="lh-name">Player</span>
    <span class="lh-teams">Teams</span>
    <span class="lh-pts">Pts</span>
  </div>
  <div class="ladder-list">
    ${ladder.map((p, i) => `
      <a href="#/draft/player/${p.id}" class="ladder-row ${i === 0 ? 'leader' : ''}">
        <span class="ladder-rank">${i + 1}</span>
        <span class="ladder-avatar">${initials(p.name)}</span>
        <span class="ladder-name">${esc(p.name)}</span>
        <span class="ladder-teams">${p.teamCount}</span>
        <span class="ladder-pts">${p.points}</span>
      </a>`).join('')}
  </div>
  <p class="hint" style="margin-top:1rem">"Teams left" counts only your drafted nations still in the tournament. Points: group win = 1, draw = 0.5. Knockouts: R32 = 1, R16 = 2, QF = 3, SF = 4, Final = 5. Own both teams in a match? Any decisive result scores the full win, a draw scores 0.5.</p>
  <div class="view-btn-wrap"><a class="view-btn" href="#/fixtures">View Fixtures</a></div>`;
}

// -------------------------------------------------------------- Fixtures
export function renderFixtures(groups) {
  if (!groups.length) return `<h1>Fixtures</h1><p class="hint">No fixtures yet.</p>`;

  const card = (f) => {
    const scored = f.status === 'finished';
    const sep = scored ? `${f.home_score}&ndash;${f.away_score}` : 'v';
    return `
    <div id="fx-${f.id}" class="fixture-card ${scored ? 'played' : ''}">
      <div class="fxc-top">
        <span class="fxc-time">${esc(f.time_label || 'TBC')}</span>
        <span class="fxc-group">${esc(f.stage_label || '')}</span>
      </div>
      <div class="fxc-match">
        <span class="fxc-team">${esc(f.home_name || 'TBD')}</span>
        <span class="fxc-sep">${sep}</span>
        <span class="fxc-team">${esc(f.away_name || 'TBD')}</span>
      </div>
      <div class="fxc-owners">
        <span class="fxc-owner ${f.home_is_winner ? 'winner' : ''} ${!f.home_owner ? 'dim' : ''}">${esc(f.home_owner || '—')}</span>
        <span class="fxc-vs">vs</span>
        <span class="fxc-owner ${f.away_is_winner ? 'winner' : ''} ${!f.away_owner ? 'dim' : ''}">${esc(f.away_owner || '—')}</span>
      </div>
    </div>`;
  };

  // Determine which group should be open by default:
  // The last group that has started (kickoff passed) but isn't fully played yet.
  // If no such group exists, open the first upcoming group.
  const now = Date.now();
  let activeTitle = null;
  for (const g of groups) {
    const hasStarted = g.date_ts != null && g.date_ts <= now + 2 * 3600 * 1000; // 2hr lead-in
    const hasAnyPlayed = g.fixtures.some(f => f.status === 'finished');
    if ((hasStarted || hasAnyPlayed) && !g.allPlayed) activeTitle = g.title;
  }
  if (!activeTitle) {
    const next = groups.find(g => !g.allPlayed && g.date_ts != null && g.date_ts > now);
    if (next) activeTitle = next.title;
  }

  return `
  <h1>Fixtures</h1>
  <p class="hint">Times shown in AEST. Owner names appear once the draft is complete.</p>
  ${groups.map((g) => {
    const played = g.fixtures.filter(f => f.status === 'finished').length;
    const total = g.fixtures.length;
    const badge = g.allPlayed
      ? `<span class="fxday-badge done">All played</span>`
      : played > 0
        ? `<span class="fxday-badge">${played}/${total} played</span>`
        : `<span class="fxday-badge">${total} match${total !== 1 ? 'es' : ''}</span>`;
    const isOpen = g.title === activeTitle;
    return `
    <details class="fxday" data-group="${esc(g.title)}"${isOpen ? ' open' : ''}>
      <summary class="fxday-header">
        <span class="fxday-title">${esc(g.title)}</span>
        ${badge}
      </summary>
      <div class="fxday-body">${g.fixtures.map(card).join('')}</div>
    </details>`;
  }).join('')}
  <div class="view-btn-wrap"><a class="view-btn" href="#/">View Ladder</a></div>`;
}

// --------------------------------------------------------------- Bracket
function koSide(name, score, isWinner, finished, tbd) {
  return `
    <div class="ko-side ${isWinner ? 'win' : ''} ${tbd ? 'tbd' : ''}">
      <span class="ko-team">${tbd ? 'TBD' : esc(name || 'TBD')}</span>
      <span class="ko-score">${finished && score != null ? score : ''}</span>
    </div>`;
}
function koMatch(m) {
  const finished = m.status === 'finished';
  return `
    <div class="ko-match ${finished ? 'played' : ''} ${m.tbd ? 'is-tbd' : ''}">
      ${koSide(m.home_name, m.home_score, m.home_is_winner, finished, m.tbd)}
      ${koSide(m.away_name, m.away_score, m.away_is_winner, finished, m.tbd)}
    </div>`;
}
function bkCol(matches, side) {
  if (matches.length === 1) {
    return `<div class="bk-col bk-${side}"><div class="bk-slot">${koMatch(matches[0])}</div></div>`;
  }
  let html = `<div class="bk-col bk-${side}">`;
  for (let i = 0; i < matches.length; i += 2) {
    html += `<div class="bk-pair"><div class="bk-slot">${koMatch(matches[i])}</div><div class="bk-slot">${koMatch(matches[i + 1])}</div></div>`;
  }
  return html + `</div>`;
}
// Mobile bracket row: two feed matches on the left → one advance match on the right
function mbRow(feed1, feed2, advance) {
  return `
  <div class="mb-section">
    <div class="mb-pair">
      <div class="mb-slot">${koMatch(feed1)}</div>
      <div class="mb-slot">${koMatch(feed2)}</div>
    </div>
    <div class="mb-advance">${koMatch(advance)}</div>
  </div>`;
}

export function renderBracket(b) {
  const [r32, r16, qf, sf, fin] = b.rounds.map(r => r.matches);
  const half = a => [a.slice(0, a.length / 2), a.slice(a.length / 2)];
  const [r32L, r32R] = half(r32);
  const [r16L, r16R] = half(r16);
  const [qfL,  qfR]  = half(qf);
  const [sfL,  sfR]  = half(sf);

  // R32 panel: 8 bracket rows [r32[i], r32[i+1]] → r16[i/2]
  let r32html = '';
  for (let i = 0; i < r32.length; i += 2) r32html += mbRow(r32[i], r32[i + 1], r16[i / 2]);

  // R16 panel: 4 bracket rows [r16[i], r16[i+1]] → qf[i/2]
  let r16html = '';
  for (let i = 0; i < r16.length; i += 2) r16html += mbRow(r16[i], r16[i + 1], qf[i / 2]);

  // QF–Final panel: QF pairs → SF, then SF pair → Final
  const kohtml = `
    <p class="bm-stage-lbl">Quarter-Finals → Semi-Finals <span class="round-pts">3 pts</span></p>
    ${mbRow(qf[0], qf[1], sf[0])}
    ${mbRow(qf[2], qf[3], sf[1])}
    <p class="bm-stage-lbl">Semi-Finals → Final <span class="round-pts">4 pts</span></p>
    ${mbRow(sf[0], sf[1], fin[0])}
    ${b.thirdPlace ? `<p class="bm-stage-lbl">3rd Place <span class="round-pts">–</span></p><div class="mb-solo">${koMatch(b.thirdPlace)}</div>` : ''}`;

  return `
  <div class="bracket-hdr">
    <h1>Bracket</h1>
    ${b.hasAny
      ? `<p class="hint">Advancing team highlighted. Points: R32=1, R16=2, QF=3, SF=4, Final=5.</p>`
      : `<p class="hint">Bracket fills in after the group stage.</p>`}
  </div>
  <div class="bkt-page">
    <div class="bkt-header">
      <div class="bkt-hcol">R32</div>
      <div class="bkt-hcol">R16</div>
      <div class="bkt-hcol">QF</div>
      <div class="bkt-hcol">SF</div>
      <div class="bkt-hcol bkt-hcol-center">FINAL</div>
      <div class="bkt-hcol">SF</div>
      <div class="bkt-hcol">QF</div>
      <div class="bkt-hcol">R16</div>
      <div class="bkt-hcol">R32</div>
    </div>
    <div class="bkt-body">
      ${bkCol(r32L, 'left')}
      ${bkCol(r16L, 'left')}
      ${bkCol(qfL,  'left')}
      ${bkCol(sfL,  'left')}
      <div class="bk-center">
        <img class="bk-logo" src="assets/img/favicon.svg" alt="LBH">
        <div class="bk-final-slot">${koMatch(fin[0])}</div>
        ${b.thirdPlace ? `<div class="bk-third"><p class="bk-third-lbl">3rd Place</p>${koMatch(b.thirdPlace)}</div>` : ''}
      </div>
      ${bkCol(sfR,  'right')}
      ${bkCol(qfR,  'right')}
      ${bkCol(r16R, 'right')}
      ${bkCol(r32R, 'right')}
    </div>
  </div>
  <div class="bkt-mobile">
    <input type="radio" name="bm" id="bm-r32" class="bm-input" checked>
    <input type="radio" name="bm" id="bm-r16" class="bm-input">
    <input type="radio" name="bm" id="bm-ko"  class="bm-input">
    <div class="bm-tabs">
      <label for="bm-r32" class="bm-label">R32</label>
      <label for="bm-r16" class="bm-label">R16</label>
      <label for="bm-ko"  class="bm-label">QF–Final</label>
    </div>
    <div class="bm-panel" id="bmp-r32">${r32html}</div>
    <div class="bm-panel" id="bmp-r16">${r16html}</div>
    <div class="bm-panel" id="bmp-ko">${kohtml}</div>
  </div>`;
}

// ----------------------------------------------------------------- Draft
export function renderDraft(s, isAdmin, myId) {
  const head = `
    <div class="draft-head">
      <h1>Draft Room</h1>
      ${isAdmin && s.settings.draft_status !== 'not_started'
        ? `<form data-action="draft-reset"><button class="danger">Reset draft</button></form>` : ''}
    </div>`;

  if (s.settings.draft_status === 'not_started') {
    return head + `
      <div class="card">
        <p>The draft hasn't started yet. The pick order will be <strong>randomised</strong>, then run as a snake
          (1-2-3-4-5, then 5-4-3-2-1, and so on) for <strong>${s.teamsPerPlayer} rounds</strong> — that's
          ${s.teamsPerPlayer} teams each, with 3 nations left undrafted.</p>
        <ul class="players-list">${s.players.map((p) => `<li>${esc(p.name)}</li>`).join('')}</ul>
        ${isAdmin
          ? `<form data-action="draft-start"><button class="primary">🎲 Start draft (randomise order)</button></form>`
          : `<p class="hint">An admin needs to log in and start the draft.</p>`}
      </div>`;
  }

  const onclock = s.settings.draft_status === 'in_progress' && s.current ? `
    <div class="onclock card">
      <div class="onclock-main">
        <span class="label">On the clock</span>
        <span class="who">${esc(s.current.playerName)}</span>
        <span class="meta">Pick #${s.current.pickNumber} · Round ${s.current.round}</span>
      </div>
      ${s.upcoming.length ? `<div class="upnext">Next: ${s.upcoming.map((u) => esc(u.playerName)).join(' → ')}</div>` : ''}
    </div>`
    : (s.settings.draft_status === 'complete' ? `<div class="card done">✅ Draft complete — teams are locked in.</div>` : '');

  const rosters = `
    <section class="rosters">
      <h2>Rosters</h2>
      ${s.players.map((p) => `
        <div class="roster ${s.current && s.current.playerId === p.id ? 'active' : ''}">
          <h3><span class="slot">${p.draft_slot ?? '–'}</span> ${esc(p.name)}
            <span class="count">${p.roster.length}/${s.teamsPerPlayer}</span></h3>
          <ul>
            ${p.roster.map((pick) => `<li><span class="rank">#${pick.team_ranking}</span> ${esc(pick.team_name)}</li>`).join('')}
            ${!p.roster.length ? `<li class="empty">—</li>` : ''}
          </ul>
        </div>`).join('')}
    </section>`;

  const me = s.players.find((p) => p.id === myId) || null;
  const myTurn = s.settings.draft_status === 'in_progress' && s.current && s.current.playerId === myId;

  // "Who are you?" — each device claims a player so only the on-clock person can pick.
  const identity = s.settings.draft_status === 'in_progress' ? `
    <div class="whoami card">
      ${me
        ? `<span class="who-label">You are</span> <span class="me">${esc(me.name)}</span> <button class="link" data-action="clear-me">change</button>`
        : `<span class="who-label">Who are you?</span> <span class="who-btns">${s.players.map((p) => `<button data-action="set-me" data-player-id="${p.id}">${esc(p.name)}</button>`).join('')}</span>`}
    </div>` : '';

  const teamButtons = `
    <div class="team-buttons">
      ${s.available.map((t) => `
        <button class="teambtn" data-action="draft-pick" data-team-id="${t.id}">
          <span class="rank">#${t.ranking}</span>
          <span class="tname">${esc(t.name)}</span>
          <span class="grp">${esc(t.grp)}</span>
        </button>`).join('')}
    </div>`;

  let pickpane = '';
  if (s.settings.draft_status === 'in_progress' && s.current) {
    if (myTurn) {
      pickpane = `<section class="pickpane">
        <h2>Your pick <span class="hl">— ${esc(me.name)}</span></h2>
        <p class="hint">Best available first — by FIFA ranking</p>${teamButtons}</section>`;
    } else if (isAdmin) {
      pickpane = `<section class="pickpane">
        <h2>Admin — pick for <span class="hl">${esc(s.current.playerName)}</span></h2>
        <p class="hint">It's ${esc(s.current.playerName)}'s turn. You can pick on their behalf if needed.</p>${teamButtons}</section>`;
    } else if (!me) {
      pickpane = `<section class="pickpane"><p class="hint">Choose your name above to take part in the draft.</p></section>`;
    } else {
      pickpane = `<section class="pickpane"><p class="waiting">Waiting for <strong>${esc(s.current.playerName)}</strong> to pick…</p></section>`;
    }
  }

  const progress = `
    <div class="progress">
      <div class="bar"><span style="width: ${s.totalPicks ? (s.picksMade / s.totalPicks * 100) : 0}%"></span></div>
      <span class="progress-label">${s.picksMade} / ${s.totalPicks} picks</span>
    </div>`;

  return head + identity + progress + onclock + `<div class="draft-grid">${rosters}${pickpane}</div>`;
}

// ----------------------------------------------------------------- Teams

function fxPill(f) {
  const sn = (n) => n ? (n.length > 5 ? n.slice(0, 4) + '..' : n) : '—';
  const when = [f.short_date_label, f.time_label].filter(Boolean).join(' ');
  const owners = (f.home_owner || f.away_owner) ? `${sn(f.home_owner)} v ${sn(f.away_owner)}` : '';
  return `
  <li class="fixture ${f.status === 'finished' ? 'played' : ''}">
    <span class="fx-when">${esc(when || 'TBC')}</span>
    <div class="fx-teams">
      <span class="fx-home">${esc(f.home_name || 'TBD')}</span>
      <span class="fx-sep">${f.status === 'finished' ? `${f.home_score}&ndash;${f.away_score}` : 'v'}</span>
      <span class="fx-away">${esc(f.away_name || 'TBD')}</span>
    </div>
    <span class="fx-owners">${esc(owners)}</span>
  </li>`;
}

export function renderTeamsOverview(players) {
  const hasPicks = players.some((p) => p.teams.length);
  if (!hasPicks) return `<h1>Teams</h1><p class="hint">No teams drafted yet — come back once the draft starts.</p>`;
  return `
  <h1>Teams</h1>
  <div class="teams-grid">
    ${players.filter((p) => p.teams.length).map((p) => `
      <a class="team-card" href="#/draft/player/${p.id}">
        <span class="team-card-name">${esc(p.name)}</span>
        <ul class="team-card-list">
          ${p.teams.map((t) => `<li>${esc(t.name)}</li>`).join('')}
        </ul>
        <span class="team-card-chevron">›</span>
      </a>`).join('')}
  </div>`;
}

export function renderPlayerView(pv) {
  if (!pv) return `<p class="hint">Player not found.</p>`;
  const { player, teams, fixtures } = pv;
  const upcoming = fixtures.filter((f) => f.status !== 'finished');
  const played = [...fixtures.filter((f) => f.status === 'finished')].reverse();
  return `
  <a class="back-link" href="#/draft">‹ All Teams</a>
  <h1>${esc(player.name)}</h1>
  <div class="player-teams-row">
    ${teams.map((t) => `<a class="player-team-badge" href="#/draft/team/${t.id}">${esc(t.name)}</a>`).join('')}
  </div>
  ${upcoming.length ? `
  <section class="fxgroup">
    <h3 class="section-label">Upcoming</h3>
    <ul class="fixtures">${upcoming.map(fxPill).join('')}</ul>
  </section>` : `<p class="hint" style="margin-top:1rem">No upcoming fixtures.</p>`}
  ${played.length ? `
  <section class="fxgroup">
    <h3 class="section-label">Results</h3>
    <ul class="fixtures">${played.map(fxPill).join('')}</ul>
  </section>` : ''}
  <div class="view-btn-wrap"><a class="view-btn" href="#/draft">‹ All Teams</a></div>`;
}

export function renderTeamView(tv, fromPlayerRoute) {
  if (!tv) return `<p class="hint">Team not found.</p>`;
  const { team, fixtures } = tv;
  const upcoming = fixtures.filter((f) => f.status !== 'finished');
  const played = [...fixtures.filter((f) => f.status === 'finished')].reverse();
  const backHref = fromPlayerRoute ? `#${fromPlayerRoute}` : '#/draft';
  const backLabel = fromPlayerRoute ? '‹ My Teams' : '‹ All Teams';
  return `
  <a class="back-link" href="${backHref}">${backLabel}</a>
  <h1>${esc(team.name)}</h1>
  ${upcoming.length ? `
  <section class="fxgroup">
    <h3 class="section-label">Upcoming</h3>
    <ul class="fixtures">${upcoming.map(fxPill).join('')}</ul>
  </section>` : `<p class="hint" style="margin-top:1rem">No upcoming fixtures for this team.</p>`}
  ${played.length ? `
  <section class="fxgroup">
    <h3 class="section-label">Results</h3>
    <ul class="fixtures">${played.map(fxPill).join('')}</ul>
  </section>` : ''}
  <div class="view-btn-wrap"><a class="view-btn" href="${backHref}">${backLabel}</a></div>`;
}

// ----------------------------------------------------------------- Admin
export function renderAdmin({ groups, players, teams, settings, mode, notice, problem }) {
  const teamOptions = (sel) => teams.map((t) => `<option value="${t.id}" ${sel === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');

  const scoreRows = groups.map((g) => `
    <h3>${esc(g.title)}</h3>
    ${g.fixtures.map((f) => `
      <form data-action="score" id="fx-${f.id}" class="score-row">
        <input type="hidden" name="fixtureId" value="${f.id}" />
        <span class="t home">${esc(f.home_name || 'TBD')}</span>
        <input class="sc" type="number" min="0" name="homeScore" value="${f.home_score ?? ''}" />
        <input class="sc" type="number" min="0" name="awayScore" value="${f.away_score ?? ''}" />
        <span class="t away">${esc(f.away_name || 'TBD')}</span>
        ${f.stage !== 'group' ? `
          <select name="winnerTeamId">
            <option value="">advances…</option>
            <option value="${f.home_team_id}" ${f.winner_team_id === f.home_team_id ? 'selected' : ''}>${esc(f.home_name || 'Home')}</option>
            <option value="${f.away_team_id}" ${f.winner_team_id === f.away_team_id ? 'selected' : ''}>${esc(f.away_name || 'Away')}</option>
          </select>` : ''}
        <button type="submit">${f.status === 'finished' ? 'Update' : 'Save'}</button>
        ${f.stage !== 'group' ? `<button type="button" class="danger" data-action="del-fixture" data-id="${f.id}">✕</button>` : ''}
      </form>`).join('')}`).join('');

  return `
  <h1>Admin</h1>
  ${notice ? `<div class="banner ok">${esc(notice)}</div>` : ''}
  ${problem ? `<div class="banner err">${esc(problem)}</div>` : ''}

  <section class="card">
    <h2>Data <span class="provider-tag">${mode === 'supabase' ? 'supabase · shared' : 'local · this device only'}</span></h2>
    ${mode === 'supabase'
      ? `<p class="hint">Connected to Supabase — the draft, scores and ladder are shared live with everyone.</p>`
      : `<p class="hint">No Supabase keys in <code>config.js</code> yet, so data lives only in <strong>this</strong> browser. Great for a solo test run; fill in <code>config.js</code> to share with the group.</p>`}
  </section>

  <section class="card">
    <h2>Players</h2>
    <form data-action="players" class="form grid-players">
      ${players.map((p) => `<label>Slot ${p.draft_slot || '–'}<input name="player_${p.id}" value="${esc(p.name)}" /></label>`).join('')}
      <button type="submit">Save names</button>
    </form>
  </section>

  <section class="card">
    <h2>Settings</h2>
    <form data-action="settings" class="form">
      <label class="checkbox">
        <input type="checkbox" name="scoreThirdPlace" ${settings.score_third_place ? 'checked' : ''} />
        Score the third-place playoff (1 point)
      </label>
      <button type="submit">Save settings</button>
    </form>
    <hr />
    <form data-action="draft-reset"><button class="danger">Reset draft (clears all picks)</button></form>
  </section>

  <section class="card">
    <h2>Add a knockout match</h2>
    <p class="hint">Once the bracket is drawn, add each knockout tie here so it shows on the Bracket page and can be scored.</p>
    <form data-action="add-fixture" class="form">
      <label>Round
        <select name="stage">
          <option value="R32">Round of 32</option>
          <option value="R16">Round of 16</option>
          <option value="QF">Quarter-final</option>
          <option value="SF">Semi-final</option>
          <option value="third">Third-place playoff</option>
          <option value="final">Final</option>
        </select>
      </label>
      <label>Home team<select name="homeTeamId">${teamOptions()}</select></label>
      <label>Away team<select name="awayTeamId">${teamOptions()}</select></label>
      <label>Kickoff (optional)<input type="datetime-local" name="kickoff" /></label>
      <button type="submit">Add match</button>
    </form>
  </section>

  <section class="card">
    <h2>Enter scores</h2>
    <p class="hint">For knockout matches, also pick the team that advances (this is who gets the points, including penalty wins).</p>
    ${scoreRows}
  </section>`;
}

// ----------------------------------------------------------------- Login
export function renderLogin(error) {
  return `
  <h1>Admin login</h1>
  ${error ? `<p class="error">${esc(error)}</p>` : ''}
  <form data-action="login" class="card form narrow">
    <label>Password<input type="password" name="password" autofocus autocomplete="current-password" /></label>
    <button type="submit" class="primary">Log in</button>
  </form>`;
}
