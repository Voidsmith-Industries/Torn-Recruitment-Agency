const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const Shared=require('../src/v46-recruitment-shared');
const CompanyCore=require('../src/v46-company-core');
const FactionCore=require('../src/v47-faction-core');
const CompanyStorage=require('../src/v46-company-storage');
const FactionStorage=require('../src/v47-faction-storage');

test('shared organization lookup reads only its own domain fields',()=>{
  const company=Shared.organizationInfoFor({player:'playerRecord',name:'currentCompany',id:'currentCompanyId',label:'Company'});
  const faction=Shared.organizationInfoFor({player:'player',name:'factionName',id:'factionId',label:'Faction'});
  const row={currentCompanyId:4,factionName:'Wolves',playerRecord:{currentCompany:''},player:{factionId:0}};
  assert.deepEqual(company(row),{state:'has',label:'Company #4'});
  assert.deepEqual(faction(row),{state:'has',label:'Wolves'});
  assert.deepEqual(company({factionId:9}),{state:'unknown',label:'Unknown'});
  assert.deepEqual(faction({currentCompanyId:0}),{state:'unknown',label:'Unknown'});
  assert.deepEqual(Shared.filterRows([row,{userId:'2'}],{organizationPresence:'has'},company).length,1);
});

test('shared criterion rows keep Company and Faction editor attributes apart',()=>{
  const dom=new JSDOM(`<div id="c">${Shared.renderCriterionRow({id:'a',field:'networth',value:'5'},'baseline','','ee')}</div><div id="f">${Shared.renderCriterionRow({id:'b',value:'7',kind:'Hard'},'profile:p','faction-','level')}</div>`);
  const c=dom.window.document.getElementById('c'),f=dom.window.document.getElementById('f');
  assert.ok(c.querySelector('[data-criterion-row][data-criterion-id="a"]'));
  assert.ok(f.querySelector('[data-faction-criterion-row][data-faction-criterion-scope="profile:p"]'));
  assert.equal(Shared.readCriteria(f,'').length,0,'Company reader ignores Faction rows');
  assert.equal(Shared.readCriteria(c,'faction-').length,0,'Faction reader ignores Company rows');
  assert.deepEqual(Shared.readCriteria(c)[0],{id:'a',label:'',field:'networth',operator:'gte',kind:'Preferred',value:5,weight:1});
  assert.deepEqual(Shared.readCriteria(f,'faction-')[0],{id:'b',label:'',field:'level',operator:'gte',kind:'Hard',value:7,weight:1});
  assert.equal(Shared.renderCriterionRow({}, 'baseline','','ee').includes('value="ee" selected'),true);
});

test('domain waiver scoping stays separate after sharing criteria evaluation',()=>{
  const criteria=[{id:'lvl',field:'level',operator:'gte',value:10,kind:'Hard'}];
  const specialistWaiver=[{requirementId:'lvl',state:'Active',context:'specialist',profileId:'p'}];
  assert.equal(CompanyCore.evaluateCriteria(criteria,{level:5},specialistWaiver).eligibility,'Eligible by Waiver','Company waivers ignore Faction contexts');
  assert.equal(FactionCore.evaluateCriteria(criteria,{level:5},specialistWaiver).eligibility,'NOT CURRENTLY ELIGIBLE','Faction baseline ignores specialist waivers');
  assert.equal(FactionCore.evaluateCriteria(criteria,{level:5},specialistWaiver,{context:'specialist',profileId:'p'}).eligibility,'Eligible by Waiver');
  assert.equal(Shared.evaluateCriteria(criteria,{level:5}).eligibility,'NOT CURRENTLY ELIGIBLE');
});

test('shared config and store helpers keep per-domain keys and stores',()=>{
  assert.equal(CompanyStorage.normalizeConfig({key:'faction',activeResultsProfileId:'x'}).key,'company');
  assert.equal('activeResultsProfileId' in CompanyStorage.normalizeConfig({activeResultsProfileId:'x'}),false);
  assert.equal(FactionStorage.normalizeConfig({key:'company',activeResultsProfileId:' x '}).activeResultsProfileId,'x');
  const created=[];const db={objectStoreNames:{contains:name=>name==='companyVacancies'},createObjectStore:(name)=>{created.push(name);return{createIndex(){}};}};
  CompanyStorage.applyUpgrade(db);FactionStorage.applyUpgrade(db);
  assert.deepEqual(created,['companyCampaigns','companyRecruitmentConfig','companyRecruitmentSessions','factionSpecialistProfiles','factionCampaigns','factionRecruitmentConfig','factionRecruitmentSessions']);
});

test('shared results renderer uses domain-specific control ids',()=>{
  const spec=d=>({domain:d,label:d==='company'?'Company':'Faction',orgHeader:'Org',orgPlaceholder:'x',columns:['player','message'],contactedStages:[],messageCell:()=>'m'});
  const company=Shared.renderResults([{userId:'1',name:'A'}],{},spec('company')),faction=Shared.renderResults([],{},spec('faction'));
  assert.match(company,/id="ra-company-filter-search"/);assert.match(company,/data-company-sort="player"/);assert.match(company,/data-player-domain="company"/);
  assert.doesNotMatch(company,/ra-faction-/);
  assert.match(faction,/id="ra-faction-search-apply"/);assert.match(faction,/No matching Faction candidates/);assert.doesNotMatch(faction,/ra-company-/);
});

test('two results platforms keep separate runtime state and saved views',async()=>{
  const dom=new JSDOM('<!doctype html><div id="ra-app"><h2 id="ra-page-title"></h2><p id="ra-page-desc"></p><div id="ra-nav"></div><div id="ra-content"></div></div>');
  global.window=dom.window;global.document=dom.window.document;global.MutationObserver=dom.window.MutationObserver;
  try{
    const saved=[];
    const app={_test:{state:{db:{transaction(){throw new Error('no db');}},page:'',settings:{candidates:{resultsView:{company:{filters:{search:'co'},sort:{key:'man',direction:'desc'}},faction:{filters:{search:'fa'}}}}}}},saveResultsView:async(domain,view)=>saved.push([domain,view.filters.search,view.sort.key])};
    const make=d=>Shared.createResultsPlatform({domain:d,label:d,logTag:d,routes:[`${d}-candidates`],implemented:[`${d}-candidates`],goPageSelector:'[data-go-page]',meta:{[`${d}-candidates`]:[d,d]},organizationInfo:()=>({state:'unknown',label:'Unknown'}),buildRows:async()=>[],profileSearchFilters:()=>({}),selectProfile:async()=>({selected:null}),renderHtml:async()=>`<p>${d}</p>`,bindControls(){}});
    const company=make('company'),faction=make('faction');
    assert.notEqual(company.runtime,faction.runtime);
    company.install(app,{renderInitial:false});faction.install(app,{renderInitial:false});
    assert.equal(await company.renderPage('company-candidates',{persist:false}),true);
    assert.equal(await faction.renderPage('faction-candidates',{persist:false}),true);
    assert.equal(await company.renderPage('faction-candidates',{persist:false}),false,'a platform never renders the other domain route');
    assert.equal(company.runtime.searchFilters.search,'co');assert.equal(faction.runtime.searchFilters.search,'fa');
    assert.equal(company.runtime.sort.key,'man');assert.equal(faction.runtime.sort.key,'player');
    company.runtime.searchFilters={...company.runtime.searchFilters,search:'changed'};
    assert.equal(faction.runtime.searchFilters.search,'fa');
    assert.deepEqual(saved,[['company','co','man'],['faction','fa','player']]);
    company.uninstall();faction.uninstall();
  }finally{dom.window.close();delete global.window;delete global.document;delete global.MutationObserver;}
});
