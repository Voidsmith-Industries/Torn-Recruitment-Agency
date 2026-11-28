const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/scout-core');

const historic = (values, timestamp = 1700000000) => ({ personalstats: Object.entries(values).map(([name, value]) => ({ name, value, timestamp })) });

test('L1 extractPersonalStats reads the Torn v2 UserPersonalStatsHistoric array', () => {
  const flat = core.extractPersonalStats(historic({ xantaken: 500, timeplayed: 360000, refills: 40, networth: 5e9 }));
  assert.deepEqual(flat, { xantaken: 500, timeplayed: 360000, refills: 40, networth: 5e9 });
});

test('L1 extractPersonalStats maps nested v2 category objects defensively', () => {
  const flat = core.extractPersonalStats({ personalstats: {
    drugs: { xanax: 500 }, other: { activity: { time: 99999, streak: { current: 4, best: 9 } }, refills: { energy: 40 } },
    networth: { total: 5e9 }, attacking: { attacks: { won: 10, lost: 2 }, faction: { ranked_war_hits: 7 } }, items: { used: { stat_enhancers: 3 } }
  } });
  assert.deepEqual(flat, { xantaken: 500, timeplayed: 99999, activestreak: 4, bestactivestreak: 9, refills: 40, networth: 5e9, attackswon: 10, attackslost: 2, rankedwarhits: 7, statenhancersused: 3 });
});

test('L1 extractPersonalStats ignores non-numeric entries and missing payloads', () => {
  assert.deepEqual(core.extractPersonalStats(null), {});
  assert.deepEqual(core.extractPersonalStats({ personalstats: [{ name: 'xantaken', value: null }, { name: '', value: 3 }] }), {});
});

test('L1 deltaStats uses timeplayed and keeps unknown stats null instead of 0', () => {
  const current = core.extractPersonalStats(historic({ xantaken: 500, timeplayed: 720000, refills: 40 }));
  const past = core.extractPersonalStats(historic({ xantaken: 400, timeplayed: 360000, refills: 30 }));
  const d = core.deltaStats(current, past);
  assert.equal(d.xanax, 100);
  assert.equal(d.activityHours, 100);
  assert.equal(d.refills, 10);
  assert.equal(d.attacks, null);
  assert.equal(d.rwHits, null);
  assert.equal(d.networth, null);
  assert.equal(core.metricsComplete(d), false);
});

test('L1 empty responses never become measured zeros', () => {
  const d = core.deltaStats(core.extractPersonalStats({}), core.extractPersonalStats({}));
  for (const key of core.METRICS) assert.equal(d[key], null, key);
  assert.equal(core.metricsComplete(d), false);
  assert.equal(core.metricsComplete(core.metricsFromTotals({})), false);
});

test('L1 complete v2 windows are measurable and trend ignores unknown metrics', () => {
  const all = v => historic({ xantaken: v, timeplayed: v * 3600, refills: v, attackswon: v, attackslost: 0, rankedwarhits: v, statenhancersused: 0, networth: 1, activestreak: 1, bestactivestreak: 1 });
  const w30 = core.deltaStats(core.extractPersonalStats(all(130)), core.extractPersonalStats(all(100)));
  assert.equal(core.metricsComplete(w30), true);
  assert.equal(w30.activityHours, 30);
  const trend = core.computeTrend({ xanax: 7, activityHours: null, refills: null, attacks: null, rwHits: null }, w30);
  assert.deepEqual(Object.keys(trend.components), ['xanax']);
  assert.equal(core.projectWindow({ xanax: null, activityHours: 1, refills: 1, attacks: 1, rwHits: 1 }, 7).xanax, null);
});
