// 4.9.2 Scout against Torn v2 (L1-L3).
const test = require('node:test');
const assert = require('node:assert/strict');
const { openPage, settle, getAll, getOne } = require('./v492-browser-harness');

function scoutApi({ age = 400, empty = false, delay = 0 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  return async url => {
    if (delay) await new Promise(r => setTimeout(r, delay));
    const m = url.pathname.match(/^\/v2\/user\/(\d+)\/(profile|personalstats)$/);
    if (!m) return null;
    if (m[2] === 'profile') return { profile: { id: Number(m[1]), name: `Scouted${m[1]}`, level: 40, age, faction_id: 801, status: { state: 'Okay' }, last_action: { status: 'Online', timestamp: now } } };
    if (empty) return { personalstats: [] };
    const ts = Number(url.searchParams.get('timestamp') || now);
    const daysAgo = Math.round((now - ts) / 86400);
    const base = daysAgo >= 30 ? 0 : daysAgo >= 7 ? 46 : 60; // 60 xanax over 30 days, 14 in the last 7
    const values = { xantaken: 1000 + base, timeplayed: 3600 * (5000 + base * 2), refills: 200 + base, statenhancersused: 3, attackswon: 900 + base * 3, attackslost: 50 + base / 2, rankedwarhits: 100 + base, networth: 5e9, activestreak: 30, bestactivestreak: 90 };
    const wanted = String(url.searchParams.get('stat') || '').split(',');
    return { personalstats: wanted.filter(name => name in values).map(name => ({ name, value: values[name], timestamp: ts })) };
  };
}

test('L1/L3 Scout uses Torn v2 profile + personalstats routes, reads the historic array and never enqueues Global rows', { timeout: 60000 }, async () => {
  const page = await openPage(scoutApi());
  const snapshot = await page.evaluate(() => RA_V45App._test.scoutPlayer(424242, true));
  const paths = page.log.map(u => u.pathname + '?' + u.searchParams.toString());
  assert.ok(page.log.some(u => u.pathname === '/v2/user/424242/profile'), paths.join('\n'));
  const stats = page.log.filter(u => u.pathname === '/v2/user/424242/personalstats');
  assert.equal(stats.length, 3, 'current + 7-day + 30-day history');
  for (const u of page.log) assert.equal(u.searchParams.has('selections'), false, 'no v1 selections param');
  assert.ok(stats.every(u => u.searchParams.get('stat').split(',').includes('timeplayed') && !u.searchParams.get('stat').includes('useractivity')));
  assert.ok(stats.every(u => u.searchParams.get('stat').split(',').length <= 10));
  assert.equal(snapshot.official, true);
  assert.equal(snapshot.w30.xanax, 60);
  assert.equal(snapshot.w30.activityHours, 120);
  assert.equal(snapshot.w7.xanax, 14);
  assert.ok(snapshot.currentFit > 0, `measured fit ${snapshot.currentFit}`);
  const player = await getOne(page, 'playerIntelligence', '424242');
  assert.equal(player.fitType, 'official');
  assert.equal(player.xanax30, 60);
  assert.equal((await getAll(page, 'globalSyncQueue')).length, 0, 'hidden Global Intelligence gets no new queue rows');
  await page.close();
});

test('L1 Scout with no returned stats stays Unknown: no official flag, no Fit 0', { timeout: 60000 }, async () => {
  const page = await openPage(scoutApi({ empty: true }));
  const snapshot = await page.evaluate(() => RA_V45App._test.scoutPlayer(434343, true));
  assert.equal(snapshot.official, false);
  assert.equal(snapshot.currentFit, null);
  assert.equal(snapshot.originalFitType, 'unmeasured');
  const player = await getOne(page, 'playerIntelligence', '434343');
  assert.equal(player.fit ?? null, null, 'no made-up Fit is written to shared intelligence');
  assert.equal(player.xanax30 ?? null, null);
  assert.equal(player.name, 'Scouted434343');
  await page.close();
});

test('L1 Settings cache diagnostic uses the v2 personalstats route', { timeout: 60000 }, async () => {
  const page = await openPage(scoutApi());
  await page.evaluate(() => { window.prompt = () => '515151'; });
  const verdict = await page.evaluate(() => RA_V45App._test.runCacheDiagnostic({ waitMs: 10 }));
  assert.ok(['flat', 'cached', 'clear', 'odd'].includes(verdict));
  const stats = page.log.filter(u => u.pathname === '/v2/user/515151/personalstats');
  assert.equal(stats.length, 3);
  assert.ok(stats.every(u => u.searchParams.get('timestamp') && u.searchParams.get('stat').includes('timeplayed')));
  await page.close();
});

test('L2 Scout Pause/Cancel enable while running and Queue/API counters update live', { timeout: 60000 }, async () => {
  const page = await openPage(scoutApi({ delay: 300 }));
  await page.evaluate(async () => { await RA_V45App._test.saveSettings({ optionalModules: { ...RA_V45App._test.state.settings.optionalModules, scout: true } }); await RA_V45App._test.openApp(); await RA_V45App._test.navigate('scout', false); });
  await page.waitForSelector('#ra-run-scout');
  await page.$eval('#ra-scout-ids', el => { el.value = '111, 222'; });
  await page.click('#ra-run-scout');
  await page.waitForFunction(() => Number(RA_V45App._test.state.scout.calls) >= 2, { timeout: 10000 });
  const live = await page.evaluate(() => ({ pause: document.getElementById('ra-pause-scout').disabled, cancel: document.getElementById('ra-cancel-scout').disabled, queue: document.getElementById('ra-scout-queue')?.textContent, calls: document.getElementById('ra-scout-calls')?.textContent }));
  assert.equal(live.pause, false, 'Pause usable during a run');
  assert.equal(live.cancel, false, 'Cancel usable during a run');
  assert.match(live.queue, /^\d\/2$/);
  assert.notEqual(live.calls, '0');
  await page.click('#ra-cancel-scout');
  await page.waitForFunction(() => !RA_V45App._test.state.scout.running, { timeout: 15000 });
  await page.close();
});
