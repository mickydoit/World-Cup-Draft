// SPA router + event wiring. Hash-based routing so it works under any GitHub
// Pages base path with no server rewrites.

import { store } from './store.js?v=5';
import { getLadder, getFixturesView, getBracket, getDraftState, getTeamsView, getPlayerView, getTeamView } from './compute.js?v=38';
import { renderLadder, renderFixtures, renderBracket, renderDraft, renderAdmin, renderLogin, renderTeamsOverview, renderPlayerView, renderTeamView } from './views.js?v=39';

const root = document.getElementById('root');
const PASSWORD = (window.LBH_CONFIG || {}).ADMIN_PASSWORD || 'admin';
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let isAdmin = localStorage.getItem('lbh_admin') === '1';
let myId = Number(localStorage.getItem('lbh_me')) || null; // which player THIS device is

function applyTheme(dark) {
  document.body.dataset.theme = dark ? 'dark' : 'light';
  localStorage.setItem('lbh_theme', dark ? 'dark' : 'light');
}
applyTheme(localStorage.getItem('lbh_theme') !== 'light');
let draftMyTurn = false;   // set each draft render; pauses auto-refresh while you're picking
let flash = null;          // {notice} | {problem} consumed by the next admin render
let loginError = null;
let refreshTimer = null;
let lastPaintedRoute = null;
let lastRenderedBody = null;
let lastRenderedRoute = null;
let prevRoute = null;
let cachedData = null;

const NAV = [
  { route: '/', label: 'Ladder', key: 'ladder' },
  { route: '/fixtures', label: 'Fixtures', key: 'fixtures' },
  { route: '/bracket', label: 'Bracket', key: 'bracket' },
  { route: '/draft', label: 'Teams', key: 'draft' },
];

function currentRoute() {
  return location.hash.replace(/^#/, '') || '/';
}
function activeKey(route) {
  if (route === '/') return 'ladder';
  if (route.startsWith('/fixtures')) return 'fixtures';
  if (route.startsWith('/bracket')) return 'bracket';
  if (route.startsWith('/draft')) return 'draft';
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
  return `
  <header class="topbar">
    <a class="brand" href="#/">
      <img class="brand-logo-img" src="assets/img/logo-black.svg" alt="LBH Club World Cup Draft" width="80" height="36" />
    </a>
    <nav class="topbar-nav">${links}${adminArea}</nav>
    <div class="topbar-end">
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
    window.scrollTo(0, 0);
  }
  // Restore open state on auto-refresh (skip on first load — let the smart default apply)
  if (hadAccordions && openGroups.size > 0) {
    document.querySelectorAll('.fxday').forEach(el => {
      if (el.dataset.group) el.open = openGroups.has(el.dataset.group);
    });
  }
}

function bodyFromData(route, data) {
  if (route.startsWith('/draft/player/')) {
    return renderPlayerView(getPlayerView(data, Number(route.split('/')[3])));
  }
  if (route.startsWith('/draft/team/')) {
    const fromPlayer = prevRoute && prevRoute.startsWith('/draft/player/') ? prevRoute : null;
    return renderTeamView(getTeamView(data, Number(route.split('/')[3])), fromPlayer);
  }
  switch (route) {
    case '/fixtures': return renderFixtures(getFixturesView(data));
    case '/bracket':  return renderBracket(getBracket(data));
    case '/draft': {
      const ds = getDraftState(data);
      if (ds.settings.draft_status === 'complete') return renderTeamsOverview(getTeamsView(data));
      draftMyTurn = ds.settings.draft_status === 'in_progress' && !!ds.current && ds.current.playerId === myId;
      return renderDraft(ds, isAdmin, myId);
    }
    case '/admin':
      if (!isAdmin) { const b = renderLogin(loginError); loginError = null; return b; }
      else {
        const b = renderAdmin({
          groups: getFixturesView(data),
          players: [...data.players].sort((a, b) => a.id - b.id),
          teams: [...data.teams].sort((a, b) => (a.ranking ?? 1e9) - (b.ranking ?? 1e9)),
          settings: data.settings,
          mode: store.mode,
          notice: flash && flash.notice,
          problem: flash && flash.problem,
        });
        flash = null;
        return b;
      }
    default: return renderLadder(getLadder(data));
  }
}

async function render(opts = {}) {
  const route = currentRoute();
  if (lastRenderedRoute !== route) prevRoute = lastRenderedRoute;
  lastRenderedRoute = route;

  if (route === '/login') {
    paint(route, renderLogin(loginError));
    loginError = null;
    setAutoRefresh(route);
    return;
  }

  // Paint immediately with cached data so navigation feels instant
  if (lastPaintedRoute !== route && cachedData) {
    paint(route, bodyFromData(route, cachedData));
  } else if (!root.querySelector('.topbar')) {
    paint(route, `<p class="hint">Loading…</p>`);
  }

  let data;
  try {
    data = await store.loadAll();
    cachedData = data;
  } catch (err) {
    paint(route, `
      <h1>Couldn't load data</h1>
      <div class="banner err">${esc(err.message)}</div>
      <p class="hint">If you've just set up Supabase, check the <code>SUPABASE_URL</code> + <code>SUPABASE_ANON_KEY</code> in
      <code>config.js</code> and that you ran <code>supabase-schema.sql</code> in the SQL editor.</p>`);
    return;
  }

  paint(route, bodyFromData(route, data));
  setAutoRefresh(route);
  // On navigation (not the silent auto-refresh), jump to where the tournament
  // is up to so you don't have to scroll past weeks of finished games.
  if (opts.scrollToCurrent && route === '/bracket') {
    scrollToCurrentMatch(route);
  }
}

// Land on the most recent finished match — recent results sit at the top with
// the next match just below. Until something's been played there's nothing to
// scroll past, so leave the page at the top.
function scrollToCurrentMatch(route) {
  const app = document.getElementById('app');
  if (!app) return;
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
  if (route === '/' || route === '/fixtures') {
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
    localStorage.setItem('lbh_me', String(myId));
    render();
  } else if (action === 'clear-me') {
    myId = null;
    localStorage.removeItem('lbh_me');
    render();
  } else if (action === 'draft-pick') {
    run(() => store.makePick(Number(el.dataset.teamId)));
  } else if (action === 'del-fixture') {
    if (!window.confirm('Delete this knockout match?')) return;
    run(() => store.deleteFixture(Number(el.dataset.id)));
  } else if (action === 'scroll-to') {
    const target = document.getElementById(el.dataset.target);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  setTimeout(() => splashEl.remove(), 520);
};
const splashGuard = setTimeout(hideSplash, 6000); // failsafe
render({ scrollToCurrent: true }).finally(() => {
  clearTimeout(splashGuard);
  setTimeout(hideSplash, Math.max(0, MIN_SPLASH - (Date.now() - splashT0)));
});
