// 4.9.2 small logic fixes that need no browser (L11, L18, L20).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Shared = require('../src/v46-recruitment-shared');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');

test('L11 Current Faction/Company filter matches the displayed "Faction #801" label, "Faction 801" and the bare ID', () => {
  const info = Shared.organizationInfoFor({ player: 'player', name: 'factionName', id: 'factionId', label: 'Faction' });
  const rows = [{ userId: '1', name: 'Api', player: { factionId: 801 } }, { userId: '2', name: 'Other', player: { factionId: 9 } }, { userId: '3', name: 'Named', player: { factionName: 'Silent Ledger', factionId: 5 } }];
  for (const needle of ['Faction #801', 'faction 801', '801', '#801']) {
    assert.deepEqual(Shared.filterRows(rows, { organization: needle }, info).map(row => row.userId), ['1'], needle);
  }
  assert.deepEqual(Shared.filterRows(rows, { organization: 'silent' }, info).map(row => row.userId), ['3']);
  const company = Shared.organizationInfoFor({ player: 'playerRecord', name: 'currentCompany', id: 'currentCompanyId', label: 'Company', presence: 'companyPresence' });
  assert.deepEqual(Shared.filterRows([{ userId: '4', playerRecord: { currentCompanyId: 77 } }], { organization: '77' }, company).map(row => row.userId), ['4']);
  assert.match(read('v46-company-ui.js'), /orgPlaceholder:'Company name or ID'/);
  assert.match(read('v47-faction-ui.js'), /orgPlaceholder:'Faction name or ID'/);
});

test('L18 no re-render checks for the removed company-pipeline / company-overview routes', () => {
  const app = read('v45-app.js');
  assert.doesNotMatch(app, /state\.page===['"]company-(pipeline|overview)['"]/);
});

test('L20 profile errors use the UI term "Recruitment profile" and platform errors prefer a toast', () => {
  const platform = read('v46-company-platform.js');
  assert.doesNotMatch(platform, /Match Profile/);
  assert.match(platform, /Choose a Recruitment profile first\./);
  const shared = read('v46-recruitment-shared.js');
  assert.match(shared, /typeof runtime\.app\?\.toast==='function'\)runtime\.app\.toast\(message,true\);else globalThis\.alert/);
});
