const test = require('node:test');
const assert = require('node:assert/strict');

const App = require('../src/v45-app');

test('v4.9 workspace selector is a single top-level Company/Faction dropdown', () => {
  const company = App._test.workspaceSelectHtml('company');
  assert.match(company, /id="ra-workspace-toggle"/);
  assert.match(company, /data-workspace-domain="company"/);
  assert.match(company, /data-workspace-domain="faction"/);
  assert.match(company, /id="ra-workspace-label">Company<\/span>/);
  assert.doesNotMatch(company, /ra-domain-switch/);

  const faction = App._test.workspaceSelectHtml('faction');
  assert.match(faction, /id="ra-workspace-label">Faction<\/span>/);
});

test('v4.9 sidebar navigation renders only the active recruitment domain', () => {
  App._test.state.settings = App.mergeSettings({
    activeDomain: 'company',
    activePage: 'company-candidates',
    optionalModules: {
      companyPipeline: true,
      factionPipeline: true,
      scout: true
    }
  });
  App._test.state.page = 'company-candidates';

  const companyNav = App._test.navHtml();
  assert.match(companyNav, /data-page="company-candidates"/);
  assert.match(companyNav, /data-page="company-pipeline"/);
  assert.doesNotMatch(companyNav, /data-page="faction-candidates"/);
  assert.doesNotMatch(companyNav, /data-page="faction-pipeline"/);
  assert.doesNotMatch(companyNav, /data-domain=/);

  App._test.state.settings = App.mergeSettings({
    activeDomain: 'faction',
    activePage: 'faction-candidates',
    optionalModules: {
      companyPipeline: true,
      factionPipeline: true,
      scout: true
    }
  });
  App._test.state.page = 'faction-candidates';

  const factionNav = App._test.navHtml();
  assert.match(factionNav, /data-page="faction-candidates"/);
  assert.match(factionNav, /data-page="faction-pipeline"/);
  assert.doesNotMatch(factionNav, /data-page="company-candidates"/);
  assert.doesNotMatch(factionNav, /data-page="company-pipeline"/);
  assert.doesNotMatch(factionNav, /data-domain=/);
});

const { JSDOM } = require('jsdom');
const { indexedDB } = require('fake-indexeddb');
const CompanyUI = require('../src/v46-company-ui');
const FactionUI = require('../src/v47-faction-ui');

function put(db, store, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

test('v4.9 result layouts default to expanded intelligence and keep compact mode available', () => {
  const row = {
    userId:'123', name:'Candidate', level:50, age:1200, man:100, int:200, end:300,
    activity30:88, activeStreak:10, currentOrganizationLabel:'None', pipelineStage:'Not Contacted',
    lastActive:Date.now()-60_000, onlineStatus:'Online', doNotContact:false
  };
  const companyExpanded = CompanyUI.renderCandidates([row], { total:1, layout:'expanded' });
  assert.match(companyExpanded, />Level</);
  assert.match(companyExpanded, />30d Active</);
  assert.match(companyExpanded, />Recruit Fit</);
  assert.match(companyExpanded, /data-player-card="123"/);
  assert.match(companyExpanded, /data-player-domain="company"/);

  const companyCompact = CompanyUI.renderCandidates([row], { total:1, layout:'compact' });
  assert.doesNotMatch(companyCompact, />30d Active</);
  assert.match(companyCompact, />Last Online</);

  const factionExpanded = FactionUI.renderCandidates([{...row,factionRecord:{domain:'faction'}}], { total:1, layout:'expanded' });
  assert.match(factionExpanded, />Net Worth</);
  assert.match(factionExpanded, />Battle \/ RW</);
  assert.match(factionExpanded, /data-player-domain="faction"/);
});

test('v4.9 Player Card is domain-sensitive and reads local intelligence without mixing company and faction status', async () => {
  const dom = new JSDOM('<!doctype html><html><body><aside id="ra-drawer" class="ra-drawer" hidden></aside></body></html>', { url:'https://www.torn.com/' });
  global.window = dom.window;
  global.document = dom.window.document;

  const db = await App.openDB(indexedDB);
  App._test.state.db = db;
  App._test.state.playerCard = { domain:'company', userId:'', pinned:false, popout:false };

  await put(db, 'playerIntelligence', {
    userId:'321', name:'DualContext', level:75, man:10, int:20, end:30,
    currentCompany:'Acme Co', currentFaction:'Night Watch', activity30:90, fit:77
  });
  await put(db, 'companyRecruitment', { userId:'321', domain:'company', pipelineStage:'Contacted', availability:'Available', doNotContact:true });
  await put(db, 'factionRecruitment', { userId:'321', domain:'faction', pipelineStage:'Prospect', availability:'Unknown' });

  await App._test.openPlayerCard('company', '321', { force:true });
  assert.match(document.getElementById('ra-drawer').textContent, /Company Status/);
  assert.match(document.getElementById('ra-drawer').textContent, /Acme Co/);
  assert.doesNotMatch(document.getElementById('ra-drawer').textContent, /Faction Status/);
  assert.doesNotMatch(document.getElementById('ra-drawer').textContent, /Night Watch/);
  assert.equal(document.getElementById('ra-card-recruit').disabled, true);
  assert.equal(document.getElementById('ra-card-recruit').textContent, 'Do Not Contact');

  await App._test.openPlayerCard('faction', '321', { force:true });
  assert.match(document.getElementById('ra-drawer').textContent, /Faction Status/);
  assert.match(document.getElementById('ra-drawer').textContent, /Night Watch/);
  assert.doesNotMatch(document.getElementById('ra-drawer').textContent, /Company Status/);
  assert.doesNotMatch(document.getElementById('ra-drawer').textContent, /Acme Co/);

  db.close();
  dom.window.close();
});

test('v4.9 results preferences normalize safely and expanded is the default', () => {
  assert.equal(App.mergeSettings({}).candidates.resultsLayout, 'expanded');
  assert.equal(App.mergeSettings({ candidates:{ resultsLayout:'compact' } }).candidates.resultsLayout, 'compact');
  assert.equal(App.mergeSettings({ candidates:{ resultsLayout:'nonsense' } }).candidates.resultsLayout, 'expanded');
});


test('v4.9 Player Card uses shared intelligence observation time, not workflow edit time', async () => {
  const dom = new JSDOM('<!doctype html><html><body><aside id="ra-drawer" class="ra-drawer" hidden></aside></body></html>', { url:'https://www.torn.com/' });
  global.window = dom.window;
  global.document = dom.window.document;
  const db = await App.openDB(indexedDB);
  App._test.state.db = db;
  App._test.state.settings = App.mergeSettings({});
  App._test.state.playerCard = { domain:'company', userId:'', pinned:false, popout:false };
  await put(db, 'playerIntelligence', {userId:'654',name:'Observed',updatedAt:1000});
  await put(db, 'companyRecruitment', {userId:'654',domain:'company',pipelineStage:'Not Contacted',updatedAt:9000});
  await App._test.openPlayerCard('company','654',{force:true});
  const body=document.getElementById('ra-drawer').textContent;
  assert.ok(body.includes(new Date(1000).toLocaleString()));
  assert.ok(!body.includes(new Date(9000).toLocaleString()));
  db.close();
  dom.window.close();
});

test('v4.9 navigation closes Player Card when rememberPanel is disabled',()=>{
  const source=require('node:fs').readFileSync(require.resolve('../src/v45-app'),'utf8');
  assert.match(source,/requested!==previousPage&&state\.settings\.candidates\?\.playerCard\?\.rememberPanel===false/);
  assert.match(source,/drawer\.hidden=true/);
  assert.match(source,/state\.playerCard=\{\.\.\.state\.playerCard,userId:'',pinned:false\}/);
});
