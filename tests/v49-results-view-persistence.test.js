const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const puppeteer = require('puppeteer-core');
const sourceCompatibleBoot = require('./source-compatible-boot');

const ROOT = path.join(__dirname, '..');
const MODULES = [
  'scout-core.js', 'results-core.js', 'global-core.js', 'match-core.js', 'forum-core.js',
  'v45-runtime.js', 'v45-candidates.js', 'v45-discovery.js', 'v45-messaging.js',
  'v46-domain-core.js', 'v46-storage-core.js', 'v46-navigation.js', 'v46-company-core.js',
  'v46-company-storage.js', 'v46-company-ui.js', 'v46-company-platform.js', 'v47-faction-core.js', 'v47-faction-storage.js',
  'v47-faction-ui.js', 'v47-faction-platform.js',
  'v45-app.js'
];
const BOOT = sourceCompatibleBoot(ROOT);

function chromePath() {
  for (const cmd of ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium']) {
    try { return execFileSync('which', [cmd], { encoding: 'utf8' }).trim(); } catch {}
  }
  throw new Error('No Chrome/Chromium executable found on CI runner.');
}

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/src/')) {
      const file = path.basename(url.pathname);
      if (!MODULES.includes(file)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
      res.end(fs.readFileSync(path.join(ROOT, 'src', file)));
      return;
    }
    // Every other path is a "Torn page": a full document load, like navigating Torn.
    const scripts = MODULES.map(file => `<script src="/src/${file}"></script>`).join('');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><meta charset="utf-8"></head><body><h4>Torn ${url.pathname}</h4>${scripts}
      <script>
        window.alert=()=>{}; window.confirm=()=>true; window.prompt=()=>''; window.open=()=>null;
        window.fetch=()=>Promise.reject(new Error('offline test'));
        window.GM_xmlhttpRequest=o=>setTimeout(()=>o.onerror&&o.onerror({}),5);
        window.__runtimeErrors='';
        window.addEventListener('error',e=>{window.__runtimeErrors += String(e.error||e.message)+'\\n';});
      </script></body></html>`);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function boot(page, base, pathname) {
  await page.goto(base + pathname, { waitUntil: 'networkidle0' });
  await page.addScriptTag({ content: BOOT });
  await page.waitForFunction(() => window.RA_V45App?._test?.state?.db && window.RA_V45App._test.state.mounted, { timeout: 10000 });
  await page.evaluate(() => RA_V45App._test.openApp());
  await page.evaluate(() => { RA_V45App._test.state.settings.apiKey = 'testkeytestkey01'; });
}

async function open(page, domain) {
  await page.evaluate(d => RA_V45App._test.navigate(`${d}-candidates`, false), domain);
  await page.waitForSelector(`#ra-${domain}-filter-search`, { timeout: 10000 });
  await wait(150);
}

function view(page, domain) {
  return page.evaluate(d => {
    const v = id => document.getElementById(id)?.value ?? null;
    const sort = document.querySelector(`#ra-content [data-${d}-sort].active`);
    return {
      search: v(`ra-${d}-filter-search`), man: v(`ra-${d}-filter-man`), int: v(`ra-${d}-filter-int`), end: v(`ra-${d}-filter-end`),
      status: v(`ra-${d}-filter-status`), organization: v(`ra-${d}-filter-organization`),
      presence: v(`ra-${d}-filter-organization-presence`),
      profile: v(d === 'company' ? 'ra-company-profile-select' : 'ra-faction-results-profile'),
      sort: sort ? `${sort.dataset[d + 'Sort']}:${/▼/.test(sort.textContent) ? 'desc' : 'asc'}` : null,
      rows: [...document.querySelectorAll('#ra-content [data-player-card]')].map(a => a.textContent.trim()).join(',')
    };
  }, domain);
}

async function setFilters(page, domain, values) {
  await page.evaluate((d, vals) => {
    for (const [key, value] of Object.entries(vals)) {
      const el = document.getElementById(`ra-${d}-filter-${key}`);
      el.value = value;
    }
  }, domain, values);
}

async function clickAndRender(page, selector) {
  // Wait until the clicked control has been replaced by a fresh render of the results page.
  await page.$eval(selector, el => { window.__raClicked = el; el.click(); });
  await page.waitForFunction(() => !window.__raClicked.isConnected, { timeout: 20000 });
  await wait(200);
}

test('Results search filters, sort and visible results survive a reload and Torn page navigation per workspace', { timeout: 90000 }, async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const page = await browser.newPage();
    page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
    await page.setViewport({ width: 1440, height: 900 });
    await boot(page, base, '/index.php');
    await page.evaluate(async () => {
      const repos = RA_V45App._test.repositories;
      for (let i = 1; i <= 5; i++) {
        await repos.company.ensure(String(1000 + i), { name: `Comp${i}`, stats: { man: i * 1000, int: i, end: i } });
        await repos.faction.ensure(String(2000 + i), { name: `Fac${i}` });
      }
    });

    // Company: search filters applied with the Search button. The network is offline here, so the
    // search itself fails, but the visible filters must still be applied to the local results.
    await open(page, 'company');
    await setFilters(page, 'company', { search: 'Comp', man: '2000', int: '2', end: '', status: '', organization: '', 'organization-presence': 'any' });
    await clickAndRender(page, '#ra-company-search-apply');
    const companyAfterSearch = await view(page, 'company');
    assert.equal(companyAfterSearch.rows.split(',').sort().join(','), 'Comp2,Comp3,Comp4,Comp5', 'a failed remote search must still apply the local filters');
    await clickAndRender(page, '#ra-content [data-company-sort="man"]');
    const companyBefore = await view(page, 'company');
    assert.equal(companyBefore.sort, 'man:desc');
    assert.equal(companyBefore.rows, 'Comp5,Comp4,Comp3,Comp2');

    // Faction: a different set of filters and sort in the other workspace.
    await open(page, 'faction');
    await setFilters(page, 'faction', { search: 'Fac' });
    await clickAndRender(page, '#ra-faction-search-apply');
    await clickAndRender(page, '#ra-content [data-faction-sort="player"]');
    const factionBefore = await view(page, 'faction');
    assert.equal(factionBefore.sort, 'player:desc');
    assert.equal(factionBefore.rows, 'Fac5,Fac4,Fac3,Fac2,Fac1');

    await open(page, 'company');
    assert.deepEqual(await view(page, 'company'), companyBefore, 'switching workspace in-session keeps Company results state');

    // Navigate to another Torn page (full reload, same browser profile -> same IndexedDB).
    await boot(page, base, '/factions.php');
    await open(page, 'company');
    assert.deepEqual(await view(page, 'company'), companyBefore, 'Company filters, sort and results survive a Torn page navigation');
    await open(page, 'faction');
    assert.deepEqual(await view(page, 'faction'), factionBefore, 'Faction filters, sort and results survive a Torn page navigation and stay isolated from Company');

    // Status / membership values round-trip through a plain reload.
    await setFilters(page, 'faction', { status: 'Offline', 'organization-presence': 'has', organization: 'Alpha' });
    await clickAndRender(page, '#ra-faction-search-apply');
    const factionStatusBefore = await view(page, 'faction');
    assert.equal(factionStatusBefore.status, 'Offline');
    assert.equal(factionStatusBefore.presence, 'has');
    assert.equal(factionStatusBefore.organization, 'Alpha');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.addScriptTag({ content: BOOT });
    await page.waitForFunction(() => window.RA_V45App?._test?.state?.db && window.RA_V45App._test.state.mounted, { timeout: 10000 });
  await page.evaluate(() => RA_V45App._test.openApp());
    await open(page, 'faction');
    assert.deepEqual(await view(page, 'faction'), factionStatusBefore, 'Faction status/membership filters survive page.reload');

    // The app is built lazily: after a reload, opening it with the launcher (no programmatic navigation)
    // must restore the last page and its results view on the first render.
    // Leave the page and come back so the route is persisted the way a nav click persists it.
    await page.evaluate(async () => { await RA_V45App._test.navigate('settings'); await RA_V45App._test.navigate('faction-candidates'); });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.addScriptTag({ content: BOOT });
    await page.waitForSelector('#ra-sidebar-launcher,#ra-launch', { timeout: 10000 });
    await page.waitForFunction(() => window.RA_V45App?._test?.state?.mounted, { timeout: 10000 });
    assert.equal(await page.evaluate(() => document.getElementById('ra-app')), null, 'app shell is not built before the user opens it');
    await page.evaluate(() => (document.getElementById('ra-sidebar-launcher') || document.getElementById('ra-launch')).click());
    await page.waitForSelector('#ra-faction-filter-search', { timeout: 10000 });
    await wait(150);
    assert.equal(await page.evaluate(() => RA_V45App._test.state.page), 'faction-candidates', 'opening the app restores the last page');
    assert.deepEqual(await view(page, 'faction'), factionStatusBefore, 'opening the app after reload restores the Faction results view');
    await open(page, 'company');
    assert.deepEqual(await view(page, 'company'), companyBefore, 'Company state is not affected by Faction changes');

    // A deliberately cleared Company profile and filters must stay cleared after reload (RA-003 behaviour).
    await clickAndRender(page, '#ra-company-profile-clear');
    const cleared = await view(page, 'company');
    assert.equal(cleared.profile, '');
    assert.equal(cleared.search, '');
    assert.equal(cleared.man, '');
    await boot(page, base, '/index.php');
    await open(page, 'company');
    const clearedAfter = await view(page, 'company');
    assert.equal(clearedAfter.profile, '');
    assert.equal(clearedAfter.search, '');
    assert.equal(clearedAfter.man, '');
    assert.equal(clearedAfter.sort, 'man:desc', 'sort is independent of the Match Profile');

    const errors = await page.evaluate(() => window.__runtimeErrors);
    assert.equal(errors, '', `runtime errors: ${errors}`);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
