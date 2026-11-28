const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const app=fs.readFileSync(path.join(__dirname,'..','src','v45-app.js'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(__dirname,'..','package.json'),'utf8'));

const FACTION_MODULES=[
  'v47-faction-core','v47-faction-storage','v47-faction-ui','v47-faction-platform'
];

test('app wires every Faction runtime dependency and uses DB15 as the database target',()=>{
  for(const module of FACTION_MODULES){
    const symbol='RA_'+module.split('-').map((part,index)=>index===0?part.toUpperCase():part[0].toUpperCase()+part.slice(1)).join('');
    assert.match(app,new RegExp(module.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  }
  assert.match(app,/RA_V47FactionStorage/);
  assert.match(app,/RA_V47FactionPlatform/);
  assert.match(app,/require\('\.\/v47-faction-storage'\)/);
  assert.match(app,/require\('\.\/v47-faction-platform'\)/);
  assert.match(app,/const DB_VERSION = V47FactionStorage\.DB_VERSION;/);
});

test('DB open applies Foundation then Company then Faction upgrades additively',()=>{
  const foundationAt=app.indexOf('V46Storage.applyUpgrade(db);');
  const companyAt=app.indexOf('V46CompanyStorage.applyUpgrade(db);');
  const factionAt=app.indexOf('V47FactionStorage.applyUpgrade(db);');
  assert.ok(foundationAt>=0,'Foundation upgrade');
  assert.ok(companyAt>foundationAt,'Company DB14 upgrade after Foundation DB13');
  assert.ok(factionAt>companyAt,'Faction DB15 upgrade after Company DB14');
  for(const store of ['factionSpecialistProfiles','factionCampaigns','factionRecruitmentConfig','factionRecruitmentSessions'])assert.match(app,new RegExp(`['\"]${store}['\"]`));
});

test('Faction repositories are created from the existing IndexedDB adapter and exposed to platforms/tests',()=>{
  assert.match(app,/const factionRepositories=V47FactionStorage\.createRepositories\(idb,V47FactionCore\);/);
  assert.match(app,/factionRepositories/);
});

test('source app installs, delegates and synchronously rebinds owned Faction routes',()=>{
  assert.match(app,/V47FactionPlatform\.install\(/);
  assert.match(app,/V47FactionPlatform\.renderPage\(/);
  assert.match(app,/V47FactionPlatform\._test\.IMPLEMENTED_ROUTES\.has\(state\.page\)/);
  assert.match(app,/V47FactionPlatform\.syncNavigation\?\.\(\)/);
});

test('syntax script parses every Faction source module',()=>{
  for(const file of FACTION_MODULES)assert.match(pkg.scripts.syntax,new RegExp(`src/${file}\\.js`));
});
