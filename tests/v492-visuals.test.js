const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { indexedDB } = require('fake-indexeddb');

const App = require('../src/v45-app');
const Shared = require('../src/v46-recruitment-shared');
const CompanyCore = require('../src/v46-company-core');
const CompanyUI = require('../src/v46-company-ui');
const CompanyPlatform = require('../src/v46-company-platform');
const FactionUI = require('../src/v47-faction-ui');
const FactionPlatform = require('../src/v47-faction-platform');

function put(db, store, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
const cell = (html, col) => (html.match(new RegExp(`<td data-col="${col}">([\\s\\S]*?)</td>`)) || [])[1];

test('V2 criterion editor shows human labels, lists MAN/INT/END and keeps raw keys as values', () => {
  const html = Shared.renderCriterionRow({ field: 'ee', operator: 'gte' }, 'baseline', '', 'ee');
  assert.match(html, /<option value="ee" selected>Employee effectiveness \(EE\)<\/option>/);
  assert.match(html, /<option value="rwHits30" >Ranked-war hits, last 30 days<\/option>/);
  assert.match(html, /<option value="activity30" >Activity, last 30 days<\/option>/);
  for (const key of ['man', 'int', 'end']) assert.ok(Shared.CRITERION_FIELDS.includes(key), `${key} is a criterion field`);
  assert.match(html, /<option value="man" >MAN \(manual labour\)<\/option>/);
  assert.match(html, /<option value="gte" selected>at least \(≥\)<\/option>/);
  assert.doesNotMatch(html, />rwHits30</, 'raw keys are not shown as option text');
  const auto = Shared.renderCriterionRow({ field: 'rwHits30', label: 'rwHits30' }, 'baseline', '', 'ee');
  assert.match(auto, /data-criterion-field="label" value="" placeholder="Ranked-war hits, last 30 days"/, 'a label that is only the raw key is shown as the human placeholder');
  assert.match(Shared.renderCriterionRow({ field: 'level', label: 'Seniority' }), /value="Seniority"/, 'custom labels stay');
});

test('V2 a saved field this version does not list survives a save instead of becoming level', () => {
  const html = Shared.renderCriterionRow({ id: 'x', field: 'legacyStat', operator: 'between', value: 5 }, 'baseline', 'faction-', 'level');
  assert.match(html, /<option value="legacyStat" selected>legacyStat<\/option>/);
  const dom = new JSDOM(`<div id="host">${html}</div>`);
  const [saved] = Shared.readCriteria(dom.window.document.getElementById('host'), 'faction-');
  assert.equal(saved.field, 'legacyStat');
  assert.equal(saved.operator, 'between');
});

test('V2 Company rows failing a Hard criterion show a Not eligible marker with the reason; unknown never fails', () => {
  const criteria = [{ id: 'lvl', field: 'level', operator: 'gte', value: 20, kind: 'Hard', label: 'level' }];
  const rows = CompanyUI.buildCandidateRows(
    [{ userId: '1', domain: 'company' }, { userId: '2', domain: 'company' }, { userId: '3', domain: 'company' }],
    [{ userId: '1', name: 'Low', level: 5 }, { userId: '2', name: 'High', level: 40 }, { userId: '3', name: 'NoLevel' }],
    { eligibilityFor: (record, player) => CompanyCore.evaluateCriteria(criteria, player, []) });
  const byName = Object.fromEntries(rows.map(row => [row.name, row]));
  assert.deepEqual(byName.Low.ineligibleReasons, ['Level ≥ 20']);
  assert.deepEqual(byName.High.ineligibleReasons, []);
  assert.deepEqual(byName.NoLevel.ineligibleReasons, [], 'an unknown fact is not a failure');
  const html = CompanyUI.renderCandidates(rows, { filters: {}, total: 3 });
  const marked = [...html.matchAll(/<tr class="vx-row[^"]*">[\s\S]*?<\/tr>/g)].map(m => m[0]);
  assert.equal(marked.filter(tr => /Not eligible/.test(tr)).length, 1);
  assert.match(marked.find(tr => /Not eligible/.test(tr)), /data-player-card="1"/);
  assert.match(html, /title="Not eligible: fails Hard criteria: Level ≥ 20"/);
});

test('V2 Company baseline MAN/INT/END criteria use candidate work stats and leave unknown stats alone', async () => {
  const db = await App.openDB(indexedDB);
  try {
    await put(db, 'companyRecruitmentConfig', { key: 'company', baseline: { criteria: [{ id: 'm', field: 'man', operator: 'gte', value: 50000, kind: 'Hard' }] } });
    for (const id of ['11', '12', '13']) await put(db, 'companyRecruitment', { userId: id, domain: 'company', pipelineStage: 'Not Contacted' });
    await put(db, 'playerIntelligence', { userId: '11', name: 'WeakMan' });
    await put(db, 'candidateLocal', { userId: '11', stats: { man: 10000 } });
    await put(db, 'candidateLocal', { userId: '12', stats: { man: 90000 } });
    const rows = await CompanyPlatform._test.buildRows({ _test: { state: { db } } });
    const by = Object.fromEntries(rows.map(row => [row.userId, row]));
    assert.deepEqual(by['11'].ineligibleReasons, ['MAN (manual labour) ≥ 50000']);
    assert.deepEqual(by['12'].ineligibleReasons, []);
    assert.deepEqual(by['13'].ineligibleReasons, [], 'MAN unknown: not marked, never treated as 0');
    assert.equal(by['13'].man, null);
  } finally { db.close(); }
});

test('V2 Faction baseline marks rows without needing a specialist profile', async () => {
  const db = await App.openDB(indexedDB);
  try {
    await put(db, 'factionRecruitmentConfig', { key: 'faction', baseline: { criteria: [{ id: 'l', field: 'level', operator: 'gte', value: 30, kind: 'Hard' }, { id: 'e', field: 'end', operator: 'gte', value: 100000, kind: 'Hard', label: 'Tank END' }] } });
    await put(db, 'factionRecruitment', { userId: '21', domain: 'faction', pipelineStage: 'Prospect' });
    await put(db, 'factionRecruitment', { userId: '22', domain: 'faction', pipelineStage: 'Prospect' });
    await put(db, 'playerIntelligence', { userId: '21', name: 'Rookie', level: 10 });
    await put(db, 'candidateLocal', { userId: '21', stats: { end: 5000 } });
    await put(db, 'playerIntelligence', { userId: '22', name: 'Veteran', level: 60 });
    const rows = await FactionPlatform._test.buildRows({ _test: { state: { db } } });
    const by = Object.fromEntries(rows.map(row => [row.userId, row]));
    assert.deepEqual(by['21'].ineligibleReasons, ['Level ≥ 30', 'Tank END ≥ 100000']);
    assert.deepEqual(by['22'].ineligibleReasons, []);
    const html = FactionUI.renderCandidates(rows, { filters: {}, total: 2 });
    assert.equal((html.match(/>Not eligible</g) || []).length, 1);
  } finally { db.close(); }
});

test('Unknown stats render as a hatched chip announced as Unknown, never as a bar, zero or estimate', () => {
  const html = CompanyUI.renderCandidates([{ userId: '5', name: 'Mystery', man: null, int: '', end: undefined, level: null, recruitmentFit: null }], { filters: {}, total: 1 });
  for (const col of ['man', 'int', 'end', 'level']) {
    assert.equal(cell(html, col), Shared.UNKNOWN_CHIP, `${col} is the Unknown chip`);
  }
  assert.match(Shared.UNKNOWN_CHIP, /aria-label="Unknown"[^>]*>—<\/span>$/);
  assert.doesNotMatch(cell(html, 'man'), /vx-stat|--p/);
  assert.match(cell(html, 'fit'), /data-band="na"[^>]*>—</);
  assert.doesNotMatch(html, /<td data-col="\w+">0<\/td>/);
});

test('work-stat bars use the documented fixed log scale (1k empty, 500k full) and keep exact numbers', () => {
  assert.deepEqual(Shared.STAT_SCALE, { min: 1000, max: 500000 });
  assert.equal(Shared.statScale(1000), 0);
  assert.equal(Shared.statScale(10), 0);
  assert.equal(Shared.statScale(500000), 1);
  assert.equal(Shared.statScale(9e6), 1);
  assert.ok(Math.abs(Shared.statScale(Math.sqrt(1000 * 500000)) - 0.5) < 1e-9);
  const bar = Shared.statCell('end', 70412);
  assert.match(bar, /class="vx-stat vx-end" style="--p:0\.68\d"/);
  assert.match(bar, /<b>70,412<\/b>/);
});

test('KPI strip is labelled as this page and only averages known Recruit Fit', () => {
  const rows = [
    { userId: '1', name: 'A', onlineStatus: 'Online', man: 1, int: 2, end: 3, recruitmentFit: 80 },
    { userId: '2', name: 'B', onlineStatus: 'Offline', man: 1, recruitmentFit: 60 },
    { userId: '3', name: 'C', onlineStatus: 'Idle', recruitmentFit: null }
  ];
  const html = CompanyUI.renderCandidates(rows, { filters: {}, total: 40, filteredTotal: 30, pagination: { page: 0, pageCount: 1, start: 0, end: 3 } });
  assert.match(html, /aria-label="Summary of this page"/);
  assert.match(html, /This page · rows 1-3/);
  assert.match(html, /<small>Online now<\/small><b>1<\/b>/);
  assert.match(html, /<small>Work stats known<\/small><b>1<span>\/3<\/span><\/b><em>1 partial · 1 unknown<\/em>/);
  assert.match(html, /<small>Avg Recruit Fit<\/small><b>70\.0<\/b><em>2 of 3 scored<\/em>/);
  const empty = CompanyUI.renderCandidates([], { filters: {}, total: 0 });
  assert.doesNotMatch(empty, /vx-kpis/);
  assert.match(empty, /class="vx-empty"/);
  assert.match(empty, /No matching Company candidates\./);
});

test('V3 page titles match the Search & Results navigation label', () => {
  assert.equal(CompanyPlatform.routeMeta('company-candidates').title, 'Company Search & Results');
  assert.equal(FactionPlatform.routeMeta('faction-candidates').title, 'Faction Search & Results');
});

test('Player Card hero shows bars for known stats, Unknown for unknown, and why a player is not eligible', async () => {
  const dom = new JSDOM('<!doctype html><html><body><aside id="ra-drawer" class="ra-drawer" hidden></aside></body></html>', { url: 'https://www.torn.com/' });
  global.window = dom.window; global.document = dom.window.document;
  const db = await App.openDB(indexedDB);
  App._test.state.db = db;
  App._test.state.settings = App.mergeSettings({});
  App._test.state.playerCard = { domain: 'company', userId: '', pinned: false, popout: false };
  try {
    await put(db, 'companyRecruitmentConfig', { key: 'company', baseline: { criteria: [{ id: 'l', field: 'level', operator: 'gte', value: 50, kind: 'Hard' }] } });
    await put(db, 'playerIntelligence', { userId: '77', name: 'Card Person', level: 12, man: 70412 });
    await put(db, 'companyRecruitment', { userId: '77', domain: 'company', pipelineStage: 'Not Contacted' });
    await App._test.openPlayerCard('company', '77', { force: true });
    const drawer = document.getElementById('ra-drawer');
    const bars = [...drawer.querySelectorAll('.vx-hbar')].map(el => el.textContent.replace(/\s+/g, ' ').trim());
    assert.deepEqual(bars, ['MAN70,412', 'INT—Unknown', 'END—Unknown']);
    assert.equal(drawer.querySelectorAll('.vx-hbar .vx-track').length, 1, 'only the known stat gets a bar');
    assert.match(drawer.querySelector('.vx-scale').textContent, /log scale from 1k to 500k/);
    assert.match(drawer.querySelector('.vx-inel-why').textContent, /Not eligible · fails Hard criteria: Level ≥ 50/);
    assert.equal(document.getElementById('ra-card-recruit').textContent, 'Recruit');
  } finally { db.close(); dom.window.close(); }
});
