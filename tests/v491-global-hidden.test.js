const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const App=require('../src/v45-app');
const Navigation=require('../src/v46-navigation');

test('Global Intelligence is hidden: no optional toggle, no route, no endpoint settings, no network code',()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','src','v45-app.js'),'utf8');
  assert.equal(Navigation.ROUTES.includes('global-intelligence'),false);
  const pages=Navigation.visibleGroups({optionalModules:{globalIntelligence:true,scout:true}}).flatMap(group=>group.pages.map(page=>page.id));
  assert.equal(pages.includes('global-intelligence'),false);
  assert.ok(pages.includes('scout'));
  assert.doesNotMatch(app,/\['globalIntelligence'/);
  assert.doesNotMatch(app,/ra-setting-global-endpoint|ra-global-test|flushGlobalQueue|testGlobalService|GM_xmlhttpRequest/);
  const merged=App.mergeSettings({optionalModules:{globalIntelligence:true},global:{enabled:true,endpoint:'https://script.google.com/macros/s/x/exec'}});
  assert.equal(merged.global.endpoint,'https://script.google.com/macros/s/x/exec','old saved settings are kept, untouched');
});
