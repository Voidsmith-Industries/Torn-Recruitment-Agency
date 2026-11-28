const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const puppeteer = require('puppeteer-core');
const sourceCompatibleBoot = require('./source-compatible-boot');

const ROOT = path.join(__dirname, '..');
const MODULES = [...fs.readFileSync(path.join(ROOT, 'R4G3RUNN3R-Recruitment-Agency.user.js'), 'utf8').matchAll(/^\/\/ @require\s+\S+\/src\/(\S+\.js)\s*$/gm)].map(match => match[1]);
const BOOT = sourceCompatibleBoot(ROOT);

function chromePath() {
  for (const cmd of ['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium']) {
    try { return execFileSync('which', [cmd], { encoding: 'utf8' }).trim(); } catch {}
  }
  throw new Error('No Chrome/Chromium executable found on CI runner.');
}

// No fetch stub in the page: the app's real fetch reaches api.torn.com and is answered by request interception.
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
    const scripts = MODULES.map(file => `<script src="/src/${file}"></script>`).join('');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><meta charset="utf-8"></head><body><h4>Torn</h4>${scripts}
      <script>
        window.alert=m=>{window.__runtimeErrors+='alert: '+m+'\\n';}; window.confirm=()=>true; window.prompt=()=>'testkeytestkey01'; window.open=()=>null;
        window.__gmCalls=0; window.GM_xmlhttpRequest=o=>{window.__gmCalls++;setTimeout(()=>o.onerror&&o.onerror({}),5);};
        window.__runtimeErrors='';
        window.addEventListener('error',e=>{window.__runtimeErrors += String(e.error||e.message)+'\\n';});
        window.addEventListener('unhandledrejection',e=>{window.__runtimeErrors += String(e.reason)+'\\n';});
      </script></body></html>`);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Spec-shaped Torn v2 responses (openapi UserSearchResponse / forum posts), 25 users per page, 8 pages.
function tornApi(page, log) {
  return page.setRequestInterception(true).then(() => page.on('request', request => {
    const url = new URL(request.url());
    if (url.hostname === '127.0.0.1') return request.continue();
    log.push(url.href);
    if (url.hostname !== 'api.torn.com') return request.abort();
    const json = body => request.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (url.pathname.startsWith('/v2/forum/')) return json({ posts: [], _metadata: { links: { next: null, prev: null } } });
    if (url.pathname === '/v2/user/search') {
      const n = url.searchParams.get('cursor') ? Number(url.searchParams.get('cursor').slice(1)) : 0;
      const search = Array.from({ length: 25 }, (_, i) => ({ id: 700000 + n * 25 + i, name: `Api${String(n * 25 + i).padStart(3, '0')}`, level: 15, online: 'Offline', faction_id: 0, icons: [] }));
      const next = n < 7 ? `https://api.torn.com/v2/user/search?filters=${encodeURIComponent(url.searchParams.get('filters') || '')}&limit=25&cursor=c${n + 1}` : null;
      return json({ search, _metadata: { links: { next, prev: null }, total: 200 } });
    }
    return json({ error: { code: 2, error: 'Incorrect key' } });
  }));
}

async function boot(page, base) {
  await page.goto(base + '/index.php', { waitUntil: 'networkidle0' });
  await page.addScriptTag({ content: BOOT });
  await page.waitForFunction(() => window.RA_V45App?._test?.state?.db && window.RA_V45App._test.state.mounted, { timeout: 10000 });
}

async function withBrowser(run) {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
    await page.setViewport({ width: 1440, height: 900 });
    await run(page, base);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

async function clickAndRender(page, selector) {
  await page.$eval(selector, el => { window.__raClicked = el; el.click(); });
  await page.waitForFunction(() => !window.__raClicked.isConnected, { timeout: 30000 });
  await new Promise(resolve => setTimeout(resolve, 200));
}

test('old settings with Global Intelligence enabled and an endpoint still boot; GI is hidden and nothing is sent', { timeout: 90000 }, async () => {
  await withBrowser(async (page, base) => {
    const log = [];
    await tornApi(page, log);
    await boot(page, base);
    await page.evaluate(async () => {
      const db = RA_V45App._test.state.db;
      const put = (store, value) => new Promise((resolve, reject) => { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
      const meta = await new Promise(resolve => { const q = db.transaction('meta', 'readonly').objectStore('meta').get('global'); q.onsuccess = () => resolve(q.result); });
      const settings = { ...(meta?.settings || {}), activePage: 'global-intelligence', optionalModules: { globalIntelligence: true, scout: true }, global: { enabled: true, endpoint: 'https://script.google.com/macros/s/abc/exec', lookupCacheMs: 1800000, maxRetryAttempts: 5 } };
      await put('meta', { ...(meta || { key: 'global', ui: {} }), key: 'global', settings });
      await put('globalSyncQueue', { queueId: 'q1', userId: 1, observation: { playerId: 1 }, attempts: 0, createdAt: 1, nextRetryAt: 0, lastError: '' });
    });
    await boot(page, base);
    assert.equal(await page.evaluate(() => RA_V45App._test.state.page), 'company-candidates');
    await page.evaluate(() => RA_V45App._test.openApp());
    await page.waitForSelector('#ra-company-filter-search');
    const nav = await page.$$eval('#ra-nav [data-page]', els => els.map(el => el.dataset.page));
    assert.ok(nav.includes('scout'));
    assert.equal(nav.includes('global-intelligence'), false);
    assert.equal(await page.evaluate(() => RA_V45App._test.navigate('global-intelligence')), false, 'the route is unavailable');

    await page.evaluate(() => RA_V45App._test.navigate('settings'));
    await page.waitForSelector('#ra-save-settings');
    const settingsPage = await page.evaluate(() => ({
      keys: [...document.querySelectorAll('[data-optional-module]')].map(el => el.dataset.optionalModule),
      endpoint: !!document.getElementById('ra-setting-global-endpoint'),
      section: !!document.querySelector('[data-settings-section="global"]'),
      text: document.getElementById('ra-content').textContent
    }));
    assert.equal(settingsPage.keys.includes('globalIntelligence'), false);
    assert.equal(settingsPage.endpoint, false, 'users are never asked for an endpoint');
    assert.equal(settingsPage.section, false);
    assert.doesNotMatch(settingsPage.text, /Global Intelligence|endpoint/i);
    await page.evaluate(() => document.getElementById('ra-save-settings').click());
    await new Promise(resolve => setTimeout(resolve, 500));
    const kept = await page.evaluate(async () => ({
      endpoint: RA_V45App._test.state.settings.global.endpoint,
      queue: await new Promise(resolve => { const q = RA_V45App._test.state.db.transaction('globalSyncQueue', 'readonly').objectStore('globalSyncQueue').getAll(); q.onsuccess = () => resolve(q.result.length); }),
      gm: window.__gmCalls
    }));
    assert.equal(kept.endpoint, 'https://script.google.com/macros/s/abc/exec', 'stored settings are left untouched');
    assert.equal(kept.queue, 1, 'existing Global data is left untouched');
    assert.equal(kept.gm, 0, 'no GM_xmlhttpRequest is made');
    assert.equal(log.length, 0, 'no network request leaves the page');
    assert.equal(await page.evaluate(() => window.__runtimeErrors), '');
  });
});
