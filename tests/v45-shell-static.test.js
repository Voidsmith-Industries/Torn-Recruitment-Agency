const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'src','v45-app.js'),'utf8');
const boot=fs.readFileSync(path.join(root,'R4G3RUNN3R-Recruitment-Agency.user.js'),'utf8');

test('v4.5 shell is movable, resizable, routed and responsive',()=>{assert.match(app,/resize:both/);assert.match(app,/bindWindow/);assert.match(app,/saveGeometry/);assert.match(app,/restoreGeometry/);assert.match(app,/@media\(max-width:640px\)/);assert.match(app,/V46Navigation\.visibleGroups/);});

test('v4.5.4 shell layer owns scroll constraints, settings cleanup and maximize restore',()=>{
  assert.match(boot,/#ra-app \.ra-shell\{min-height:0!important\}/);
  assert.match(boot,/#ra-app \.ra-main\{min-height:0!important;overflow:hidden!important\}/);
  assert.match(boot,/#ra-app \.ra-content\{min-height:0!important;overflow:auto!important/);
  assert.match(boot,/scrollbar-color:var\(--ra-accent\) var\(--ra-panel2\)/);
  assert.match(boot,/#ra-app\.ra-maximized\{/);
  assert.match(boot,/function stripSidebarSettings\(\)/);
  assert.match(boot,/#ra-nav \[data-page=\"settings\"\]/);
  assert.match(boot,/id = 'ra-maximize'/);
  assert.match(boot,/function maximizeApp\(appModule\)/);
  assert.match(boot,/function restoreApp\(appModule\)/);
  assert.match(boot,/function persistNormalGeometry\(appModule, geometry\)/);
  assert.match(boot,/function installShellResizeGuard\(\)/);
  assert.match(boot,/function installMaximizedDragGuard\(\)/);
});

test('v4.8 optional navigation keeps Logs hidden unless explicitly enabled in Advanced mode',()=>{const N=require('../src/v46-navigation');assert.equal(N.visibleGroups({complexity:'simple',optionalModules:{logs:true}}).flatMap(g=>g.pages).some(p=>p.id==='logs'),false);assert.equal(N.visibleGroups({complexity:'advanced',optionalModules:{logs:false}}).flatMap(g=>g.pages).some(p=>p.id==='logs'),false);assert.equal(N.visibleGroups({complexity:'advanced',optionalModules:{logs:true}}).flatMap(g=>g.pages).some(p=>p.id==='logs'),true);});

test('collapsible navigation is button-based and keeps Settings outside the sidebar',()=>{assert.match(app,/data-nav-toggle/);assert.match(app,/aria-expanded/);assert.match(app,/data-nav-group/);assert.match(app,/V46Navigation\.toggleExpandedGroup/);assert.match(app,/document\.getElementById\('ra-settings-button'\)\.onclick=\(\)=>route\('settings'\)/);});

test('contextual help is header-anchored and viewport clamped',()=>{assert.match(app,/function helpButton/);assert.match(app,/function positionHelp/);assert.match(app,/getBoundingClientRect/);assert.match(app,/innerWidth-width-margin/);assert.match(app,/innerHeight-height-margin/);});

test('v4.9 Voidsmith themes keep high-contrast text with purple brand accents',()=>{assert.match(app,/--ra-text:#f6f1fb/);assert.match(app,/:root\[data-ra-theme=\"light\"\][^}]*--ra-text:#1d1722/);assert.match(app,/--ra-accent:#9b4dff/);assert.match(app,/--ra-accent2:#d06cff/);});
