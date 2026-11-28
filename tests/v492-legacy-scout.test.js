// 4.9.2 follow-up: Scout values that pre-4.9.2 builds saved as 0 (Torn v2 stats parsed as flat v1 keys) read as Unknown.
const test = require('node:test');
const assert = require('node:assert/strict');
const Domain = require('../src/v46-domain-core');

test('legacy Scout zeros move aside as legacyScoutFields and read as null; nothing is deleted', () => {
  const legacy = { userId: '1', name: 'Old', level: 30, lastScoutAt: 1, fit: 0, fitType: 'official', activity30: 0, xanax30: 0, refills30: 0, attacks30: 0, rwHits30: 0, networth: 0, activeStreak: 0, bestActiveStreak: 0, man: 0 };
  const { changed, next } = Domain.quarantineLegacyScoutFields(legacy);
  assert.equal(changed, true);
  for (const key of ['fit', 'fitType', 'activity30', 'xanax30', 'refills30', 'attacks30', 'rwHits30', 'networth', 'activeStreak', 'bestActiveStreak']) assert.equal(next[key], null, key);
  assert.deepEqual(next.legacyScoutFields, { fit: 0, fitType: 'official', activity30: 0, xanax30: 0, refills30: 0, attacks30: 0, rwHits30: 0, networth: 0, activeStreak: 0, bestActiveStreak: 0 });
  assert.equal(next.level, 30, 'profile facts are kept');
  assert.equal(next.man, 0, 'non-Scout fields are never touched');
  assert.equal(Domain.quarantineLegacyScoutFields(next).changed, false, 'idempotent');
});

test('v2 Scout records, legacy non-zero values and never-scouted players are left alone', () => {
  assert.equal(Domain.quarantineLegacyScoutFields({ userId: '2', lastScoutAt: 1, scoutStatsVersion: 2, fit: 0, xanax30: 0 }).changed, false);
  const partial = Domain.quarantineLegacyScoutFields({ userId: '3', lastGlobalAt: 1, fit: 55, fitType: 'official', xanax30: 40, networth: 0 });
  assert.equal(partial.next.fit, 55);
  assert.equal(partial.next.fitType, 'official');
  assert.equal(partial.next.xanax30, 40);
  assert.equal(partial.next.networth, null);
  assert.equal(Domain.quarantineLegacyScoutFields({ userId: '4', fit: 0, xanax30: 0 }).changed, false, 'no Scout/Global provenance');
});

test('a v2 rescout marks the shared record and overwrites quarantined fields', () => {
  const { next } = Domain.quarantineLegacyScoutFields({ userId: '5', lastScoutAt: 1, fit: 0, fitType: 'official', xanax30: 0 });
  const merged = Domain.mergePlayerIntelligence(next, { fit: 72, fitType: 'official', xanax30: 60, scoutStatsVersion: 2, lastScoutAt: 2 }, 'scout', 2);
  assert.equal(merged.fit, 72);
  assert.equal(merged.xanax30, 60);
  assert.equal(merged.scoutStatsVersion, 2);
  assert.equal(Domain.quarantineLegacyScoutFields(merged).changed, false);
});
