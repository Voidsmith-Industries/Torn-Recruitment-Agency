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

const OLD_WORKFLOW_FLAGS = ['companyOverview', 'companyToday', 'companyPipeline', 'companyVacancies', 'companyCampaigns', 'companyFollowups', 'companyTimeline', 'companyStageAging', 'companyContactOutcomes', 'companySessions', 'companyTalentPool', 'companyReactivation', 'companyOpportunity', 'companyCompare', 'factionOverview', 'factionToday', 'factionDiscovery', 'factionPipeline', 'factionRequirements', 'factionCampaigns', 'factionFollowups', 'factionTimeline', 'factionStageAging', 'factionContactOutcomes', 'factionSessions', 'factionReactivation', 'factionOpportunity', 'factionCompare', 'logs'];

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
    res.end(`<!doctype html><html><head><meta charset="utf-8"></head><body><h4>Torn</h4>${scripts}
      <script>
        window.alert=()=>{}; window.confirm=()=>true; window.prompt=()=>''; window.open=()=>null;
        window.fetch=()=>Promise.reject(new Error('offline test'));
        window.GM_xmlhttpRequest=o=>setTimeout(()=>o.onerror&&o.onerror({}),5);
        window.__runtimeErrors='';
        window.addEventListener('error',e=>{window.__runtimeErrors += String(e.error||e.message)+'\\n';});
        window.addEventListener('unhandledrejection',e=>{window.__runtimeErrors += String(e.reason)+'\\n';});
      </script></body></html>`);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function boot(page, base) {
  await page.goto(base + '/index.php', { waitUntil: 'networkidle0' });
  await page.addScriptTag({ content: BOOT });
  await page.waitForFunction(() => window.RA_V45App?._test?.state?.db && window.RA_V45App._test.state.mounted, { timeout: 10000 });
}

async function seedOldSettings(page, settings) {
  await page.evaluate(async patch => {
    const db = RA_V45App._test.state.db;
    const read = () => new Promise((resolve, reject) => { const q = db.transaction('meta', 'readonly').objectStore('meta').get('global'); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
    const meta = await read() || { key: 'global', settings: {} };
    meta.settings = { ...meta.settings, ...patch, optionalModules: { ...(meta.settings?.optionalModules || {}), ...patch.optionalModules } };
    await new Promise((resolve, reject) => { const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put(meta); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  }, settings);
}

test('settings saved by a version with workflow pages still boot, fall back to Search & Results and save cleanly', { timeout: 90000 }, async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await boot(page, base);
    const optionalModules = Object.fromEntries([...OLD_WORKFLOW_FLAGS, 'companyDiscovery', 'scout'].map(key => [key, true]));
    for (const [activePage, activeDomain, expected] of [['company-pipeline', 'company', 'company-candidates'], ['faction-requirements', 'faction', 'faction-candidates'], ['logs', 'company', 'company-candidates']]) {
      await seedOldSettings(page, { activePage, activeDomain, complexity: 'advanced', optionalModules, navigation: { expandedGroups: ['recruitment', 'faction-recruitment'] }, candidates: { view: 'cards', visibleColumns: ['player', 'stage', 'pipeline'] } });
      await boot(page, base);
      assert.equal(await page.evaluate(() => RA_V45App._test.state.page), expected, `${activePage} falls back to ${expected}`);
      await page.evaluate(() => RA_V45App._test.openApp());
      await page.waitForFunction(id => document.getElementById(`ra-${id.split('-')[0]}-filter-search`), { timeout: 10000 }, expected);
      const nav = await page.$$eval('#ra-nav [data-page]', els => els.map(el => el.dataset.page));
      assert.ok(nav.includes(expected));
      assert.ok(nav.includes('company-discover'), 'Forum Discovery keeps its saved companyDiscovery flag');
      for (const removed of ['company-pipeline', 'company-overview', 'faction-requirements', 'faction-discover', 'logs']) assert.equal(nav.includes(removed), false, `${removed} is not in the navigation`);
    }

    await page.evaluate(() => RA_V45App._test.navigate('settings'));
    await page.waitForSelector('#ra-save-settings');
    const keys = await page.$$eval('[data-optional-module]', els => els.map(el => el.dataset.optionalModule));
    assert.deepEqual(keys, ['companyDiscovery', 'scout', 'smartMatch', 'data'], 'no Optional Features toggles remain for removed pages');
    await page.evaluate(() => document.getElementById('ra-save-settings').click());
    await page.waitForFunction(() => [...document.querySelectorAll('.ra-toast')].some(t => /Settings saved/.test(t.textContent)), { timeout: 5000 });
    const saved = await page.evaluate(() => RA_V45App._test.state.settings.optionalModules);
    // 4.9.2: flags this version no longer shows are kept on save so a rollback still finds them.
    assert.equal(saved.companyPipeline, true);
    assert.equal(saved.companyDiscovery, true);
    assert.equal(saved.scout, true);
    assert.equal(await page.evaluate(() => window.__runtimeErrors), '');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
