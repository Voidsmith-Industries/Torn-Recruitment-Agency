const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {indexedDB}=require('fake-indexeddb');
const App=require('../src/v45-app');
const CompanyPlatform=require('../src/v46-company-platform');
const FactionPlatform=require('../src/v47-faction-platform');

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const settle=async()=>{for(let i=0;i<6;i++)await tick();};

function shell(){
  const dom=new JSDOM('<!doctype html><html><body><div id="ra-app"><h2 id="ra-page-title"></h2><p id="ra-page-desc"></p><div id="ra-nav"></div><div id="ra-content"></div></div></body></html>',{url:'https://www.torn.com/'});
  global.window=dom.window;
  global.document=dom.window.document;
  global.MutationObserver=dom.window.MutationObserver;
  return dom;
}

async function harness(page){
  const db=await App.openDB(indexedDB);
  App._test.state.db=db;
  await App._test.clearRecruitmentData();
  return {
    db,
    app:{_test:{state:{db,settings:{activePage:page},page},repositories:App._test.repositories,companyRepositories:App._test.companyRepositories,factionRepositories:App._test.factionRepositories}}
  };
}

function setCriterion(row,values){
  for(const [key,value] of Object.entries(values)){
    const el=row.querySelector(`[data-criterion-field="${key}"],[data-faction-criterion-field="${key}"]`);
    el.value=String(value);
  }
}

test('Company search page carries a minimal eligibility baseline editor that saves to the Company config',async()=>{
  const dom=shell();
  const {db,app}=await harness('company-candidates');
  CompanyPlatform.install(app,{renderInitial:false});
  await CompanyPlatform.renderPage('company-candidates',{persist:false});
  const editor=document.getElementById('ra-company-baseline-editor');
  assert.ok(editor,'baseline editor is reachable from Company search');
  assert.equal(editor.tagName,'DETAILS','editor stays collapsed out of the way by default');
  assert.equal(editor.open,false);
  document.getElementById('ra-company-baseline-add').click();
  const rows=editor.querySelectorAll('[data-criterion-row]');
  assert.equal(rows.length,1);
  setCriterion(rows[0],{label:'Min EE',field:'ee',operator:'gte',kind:'Hard',value:5000,weight:2});
  document.getElementById('ra-company-baseline-save').click();
  await settle();
  const config=await App._test.companyRepositories.config.get();
  assert.equal(config.baseline.criteria.length,1);
  assert.equal(config.baseline.criteria[0].field,'ee');
  assert.equal(config.baseline.criteria[0].kind,'Hard');
  assert.equal(config.baseline.criteria[0].value,5000);
  const after=document.getElementById('ra-company-baseline-editor');
  assert.equal(after.open,true,'editor stays open after saving');
  assert.equal(after.querySelectorAll('[data-criterion-row]').length,1,'saved criterion is shown again');
  after.querySelector('[data-remove-criterion]').click();
  assert.equal(after.querySelectorAll('[data-criterion-row]').length,0,'criterion rows can be removed before saving');
  CompanyPlatform.uninstall();db.close();dom.window.close();
});

test('Faction search page carries a slim Specialist Profile editor (create, edit, delete) and baseline editor',async()=>{
  const dom=shell();
  const {db,app}=await harness('faction-candidates');
  dom.window.confirm=()=>true;global.confirm=()=>true;
  FactionPlatform.install(app,{renderInitial:false});
  await FactionPlatform.renderPage('faction-candidates',{persist:false});
  const editor=document.getElementById('ra-faction-profile-editor');
  assert.ok(editor,'profile editor is reachable from Faction search');
  assert.equal(editor.tagName,'DETAILS');
  assert.equal(editor.querySelector('[data-faction-waiver-grant],#ra-faction-waiver-grant'),null,'waiver management is not part of the slim editor');

  document.getElementById('ra-faction-profile-new').click();
  await settle();
  let profiles=await App._test.factionRepositories.profiles.list();
  assert.equal(profiles.length,1);
  const id=profiles[0].profileId;
  const card=document.querySelector(`[data-faction-profile-card="${id}"]`);
  assert.ok(card,'new profile is rendered for editing');
  assert.equal(document.getElementById('ra-faction-profile-editor').open,true);
  card.querySelector('[data-faction-profile-field="name"]').value='Chain Hitter';
  card.querySelector('[data-faction-profile-field="status"]').value='Active';
  card.querySelector(`[data-faction-profile-add-criterion="${id}"]`).click();
  const criterion=card.querySelector('[data-faction-criterion-row]');
  assert.ok(criterion);
  setCriterion(criterion,{label:'Level',field:'level',operator:'gte',kind:'Hard',value:30,weight:1});
  card.querySelector(`[data-faction-profile-save="${id}"]`).click();
  await settle();
  profiles=await App._test.factionRepositories.profiles.list();
  assert.equal(profiles[0].name,'Chain Hitter');
  assert.equal(profiles[0].status,'Active');
  assert.equal(profiles[0].criteria.length,1);
  assert.equal(profiles[0].criteria[0].value,30);
  assert.ok([...document.querySelectorAll('#ra-faction-results-profile option')].some(option=>option.value===id),'saved profile is selectable on the results page');

  document.getElementById('ra-faction-baseline-add').click();
  setCriterion(document.querySelector('#ra-faction-baseline-criteria [data-faction-criterion-row]'),{field:'level',operator:'gte',kind:'Preferred',value:10,weight:1});
  document.getElementById('ra-faction-baseline-save').click();
  await settle();
  const config=await App._test.factionRepositories.config.get();
  assert.equal(config.baseline.criteria.length,1);
  assert.equal(config.baseline.criteria[0].value,10);

  document.querySelector(`[data-faction-profile-delete="${id}"]`).click();
  await settle();
  assert.equal((await App._test.factionRepositories.profiles.list()).length,0);
  FactionPlatform.uninstall();db.close();dom.window.close();
  delete global.confirm;
});
