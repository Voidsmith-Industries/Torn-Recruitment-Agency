const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const puppeteer = require('puppeteer-core');
const sourceCompatibleBoot = require('./source-compatible-boot');

// v4.9.2 visuals in a real browser: light/dark contrast from computed styles, phone cards at 390px,
// Message reachable in the wide Expanded table, and prefers-reduced-motion.
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
    res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h4>Torn</h4>${scripts}
      <script>window.alert=()=>{};window.confirm=()=>true;window.prompt=()=>'';window.open=()=>null;window.GM_xmlhttpRequest=o=>setTimeout(()=>o.onerror&&o.onerror({}),5);</script></body></html>`);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function withApp(viewport, run, media = []) {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
    await page.setViewport(viewport);
    if (media.length) await page.emulateMediaFeatures(media);
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.hostname === '127.0.0.1') return request.continue();
      return request.abort();
    });
    await page.goto(base + '/index.php', { waitUntil: 'networkidle0' });
    await page.addScriptTag({ content: BOOT });
    await page.waitForFunction(() => window.RA_V45App?._test?.state?.db && window.RA_V45App._test.state.mounted, { timeout: 10000 });
    await page.evaluate(async () => {
      await RA_V45App._test.openApp();
      const repos = RA_V45App._test.repositories;
      await repos.company.ensure('900001', { name: 'Ashgrove', stats: { man: 70412, int: 52990, end: 96289 } });
      await repos.company.ensure('900002', { name: 'Brimwell', stats: { man: 3794, int: null, end: 19588 } });
      for (let i = 0; i < 6; i++) await repos.company.ensure(String(900100 + i), { name: `Unknown${i}` });
      await RA_V45App._test.navigate('company-candidates', false);
    });
    await page.waitForSelector('#ra-content table.ra-core-results tbody tr.vx-row');
    await run(page);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

// Contrast of each element's text against the first opaque background (solid colour or gradient stops) behind it.
function contrastReport(selectors) {
  const parse = value => (value.match(/rgba?\([^)]*\)/g) || []).map(c => c.match(/[\d.]+/g).map(Number)).map(([r, g, b, a = 1]) => ({ r, g, b, a }));
  const lum = ({ r, g, b }) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const backgrounds = el => {
    for (let node = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const stops = parse(style.backgroundImage).filter(c => c.a >= 0.5);
      if (stops.length) return stops;
      const [color] = parse(style.backgroundColor);
      if (color && color.a >= 0.5) return [color];
    }
    return [{ r: 255, g: 255, b: 255, a: 1 }];
  };
  return selectors.map(selector => {
    const el = document.querySelector(selector);
    if (!el) return { selector, missing: true };
    const [fg] = parse(getComputedStyle(el).color);
    const worst = Math.min(...backgrounds(el).map(bg => ratio(fg, bg)));
    return { selector, ratio: Math.round(worst * 100) / 100, fg: getComputedStyle(el).color, bg: JSON.stringify(backgrounds(el)) };
  });
}

const KEY_TEXT = [
  '.ra-title-copy strong', '#ra-workspace-toggle', '#ra-nav button.active', '#ra-page-title', '.ra-results-panel h3',
  '.ra-results-panel .ra-panel-head p', '#ra-company-filter-search', '.vx-kpi b', '.vx-kpi small', '.vx-kpis-cap',
  'td[data-col="player"] a', 'td[data-col="player"] small', 'td[data-col="man"] .vx-stat b', 'td[data-col="man"] .vx-unk',
  'td[data-col="org"] .vx-chip', 'td[data-col="message"] .ra-btn', 'th[data-col="player"] .ra-sort-button'
];
const CARD_TEXT = ['.ra-player-card-domain', '.ra-drawer-head b', '.vx-hero-id b', '.vx-hbar b', '.vx-hbar em', '.ra-detail-grid span', '.ra-detail-grid b', '#ra-card-recruit'];

for (const theme of ['light', 'dark']) {
  test(`${theme} mode: key text, Player Card and Settings meet 4.5:1 contrast from computed styles`, { timeout: 90000 }, async () => {
    await withApp({ width: 1440, height: 900 }, async page => {
      await page.evaluate(t => { RA_V45App._test.state.settings.theme = t; document.documentElement.dataset.raTheme = t; }, theme);
      await new Promise(resolve => setTimeout(resolve, 400)); // let the 0.12s row hover transition settle
      const check = async (selectors, where) => {
        const report = await page.evaluate(contrastReport, selectors);
        for (const item of report) {
          assert.ok(!item.missing, `${where}: ${item.selector} should exist`);
          assert.ok(item.ratio >= 4.5, `${theme} ${where}: ${item.selector} contrast ${item.ratio} < 4.5 (${item.fg} on ${item.bg})`);
        }
      };
      await check(KEY_TEXT, 'results');
      await page.$eval('#ra-content [data-player-card="900002"]', el => el.click());
      await page.waitForSelector('#ra-drawer:not([hidden]) .vx-hero');
      await check(CARD_TEXT, 'Player Card');
      await page.$eval('#ra-close-drawer', el => el.click());
      await page.$eval('#ra-settings-button', el => el.click());
      await page.waitForSelector('.ra-settings summary');
      await check(['.ra-settings summary', '.ra-settings .ra-field label', '.ra-settings .ra-field input, .ra-settings .ra-field select'], 'Settings');
    });
  });
}

test('phone (390px): each result is a card with MAN/INT/END and a full-width Message, without sideways scrolling', { timeout: 90000 }, async () => {
  await withApp({ width: 390, height: 844, isMobile: true, hasTouch: true }, async page => {
    const layout = await page.evaluate(() => {
      const wrap = document.querySelector('.ra-results-panel .ra-table-wrap');
      const row = document.querySelector('#ra-content tr.vx-row');
      const rowBox = row.getBoundingClientRect(), pad = parseFloat(getComputedStyle(row).paddingLeft) + parseFloat(getComputedStyle(row).paddingRight);
      const shown = col => getComputedStyle(row.querySelector(`td[data-col="${col}"]`)).display !== 'none';
      const button = row.querySelector('td[data-col="message"] .ra-btn').getBoundingClientRect();
      return {
        display: getComputedStyle(row).display, head: getComputedStyle(document.querySelector('#ra-content table.ra-core-results thead')).display,
        visible: ['player', 'man', 'int', 'end', 'fit', 'lastActive', 'message'].filter(shown),
        hidden: ['level', 'age', 'drug', 'activity30', 'activeStreak', 'org', 'source', 'contacted'].filter(col => !shown(col)),
        overflow: wrap.scrollWidth - wrap.clientWidth, rowRight: rowBox.right, vw: window.innerWidth,
        buttonShare: button.width / (rowBox.width - pad), buttonHeight: button.height,
        statLabel: getComputedStyle(row.querySelector('td[data-col="end"]'), '::before').content
      };
    });
    assert.equal(layout.display, 'grid');
    assert.equal(layout.head, 'none');
    assert.deepEqual(layout.visible, ['player', 'man', 'int', 'end', 'fit', 'lastActive', 'message']);
    assert.deepEqual(layout.hidden, ['level', 'age', 'drug', 'activity30', 'activeStreak', 'org', 'source', 'contacted']);
    assert.ok(layout.overflow <= 1, `results do not scroll sideways (overflow ${layout.overflow}px)`);
    assert.ok(layout.rowRight <= layout.vw, 'card fits the viewport');
    assert.ok(layout.buttonShare > 0.98, `Message spans the card (${layout.buttonShare})`);
    assert.ok(layout.buttonHeight >= 36, 'Message is a comfortable touch target');
    assert.equal(layout.statLabel, '"END"');
  });
});

test('desktop Expanded: Player and Message stay reachable while the wide table scrolls', { timeout: 90000 }, async () => {
  await withApp({ width: 1180, height: 820 }, async page => {
    const box = () => page.evaluate(() => {
      const wrap = document.querySelector('.ra-results-panel .ra-table-wrap').getBoundingClientRect();
      const row = document.querySelector('#ra-content tr.vx-row');
      const r = sel => row.querySelector(sel).getBoundingClientRect();
      return { wrap: [wrap.left, wrap.right], message: [r('td[data-col="message"] .ra-btn').left, r('td[data-col="message"] .ra-btn').right], player: [r('td[data-col="player"] a').left, r('td[data-col="player"] a').right], wide: document.querySelector('.ra-results-panel .ra-table-wrap').scrollWidth > document.querySelector('.ra-results-panel .ra-table-wrap').clientWidth };
    });
    const start = await box();
    assert.ok(start.wide, 'the Expanded table is wider than its panel');
    assert.ok(start.message[0] >= start.wrap[0] && start.message[1] <= start.wrap[1], `Message is visible without scrolling ${JSON.stringify(start)}`);
    await page.$eval('.ra-results-panel .ra-table-wrap', el => { el.scrollLeft = el.scrollWidth; });
    const end = await box();
    assert.ok(end.player[0] >= end.wrap[0] - 1 && end.player[1] <= end.wrap[1], `Player stays visible when scrolled right ${JSON.stringify(end)}`);
    assert.ok(end.message[1] <= end.wrap[1] + 1, 'Message still visible when scrolled right');
  });
});

test('prefers-reduced-motion turns off row transitions', { timeout: 60000 }, async () => {
  await withApp({ width: 1440, height: 900 }, async page => {
    const duration = await page.$eval('#ra-content tr.vx-row td', el => getComputedStyle(el).transitionDuration);
    assert.equal(duration, '0s');
  }, [{ name: 'prefers-reduced-motion', value: 'reduce' }]);
});
