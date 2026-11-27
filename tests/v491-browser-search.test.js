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

test('Search with END >= 100k lists Torn API players (stats Unknown) and Search more loads the next 100', { timeout: 120000 }, async () => {
  await withBrowser(async (page, base) => {
    const log = [];
    await tornApi(page, log);
    await boot(page, base);
    await page.evaluate(async () => {
      await RA_V45App._test.openApp();
      const repos = RA_V45App._test.repositories;
      await repos.company.ensure('900001', { name: 'KnownStrong', stats: { man: 1, int: 1, end: 250000 } });
      await repos.company.ensure('900002', { name: 'KnownWeak', stats: { man: 1, int: 1, end: 5000 } });
      await RA_V45App._test.navigate('company-candidates', false);
    });
    await page.waitForSelector('#ra-company-filter-search');
    assert.equal(await page.$('#ra-company-search-more'), null, 'Search more appears only after a search with more pages');
    await page.$eval('#ra-company-filter-end', el => { el.value = '100k'; });
    await clickAndRender(page, '#ra-company-search-apply');

    const result = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#ra-content table.ra-core-results tbody tr')];
      const names = rows.map(row => row.querySelector('[data-player-card]')?.textContent.trim()).filter(Boolean);
      const endIndex = [...document.querySelectorAll('#ra-content table.ra-core-results thead th')].findIndex(th => th.textContent.trim().startsWith('END'));
      const apiRow = rows.find(row => /Api000/.test(row.textContent));
      return { names, apiEnd: apiRow?.children[endIndex]?.textContent.trim(), summary: document.querySelector('.ra-results-panel .ra-panel-head p')?.textContent, more: !!document.getElementById('ra-company-search-more') };
    });
    assert.ok(result.names.includes('Api000') && result.names.includes('Api099'), 'Torn API players stay listed with Unknown END');
    assert.equal(result.names.includes('KnownWeak'), false, 'a known END below the minimum stays hidden');
    assert.equal(result.apiEnd, '—', 'unknown END shows the existing em-dash, never a made-up value');
    assert.match(result.summary, /^101 matching of 102 Company candidate/);
    assert.equal(result.more, true);

    const searches = log.filter(href => href.includes('/v2/user/search')).map(href => new URL(href).searchParams);
    assert.equal(searches.length, 4, 'one Search fetches up to 4 pages (100 players)');
    assert.deepEqual(searches.map(p => p.get('filters')), Array(4).fill('lastActionRecent'));
    assert.deepEqual(searches.map(p => p.get('cursor')), [null, 'c1', 'c2', 'c3']);

    for (const direction of ['desc', 'asc']) {
      await clickAndRender(page, '#ra-content [data-company-sort="end"]');
      const order = await page.$$eval('#ra-content [data-player-card]', els => els.map(el => el.textContent.trim()));
      assert.equal(order[0], 'KnownStrong', `END ${direction}: the known stat sorts ahead of Unknown stats`);
    }
    await clickAndRender(page, '#ra-company-search-more');
    const after = log.filter(href => href.includes('/v2/user/search')).map(href => new URL(href).searchParams.get('cursor'));
    assert.deepEqual(after.slice(4), ['c4', 'c5', 'c6', 'c7']);
    const summary = await page.$eval('.ra-results-panel .ra-panel-head p', el => el.textContent);
    assert.match(summary, /^201 matching of 202 Company candidate/);
    assert.equal(await page.$('#ra-company-search-more'), null, 'Torn reported no next page, so Search more is gone');
    assert.equal(log.some(href => !href.startsWith('https://api.torn.com/')), false, 'nothing is sent anywhere but Torn');
    assert.equal(await page.evaluate(() => window.__runtimeErrors), '');
  });
});

test('Search and Discover buttons show progress while Torn is answering', { timeout: 60000 }, async () => {
  await withBrowser(async (page, base) => {
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.hostname === '127.0.0.1') return request.continue();
      if (url.hostname !== 'api.torn.com') return request.abort();
      const body = url.pathname === '/v2/user/search'
        ? { search: [], _metadata: { links: { next: null, prev: null }, total: 0 } }
        : url.pathname === '/v2/torn/hof' ? { hof: [] } : { posts: [], _metadata: { links: { next: null, prev: null } } };
      setTimeout(() => request.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) }).catch(() => {}), 1500);
    });
    await boot(page, base);
    await page.evaluate(async () => { await RA_V45App._test.openApp(); await RA_V45App._test.navigate('company-candidates', false); });
    for (const [id, busy] of [['#ra-company-search-apply', 'Searching…'], ['#ra-company-hof-discover', 'Discovering…']]) {
      await page.waitForSelector(id, { visible: true });
      await page.click(id);
      await page.waitForFunction((sel, label) => {
        const el = document.querySelector(sel);
        return el && el.disabled && el.textContent === label;
      }, { timeout: 1000 }, id, busy);
      await page.waitForFunction(sel => { const el = document.querySelector(sel); return el && !el.disabled; }, { timeout: 20000 }, id);
    }
    const errors = await page.evaluate(() => window.__runtimeErrors);
    assert.equal(errors, '', `runtime errors: ${errors}`);
  });
});
