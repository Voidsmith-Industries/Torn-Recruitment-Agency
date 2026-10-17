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
  'v46-company-storage.js', 'v46-company-ui.js', 'v46-company-operations.js',
  'v46-company-workflow.js', 'v46-company-workflow-ui.js', 'v46-company-opportunity-ui.js',
  'v46-company-platform.js', 'v47-faction-core.js', 'v47-faction-storage.js',
  'v47-faction-ui.js', 'v47-faction-operations.js', 'v47-faction-workflow.js',
  'v47-faction-workflow-ui.js', 'v47-faction-opportunity-ui.js', 'v47-faction-platform.js',
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
      </style></head><body><ul class="status-icons"></ul>
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

test('public bootstrap keeps Faction Requirements active while its own in-page controls are used', { timeout: 60000 }, async () => {
  const server = await serve();
  const port = server.address().port;
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle0' });
    await page.addScriptTag({ content: BOOT });
    await page.waitForSelector('#ra-app', { timeout: 10000 });

    const launcher = await page.evaluate(() => {
      for (const selector of ['#ra-status-launcher button']) {
        const el = document.querySelector(selector);
        if (el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden') return selector;
      }
      return '';
    });
    assert.ok(launcher, 'a Recruitment Agency launcher should be visible');
    await physicalClick(page, launcher);

    await page.evaluate(async()=>{
      RA_V45App._test.state.settings.optionalModules.factionRequirements=true;
      await RA_V45App._test.navigate('faction-requirements',false);
    });
    await page.waitForFunction(() => document.getElementById('ra-page-title')?.textContent === 'Faction Requirements', { timeout: 10000 });
    assert.equal(await title(page), 'Faction Requirements');

    const beforeCriteria = await page.$$eval('#ra-faction-baseline-criteria [data-faction-criterion-row]', els => els.length);
    await physicalClick(page, '#ra-faction-baseline-add');
    await page.waitForFunction(expected => document.querySelectorAll('#ra-faction-baseline-criteria [data-faction-criterion-row]').length === expected + 1, { timeout: 10000 }, beforeCriteria);
    assert.equal(await title(page), 'Faction Requirements', 'Add Requirement must not send the app to Company Overview');

    const beforeProfiles = await page.$$eval('[data-faction-profile-card]', els => els.length);
    await physicalClick(page, '#ra-faction-profile-new');
    await page.waitForFunction(expected => document.querySelectorAll('[data-faction-profile-card]').length === expected + 1, { timeout: 10000 }, beforeProfiles);
    assert.equal(await title(page), 'Faction Requirements', 'Create Specialist Profile must not send the app to Company Overview');

    const errors = await page.evaluate(() => window.__runtimeErrors);
    assert.equal(errors, '', `runtime errors: ${errors}`);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
