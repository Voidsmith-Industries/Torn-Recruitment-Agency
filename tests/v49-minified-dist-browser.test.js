// The shipped dist/recruitment-agency.user.js is minified. Source-level browser tests boot
// src/ directly, so this test executes the actual minified release end-to-end in headless
// Chrome on a fake Torn page: it must boot, expose its launcher, open, render Search & Results
// for both Company and Faction and raise no runtime errors.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'recruitment-agency.user.js');
const VERSION = fs.readFileSync(path.join(ROOT, 'R4G3RUNN3R-Recruitment-Agency.user.js'), 'utf8').match(/^\/\/ @version\s+(\S+)/m)[1];

function chromePath() {
  for (const cmd of ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium']) {
    try { return execFileSync('which', [cmd], { encoding: 'utf8' }).trim(); } catch {}
  }
  throw new Error('No Chrome/Chromium executable found.');
}

function hostHtml(withHeader) {
  // Without Torn header icons there is no sidebar either, so the floating fallback launcher is used.
  const header = withHeader
    ? '<div id="header-root" style="height:40px;background:#333;display:flex;align-items:center;justify-content:flex-end;padding:0 10px"><ul class="status-icons___gPkXF" style="display:flex;gap:4px;list-style:none;margin:0;padding:0"><li><a class="torn-icon" href="#">T</a></li></ul></div>'
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#202020;color:#fff;font-family:Arial">${header}
  ${withHeader ? '<div id="sidebarroot" style="width:170px;float:left"><section><h2>Information</h2><div><a href="#">Money</a></div></section></div>' : ''}
  <div class="content-wrapper" style="margin-left:180px;min-height:1200px"><h4>Torn page</h4><button id="torn-btn">Torn button</button></div>
  <script>
    window.__errs = [];
    addEventListener('error', e => __errs.push(String(e.error && e.error.stack || e.message)));
    addEventListener('unhandledrejection', e => __errs.push(String(e.reason && e.reason.stack || e.reason)));
    window.alert = () => {}; window.confirm = () => true; window.prompt = () => ''; window.open = () => null;
    window.GM_xmlhttpRequest = o => { setTimeout(() => o.onerror && o.onerror({}), 5); };
  </script>
  <script src="/dist/recruitment-agency.user.js"></script>
  </body></html>`;
}

async function withDistPage(withHeader, fn) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/dist/recruitment-agency.user.js') {
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
      res.end(fs.readFileSync(DIST));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(hostHtml(withHeader));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const consoleErrors = [];
  try {
    const page = await browser.newPage();
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(String(err && err.stack || err)));
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.php`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.RA_V45App?._test?.state?.mounted === true && !!document.querySelector('#ra-launch,#ra-status-launcher'), { timeout: 15000 });
    await fn(page);
    const errs = await page.evaluate(() => window.__errs);
    assert.deepEqual(errs, [], 'minified dist must not raise runtime errors');
    assert.deepEqual(consoleErrors, [], 'minified dist must not log console errors');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

async function physicalClick(page, selector) {
  await page.waitForSelector(selector, { visible: true, timeout: 5000 });
  const p = await page.$eval(selector, el => {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, ok: hit === el || !!(hit && el.contains(hit)) };
  });
  assert.equal(p.ok, true, `${selector} must be physically clickable`);
  await page.mouse.click(p.x, p.y);
}

const appState = page => page.evaluate(() => {
  const app = document.getElementById('ra-app');
  return {
    open: !!app && getComputedStyle(app).display !== 'none',
    title: document.getElementById('ra-page-title')?.textContent || '',
    contentLength: (document.getElementById('ra-content')?.textContent || '').trim().length,
    controls: document.querySelectorAll('#ra-content input,#ra-content select,#ra-content button').length,
    nav: [...document.querySelectorAll('#ra-nav [data-page]')].map(el => el.dataset.page),
    active: [...document.querySelectorAll('#ra-nav [data-page].active')].map(el => `${el.dataset.page}:${el.textContent.trim()}`)
  };
});

test('minified dist boots on a Torn page with every runtime module and the release version', { timeout: 90000 }, async () => {
  await withDistPage(true, async page => {
    const info = await page.evaluate(() => ({
      owner: document.documentElement.getAttribute('data-r4g3-ra-v45-owner'),
      globals: Object.keys(window).filter(k => /^RA_/.test(k)).sort(),
      api: Object.keys(window.RA_V45App || {})
    }));
    assert.equal(info.owner, VERSION, 'installer owner guard carries the @version of the release');
    for (const name of ['RA_ScoutCore', 'RA_ResultsCore', 'RA_GlobalCore', 'RA_MatchCore', 'RA_ForumCore', 'RA_V45Runtime', 'RA_V45Candidates', 'RA_V45Discovery', 'RA_V45Messaging', 'RA_V46DomainCore', 'RA_V46StorageCore', 'RA_V46Navigation', 'RA_V46CompanyCore', 'RA_V46CompanyStorage', 'RA_V46CompanyUI', 'RA_V46CompanyPlatform', 'RA_V47FactionCore', 'RA_V47FactionStorage', 'RA_V47FactionUI', 'RA_V47FactionPlatform', 'RA_V45App']) {
      assert.ok(info.globals.includes(name), `${name} global must survive minification`);
    }
    for (const key of ['SCRIPT_VERSION', 'start', '_test']) assert.ok(info.api.includes(key), `RA_V45App.${key} property must survive minification`);
  });
});

test('minified dist: header launcher opens the app on Search & Results for Company and Faction', { timeout: 90000 }, async () => {
  await withDistPage(true, async page => {
    await page.waitForFunction(() => !!document.querySelector('ul[class*="status-icons"] #ra-status-launcher button'), { timeout: 5000 });
    assert.equal((await appState(page)).open, false, 'app starts closed');
    await physicalClick(page, '#ra-status-launcher button');
    await page.waitForFunction(() => (document.getElementById('ra-content')?.textContent || '').trim().length > 0, { timeout: 10000 });
    let state = await appState(page);
    assert.equal(state.open, true, 'launcher opens the app');
    assert.equal(state.title, 'Company Candidates');
    assert.ok(state.active.some(item => item.startsWith('company-candidates:') && item.includes('Search & Results')), `Company Search & Results is the active route, got ${state.active}`);
    assert.ok(state.controls > 0, 'Search & Results renders its controls');

    // Switch to the Faction workspace (its Search & Results) and back through the real selector.
    await physicalClick(page, '#ra-workspace-toggle');
    await physicalClick(page, '[data-workspace-domain="faction"]');
    await page.waitForFunction(() => document.getElementById('ra-page-title')?.textContent === 'Faction Candidates', { timeout: 10000 });
    state = await appState(page);
    assert.ok(state.active.some(item => item.startsWith('faction-candidates:') && item.includes('Search & Results')), `Faction Search & Results is active, got ${state.active}`);
    assert.ok(state.controls > 0, 'Faction Search & Results renders its controls');
    await physicalClick(page, '#ra-workspace-toggle');
    await physicalClick(page, '[data-workspace-domain="company"]');
    await page.waitForFunction(() => document.getElementById('ra-page-title')?.textContent === 'Company Candidates', { timeout: 10000 });

    await physicalClick(page, '#ra-close');
    assert.equal((await appState(page)).open, false, 'close button closes the app');
  });
});

test('minified dist: fallback launcher works when Torn has no header icons', { timeout: 90000 }, async () => {
  await withDistPage(false, async page => {
    await physicalClick(page, '#ra-launch');
    await page.waitForFunction(() => (document.getElementById('ra-content')?.textContent || '').trim().length > 0, { timeout: 10000 });
    const state = await appState(page);
    assert.equal(state.open, true);
    assert.equal(state.title, 'Company Candidates');
    assert.ok(state.active.some(item => item.includes('Search & Results')), `Search & Results is active, got ${state.active}`);
  });
});
