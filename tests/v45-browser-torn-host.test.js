const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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
  throw new Error('No Chrome/Chromium executable found.');
}

async function physicalClick(page, selector) {
  await page.waitForSelector(selector, { visible: true });
  const point = await page.$eval(selector, el => {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      x,
      y,
      ok: hit === el || !!(hit && el.contains(hit)),
      hit: hit && (hit.id || hit.className || hit.tagName)
    };
  });
  assert.equal(point.ok, true, `${selector} is covered by ${String(point.hit)}`);
  await page.mouse.click(point.x, point.y);
}

test('public v4.7.2 runtime remains physically clickable on the real Torn host page', { timeout: 90000 }, async () => {
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    const browserErrors = [];
    page.on('pageerror', error => browserErrors.push(String(error)));

    const response = await page.goto('https://www.torn.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });
    assert.ok(response, 'Torn should return a response');
    assert.ok(response.status() < 500, `Torn returned HTTP ${response.status()}`);

    await page.evaluate(() => {
      window.alert = () => {};
      window.confirm = () => true;
      window.prompt = () => '';
      window.open = () => null;
    });

    for (const file of MODULES) {
      await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'src', file), 'utf8') });
    }
    await page.addScriptTag({ content: BOOT });

    await page.waitForFunction(() => {
      if (!document.getElementById('ra-app')) return false;
      return ['#ra-sidebar-launcher', '#ra-launch'].some(selector => {
        const el = document.querySelector(selector);
        return el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
      });
    }, { timeout: 15000 });

    const launcher = await page.evaluate(() => {
      for (const selector of ['#ra-sidebar-launcher', '#ra-launch']) {
        const el = document.querySelector(selector);
        if (el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden') return selector;
      }
      return '';
    });
    assert.ok(launcher, 'visible Recruitment Agency launcher should exist on Torn');

    await physicalClick(page, launcher);
    assert.equal(await page.$eval('#ra-app', el => getComputedStyle(el).display), 'block');

    await physicalClick(page, '[data-page="company-candidates"]');
    await page.waitForFunction(() => document.getElementById('ra-page-title')?.textContent === 'Company Candidates', { timeout: 10000 });
    await physicalClick(page, '#ra-workspace-domain');
    await page.select('#ra-workspace-domain', 'faction');
    await page.waitForFunction(() => document.getElementById('ra-page-title')?.textContent === 'Faction Candidates', { timeout: 10000 });
    await physicalClick(page, '#ra-workspace-domain');
    await page.select('#ra-workspace-domain', 'company');
    await page.waitForFunction(() => document.getElementById('ra-page-title')?.textContent === 'Company Candidates', { timeout: 10000 });

    await physicalClick(page, '#ra-settings-button');
    await page.waitForFunction(
      () => document.getElementById('ra-page-title')?.textContent === 'Settings',
      { timeout: 10000 }
    );
    await physicalClick(page, '#ra-close');
    assert.equal(await page.$eval('#ra-app', el => getComputedStyle(el).display), 'none');

    const ownErrors = browserErrors.filter(error => /Recruitment Agency|RA_V45|v45-app/i.test(error));
    assert.deepEqual(ownErrors, []);
  } finally {
    await browser.close();
  }
});
