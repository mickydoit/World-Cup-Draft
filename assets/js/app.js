// SPA router + event wiring. Hash-based routing so it works under any GitHub
// Pages base path with no server rewrites.

import { store } from './store.js?v=17';
import { getLadder, getFixturesView, getBracket, getDraftState, getTeamsView, getPlayerView, getTeamView, getTipLadder, getTipsView, getGroupStandings, getGroupPositions, resolveEspnSlot } from './compute.js?v=25';
import { renderLadder, renderFixtures, renderBracket, renderDraft, renderAdmin, renderLogin, renderTeamsOverview, renderPlayerView, renderTeamView, renderTips, renderIdentityGate } from './views.js?v=51';

const root = document.getElementById('root');
const PASSWORD = (window.LBH_CONFIG || {}).ADMIN_PASSWORD || 'admin';
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let isAdmin = localStorage.getItem('lbh_admin') === '1';
let myId = Number(localStorage.getItem('lbh_me')) || null; // which player THIS device is
let myName = localStorage.getItem('lbh_me_name') || null;  // cached for the header chip
let skipId = sessionStorage.getItem('lbh_skip_id') === '1'; // "I'll pick later" — this visit only

// Two-letter badge for the identity chip ("Papacostas" -> "PA").
const initials = (n) => !n ? '?' : (n.includes(' ') ? n.split(' ').map((w) => w[0]).join('').slice(0, 2) : n.slice(0, 2)).toUpperCase();

function applyTheme(dark) {
  document.body.dataset.theme = dark ? 'dark' : 'light';
  localStorage.setItem('lbh_theme', dark ? 'dark' : 'light');
}
applyTheme(localStorage.getItem('lbh_theme') !== 'light');
let draftMyTurn = false;   // set each draft render; pauses auto-refresh while you're picking
let flash = null;          // {notice} | {problem} consumed by the next admin render
let loginError = null;
let refreshTimer = null;
let prevRoute = null;
let espnStandings = null;      // ESPN group standings (for qualifier resolution)
let r32Overlay = null;         // resolved R32 matchups: [{home, away, homeConfirmed, awayConfirmed}×16]

const ESPN_R32_DATES = ['20260628','20260629','20260630','20260701','20260702','20260703','20260704'];
const ESPN_SB = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=';
const ESPN_STANDINGS_URL = 'https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings?season=2026';

async function loadBracketOverlay() {
  if (r32Overlay) return;
  try {
    const [standingsResp, ...sbResps] = await Promise.all([
      fetch(ESPN_STANDINGS_URL).then((r) => r.ok ? r.json() : null).catch(() => null),
      ...ESPN_R32_DATES.map((d) => fetch(ESPN_SB + d).then((r) => r.ok ? r.json() : null).catch(() => null)),
    ]);
    espnStandings = standingsResp;
    const groupPos = getGroupPositions(espnStandings);

    const seen = new Set();
    const matches = [];
    for (const sb of sbResps) {
      for (const e of sb?.events || []) {
        if (e.season?.slug !== 'round-of-32' || seen.has(e.id)) continue;
        seen.add(e.id);
        const comp = e.competitions[0];
        const home = comp.competitors.find((c) => c.homeAway === 'home');
        const away = comp.competitors.find((c) => c.homeAway === 'away');
        const homeName = resolveEspnSlot(home?.team?.displayName, groupPos);
        const awayName = resolveEspnSlot(away?.team?.displayName, groupPos);
        matches.push({ home: homeName, away: awayName });
      }
    }
    r32Overlay = matches;
  } catch { r32Overlay = []; }
}
let lastRenderedRoute = null;
let lastPaintedRoute = null;
let lastRenderedBody = null;

const NAV = [
  { route: '/', label: 'Ladder', key: 'ladder' },
  { route: '/fixtures', label: 'Fixtures', key: 'fixtures' },
  { route: '/bracket', label: 'Bracket', key: 'bracket' },
  { route: '/draft', label: 'Teams', key: 'draft' },
  { route: '/tips', label: 'Tipping', key: 'tips' },
];

function currentRoute() {
  return location.hash.replace(/^#/, '') || '/';
}
function activeKey(route) {
  if (route === '/') return 'ladder';
  if (route.startsWith('/fixtures')) return 'fixtures';
  if (route.startsWith('/bracket')) return 'bracket';
  if (route.startsWith('/draft')) return 'draft';
  if (route.startsWith('/tips')) return 'tips';
  if (route.startsWith('/admin') || route.startsWith('/login')) return 'admin';
  return '';
}

function headerHtml(route) {
  const ak = activeKey(route);
  const links = NAV.map((n) => `<a href="#${n.route}" class="${ak === n.key ? 'active' : ''}">${n.label}</a>`).join('');
  const adminArea = isAdmin
    ? `<a href="#/admin" class="${ak === 'admin' ? 'active' : ''}">Admin</a><button class="link" data-action="logout">Logout</button>`
    : `<a href="#/login" class="${ak === 'admin' ? 'active' : ''}">Admin</a>`;
  const isDark = document.body.dataset.theme !== 'light';
  const idChip = myId
    ? `<button class="id-chip" data-action="clear-me" title="You are ${esc(myName || '')} — tap to switch player">${initials(myName)}</button>`
    : `<button class="id-chip ghost" data-action="signin" title="Pick your name">Sign in</button>`;
  return `
  <header class="topbar">
    <a class="brand" href="#/">
      <img class="brand-logo-img" src="assets/img/logo-black.svg" alt="LBH Club World Cup Draft" width="80" height="36" />
    </a>
    <nav class="topbar-nav">${links}${adminArea}</nav>
    <div class="topbar-end">
      ${idChip}
      <button class="theme-toggle" data-action="toggle-theme">${isDark ? '☀ Light' : '☾ Dark'}</button>
      <button class="nav-burger" data-action="toggle-nav" aria-label="Menu">
        <span></span><span></span><span></span>
      </button>
    </div>
    <div class="nav-drawer">${links}${adminArea}</div>
  </header>
  <nav class="bottom-nav" aria-label="Navigation">
    <a href="#/" class="bnav-item ${ak === 'ladder' ? 'active' : ''}" aria-label="Ladder">
      <span class="bnav-icon bnav-ladder"></span>
    </a>
    <a href="#/fixtures" class="bnav-item ${ak === 'fixtures' ? 'active' : ''}" aria-label="Fixtures">
      <span class="bnav-icon bnav-fixtures"></span>
    </a>
    <a href="#/draft" class="bnav-item ${ak === 'draft' ? 'active' : ''}" aria-label="Teams">
      <span class="bnav-icon bnav-teams"></span>
    </a>
    <a href="#/bracket" class="bnav-item ${ak === 'bracket' ? 'active' : ''}" aria-label="Bracket">
      <span class="bnav-icon bnav-bracket"></span>
    </a>
    <a href="#/tips" class="bnav-item ${ak === 'tips' ? 'active' : ''}" aria-label="Tipping">
      <span class="bnav-icon bnav-tips"></span>
    </a>
    <a href="${isAdmin ? '#/admin' : '#/login'}" class="bnav-item ${ak === 'admin' ? 'active' : ''}" aria-label="Admin">
      <span class="bnav-icon bnav-admin"></span>
    </a>
  </nav>`;
}

function paint(route, body) {
  const routeKey = activeKey(route);
  // Snapshot fixture accordion open state so auto-refresh doesn't reset manual toggles
  const openGroups = new Set();
  const hadAccordions = !!document.querySelector('.fxday');
  document.querySelectorAll('.fxday[open]').forEach(el => {
    if (el.dataset.group) openGroups.add(el.dataset.group);
  });
  document.body.dataset.route = routeKey || 'ladder';
  const appEl = document.getElementById('app');
  if (appEl && lastPaintedRoute === route) {
    if (body !== lastRenderedBody) {
      appEl.innerHTML = body;
      lastRenderedBody = body;
    }
  } else {
    root.innerHTML = headerHtml(route) + `<main class="container" id="app">${body}</main>`;
    lastPaintedRoute = route;
    lastRenderedBody = body;
  }
  // Restore open state on auto-refresh (skip on first load — let the smart default apply)
  if (hadAccordions && openGroups.size > 0) {
    document.querySelectorAll('.fxday').forEach(el => {
      if (el.dataset.group) el.open = openGroups.has(el.dataset.group);
    });
  }
}

async function render(opts = {}) {
  const route = currentRoute();
  if (lastRenderedRoute !== route) {
    prevRoute = lastRenderedRoute;
    window.scrollTo(0, 0);
  }
  lastRenderedRoute = route;
  if (!root.querySelector('.topbar')) paint(route, `<p class="hint">Loading…</p>`);

  if (route === '/login') {
    paint(route, renderLogin(loginError));
    loginError = null;
    setAutoRefresh(route);
    return;
  }

  let data;
  try {
    data = await store.loadAll();
  } catch (err) {
    paint(route, `
      <h1>Couldn't load data</h1>
      <div class="banner err">${esc(err.message)}</div>
      <p class="hint">If you've just set up Supabase, check the <code>SUPABASE_URL</code> + <code>SUPABASE_ANON_KEY</code> in
      <code>config.js</code> and that you ran <code>supabase-schema.sql</code> in the SQL editor.</p>`);
    return;
  }

  // Backfill the cached name for devices that picked a player before names were stored.
  if (myId && !myName) {
    const p = data.players.find((x) => x.id === myId);
    if (p) { myName = p.name; localStorage.setItem('lbh_me_name', myName); }
  }

  // First-open login: greet with "Who are you?" until you pick a name (remembered
  // on this device) or choose to look around first.
  if (!myId && !skipId) {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    root.innerHTML = `<main class="container idgate-wrap">${renderIdentityGate([...data.players].sort((a, b) => a.id - b.id))}</main>`;
    return;
  }

  let body;
  if (route.startsWith('/draft/player/')) {
    const playerId = Number(route.split('/')[3]);
    body = renderPlayerView(getPlayerView(data, playerId));
  } else if (route.startsWith('/draft/team/')) {
    const teamId = Number(route.split('/')[3]);
    const fromPlayer = prevRoute && prevRoute.startsWith('/draft/player/') ? prevRoute : null;
    body = renderTeamView(getTeamView(data, teamId), fromPlayer);
  } else {
    switch (route) {
      case '/fixtures':
        body = renderFixtures(getFixturesView(data));
        break;
      case '/bracket':
        body = renderBracket(getBracket(data, r32Overlay || []));
        if (!r32Overlay) {
          loadBracketOverlay().then(() => { if (currentRoute() === '/bracket') render('/bracket'); });
        }
        break;
      case '/tips':
        body = renderTips(getTipLadder(data), getTipsView(data, myId), myId);
        break;
      case '/draft': {
        const ds = getDraftState(data);
        if (ds.settings.draft_status === 'complete') {
          body = renderTeamsOverview(getTeamsView(data));
        } else {
          draftMyTurn = ds.settings.draft_status === 'in_progress' && !!ds.current && ds.current.playerId === myId;
          body = renderDraft(ds, isAdmin, myId);
        }
        break;
      }
      case '/admin':
        if (!isAdmin) { body = renderLogin(loginError); loginError = null; }
        else {
          body = renderAdmin({
            groups: getFixturesView(data),
            players: [...data.players].sort((a, b) => a.id - b.id),
            teams: [...data.teams].sort((a, b) => (a.ranking ?? 1e9) - (b.ranking ?? 1e9)),
            settings: data.settings,
            mode: store.mode,
            notice: flash && flash.notice,
            problem: flash && flash.problem,
          });
          flash = null;
        }
        break;
      case '/':
      default:
        body = renderLadder(getLadder(data), getGroupStandings(data));
    }
  }
  paint(route, body);
  setAutoRefresh(route);
  // On navigation (not the silent auto-refresh), jump to where the tournament
  // is up to so you don't have to scroll past weeks of finished games.
  if (opts.scrollToCurrent && (route === '/bracket' || route === '/fixtures')) {
    scrollToCurrentMatch(route);
  }
}

// Land on the most recent finished match — recent results sit at the top with
// the next match just below. Until something's been played there's nothing to
// scroll past, so leave the page at the top.
function scrollToCurrentMatch(route) {
  const app = document.getElementById('app');
  if (!app) return;

  if (route === '/fixtures') {
    // Scroll to the open accordion section (the active date).
    // Uses requestAnimationFrame so getBoundingClientRect() sees the fully-laid-out DOM.
    // Called only on navigation (opts.scrollToCurrent), not on the 30s auto-refresh.
    requestAnimationFrame(() => {
      const openDay = app.querySelector('.fxday[open]');
      if (!openDay) return;
      const headerH = document.querySelector('.topbar')?.offsetHeight || 0;
      const top = window.scrollY + openDay.getBoundingClientRect().top - headerH - 12;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    });
    return;
  }

  const sel = route === '/bracket' ? '.ko-match' : '.fixture-card';
  const played = app.querySelectorAll(`${sel}.played`);
  const target = played[played.length - 1];
  if (!target) {
    // Nothing finished yet — show the page from the top.
    window.scrollTo(0, 0);
    return;
  }
  const headerH = document.querySelector('.topbar')?.offsetHeight || 0;
  const top = window.scrollY + target.getBoundingClientRect().top - headerH - 10;
  window.scrollTo(0, Math.max(0, top));
}

// Ladder + fixtures refresh themselves so entered scores appear without a reload.
function setAutoRefresh(route) {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  if (route === '/' || route === '/fixtures' || route === '/tips') {
    refreshTimer = setInterval(() => { if (currentRoute() === route) render(); }, route === '/fixtures' ? 30000 : 60000);
  } else if (route === '/draft') {
    // Waiting players poll so picks appear live; the person mid-pick isn't yanked.
    refreshTimer = setInterval(() => { if (currentRoute() === '/draft' && !draftMyTurn) render(); }, 3500);
  }
}

async function run(fn) {
  try {
    await fn();
    await render();
  } catch (err) {
    flash = { problem: err.message };
    if (currentRoute() === '/admin') await render();
    else { window.alert(err.message); await render(); }
  }
}

// ---- event delegation (listeners live on the persistent #root) ----
root.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-action]');
  if (!form) return;
  e.preventDefault();
  const action = form.dataset.action;
  const fd = new FormData(form);

  if (action === 'login') {
    if (String(fd.get('password')) === PASSWORD) {
      isAdmin = true;
      localStorage.setItem('lbh_admin', '1');
      loginError = null;
      location.hash = '#/admin';
      if (currentRoute() === '/admin') render();
    } else {
      loginError = 'Incorrect password.';
      render();
    }
    return;
  }
  if (action === 'draft-start') {
    if (!window.confirm('Start the draft and lock in a random order?')) return;
    run(() => store.startDraft());
  } else if (action === 'draft-reset') {
    if (!window.confirm('Reset the entire draft? All picks will be cleared and the order re-rolled.')) return;
    run(() => store.resetDraft());
  } else if (action === 'score') {
    const id = Number(fd.get('fixtureId'));
    const home = fd.get('homeScore') === '' ? null : Number(fd.get('homeScore'));
    const away = fd.get('awayScore') === '' ? null : Number(fd.get('awayScore'));
    const w = fd.get('winnerTeamId');
    const homeTeamId = Number(fd.get('homeTeamId'));
    const awayTeamId = Number(fd.get('awayTeamId'));
    let winnerId = w ? Number(w) : null;
    if (!winnerId && home != null && away != null) {
      if (home > away) winnerId = homeTeamId;
      else if (away > home) winnerId = awayTeamId;
    }
    run(async () => { await store.setScore(id, home, away, winnerId); flash = { notice: 'Score saved.' }; });
  } else if (action === 'players') {
    const map = {};
    for (const [k, v] of fd.entries()) if (k.startsWith('player_')) map[k.slice(7)] = v;
    run(async () => { await store.updatePlayerNames(map); flash = { notice: 'Player names saved.' }; });
  } else if (action === 'settings') {
    const on = fd.get('scoreThirdPlace') != null;
    run(async () => { await store.setThirdPlace(on); flash = { notice: 'Settings saved.' }; });
  } else if (action === 'add-fixture') {
    const stage = fd.get('stage');
    const homeTeamId = Number(fd.get('homeTeamId'));
    const awayTeamId = Number(fd.get('awayTeamId'));
    const raw = fd.get('kickoff');
    const kickoff = raw ? new Date(raw).toISOString() : null;
    if (homeTeamId === awayTeamId) { window.alert('Pick two different teams.'); return; }
    run(async () => { await store.addFixture({ stage, kickoff, homeTeamId, awayTeamId }); flash = { notice: 'Knockout match added.' }; });
  }
});

root.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'FORM') return;
  const action = el.dataset.action;
  if (action === 'toggle-nav') {
    document.body.classList.toggle('nav-open');
  } else if (action === 'toggle-theme') {
    applyTheme(document.body.dataset.theme !== 'dark');
    render();
  } else if (action === 'logout') {
    isAdmin = false;
    localStorage.removeItem('lbh_admin');
    location.hash = '#/';
    render();
  } else if (action === 'set-me') {
    myId = Number(el.dataset.playerId);
    myName = el.dataset.playerName || null;
    localStorage.setItem('lbh_me', String(myId));
    if (myName) localStorage.setItem('lbh_me_name', myName);
    skipId = false; sessionStorage.removeItem('lbh_skip_id');
    render();
  } else if (action === 'clear-me') {
    myId = null; myName = null;
    localStorage.removeItem('lbh_me');
    localStorage.removeItem('lbh_me_name');
    skipId = false; sessionStorage.removeItem('lbh_skip_id');
    render();
  } else if (action === 'skip-id') {
    skipId = true; sessionStorage.setItem('lbh_skip_id', '1');
    render();
  } else if (action === 'signin') {
    skipId = false; sessionStorage.removeItem('lbh_skip_id');
    render();
  } else if (action === 'draft-pick') {
    run(() => store.makePick(Number(el.dataset.teamId)));
  } else if (action === 'tip') {
    if (!myId) { window.alert('Pick your name first.'); return; }
    run(() => store.saveTip(myId, Number(el.dataset.fixtureId), el.dataset.pick));
  } else if (action === 'del-fixture') {
    if (!window.confirm('Delete this knockout match?')) return;
    run(() => store.deleteFixture(Number(el.dataset.id)));
  }
});

window.addEventListener('hashchange', () => {
  document.body.classList.remove('nav-open');
  render({ scrollToCurrent: true });
});

// Splash: always show for at least 4s (Australia celebration)
const splashEl = document.getElementById('splash');
const splashT0 = Date.now();
const MIN_SPLASH = 4000;
const hideSplash = () => {
  if (!splashEl || splashEl.classList.contains('splash-out')) return;
  splashEl.classList.add('splash-out');
  setTimeout(() => splashEl.remove(), 700);
};
// Hard cap fires just after the bar animation ends — no hung fetch can keep the splash up
setTimeout(hideSplash, MIN_SPLASH + 400);
render({ scrollToCurrent: true }).finally(() => {
  setTimeout(hideSplash, Math.max(0, MIN_SPLASH - (Date.now() - splashT0)));
});
