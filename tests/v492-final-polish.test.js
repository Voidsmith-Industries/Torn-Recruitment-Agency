const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { indexedDB } = require('fake-indexeddb');

const App = require('../src/v45-app');
const Shared = require('../src/v46-recruitment-shared');

// 4.9.2 re-verification leftovers: Recruit Fit vs Hard baseline failures, Scout History legacy type,
// and the neutral "No Torn player with ID N." search outcome.

function put(db, store, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

test('Recruit Fit pill of a not-eligible row is muted, struck and labelled with the failing criterion', () => {
  const inel = Shared.recruitmentFitCell({ recruitmentFit: 100, recruitmentConfidence: 'High', ineligibleReasons: ['Level ≥ 50'] });
  assert.match(inel, /data-band="inel"/);
  assert.match(inel, /class="vx-fit is-inel"/);
  assert.match(inel, /aria-label="Recruit Fit 100\.0 — not eligible: fails Level ≥ 50"/);
  assert.match(inel, /<s>100\.0<\/s>/, 'the score stays visible but struck through');
  assert.match(inel, /not eligible/);
  assert.doesNotMatch(inel, /data-band="hi"/, 'no bright high band for a not-eligible row');
  const ok = Shared.recruitmentFitCell({ recruitmentFit: 100, recruitmentConfidence: 'High', ineligibleReasons: [] });
  assert.match(ok, /data-band="hi"/, 'eligible rows keep their band');
  assert.doesNotMatch(ok, /not eligible/);
  const unknown = Shared.recruitmentFitCell({ recruitmentFit: null, ineligibleReasons: ['Level ≥ 50'] });
  assert.match(unknown, /data-band="na"/, 'an unknown fit stays Unknown');
});

test('results table renders the muted Fit pill next to the Not eligible chip', () => {
  const row = { userId: '1', name: 'Hi', level: 12, recruitmentFit: 100, recruitmentConfidence: 'High', ineligibleReasons: ['Level ≥ 50'] };
  const html = Shared.renderResults([row], { filters: {}, sort: { key: 'player', direction: 'asc' } }, { domain: 'company', label: 'Company', orgHeader: 'Employment', columns: ['player', 'recruitmentFit', 'message'], contactedStages: [], messageCell: () => '' });
  const fit = (html.match(/<td data-col="fit">([\s\S]*?)<\/td>/) || [])[1] || '';
  assert.match(fit, /data-band="inel"/);
  assert.match(html, /Not eligible/);
});

test('sorting by Recruit Fit puts not-eligible rows after eligible ones in both directions (score maths unchanged)', () => {
  const rows = [
    { userId: '1', name: 'A', recruitmentFit: 100, ineligibleReasons: ['Level ≥ 50'] },
    { userId: '2', name: 'B', recruitmentFit: 40, ineligibleReasons: [] },
    { userId: '3', name: 'C', recruitmentFit: 80 },
    { userId: '4', name: 'D', recruitmentFit: null },
    { userId: '5', name: 'E', recruitmentFit: 20, ineligibleReasons: ['MAN ≥ 10,000'] },
    { userId: '6', name: 'F', recruitmentFit: null, ineligibleReasons: ['Level ≥ 50'] }
  ];
  const ids = list => list.map(row => row.userId);
  assert.deepEqual(ids(Shared.sortRows(rows, { key: 'recruitmentFit', direction: 'desc' })), ['3', '2', '4', '1', '5', '6']);
  assert.deepEqual(ids(Shared.sortRows(rows, { key: 'recruitmentFit', direction: 'asc' })), ['2', '3', '4', '5', '1', '6']);
  assert.equal(rows[0].recruitmentFit, 100, 'rows are not mutated');
  // Other sort keys ignore eligibility.
  assert.deepEqual(ids(Shared.sortRows(rows, { key: 'player', direction: 'asc' })), ['1', '2', '3', '4', '5', '6']);
});

test('Player Card shows the Recruit Fit of a not-eligible player muted with the reason, in hero and header', async () => {
  const dom = new JSDOM('<!doctype html><html><body><aside id="ra-drawer" class="ra-drawer" hidden></aside></body></html>', { url: 'https://www.torn.com/' });
  global.window = dom.window; global.document = dom.window.document;
  const db = await App.openDB(indexedDB);
  App._test.state.db = db;
  App._test.state.settings = App.mergeSettings({});
  App._test.state.playerCard = { domain: 'company', userId: '', pinned: false, popout: false };
  try {
    await put(db, 'companyRecruitmentConfig', { key: 'company', baseline: { criteria: [{ id: 'l', field: 'level', operator: 'gte', value: 50, kind: 'Hard' }] } });
    await put(db, 'playerIntelligence', { userId: '78', name: 'Strong Junior', level: 12, man: 240000, int: 180000, end: 320000, onlineStatus: 'Online', lastActive: Date.now() });
    await put(db, 'companyRecruitment', { userId: '78', domain: 'company', pipelineStage: 'Not Contacted' });
    await App._test.openPlayerCard('company', '78', { force: true });
    const drawer = document.getElementById('ra-drawer');
    const pill = drawer.querySelector('.vx-hero .vx-fit');
    assert.equal(pill.getAttribute('data-band'), 'inel');
    assert.match(pill.getAttribute('aria-label'), /^Recruit Fit \d+\.\d — not eligible: fails Level ≥ 50$/);
    const head = drawer.querySelector('.ra-player-card-score');
    assert.ok(head.classList.contains('is-inel'), 'header score is muted too');
    assert.match(head.getAttribute('aria-label'), /not eligible: fails Level ≥ 50/);
  } finally { db.close(); dom.window.close(); }
});

test('Scout History calls a quarantined pre-4.9.2 snapshot "legacy (unmeasured)", not official', () => {
  const type = App._test.scoutHistoryType;
  assert.equal(typeof type, 'function');
  assert.equal(type({ official: true, originalFitType: 'official', w30: { useractivity: 0 } }, null), 'legacy (unmeasured)');
  assert.equal(type({ statsVersion: 2, official: true, originalFitType: 'official' }, 72.5), 'official');
  assert.equal(type({ statsVersion: 2, originalFitType: 'unmeasured' }, null), 'unmeasured');
  assert.equal(type({ provisionalSource: {}, originalFitType: 'provisional' }, null), 'legacy (unmeasured)');
  assert.equal(type({ statsVersion: 2 }, null), '—');
});

test('an unknown numeric ID search is a neutral "No Torn player with ID N."; real API errors stay red', async () => {
  const deps = request => ({
    syncDomainForums: async () => ({ postsExamined: 0, candidatesCreated: 0, candidatesUpdated: 0 }),
    tornRequest: request,
    persistApiCandidate: async () => true
  });
  App._test.state.searchPaging = {};
  const missing = await App._test.searchCandidates('company', { search: '9999999' }, deps(async () => { throw Object.assign(new Error('Incorrect ID'), { code: 6 }); }));
  assert.deepEqual(missing.warnings, []);
  assert.equal(missing.notFoundId, '9999999');
  assert.deepEqual(App._test.searchOutcome({ apiCount: 0, forumCount: 0, notFoundId: '9999999', warnings: [] }), { text: 'No Torn player with ID 9999999.', error: false });
  App._test.state.searchPaging = {};
  const keyError = await App._test.searchCandidates('company', { search: '9999999' }, deps(async () => { throw Object.assign(new Error('Incorrect key'), { code: 2 }); }));
  assert.deepEqual(keyError.warnings, ['Torn API: Incorrect key']);
  assert.equal(keyError.notFoundId, '');
  const red = App._test.searchOutcome({ apiCount: 0, forumCount: 0, notFoundId: '', warnings: keyError.warnings });
  assert.equal(red.error, true);
  assert.match(red.text, /Torn API: Incorrect key/);
  const fine = App._test.searchOutcome({ apiCount: 3, forumCount: 1, notFoundId: '', warnings: [] });
  assert.equal(fine.error, false);
  assert.match(fine.text, /^Search complete: 3 players from Torn, 1 from forum posts\./);
  assert.equal(App._test.searchOutcome({ more: true, apiCount: 5, warnings: [] }).text, 'Loaded 5 more players from Torn.');
});
