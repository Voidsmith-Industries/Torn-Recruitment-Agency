const test = require('node:test');
const assert = require('node:assert/strict');
const { indexedDB } = require('fake-indexeddb');
const FactionCore = require('../src/v47-faction-core.js');
const CompanyStorage = require('../src/v46-company-storage.js');

let FactionStorage = null;
try {
  FactionStorage = require('../src/v47-faction-storage.js');
} catch {}

function requireStorage() {
  assert.ok(FactionStorage, 'Faction recruitment storage module should exist');
  return FactionStorage;
}

function adapter(db) {
  return {
    get(store, key) {
      return new Promise((resolve, reject) => {
        const q = db.transaction(store, 'readonly').objectStore(store).get(key);
        q.onsuccess = () => resolve(q.result || null);
        q.onerror = () => reject(q.error);
      });
    },
    getAll(store) {
      return new Promise((resolve, reject) => {
        const q = db.transaction(store, 'readonly').objectStore(store).getAll();
        q.onsuccess = () => resolve(q.result || []);
        q.onerror = () => reject(q.error);
      });
    },
    put(store, value) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(tx.error);
      });
    },
    delete(store, key) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    }
  };
}

async function openDb() {
  const Storage = requireStorage();
  const name = `ra-faction-storage-${Date.now()}-${Math.random()}`;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, Storage.DB_VERSION);
    req.onupgradeneeded = () => Storage.applyUpgrade(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

test('DB15 declares only additive Faction support stores', () => {
  const Storage = requireStorage();
  assert.equal(Storage.DB_VERSION, 15);
  assert.deepEqual(Object.keys(Storage.STORE_DEFINITIONS).sort(), [
    'factionCampaigns',
    'factionRecruitmentConfig',
    'factionRecruitmentSessions',
    'factionSpecialistProfiles'
  ]);
  assert.equal(Storage.STORE_DEFINITIONS.factionSpecialistProfiles.keyPath, 'profileId');
  assert.equal(Storage.STORE_DEFINITIONS.factionCampaigns.keyPath, 'campaignId');
  assert.equal(Storage.STORE_DEFINITIONS.factionRecruitmentConfig.keyPath, 'key');
  assert.equal(Storage.STORE_DEFINITIONS.factionRecruitmentSessions.keyPath, 'sessionId');
});

test('DB15 upgrade preserves DB13 foundation and DB14 Company stores', async () => {
  const Storage = requireStorage();
  const name = `ra-faction-upgrade-${Date.now()}-${Math.random()}`;
  const old = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 14);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('playerIntelligence', { keyPath: 'userId' });
      db.createObjectStore('companyRecruitment', { keyPath: 'userId' });
      db.createObjectStore('factionRecruitment', { keyPath: 'userId' });
      CompanyStorage.applyUpgrade(db);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  old.close();

  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 15);
    req.onupgradeneeded = () => Storage.applyUpgrade(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const names = [...db.objectStoreNames];
  for (const store of [
    'playerIntelligence','companyRecruitment','factionRecruitment',
    'companyVacancies','companyCampaigns','companyRecruitmentConfig','companyRecruitmentSessions',
    'factionSpecialistProfiles','factionCampaigns','factionRecruitmentConfig','factionRecruitmentSessions'
  ]) assert.ok(names.includes(store), store);
  db.close();
});

test('Faction config normalizes baseline thresholds and Opportunity weights under one record', async () => {
  const Storage = requireStorage();
  const db = await openDb();
  const repos = Storage.createRepositories(adapter(db), FactionCore);
  const saved = await repos.config.save({
    baseline: { criteria: [{ id: 'level', field: 'level', kind: 'Hard', operator: 'gte', value: 50 }] },
    stageThresholds: { Prospect: 7, Evaluating: 3 },
    opportunityWeights: { match: 30, fit: 20 }
  });

  assert.equal(saved.key, 'faction');
  assert.equal(saved.baseline.criteria[0].kind, 'Hard');
  assert.equal(saved.stageThresholds.Prospect, 7);
  assert.equal((await repos.config.get()).opportunityWeights.match, 30);
  db.close();
});

test('specialist profile repository preserves approved lifecycle states and lists active profiles only', async () => {
  const Storage = requireStorage();
  const db = await openDb();
  const repos = Storage.createRepositories(adapter(db), FactionCore);
  await repos.profiles.save({ profileId: 'rw', name: 'RW Fighter', status: 'Active', criteria: [{ field: 'rwHits30', kind: 'Hard', value: 50 }] });
  await repos.profiles.save({ profileId: 'old', name: 'Old', status: 'Archived' });

  assert.equal((await repos.profiles.get('rw')).status, 'Active');
  assert.deepEqual((await repos.profiles.listActive()).map(profile => profile.profileId), ['rw']);
  db.close();
});

test('Faction campaigns and recruitment sessions remain separate durable entities', async () => {
  const Storage = requireStorage();
  const db = await openDb();
  const repos = Storage.createRepositories(adapter(db), FactionCore);
  const campaign = await repos.campaigns.save({
    campaignId: 'c1',
    title: 'RW Recruitment',
    candidateIds: ['2','1','2'],
    profileId: 'rw',
    status: 'Active'
  });
  const session = await repos.sessions.save({
    sessionId: 's1',
    candidateIds: ['2','1'],
    cursor: 0,
    status: 'Active'
  });

  assert.deepEqual(campaign.candidateIds, ['2','1']);
  assert.equal(campaign.profileId, 'rw');
  assert.deepEqual(session.candidateIds, ['2','1']);
  assert.equal((await repos.campaigns.list()).length, 1);
  assert.equal((await repos.sessions.list()).length, 1);
  db.close();
});


test('Faction config preserves active Results specialist profile', () => {
  const Storage=requireStorage();
  const row=Storage.normalizeConfig({activeResultsProfileId:' rw-1 '});
  assert.equal(row.activeResultsProfileId,'rw-1');
});
