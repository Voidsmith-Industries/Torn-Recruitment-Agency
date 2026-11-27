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
  'v46-domain-core.js', 'v46-storage-core.js', 'v46-navigation.js', 'v46-recruitment-shared.js', 'v46-company-core.js',
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
    if (url.pathname === '/') {
      const scripts = MODULES.map(file => `<script src="/src/${file}"></script>`).join('');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><head><meta charset="utf-8"><style>
        body{margin:0;font-family:Arial,sans-serif;background:#202020;color:#fff}
      </style></head><body>
        <section><h2>Information</h2><div><button>One</button><button>Two</button></div></section>
        ${scripts}
        <script>
          window.alert=()=>{}; window.confirm=()=>true; window.prompt=()=>''; window.open=()=>null;
          window.__runtimeErrors='';
          window.addEventListener('error',e=>{window.__runtimeErrors += String(e.error||e.message)+'\\n';});
          window.addEventListener('unhandledrejection',e=>{window.__runtimeErrors += String(e.reason||'unhandled rejection')+'\\n';});
        </script>
      </body></html>`);
      return;
    }
    if (url.pathname.startsWith('/src/')) {
      const file = path.basename(url.pathname);
      if (!MODULES.includes(file)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
      res.end(fs.readFileSync(path.join(ROOT, 'src', file)));
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function physicalClick(page, selector) {
  await page.waitForSelector(selector, { visible: true });
  const point = await page.$eval(selector, el => {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, target: hit === el || !!(hit && el.contains(hit)) };
  });
  assert.equal(point.target, true, `${selector} must be physically hittable`);
  await page.mouse.click(point.x, point.y);
}

async function title(page) {
  return page.$eval('#ra-page-title', el => el.textContent);
}


// Delays IndexedDB read callbacks for chosen object stores so async render/save races become deterministic.
const SLOW_STORES = `(()=>{const d=Object.getOwnPropertyDescriptor(IDBRequest.prototype,'onsuccess');window.__slowStores={};Object.defineProperty(IDBRequest.prototype,'onsuccess',{configurable:true,get(){return d.get.call(this);},set(fn){let name='';try{name=this.source&&this.source.name;}catch{}const ms=window.__slowStores[name]||0;d.set.call(this,fn&&ms?function(e){setTimeout(()=>fn.call(this,e),ms);}:fn);}});})()`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function withApp(run) {
  const server = await serve();
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const boot = async () => {
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle0' });
      await page.addScriptTag({ content: BOOT });
      await page.waitForSelector('#ra-sidebar-launcher,#ra-launch', { timeout: 10000 });
      await page.waitForFunction(() => window.RA_V45App?._test?.state?.mounted, { timeout: 10000 });
      // The app is built lazily on first open: open it through the real launcher, then wait for the restored page to render.
      await page.evaluate(() => (document.getElementById('ra-sidebar-launcher') || document.getElementById('ra-launch')).click());
      await page.waitForFunction(() => document.getElementById('ra-app')?.style.display === 'block' && document.getElementById('ra-page-title')?.textContent && document.getElementById('ra-content')?.textContent, { timeout: 10000 });
      await page.evaluate(SLOW_STORES);
    };
    await boot();
    // Enable every optional page through the real Settings save flow.
    await page.evaluate(async () => {
      await RA_V45App._test.navigate('settings');
      document.querySelectorAll('[data-optional-module]').forEach(el => { el.checked = true; });
      document.getElementById('ra-save-settings').click();
    });
    await page.waitForFunction(() => RA_V45App._test.state.settings.optionalModules.scout === true && document.querySelector('#ra-nav [data-page="scout"]'), { timeout: 10000 });
    await sleep(300);
    await run(page, boot);
    const errors = await page.evaluate(() => window.__runtimeErrors);
    assert.equal(errors, '', `runtime errors: ${errors}`);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

const view = page => page.evaluate(() => ({
  page: RA_V45App._test.state.page,
  title: document.getElementById('ra-page-title').textContent,
  active: [...document.querySelectorAll('#ra-nav [data-page].active')].map(el => el.dataset.page).join(','),
  content: document.getElementById('ra-content').textContent.slice(0, 40)
}));
const clickNav = (page, id) => page.evaluate(route => document.querySelector(`#ra-nav [data-page="${route}"]`).click(), id);
const settled = () => sleep(900);

test('a slow render of an older route never overwrites the page the user navigated to', { timeout: 60000 }, async () => {
  await withApp(async page => {
    for (const [older, newer, store, expectTitle, expectContent] of [
      ['scout', 'company-discover', 'scoutHistory', 'Forum Discovery', 'Forum Discovery'],
      ['global-intelligence', 'data', 'globalSyncQueue', 'Data', 'Local Data'],
      ['smart-match', 'settings', 'matchProfiles', 'Settings', 'Getting started']
    ]) {
      await page.evaluate(async (older, newer, store) => {
        window.__slowStores = { [store]: 400 };
        const first = RA_V45App._test.navigate(older);
        await new Promise(resolve => setTimeout(resolve, 60));
        const second = RA_V45App._test.navigate(newer);
        await Promise.allSettled([first, second]);
        window.__slowStores = {};
      }, older, newer, store);
      await settled();
      const now = await view(page);
      assert.equal(now.page, newer);
      assert.equal(now.title, expectTitle, `${older} -> ${newer}: title`);
      assert.ok(now.content.startsWith(expectContent), `${older} -> ${newer}: content must belong to ${newer}, got "${now.content}"`);
    }
  });
});

test('the last route the user chose is the one restored after reload, even when saves complete out of order', { timeout: 60000 }, async () => {
  await withApp(async (page, boot) => {
    await page.evaluate(async () => {
      window.__slowStores = { meta: 300 };
      const first = RA_V45App._test.navigate('scout');
      await new Promise(resolve => setTimeout(resolve, 40));
      window.__slowStores = {};
      const second = RA_V45App._test.navigate('company-discover');
      await Promise.allSettled([first, second]);
    });
    await settled();
    assert.equal((await view(page)).page, 'company-discover');
    await boot();
    const restored = await view(page);
    assert.equal(restored.page, 'company-discover', 'reload must reopen the last route, not an older one');
    assert.equal(restored.title, 'Forum Discovery');
  });
});

test('in-page saves that finish after a nav click do not snap back to the page they started on', { timeout: 60000 }, async () => {
  await withApp(async page => {
    // Smart Match profile change, then the user clicks another page while the save is pending.
    await clickNav(page, 'smart-match');
    await settled();
    await page.evaluate(() => { window.__slowStores = { meta: 300 }; document.getElementById('ra-match-profile-select').dispatchEvent(new Event('change')); });
    await sleep(40);
    await page.evaluate(() => { window.__slowStores = {}; });
    await clickNav(page, 'company-discover');
    await settled();
    let now = await view(page);
    assert.equal(now.page, 'company-discover', 'Smart Match profile save must not pull the user back');
    assert.equal(now.title, 'Forum Discovery');

    // Settings save, then a nav click before the save completes.
    await page.evaluate(() => document.getElementById('ra-settings-button').click());
    await settled();
    await page.evaluate(() => { window.__slowStores = { meta: 300 }; document.getElementById('ra-save-settings').click(); });
    await sleep(40);
    await page.evaluate(() => { window.__slowStores = {}; });
    await clickNav(page, 'scout');
    await settled();
    now = await view(page);
    assert.equal(now.page, 'scout', 'Settings save must not pull the user back to Settings');
    assert.equal(now.title, 'Scout');
    assert.equal(now.active, 'scout');
  });
});

test('switching workspace does not override a page the user picks while the switch is saving', { timeout: 60000 }, async () => {
  await withApp(async page => {
    await page.evaluate(() => { window.__slowStores = { meta: 300 }; document.getElementById('ra-workspace-toggle').click(); document.querySelector('[data-workspace-domain="faction"]').click(); });
    await sleep(40);
    await page.evaluate(() => { window.__slowStores = {}; });
    await clickNav(page, 'data');
    await settled();
    const now = await view(page);
    assert.equal(now.page, 'data', 'workspace switch must not snap back over the later click');
    assert.equal(now.title, 'Data');
    // The workspace choice itself is still honoured.
    assert.equal(await page.$eval('#ra-workspace-label', el => el.textContent), 'Faction');
    assert.ok(await page.$('#ra-nav [data-page="faction-candidates"]'), 'Faction pages should be in the sidebar');
  });
});
