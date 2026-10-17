'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'src/v45-app.js'),'utf8');
const metadata=fs.readFileSync(path.join(root,'R4G3RUNN3R-Recruitment-Agency.user.js'),'utf8');
const dist=fs.readFileSync(path.join(root,'dist/recruitment-agency.user.js'),'utf8');

test('Voidsmith branding preserves original namespace and installed update identity',()=>{
  assert.match(metadata,/\/\/ @name\s+Recruitment Agency \| Voidsmith Industries/);
  assert.match(metadata,/\/\/ @author\s+Voidsmith Industries/);
  assert.match(metadata,/\/\/ @namespace\s+r4g3runn3r\.recruitment\.agency/);
  assert.doesNotMatch(metadata,/\/\/ @author\s+R4G3RUNN3R/);
});
test('About and donation are inside settings without changing player identity',()=>{
  assert.match(source,/settingsSection\('About & Support','about'/);
  assert.match(source,/function showAboutSuite\(/);
  assert.match(source,/3877028/);
  assert.match(source,/profiles\.php\?XID=3877028/);
  assert.match(source,/Not affiliated with or endorsed by Torn/);
});
test('Premium styles are bundled locally and respect reduced motion',()=>{
  assert.match(source,/Voidsmith Torn UI Kit: self-contained/);
  assert.match(source,/prefers-reduced-motion:reduce/);
  assert.match(source,/ra-suite-footer/);
  assert.match(dist,/ra-about-support/);
  assert.match(dist,/Part of the/);
});
