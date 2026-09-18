const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const boot=fs.readFileSync(path.join(root,'R4G3RUNN3R-Recruitment-Agency.user.js'),'utf8');
const app=fs.readFileSync(path.join(root,'src/v45-app.js'),'utf8');
const PINNED_RUNTIME='912b070ec11b68b4cdc0337b1971a8ccc3554a13';
const RELEASE_FILES=['scout-core.js','results-core.js','global-core.js','match-core.js','forum-core.js','v45-runtime.js','v45-candidates.js','v45-discovery.js','v45-messaging.js','v46-domain-core.js','v46-storage-core.js','v46-navigation.js','v46-company-core.js','v46-company-storage.js','v46-company-ui.js','v46-company-operations.js','v46-company-workflow.js','v46-company-workflow-ui.js','v46-company-opportunity-ui.js','v46-company-platform.js','v47-faction-core.js','v47-faction-storage.js','v47-faction-ui.js','v47-faction-operations.js','v47-faction-workflow.js','v47-faction-workflow-ui.js','v47-faction-opportunity-ui.js','v47-faction-platform.js','v45-app.js'];

test('public userscript is the v4.8.4 icon release with immutable v4.8.3 core requires',()=>{
  assert.match(boot,/@version\s+4\.8\.4/);
  assert.match(boot,/@noframes/);
  assert.match(boot,/@icon\s+data:image\/svg\+xml,/);
  for(const file of RELEASE_FILES){
    assert.ok(boot.includes(`/${PINNED_RUNTIME}/src/${file}`),`pinned ${file}`);
  }
  assert.doesNotMatch(boot,/@require\s+https:\/\/raw\.githubusercontent\.com\/R4G3RUNN3R\/Torn-Recruitment-Agency\/main\/src\//);
  assert.match(boot,/INSTALLER_VERSION\s*=\s*'4\.8\.4'/);
  assert.match(boot,/EXPECTED_APP_VERSION\s*=\s*'4\.8\.3'/);
  assert.match(boot,/app\.SCRIPT_VERSION/);
  assert.match(boot,/app\.start\(\)/);
});

test('v4.8.4 loads Company and Faction dependencies before the source application',()=>{
  const appIndex=boot.indexOf(`/src/v45-app.js`);
  assert.ok(appIndex>0);
  for(const file of ['v46-domain-core.js','v46-storage-core.js','v46-navigation.js','v46-company-core.js','v46-company-storage.js','v46-company-ui.js','v46-company-operations.js','v46-company-workflow.js','v46-company-workflow-ui.js','v46-company-opportunity-ui.js','v46-company-platform.js','v47-faction-core.js','v47-faction-storage.js','v47-faction-ui.js','v47-faction-operations.js','v47-faction-workflow.js','v47-faction-workflow-ui.js','v47-faction-opportunity-ui.js','v47-faction-platform.js']){
    const index=boot.indexOf(`/src/${file}`);
    assert.ok(index>=0&&index<appIndex,`${file} must load before v45-app.js`);
  }
  assert.ok(boot.indexOf('/src/v45-messaging.js')<boot.indexOf('/src/v46-company-platform.js'),'Messaging must load before CompanyPlatform');
  assert.ok(boot.indexOf('/src/v46-company-platform.js')<boot.indexOf('/src/v47-faction-core.js'),'CompanyPlatform must load before the Faction slice');
  assert.ok(boot.indexOf('/src/v47-faction-platform.js')<appIndex,'FactionPlatform must load before v45-app.js');
});

test('v4.8.4 preserves the direct and addEventListener click bridge',()=>{
  assert.match(boot,/function installClickListenerBridge\(\)/);
  assert.match(boot,/registry = new WeakMap\(\)/);
  assert.match(boot,/EventTarget\.prototype\.addEventListener/);
  assert.match(boot,/EventTarget\.prototype\.removeEventListener/);
  assert.match(boot,/type === 'click'/);
  assert.match(boot,/function installPrimaryInputShield\(clickBridge\)/);
  assert.match(boot,/window\.addEventListener\('click',[\s\S]*?,\s*true\s*\)/);
  assert.match(boot,/typeof target\.closest !== 'function'/);
  assert.doesNotMatch(boot,/target instanceof Element/);
  assert.match(boot,/target\.closest\(RA_ROOT_SELECTOR\)/);
  assert.match(boot,/clickBridge\.has\(action\)/);
  assert.match(boot,/event\.stopImmediatePropagation\(\)/);
  assert.match(boot,/clickBridge\.invoke\(action, event\)/);
});

test('v4.8.4 guards the shared DOM against duplicate worlds and legacy RA UI',()=>{
  assert.match(boot,/DOM_GUARD\s*=\s*'data-r4g3-ra-v45-owner'/);
  assert.match(boot,/root\.getAttribute\(DOM_GUARD\)/);
  assert.match(boot,/root\.setAttribute\(DOM_GUARD, INSTALLER_VERSION\)/);
  assert.match(boot,/window\.top !== window\.self/);
  assert.match(boot,/function removeLegacyRecruitmentUi\(\)/);
  for(const id of ['ra-styles','ra-panel','ra-results-panel','ra-config-modal','ra-dock-fallback','ra-launcher']) assert.ok(boot.includes(`'${id}'`),`legacy cleanup ${id}`);
});

test('v4.8.4 keeps scrollable content, title-bar-only Settings and safe maximize restore',()=>{
  assert.match(boot,/SHELL_STYLE_ID\s*=\s*'ra-v454-shell-css'/);
  assert.match(boot,/function stripSidebarSettings\(\)/);
  assert.match(boot,/#ra-nav \[data-page=\"settings\"\]/);
  assert.match(boot,/function installShellResizeGuard\(\)/);
  assert.match(boot,/function installMaximizedDragGuard\(\)/);
  assert.match(boot,/function persistNormalGeometry\(appModule, geometry\)/);
  assert.match(boot,/function maximizeApp\(appModule\)/);
  assert.match(boot,/function restoreApp\(appModule\)/);
  assert.match(boot,/ra-maximized/);
  assert.match(boot,/maximize\.id = 'ra-maximize'/);
  assert.match(boot,/actions\.insertBefore\(maximize, settings\)/);
  assert.match(boot,/scrollbar-width:thin/);
  assert.match(boot,/resize:none!important/);
});

test('v4.8.4 protects dark-theme table and Settings contrast from Torn host CSS',()=>{
  assert.match(boot,/#ra-app \.ra-table tbody td\{color:var\(--ra-text\)!important\}/);
  assert.match(boot,/#ra-app \.ra-table tbody td \.ra-muted\{color:var\(--ra-muted\)!important\}/);
  assert.match(boot,/#ra-app \.ra-table tbody td \.ra-btn,[\s\S]*color:var\(--ra-text\)!important/);
  assert.match(boot,/#ra-app \.ra-settings summary\{color:var\(--ra-accent2\)!important\}/);
  assert.match(boot,/#ra-app \.ra-settings \.ra-field label\{color:var\(--ra-accent2\)!important\}/);
  assert.match(boot,/#ra-app \.ra-settings \.ra-danger-zone summary\{color:var\(--ra-danger\)!important\}/);
  assert.match(boot,/function syncPublicVersionLabel\(\)/);assert.match(boot,/#ra-titlebar \.ra-version/);
});

test('maximize marks its guarded state before the first persistence await',()=>{
  const start=boot.indexOf('async function maximizeApp(appModule)');
  const end=boot.indexOf('async function restoreApp(appModule)',start);
  assert.ok(start>=0&&end>start,'maximizeApp source should be present');
  const fn=boot.slice(start,end);
  const stateIndex=fn.indexOf('shellUiState.maximized = true');
  const classIndex=fn.indexOf("appNode.classList.add('ra-maximized')");
  const awaitIndex=fn.indexOf('await persistNormalGeometry(appModule, geometry)');
  assert.ok(stateIndex>=0&&classIndex>=0&&awaitIndex>=0,'maximizeApp should contain guard, class and persistence steps');
  assert.ok(stateIndex<awaitIndex,'maximized state must be set before yielding to persistence');
  assert.ok(classIndex<awaitIndex,'maximized class must be applied before yielding to persistence');
});

test('source app targets additive DB15 over DB13 and DB14 foundations and shared scheduler',()=>{assert.match(app,/DB_VERSION\s*=\s*V47FactionStorage\.DB_VERSION/);assert.match(app,/V46Storage\.applyUpgrade\(db\)[\s\S]*V46CompanyStorage\.applyUpgrade\(db\)[\s\S]*V47FactionStorage\.applyUpgrade\(db\)/);assert.doesNotMatch(app,/deleteObjectStore\s*\(/);assert.match(app,/HARD_API_RATE\s*=\s*75/);assert.match(app,/MIN_API_GAP_MS\s*=\s*800/);assert.match(app,/Math\.max\(MIN_API_GAP_MS,60000\/clampRate/);});

test('v4.8 keeps Smart Match local and messaging manual',()=>{assert.match(app,/Smart Match.*zero Torn API calls/i);assert.match(app,/private chat[\s\S]*press Send/i);assert.doesNotMatch(app,/autoSubmit\s*:\s*true/);assert.doesNotMatch(app,/pipelineStage\s*=\s*['"]Contacted['"]s*;.*message/s);});

test('Settings is a real routed page and Danger Zone uses inline biohazard SVG',()=>{assert.match(app,/id=\"ra-settings-button\"/);assert.match(app,/document\.getElementById\('ra-settings-button'\)\.onclick=\(\)=>route\('settings'\)/);for(const section of ['General','Recruitment','Scout','Candidates','Smart Match','Global Intelligence','Data & Reset','Danger Zone'])assert.ok(app.includes(section));assert.match(app,/function biohazardSvg/);assert.match(app,/NUKE IT ALL!/);assert.match(app,/Type NUKE to confirm/);});

test('candidate workspace, drawer, context menu, hover and pipeline are operational',()=>{for(const token of ['renderCandidates','renderPipeline','openDrawer','openContextMenu','openCandidateHover','ra-inline-stage','data-drop-stage','shiftKey'])assert.ok(app.includes(token),token);assert.deepEqual(require('../src/v45-runtime').PIPELINE_STAGES,['Not Contacted','Shortlisted','Contacted','Replied','Hired','Rejected']);});