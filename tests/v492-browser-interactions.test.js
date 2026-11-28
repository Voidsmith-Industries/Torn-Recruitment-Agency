// 4.9.2 interaction fixes: Add Candidate name, toasts, HOF label, Escape, private chat, dock, error toasts (L8, L9, L12, L13, L16, L17, L20).
const test = require('node:test');
const assert = require('node:assert/strict');
const { openPage, settle, getAll, getOne } = require('./v492-browser-harness');

test('L8 Forum Discovery Add Candidate keeps the typed name', { timeout: 60000 }, async () => {
  const page = await openPage();
  await page.evaluate(async () => { const t = RA_V45App._test; await t.saveSettings({ optionalModules: { ...t.state.settings.optionalModules, companyDiscovery: true } }); await t.openApp(); await t.navigate('company-discover', false); });
  await page.waitForSelector('#ra-add-candidate');
  await page.click('#ra-add-candidate');
  await page.waitForSelector('#ra-add-id');
  await page.$eval('#ra-add-id', el => { el.value = '777001'; });
  await page.$eval('#ra-add-name', el => { el.value = 'TypedName'; });
  await page.click('#ra-add-save');
  await page.waitForFunction(() => document.getElementById('ra-modal').hidden, { timeout: 10000 });
  const player = await getOne(page, 'playerIntelligence', '777001');
  assert.equal(player?.name, 'TypedName');
  await page.close();
});

test('L9 toasts never cover or swallow clicks on the title bar controls', { timeout: 60000 }, async () => {
  const page = await openPage(() => null, { width: 1000, height: 700 });
  const result = await page.evaluate(async () => {
    const t = RA_V45App._test; await t.openApp();
    const app = document.getElementById('ra-app'); app.style.left = (innerWidth - app.offsetWidth - 4) + 'px'; app.style.top = '4px';
    t.toast('A fairly long toast message that would otherwise sit right over the window controls', true);
    const out = {};
    for (const id of ['ra-close', 'ra-settings-button']) { const r = document.getElementById(id).getBoundingClientRect(); out[id] = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.id; }
    out.pointer = getComputedStyle(document.getElementById('ra-toastbox')).pointerEvents;
    return out;
  });
  assert.equal(result['ra-close'], 'ra-close');
  assert.equal(result['ra-settings-button'], 'ra-settings-button');
  assert.equal(result.pointer, 'none');
  await page.close();
});

test('L12 Discover Workstat button label follows the HOF offset after re-render', { timeout: 60000 }, async () => {
  const page = await openPage(url => url.pathname === '/v2/torn/hof' ? { hof: Array.from({ length: 3 }, (_, i) => ({ id: 600000 + i, name: `Hof${i}`, level: 20, value: 100000 })) } : null);
  await page.evaluate(async () => { await RA_V45App._test.openApp(); await RA_V45App._test.navigate('company-candidates', false); });
  await page.waitForSelector('#ra-company-hof-discover');
  await page.$eval('#ra-company-hof-discover', el => { window.__b = el; el.click(); });
  await page.waitForFunction(() => !window.__b.isConnected, { timeout: 20000 });
  await settle(page, 300);
  assert.equal(await page.$eval('#ra-company-hof-discover', el => el.textContent.trim()), 'Discover Next 100');
  await page.close();
});

test('L13 Escape in an app text field blurs it instead of closing the window', { timeout: 60000 }, async () => {
  const page = await openPage();
  await page.evaluate(async () => { await RA_V45App._test.openApp(); await RA_V45App._test.navigate('company-candidates', false); });
  await page.waitForSelector('#ra-company-filter-search');
  await page.focus('#ra-company-filter-search');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.getElementById('ra-app').style.display), 'block');
  assert.notEqual(await page.evaluate(() => document.activeElement?.id), 'ra-company-filter-search');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.getElementById('ra-app').style.display), 'none');
  await page.close();
});

test('L16 private-chat draft finds the input in nested Torn chat DOM', { timeout: 60000 }, async () => {
  const page = await openPage();
  const found = await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', `<div class="chat-box_abc" id="cb"><div class="chat-box-header_x"><a href="/profiles.php?XID=456">Bob</a></div><div class="chat-box-body_y"><div class="chat-box-footer_z"><textarea id="nested-input" style="width:200px;height:30px"></textarea></div></div></div>
      <div class="chat-box_abc"><div class="chat-box-header_x"><a href="/profiles.php?XID=999">Eve</a></div><div class="chat-box-footer_z"><textarea id="other-input" style="width:200px;height:30px"></textarea></div></div>`);
    return { bob: RA_V45App._test.findPrivateChatInput('456')?.id || null, eve: RA_V45App._test.findPrivateChatInput('999')?.id || null, none: RA_V45App._test.findPrivateChatInput('123')?.id || null };
  });
  assert.deepEqual(found, { bob: 'nested-input', eve: 'other-input', none: null });
  await page.close();
});

test('L17 the dock comes back when Torn replaces #sidebarroot itself', { timeout: 60000 }, async () => {
  const page = await openPage();
  await page.waitForFunction(() => document.querySelector('#sidebar [data-voidsmith-dock="recruitment-agency"]'), { timeout: 5000 });
  await page.evaluate(() => { const old = document.getElementById('sidebarroot'); const fresh = document.createElement('div'); fresh.id = 'sidebarroot'; fresh.innerHTML = '<div id="sidebar"><div class="toggle-block">Info</div><div class="toggle-block">Areas</div></div>'; old.replaceWith(fresh); });
  await page.waitForFunction(() => document.querySelector('#sidebar [data-voidsmith-dock="recruitment-agency"]'), { timeout: 3000 });
  await page.close();
});

test('L20 Save Search without a profile toasts the UI term instead of an alert', { timeout: 60000 }, async () => {
  const page = await openPage();
  await page.evaluate(async () => { await RA_V45App._test.openApp(); await RA_V45App._test.navigate('company-candidates', false); });
  await page.waitForSelector('#ra-company-profile-save-search');
  await page.evaluate(() => { document.getElementById('ra-company-profile-select').value = ''; const b = document.getElementById('ra-company-profile-save-search'); b.disabled = false; b.click(); });
  await settle(page, 300);
  assert.deepEqual(await page.evaluate(() => window.__alerts), []);
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('.ra-toast.bad')].some(t => /Choose a Recruitment profile first/.test(t.textContent))));
  await page.close();
});
