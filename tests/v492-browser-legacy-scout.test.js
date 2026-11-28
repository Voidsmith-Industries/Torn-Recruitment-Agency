// 4.9.2 follow-up: a pre-fix Scout record with zeros shows Unknown in results and the Player Card; a v2 record shows values.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openPage, getOne } = require('./v492-browser-harness');

const put = (page, store, value) => page.evaluate((store, value) => new Promise(r => { const q = RA_V45App._test.state.db.transaction(store, 'readwrite').objectStore(store).put(value); q.onsuccess = r; }), store, value);

test('pre-4.9.2 Scout zeros read as Unknown after boot; v2 Scout values still show', { timeout: 90000 }, async () => {
  const seed = await openPage();
  const zeros = { fit: 0, fitType: 'official', activity30: 0, xanax30: 0, refills30: 0, attacks30: 0, rwHits30: 0, networth: 0, activeStreak: 0, bestActiveStreak: 0 };
  await put(seed, 'playerIntelligence', { userId: '910001', name: 'LegacyZero', level: 30, lastScoutAt: 1, lastObservedAt: 1, sources: ['scout'], ...zeros });
  await put(seed, 'playerIntelligence', { userId: '910002', name: 'FreshV2', level: 31, lastScoutAt: 2, lastObservedAt: 2, sources: ['scout'], scoutStatsVersion: 2, fit: 64, fitType: 'official', activity30: 118, xanax30: 57, refills30: 20, attacks30: 150, rwHits30: 12, networth: 5e9, activeStreak: 30, bestActiveStreak: 90 });
  for (const userId of ['910001', '910002']) {
    await put(seed, 'companyRecruitment', { userId, domain: 'company', pipelineStage: 'Not Contacted', availability: 'Unknown', createdAt: 1, updatedAt: 1 });
    await put(seed, 'factionRecruitment', { userId, domain: 'faction', pipelineStage: 'Prospect', availability: 'Unknown', createdAt: 1, updatedAt: 1 });
  }
  await seed.close();

  const page = await openPage();
  const legacy = await getOne(page, 'playerIntelligence', '910001');
  assert.equal(legacy.xanax30, null);
  assert.equal(legacy.fit, null);
  assert.equal(legacy.legacyScoutFields.xanax30, 0, 'original values kept aside, not deleted');
  await page.evaluate(async () => { await RA_V45App._test.openApp(); await RA_V45App._test.navigate('company-candidates', false); });
  await page.waitForSelector('#ra-content table.ra-core-results tbody tr [data-player-card]');
  const cells = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('#ra-content table.ra-core-results thead th')].map(th => th.textContent.trim());
    const col = name => heads.findIndex(h => h.startsWith(name));
    const row = n => [...document.querySelectorAll('#ra-content table.ra-core-results tbody tr')].find(tr => tr.textContent.includes(n));
    const get = (n, c) => row(n)?.children[col(c)]?.textContent.trim();
    return { legacyActive: get('LegacyZero', '30d Active'), legacyStreak: get('LegacyZero', 'Streak'), v2Active: get('FreshV2', '30d Active') };
  });
  assert.equal(cells.legacyActive, '—');
  assert.equal(cells.legacyStreak, '—');
  assert.notEqual(cells.v2Active, '—');
  assert.match(cells.v2Active, /118/);
  const card = async userId => { await page.evaluate(id => RA_V45App._test.openPlayerCard('faction', id), userId); await page.waitForFunction(id => !document.getElementById('ra-drawer').hidden && document.getElementById('ra-drawer').textContent.includes(id === '910001' ? 'LegacyZero' : 'FreshV2'), {}, userId); return page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#ra-drawer .ra-detail-grid span')].map(s => [s.childNodes[0]?.textContent.trim(), s.querySelector('b')?.textContent.trim()]))); };
  const legacyCard = await card('910001');
  assert.equal(legacyCard['Xanax 30d'], '—');
  assert.equal(legacyCard['Net Worth'], '—');
  assert.equal(legacyCard['Scout Fit'], '—');
  const v2Card = await card('910002');
  assert.notEqual(v2Card['Xanax 30d'], '—');
  assert.notEqual(v2Card['Scout Fit'], '—');
  await page.close();
});
