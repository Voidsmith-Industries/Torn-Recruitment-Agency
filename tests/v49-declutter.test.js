const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const puppeteer = require('puppeteer-core');
const sourceCompatibleBoot = require('./source-compatible-boot');
const CompanyUI = require('../src/v46-company-ui');
const FactionUI = require('../src/v47-faction-ui');

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
      res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#202020;color:#fff">
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

async function boot(page, port, viewport) {
  await page.setViewport(viewport);
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle0' });
  await page.addScriptTag({ content: BOOT });
  await page.waitForFunction(() => window.RA_V45App?._test?.state?.mounted, { timeout: 10000 });
  await page.evaluate(() => RA_V45App._test.openApp());
}

async function openSettings(page) {
  await page.evaluate(() => document.getElementById('ra-settings-button').click());
  await page.waitForFunction(() => document.getElementById('ra-page-title')?.textContent === 'Settings' && document.getElementById('ra-save-settings'), { timeout: 10000 });
}

test('Company search panel keeps profile extras out of the way and uses plain language', () => {
  const html = CompanyUI.renderCandidates([], { profiles: [{ profileId: 'p1', name: 'Default Recruit' }], activeProfileId: '' });
  assert.doesNotMatch(html, /combined candidate intelligence/, 'search help text should be plain language');
  const more = html.match(/<details class="ra-profile-more"[^>]*>([\s\S]*?)<\/details>/);
  assert.ok(more, 'secondary profile actions should sit in a collapsed "More" disclosure');
  assert.doesNotMatch(more[0], /<details[^>]*\sopen/, 'profile extras are collapsed by default');
  assert.match(more[1], /id="ra-company-profile-save-search"/);
  assert.match(more[1], /id="ra-company-profile-manage"/);
  assert.match(html, /id="ra-company-profile-clear"[^>]*hidden/, 'Clear Profile is hidden when no profile is active');
  const active = CompanyUI.renderCandidates([], { profiles: [{ profileId: 'p1', name: 'Default Recruit' }], activeProfileId: 'p1' });
  assert.doesNotMatch(active, /id="ra-company-profile-clear"[^>]*hidden/, 'Clear Profile is shown once a profile is active');
});

test('Faction search panel hides inactive profile actions and uses plain language', () => {
  const html = FactionUI.renderCandidates([], { profiles: [], activeProfileId: '' });
  assert.doesNotMatch(html, /combined candidate intelligence/);
  assert.match(html, /id="ra-faction-profile-clear"[^>]*hidden/);
  assert.match(html, /id="ra-faction-profile-save-search"[^>]*hidden/);
  const active = FactionUI.renderCandidates([], { profiles: [{ profileId: 'f1', name: 'Hitter' }], activeProfileId: 'f1' });
  assert.doesNotMatch(active, /id="ra-faction-profile-clear"[^>]*hidden/);
  assert.doesNotMatch(active, /id="ra-faction-profile-save-search"[^>]*hidden/);
});

test('first run: desktop has no dead mobile menu button and Settings leads with the essentials', async () => {
  const server = await serve();
  const port = server.address().port;
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    await boot(page, port, { width: 1440, height: 900 });
    assert.equal(await page.$eval('#ra-mobile-menu', el => getComputedStyle(el).display), 'none', 'the mobile-only menu button does nothing on desktop and should not be shown');

    await openSettings(page);
    const layout = await page.evaluate(() => {
      const sections = [...document.querySelectorAll('.ra-settings details[data-settings-section]')];
      const first = sections[0];
      const advanced = document.querySelector('.ra-settings [data-settings-group="advanced"]');
      const optionalGroups = [...document.querySelectorAll('[data-settings-section="optional-features"] [data-optional-group]')].map(group => group.dataset.optionalGroup);
      return {
        firstId: first?.dataset.settingsSection,
        firstOpen: !!first?.open,
        firstHas: ['ra-set-key', 'ra-setting-company-message', 'ra-setting-faction-message', 'ra-setting-own-company', 'ra-setting-faction-name'].filter(id => first?.querySelector('#' + id)),
        openOthers: sections.slice(1).filter(section => section.open).map(section => section.dataset.settingsSection),
        advancedSections: advanced ? [...advanced.querySelectorAll('details[data-settings-section]')].map(section => section.dataset.settingsSection) : [],
        advancedHeading: advanced?.querySelector('.ra-settings-group-title')?.textContent || '',
        scoutHasKey: !!document.querySelector('[data-settings-section="scout"] #ra-set-key'),
        optionalGroups,
        optionalKeys: [...document.querySelectorAll('[data-optional-module]')].map(el => el.dataset.optionalModule)
      };
    });
    assert.equal(layout.firstId, 'essentials', 'Settings should start with the essentials needed to search and message');
    assert.equal(layout.firstOpen, true, 'the essentials section is open by default');
    assert.deepEqual(layout.firstHas, ['ra-set-key', 'ra-setting-company-message', 'ra-setting-faction-message', 'ra-setting-own-company', 'ra-setting-faction-name']);
    assert.deepEqual(layout.openOthers, [], 'every other section starts collapsed');
    assert.equal(layout.scoutHasKey, false, 'the API key control is not buried in Scout');
    assert.match(layout.advancedHeading, /Advanced/);
    for (const id of ['optional-features', 'recruitment', 'scout', 'candidates', 'smart-match', 'data', 'danger']) {
      assert.ok(layout.advancedSections.includes(id), `${id} should be grouped under Advanced`);
    }
    assert.deepEqual(layout.optionalGroups, ['tools'], 'only the kept optional tools are offered');
    assert.deepEqual(layout.optionalKeys, ['companyDiscovery', 'scout', 'smartMatch', 'data'], 'Optional Features lists only kept tools; removed workflow pages have no toggles');

    // Existing user data is untouched: enabling a tool still works through the regrouped list and saving keeps messages.
    await page.evaluate(() => {
      document.querySelector('[data-optional-module="companyDiscovery"]').checked = true;
      document.getElementById('ra-setting-company-message').value = 'Hi {name}, join us.';
      document.getElementById('ra-save-settings').click();
    });
    await page.waitForFunction(() => window.RA_V45App._test.state.settings.optionalModules.companyDiscovery === true, { timeout: 5000 });
    const saved = await page.evaluate(() => ({
      message: window.RA_V45App._test.state.settings.recruitment.companyRecruitmentMessage,
      nav: !!document.querySelector('[data-page="company-discover"]')
    }));
    assert.equal(saved.message, 'Hi {name}, join us.');
    assert.equal(saved.nav, true, 'enabled optional tools still appear in navigation');
    assert.equal(await page.evaluate(() => window.__runtimeErrors), '');

    const mobile = await browser.newPage();
    await boot(mobile, port, { width: 390, height: 844, isMobile: true, hasTouch: true });
    assert.notEqual(await mobile.$eval('#ra-mobile-menu', el => getComputedStyle(el).display), 'none', 'mobile keeps its menu button');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
