const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const app=fs.readFileSync(path.join(__dirname,'..','src','v45-app.js'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(__dirname,'..','package.json'),'utf8'));

test('app retains CompanyCore and CompanyStorage as required source dependencies beneath DB15',()=>{
  assert.match(app,/RA_V46CompanyCore/);
  assert.match(app,/RA_V46CompanyStorage/);
  assert.match(app,/require\('\.\/v46-company-core'\)/);
  assert.match(app,/require\('\.\/v46-company-storage'\)/);
  assert.match(app,/const DB_VERSION = V47FactionStorage\.DB_VERSION;/);
});

test('DB open applies Foundation then Company then Faction additive upgrades and owns Company stores for hard reset',()=>{
  const foundationAt=app.indexOf('V46Storage.applyUpgrade(db);');
  const companyAt=app.indexOf('V46CompanyStorage.applyUpgrade(db);');
  const factionAt=app.indexOf('V47FactionStorage.applyUpgrade(db);');
  assert.ok(foundationAt>=0);
  assert.ok(companyAt>foundationAt,'Company DB14 upgrade must run after Foundation DB13 upgrade');
  assert.ok(factionAt>companyAt,'Faction DB15 upgrade must run after Company DB14 upgrade');
  for(const store of ['companyVacancies','companyCampaigns','companyRecruitmentConfig','companyRecruitmentSessions'])assert.match(app,new RegExp(`['\"]${store}['\"]`));
});

test('Company repositories are created from the existing IndexedDB adapter',()=>{
  assert.match(app,/const companyRepositories=V46CompanyStorage\.createRepositories\(idb,V46CompanyCore\);/);
});

test('source app installs and delegates owned Company routes to the v4.6 Company platform',()=>{
  assert.match(app,/RA_V46CompanyPlatform/);
  assert.match(app,/require\('\.\/v46-company-platform'\)/);
  assert.match(app,/V46CompanyPlatform\.install\(/);
  assert.match(app,/V46CompanyPlatform\.renderPage\(/);
  assert.match(app,/V46CompanyPlatform\._test\.IMPLEMENTED_ROUTES\.has\(state\.page\)/);
});

test('syntax script includes Company core, storage, UI and platform source modules',()=>{
  for(const file of ['v46-company-core','v46-company-storage','v46-company-ui','v46-company-platform'])assert.match(pkg.scripts.syntax,new RegExp(`src/${file}\\.js`));
});
