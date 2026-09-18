const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'src','v45-app.js'),'utf8');

test('source foundation remains wired beneath additive DB14 Company and DB15 Faction storage',()=>{
  assert.match(app,/V46Domain:\s*root\s*&&\s*root\.RA_V46DomainCore/);
  assert.match(app,/V46Storage:\s*root\s*&&\s*root\.RA_V46StorageCore/);
  assert.match(app,/V46Navigation:\s*root\s*&&\s*root\.RA_V46Navigation/);
  assert.match(app,/V46CompanyStorage:\s*root\s*&&\s*root\.RA_V46CompanyStorage/);
  assert.match(app,/V47FactionStorage:\s*root\s*&&\s*root\.RA_V47FactionStorage/);
  assert.match(app,/DB_VERSION\s*=\s*V47FactionStorage\.DB_VERSION/);
  const foundationUpgrade=app.indexOf('V46Storage.applyUpgrade(db)');
  const companyUpgrade=app.indexOf('V46CompanyStorage.applyUpgrade(db)');
  const factionUpgrade=app.indexOf('V47FactionStorage.applyUpgrade(db)');
  assert.ok(foundationUpgrade>=0&&companyUpgrade>foundationUpgrade,'DB13 foundation must upgrade before DB14 Company stores');
  assert.ok(factionUpgrade>companyUpgrade,'DB14 Company stores must upgrade before DB15 Faction stores');
  assert.match(app,/V46Storage\.createRepositories\(idb\)/);
  assert.doesNotMatch(app,/deleteObjectStore\s*\(/);
});

test('source foundation preserves API pacing and v4.8.3 core runtime contract',()=>{
  assert.match(app,/SCRIPT_VERSION\s*=\s*'4\.8\.3'/);
  assert.match(app,/HARD_API_RATE\s*=\s*75/);
  assert.match(app,/MIN_API_GAP_MS\s*=\s*800/);
});

test('new stores are owned by scoped reset and startup backfill runs before match setup',()=>{
  for(const store of ['playerIntelligence','companyRecruitment','factionRecruitment']) assert.ok(app.includes(`'${store}'`),store);
  const startIndex=app.indexOf('async function start(options={})');
  const returnIndex=app.indexOf('return Object.freeze',startIndex);
  assert.ok(startIndex>=0&&returnIndex>startIndex,'start function should be present');
  const startBlock=app.slice(startIndex,returnIndex);
  const migrate=startBlock.indexOf('await migrateLegacyUsers()');
  const backfill=startBlock.indexOf('await repositories.backfillLegacy(Date.now())');
  const match=startBlock.indexOf('await ensureDefaultMatchProfile()');
  assert.ok(migrate>=0&&backfill>migrate&&match>backfill,'startup migration/backfill/match order');
});

test('Scout and Fill Companies mirror only shared facts into player intelligence',()=>{
  assert.match(app,/repositories\.players\.ensure\(String\(id\)/);
  assert.match(app,/repositories\.players\.ensure\(String\(item\.userId\)/);
  assert.match(app,/lastScoutAt:capturedAt/);
  assert.match(app,/companyCheckedAt:candidate\.companyCheckedAt/);
});
