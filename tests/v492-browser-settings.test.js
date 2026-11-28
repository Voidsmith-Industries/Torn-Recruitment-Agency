// 4.9.2 settings/meta writes, window geometry, API key and Smart Match entry points (L6, L7, L10, L14, L19).
const test = require('node:test');
const assert = require('node:assert/strict');
const { openPage, settle, getAll, getOne } = require('./v492-browser-harness');

test('L6 concurrent Results view and layout saves never drop each other', { timeout: 60000 }, async () => {
  const page = await openPage();
  const saved = await page.evaluate(async () => {
    const app = RA_V45App._test.platformApp;
    await Promise.all([app.saveResultsView('company', { sort: { key: 'name', dir: 'asc' } }), app.saveResultsView('faction', { sort: { key: 'level', dir: 'desc' } }), app.setResultsLayout('compact')]);
    const meta = await new Promise(r => { const q = RA_V45App._test.state.db.transaction('meta').objectStore('meta').get('global'); q.onsuccess = () => r(q.result); });
    return meta.settings.candidates;
  });
  assert.ok(saved.resultsView.company && saved.resultsView.faction, JSON.stringify(saved.resultsView));
  assert.equal(saved.resultsLayout, 'compact');
  await page.close();
});

test('L7 closing never saves 0x0 geometry and restore keeps title-bar controls on a narrow screen', { timeout: 60000 }, async () => {
  const page = await openPage(() => null, { width: 700, height: 800 });
  const result = await page.evaluate(async () => {
    const t = RA_V45App._test;
    await t.openApp();
    await t.updateMeta(meta => { meta.ui = { windowGeometry: { main: { x: 900, y: 30, width: 900, height: 600 } } }; });
    await t.restoreGeometry();
    const app = document.getElementById('ra-app'); const r = app.getBoundingClientRect(); const close = document.getElementById('ra-close').getBoundingClientRect();
    t.closeApp(); await t.saveGeometry();
    const meta = await new Promise(res => { const q = t.state.db.transaction('meta').objectStore('meta').get('global'); q.onsuccess = () => res(q.result); });
    return { right: r.right, closeRight: close.right, width: innerWidth, saved: meta.ui.windowGeometry.main };
  });
  assert.ok(result.right <= result.width, `window right ${result.right} within ${result.width}`);
  assert.ok(result.closeRight <= result.width, 'close button visible');
  assert.ok(result.saved.width > 0 && result.saved.height > 0, `saved ${JSON.stringify(result.saved)}`);
  await page.close();
});

test('L10 Smart Match entry points are hidden with a hint while Smart Match is off', { timeout: 60000 }, async () => {
  const page = await openPage();
  await page.evaluate(async () => { await RA_V45App._test.openApp(); await RA_V45App._test.navigate('company-candidates', false); });
  await page.waitForSelector('#ra-company-search-apply');
  assert.equal(await page.$('#ra-company-profile-manage'), null, 'Manage Profiles hidden');
  assert.match(await page.$eval('.ra-profile-bar', el => el.textContent), /Smart Match/);
  await page.evaluate(() => RA_V45App._test.navigate('settings', false));
  await page.waitForSelector('#ra-save-settings');
  assert.equal(await page.$('[data-go-page="smart-match"]'), null, 'Open Smart Match hidden');
  await page.evaluate(async () => { const t = RA_V45App._test; await t.saveSettings({ optionalModules: { ...t.state.settings.optionalModules, smartMatch: true } }); await t.navigate('settings', false); });
  await page.waitForSelector('[data-go-page="smart-match"]');
  await page.evaluate(() => RA_V45App._test.navigate('company-candidates', false));
  await page.waitForSelector('#ra-company-profile-manage');
  await page.close();
});

test('L14 cancelling Change API key keeps the old key without an error toast', { timeout: 60000 }, async () => {
  const page = await openPage();
  await page.evaluate(async () => { await RA_V45App._test.openApp(); await RA_V45App._test.navigate('settings', false); window.prompt = () => null; });
  await page.waitForSelector('#ra-set-key');
  await page.click('#ra-set-key');
  await settle(page, 300);
  assert.equal(await page.$('.ra-toast.bad'), null);
  assert.equal(await page.evaluate(() => RA_V45App._test.state.settings.apiKey), 'testkeytestkey01');
  await page.close();
});

test('L19 saving Settings keeps optionalModules keys this version does not know', { timeout: 60000 }, async () => {
  const page = await openPage();
  await page.evaluate(async () => {
    const t = RA_V45App._test;
    await t.updateMeta(meta => { meta.settings.optionalModules = { ...meta.settings.optionalModules, globalIntelligence: true }; });
    t.state.settings = t.mergeSettings((await new Promise(r => { const q = t.state.db.transaction('meta').objectStore('meta').get('global'); q.onsuccess = () => r(q.result); })).settings);
    await t.openApp(); await t.navigate('settings', false);
  });
  await page.waitForSelector('#ra-save-settings');
  await page.click('#ra-save-settings');
  await page.waitForFunction(() => [...document.querySelectorAll('.ra-toast')].some(t => /Settings saved/.test(t.textContent)), { timeout: 10000 });
  const meta = await getOne(page, 'meta', 'global');
  assert.equal(meta.settings.optionalModules.globalIntelligence, true);
  await page.close();
});
