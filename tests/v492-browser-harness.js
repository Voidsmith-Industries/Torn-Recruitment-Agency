// Shared headless-Chrome harness for the 4.9.2 logic regression tests (spec-shaped Torn v2 responses via request interception).
const test = require('node:test');
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
    res.end(`<!doctype html><html><head><meta charset="utf-8"></head><body><h4>Torn</h4><div class="wrap"><div id="sidebarroot"><div id="sidebar"><div class="toggle-block">Info</div><div class="toggle-block">Areas</div></div></div></div>${scripts}
      <script>
        window.__alerts=[]; window.alert=m=>{window.__alerts.push(String(m));}; window.confirm=()=>true; window.prompt=()=>'testkeytestkey01'; window.open=()=>null;
        window.GM_xmlhttpRequest=o=>{setTimeout(()=>o.onerror&&o.onerror({}),5);};
        window.__runtimeErrors='';
        window.addEventListener('error',e=>{window.__runtimeErrors += String(e.error||e.message)+'\\n';});
        window.addEventListener('unhandledrejection',e=>{window.__runtimeErrors += String(e.reason)+'\\n';});
      </script></body></html>`);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

let browser, server, base;
test.before(async () => {
  server = await serve();
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
});
test.after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); });

// handler(url) -> JSON body, or a Promise of one. Every Torn request URL is logged.
async function openPage(handler = () => null, viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage();
  const log = [];
  page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
  await page.setViewport(viewport);
  await page.setRequestInterception(true);
  page.on('request', async request => {
    const url = new URL(request.url());
    if (url.hostname === '127.0.0.1') return request.continue();
    log.push(url);
    if (url.hostname !== 'api.torn.com') return request.abort();
    const body = (await handler(url)) || { error: { code: 2, error: 'Incorrect key' } };
    request.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) }).catch(() => {});
  });
  await page.goto(base + '/index.php', { waitUntil: 'networkidle0' });
  await page.addScriptTag({ content: BOOT });
  await page.waitForFunction(() => window.RA_V45App?._test?.state?.db && window.RA_V45App._test.state.mounted, { timeout: 10000 });
  await page.evaluate(async () => {
    const t = RA_V45App._test; t.state.apiRetryMs = 50;
    const meta = await new Promise(r => { const q = t.state.db.transaction('meta').objectStore('meta').get('global'); q.onsuccess = () => r(q.result); });
    meta.settings.apiKey = 'testkeytestkey01'; t.state.settings.apiKey = 'testkeytestkey01'; t.state.apiNextAt = 0;
    await new Promise(r => { const q = t.state.db.transaction('meta', 'readwrite').objectStore('meta').put(meta); q.onsuccess = r; });
  });
  page.log = log;
  return page;
}
const settle = (page, ms = 200) => page.evaluate(ms => new Promise(r => setTimeout(r, ms)), ms);
const getAll = (page, store) => page.evaluate(store => new Promise(r => { const q = RA_V45App._test.state.db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => r(q.result); }), store);
const getOne = (page, store, key) => page.evaluate((store, key) => new Promise(r => { const q = RA_V45App._test.state.db.transaction(store).objectStore(store).get(key); q.onsuccess = () => r(q.result); }), store, key);


module.exports = { openPage, settle, getAll, getOne };
