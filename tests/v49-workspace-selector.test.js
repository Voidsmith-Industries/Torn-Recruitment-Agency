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
    lastActive:Date.now()-60_000, onlineStatus:'Online', doNotContact:false,
    recruitmentFit:86.4, recruitmentConfidence:'High', prospectState:'Active Lead',
    prospectProvenance:{sources:['Recruitment Forum'],state:'Active Lead',freshness:'Fresh'}
  };
  const companyExpanded = CompanyUI.renderCandidates([row], { total:1, layout:'expanded' });
  assert.match(companyExpanded, />Level</);
  assert.match(companyExpanded, />30d Active</);
  assert.match(companyExpanded, />Recruit Fit</);
  assert.match(companyExpanded, />Source</);
  assert.match(companyExpanded, /86\.4/);
  assert.match(companyExpanded, /High/);
  assert.match(companyExpanded, /Recruitment Forum/);
  assert.match(companyExpanded, /Active Lead/);
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
  assert.equal(document.getElementById('ra-card-refresh').textContent, 'Refresh Intelligence');

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


test('v4.9 activity formatting accepts both millisecond and second timestamps', () => {
  const now=Date.now();
  const originalNow=Date.now;
  Date.now=()=>now;
  try{
    assert.equal(App._test.lastActiveText({lastActive:now-2*3600*1000}),'2h');
    assert.equal(App._test.lastActiveText({lastActive:Math.floor(now/1000)-2*3600}),'2h');
  }finally{Date.now=originalNow;}
});

test('v4.9 repeated Torn search persistence records fresh observation time and public age', async () => {
  const db=await App.openDB(indexedDB);
  App._test.state.db=db;
  const before=Date.now();
  await App._test.persistApiSearchCandidate('company',{
    id:777,name:'Repeat Search',level:25,age:4567,faction_id:0,
    last_action:{timestamp:Math.floor((before-3*3600*1000)/1000),status:'Offline'}
  });
  const first=await new Promise((resolve,reject)=>{
    const q=db.transaction('playerIntelligence','readonly').objectStore('playerIntelligence').get('777');
    q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
  });
  assert.equal(first.age,4567);
  assert.ok(Number(first.lastObservedAt)>=before);
  assert.ok(Number(first.lastObservedAt)<=Date.now());
  db.close();
});


test('v4.9 forum rediscovery persists a dedicated observation timestamp', async () => {
  const db=await App.openDB(indexedDB);
  App._test.state.db=db;
  const observedAt=Date.now()-5000;
  await App._test.persistDiscoveredCandidate(
    {feedId:'company',sourceType:'COMPANY FORUM'},
    {userId:'778',name:'Forum Repeat',pipelineStage:'Not Contacted',discoverySources:['COMPANY FORUM']},
    {sourceId:'COMPANY FORUM:778:1',sourceType:'COMPANY FORUM',observedAt,postedAt:observedAt}
  );
  const player=await new Promise((resolve,reject)=>{
    const q=db.transaction('playerIntelligence','readonly').objectStore('playerIntelligence').get('778');
    q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
  });
  assert.equal(player.lastObservedAt,observedAt);
  db.close();
});


test('v4.9 work-stat HOF normalization keeps total separate from unknown MAN INT END', () => {
  const row=App._test.normalizeWorkstatHofCandidate({
    id:8801,username:'Passive Prospect',level:44,age_in_days:3210,faction_id:91,
    last_action:Math.floor(Date.now()/1000)-3600,value:987654,position:125,rank_name:'Professional'
  });
  assert.equal(row.userId,'8801');
  assert.equal(row.name,'Passive Prospect');
  assert.equal(row.level,44);
  assert.equal(row.age,3210);
  assert.equal(row.total,987654);
  assert.equal(row.factionId,91);
  assert.ok(row.lastActive>1e12);
  assert.equal(Object.hasOwn(row,'man'),false);
  assert.equal(Object.hasOwn(row,'int'),false);
  assert.equal(Object.hasOwn(row,'end'),false);
});

test('v4.9 work-stat HOF discovery is explicit bounded and does not perform per-player enrichment', async () => {
  const calls=[],persisted=[];
  const result=await App._test.discoverWorkstatProspects({limit:999,offset:-50,minTotal:500},{
    tornRequest:async(path,params)=>{
      calls.push({path,params});
      return {hof:[
        {id:8802,username:'Keep',value:1000,last_action:100},
        {id:8803,username:'Skip',value:100,last_action:100}
      ]};
    },
    persistCandidate:async(raw,observedAt)=>{persisted.push({raw,observedAt});}
  });
  assert.deepEqual(calls,[{path:'torn/hof',params:{cat:'workstats',limit:100,offset:0}}]);
  assert.equal(result.requested,2);
  assert.equal(result.imported,1);
  assert.equal(result.skipped,1);
  assert.equal(result.limit,100);
  assert.equal(result.offset,0);
  assert.equal(result.nextOffset,2);
  assert.equal(persisted.length,1);
  assert.equal(persisted[0].raw.id,8802);
  assert.equal(calls.filter(call=>/^user\//.test(call.path)).length,0);
});

test('v4.9 work-stat HOF persistence deduplicates into shared intelligence and preserves Company private state', async () => {
  const db=await App.openDB(indexedDB);
  App._test.state.db=db;
  const observedAt=Date.now()-1000;
  await put(db,'companyRecruitment',{
    userId:'8804',domain:'company',pipelineStage:'Contacted',availability:'Available',
    recruiterNote:'PRIVATE KEEP',doNotContact:true,doNotContactReason:'Do not message',
    discoverySources:['TORN API SEARCH'],createdAt:observedAt-10000,updatedAt:observedAt-5000
  });
  await App._test.persistWorkstatHofCandidate({
    id:8804,username:'Known Prospect',level:55,age_in_days:4000,faction_id:12,
    last_action:Math.floor((observedAt-3600000)/1000),value:7654321
  },observedAt);
  await App._test.persistWorkstatHofCandidate({
    id:8804,username:'Known Prospect',level:55,age_in_days:4000,faction_id:12,
    last_action:Math.floor((observedAt-1800000)/1000),value:7654321
  },observedAt+500);

  const read=(store,key)=>new Promise((resolve,reject)=>{
    const q=db.transaction(store,'readonly').objectStore(store).get(key);
    q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>reject(q.error);
  });
  const company=await read('companyRecruitment','8804');
  const player=await read('playerIntelligence','8804');
  const faction=await read('factionRecruitment','8804');

  assert.equal(company.pipelineStage,'Contacted');
  assert.equal(company.recruiterNote,'PRIVATE KEEP');
  assert.equal(company.doNotContact,true);
  assert.deepEqual(company.discoverySources.sort(),['TORN API SEARCH','WORKSTAT LEADERBOARD'].sort());
  assert.equal(player.total,7654321);
  assert.equal(player.age,4000);
  assert.equal(player.level,55);
  assert.equal(player.lastObservedAt,observedAt+500);
  assert.equal(Object.hasOwn(player,'man'),false);
  assert.equal(Object.hasOwn(player,'int'),false);
  assert.equal(Object.hasOwn(player,'end'),false);
  assert.equal(faction,null);
  db.close();
});

test('v4.9 Company results expose passive HOF discovery as an explicit action', () => {
  const html=CompanyUI.renderCandidates([], {total:0,layout:'expanded'});
  assert.match(html,/id="ra-company-hof-discover"/);
  assert.match(html,/Discover Workstat Prospects/);
});


test('v4.9 Company role-profile requirements are explicit and Faction remains unaffected', () => {
  assert.deepEqual(App._test.matchProfileRequirements({
    criteria:{
      man:{enabled:true,target:50000},
      int:{enabled:false,target:70000},
      end:{enabled:true,target:120000}
    }
  }),{minMan:50000,minEnd:120000});
});

test('v4.9 Player Card shows the active Company recruitment profile while keeping Faction on its own default', async () => {
  const dom = new JSDOM('<!doctype html><html><body><aside id="ra-drawer" class="ra-drawer" hidden></aside></body></html>', { url:'https://www.torn.com/' });
  global.window=dom.window;
  global.document=dom.window.document;
  const db=await App.openDB(indexedDB);
  App._test.state.db=db;
  App._test.state.settings=App.mergeSettings({match:{activeProfileId:'sales-role'}});
  App._test.state.playerCard={domain:'company',userId:'',pinned:false,popout:false};

  await put(db,'matchProfiles',{
    profileId:'sales-role',name:'Sales Role',
    criteria:{man:{enabled:true,target:100,weight:10}},
    searchFilters:{company:{}}
  });
  await put(db,'playerIntelligence',{userId:'9901',name:'Profile Test',man:100,int:200,end:300});
  await put(db,'companyRecruitment',{userId:'9901',domain:'company',pipelineStage:'Not Contacted'});
  await put(db,'factionRecruitment',{userId:'9901',domain:'faction',pipelineStage:'Prospect'});

  await App._test.openPlayerCard('company','9901',{force:true});
  assert.match(document.getElementById('ra-drawer').textContent,/Sales Role/);

  await App._test.openPlayerCard('faction','9901',{force:true});
  assert.match(document.getElementById('ra-drawer').textContent,/Faction default/);
  assert.doesNotMatch(document.getElementById('ra-drawer').textContent,/Sales Role/);

  db.close();
  dom.window.close();
});


test('v4.9 Player Card watch reuses Company Talent Pool and never creates Faction workflow state', async () => {
  const db=await App.openDB(indexedDB);
  App._test.state.db=db;
  await put(db,'companyRecruitment',{
    userId:'9902',domain:'company',pipelineStage:'Not Contacted',recruiterNote:'KEEP',
    talentPool:false,cycles:[],events:[]
  });

  const watched=await App._test.setCompanyWatchlist('9902',true);
  assert.equal(watched.talentPool,true);
  assert.equal(watched.talentPoolReason,'Watched from Player Card');
  assert.equal(watched.recruiterNote,'KEEP');

  const unwatched=await App._test.setCompanyWatchlist('9902',false);
  assert.equal(unwatched.talentPool,false);
  assert.equal(unwatched.talentPoolReason,'');

  const faction=await new Promise((resolve,reject)=>{
    const q=db.transaction('factionRecruitment','readonly').objectStore('factionRecruitment').get('9902');
    q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>reject(q.error);
  });
  assert.equal(faction,null);
  db.close();
});


test('v4.9 Faction Player Card uses the active specialist recruitment profile', async () => {
  const dom=new JSDOM('<!doctype html><html><body><aside id="ra-drawer" class="ra-drawer" hidden></aside></body></html>',{url:'https://www.torn.com/'});
  global.window=dom.window;global.document=dom.window.document;
  const db=await App.openDB(indexedDB);
  App._test.state.db=db;
  App._test.state.playerCard={domain:'faction',userId:'',pinned:false,popout:false};

  await put(db,'playerIntelligence',{userId:'991',name:'Faction Fit',rwHits30:80,attacks30:500,lastActive:Date.now()-3600000});
  await put(db,'factionRecruitment',{userId:'991',domain:'faction',pipelineStage:'Prospect',availability:'Unknown',waivers:[]});
  await put(db,'factionSpecialistProfiles',{
    profileId:'rw-role',name:'RW Recruit',status:'Active',
    criteria:[{id:'rw',field:'rwHits30',operator:'gte',value:50,kind:'Preferred',weight:1}],
    searchFilters:{},version:1,createdAt:Date.now(),updatedAt:Date.now()
  });
  await put(db,'factionRecruitmentConfig',{key:'faction',baseline:{criteria:[]},stageThresholds:{},opportunityWeights:{},activeResultsProfileId:'rw-role',updatedAt:Date.now()});

  await App._test.openPlayerCard('faction','991',{force:true});
  assert.match(document.getElementById('ra-drawer').textContent,/RW Recruit/);
  assert.match(document.getElementById('ra-drawer').textContent,/Recruitment Fit/);
  assert.doesNotMatch(document.getElementById('ra-drawer').textContent,/Default Recruit/);

  db.close();dom.window.close();
});

// Verified RA-002 regression coverage retained during RA-003 reconciliation.
test('v4.9 Player Card uses shared intelligence observation time, not workflow edit time', async () => {
  const dom = new JSDOM('<!doctype html><html><body><aside id="ra-drawer" class="ra-drawer" hidden></aside></body></html>', { url:'https://www.torn.com/' });
  global.window = dom.window;
  global.document = dom.window.document;
  const db = await App.openDB(indexedDB);
  App._test.state.db = db;
  App._test.state.settings = App.mergeSettings({});
  App._test.state.playerCard = { domain:'company', userId:'', pinned:false, popout:false };
  await put(db, 'playerIntelligence', {userId:'654',name:'Observed',updatedAt:5000,lastObservedAt:1000});
  await put(db, 'companyRecruitment', {userId:'654',domain:'company',pipelineStage:'Not Contacted',updatedAt:9000});
  await App._test.openPlayerCard('company','654',{force:true});
  const body=document.getElementById('ra-drawer').textContent;
  assert.ok(body.includes(new Date(1000).toLocaleString()));
  assert.ok(!body.includes(new Date(9000).toLocaleString()));
  db.close();
  dom.window.close();
});

test('v4.9 navigation closes Player Card only when changing pages and rememberPanel is disabled',async()=>{
  const dom=new JSDOM('<!doctype html><html><body><div class="ra-shell"><nav id="ra-nav"></nav><h1 id="ra-page-title"></h1><p id="ra-page-desc"></p><main id="ra-content"></main><aside id="ra-drawer"></aside></div></body></html>',{url:'https://www.torn.com/'});
  global.window=dom.window;
  global.document=dom.window.document;
  global.MutationObserver=dom.window.MutationObserver;
  const db=await App.openDB(indexedDB);
  App._test.state.db=db;
  App._test.state.settings=App.mergeSettings({
    activeDomain:'company',
    activePage:'settings',
    optionalModules:{data:true},
    candidates:{playerCard:{rememberPanel:false}}
  });
  App._test.state.page='settings';
  App._test.state.playerCard={domain:'company',userId:'777',pinned:true,popout:true};
  App._test.state.drawerCandidateId='777';
  const drawer=document.getElementById('ra-drawer');
  drawer.hidden=false;

  await App._test.navigate('settings',false);
  assert.equal(drawer.hidden,false);
  assert.equal(App._test.state.playerCard.userId,'777');
  assert.equal(App._test.state.playerCard.pinned,true);

  await App._test.navigate('data',false);
  assert.equal(drawer.hidden,true);
  assert.equal(App._test.state.playerCard.userId,'');
  assert.equal(App._test.state.playerCard.pinned,false);

  db.close();
  dom.window.close();
});

test('v4.9 Player Card Contacted state honors recorded outcomes even after stage changes',async()=>{
  const dom=new JSDOM('<!doctype html><html><body><aside id="ra-drawer" class="ra-drawer" hidden></aside></body></html>',{url:'https://www.torn.com/'});
  global.window=dom.window;
  global.document=dom.window.document;
  const db=await App.openDB(indexedDB);
  App._test.state.db=db;
  App._test.state.settings=App.mergeSettings({});
  App._test.state.playerCard={domain:'company',userId:'',pinned:false,popout:false};
  await put(db,'playerIntelligence',{userId:'888',name:'Outcome Candidate',updatedAt:1000});
  await put(db,'companyRecruitment',{userId:'888',domain:'company',pipelineStage:'Rejected',outcomes:[{kind:'declined',at:900}],updatedAt:1200});
  await App._test.openPlayerCard('company','888',{force:true});
  assert.match(document.getElementById('ra-drawer').textContent,/ContactedContacted/);
  db.close();
  dom.window.close();
});


test('v4.9 workflow edits do not advance Last Observed intelligence time',async()=>{
  const db=await App.openDB(indexedDB);
  App._test.state.db=db;
  await put(db,'playerIntelligence',{userId:'991',name:'Observed',updatedAt:1000,lastObservedAt:1000});
  await App._test.repositories.company.ensure('991',{pipelineStage:'Contacted'},{sharedPatch:{name:'Observed'},source:'company-workflow',observedAt:9000});
  const player=await new Promise((resolve,reject)=>{const q=db.transaction('playerIntelligence','readonly').objectStore('playerIntelligence').get('991');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
  assert.equal(player.updatedAt,9000);
  assert.equal(player.lastObservedAt,1000);
  db.close();
});

test('v4.9 recruitment entry point rechecks current domain DNC state',async()=>{
  const db=await App.openDB(indexedDB);
  App._test.state.db=db;
  App._test.state.settings=App.mergeSettings({});
  await put(db,'companyRecruitment',{userId:'992',domain:'company',pipelineStage:'Not Contacted',doNotContact:true});
  await assert.rejects(()=>App._test.recruitCandidate('company','992','Blocked'),/Do Not Contact is currently set/);
  db.close();
});

test('v4.9 platform overrides must carry explicit DNC confirmation to recruitment entry point',()=>{
  const fs=require('node:fs');
  const company=fs.readFileSync(require.resolve('../src/v46-company-platform'),'utf8');
  const faction=fs.readFileSync(require.resolve('../src/v47-faction-platform'),'utf8');
  assert.match(company,/overrideDnc:override,dncConfirmed:override/);
  assert.match(faction,/overrideDnc:override,dncConfirmed:override/);
});


test('CodeQL workflow is pinned and least-privilege',()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const yaml=fs.readFileSync(path.join(__dirname,'..','.github','workflows','codeql.yml'),'utf8');
  assert.match(yaml,/contents:\s*read/);
  assert.match(yaml,/actions:\s*read/);
  assert.match(yaml,/security-events:\s*write/);
  assert.doesNotMatch(yaml,/packages:\s*read/);
  assert.match(yaml,/actions\/checkout@[0-9a-f]{40}/);
  assert.match(yaml,/github\/codeql-action\/init@[0-9a-f]{40}/);
  assert.match(yaml,/github\/codeql-action\/analyze@[0-9a-f]{40}/);
});


test('legacy startup migration is one-time and cannot use workflow timestamps as observation authority',()=>{
  const fs=require('node:fs');
  const app=fs.readFileSync(require.resolve('../src/v45-app'),'utf8');
  const start=app.indexOf('async function migrateLegacyUsers()');
  const end=app.indexOf('function recruitmentDomainForFeed',start);
  assert.ok(start>=0&&end>start);
  const migration=app.slice(start,end);
  assert.match(migration,/v45-legacy-users-migration-v2/);
  assert.match(migration,/marker\?\.complete===true/);
  assert.match(migration,/skipShared:true/);
  assert.match(migration,/existingFaction/);
  assert.match(migration,/existingCompany/);
  assert.doesNotMatch(migration,/row\.updatedAt|row\.createdAt|candidate\?\.updatedAt|candidate\?\.createdAt/);
});


test('v4.9 acquisition paths preserve missing Scout, work-stat and company facts as unknown',()=>{
  const fs=require('node:fs');
  const source=fs.readFileSync(require.resolve('../src/v45-app'),'utf8');
  assert.match(source,/level:finite\(p\.level\)/);
  assert.match(source,/factionId:finite\(faction\.id\?\?p\.faction_id\)/);
  assert.match(source,/networth:finite\(current\.networth\)/);
  assert.match(source,/workStats\.every\(value=>value!==null\)\?workStats\.reduce/);
  assert.match(source,/eligibility\.known===false\)throw new Error\('Company affiliation data was missing from the Torn response\.'\)/);
  assert.doesNotMatch(source,/view\.total=\[view\.man,view\.int,view\.end\]\.reduce\(\(s,x\)=>s\+\(finite\(x\)\|\|0\),0\)/);
});

test('v4.9 Scout shared patch only persists measured optional facts',()=>{
  const fs=require('node:fs');
  const source=fs.readFileSync(require.resolve('../src/v45-app'),'utf8');
  assert.match(source,/const scoutShared=\{name:profile\.name,lastScoutAt:/);
  assert.match(source,/const measuredFit=finite\(snapshot\.currentFit\?\?snapshot\.originalFit\)/);
  assert.match(source,/if\(measuredFit!==null\)\{scoutShared\.fit=measuredFit;scoutShared\.fitType=/);
  assert.match(source,/if\(value!==null&&value!==undefined&&value!==''\)scoutShared\[key\]=value/);
  assert.match(source,/repositories\.players\.ensure\(String\(id\),scoutShared,'scout',capturedAt\)/);
});

test('v4.9 Company workflow saves never replay candidate facts into shared intelligence',()=>{
  const fs=require('node:fs');
  const source=fs.readFileSync(require.resolve('../src/v45-app'),'utf8');
  const start=source.indexOf('async function saveCandidate(candidate)');
  const end=source.indexOf('async function changeCandidateStage',start);
  assert.ok(start>=0&&end>start);
  const saveCandidate=source.slice(start,end);
  assert.match(saveCandidate,/skipShared:true/);
  assert.doesNotMatch(saveCandidate,/sharedPatch/);
});


test('v4.9 private-chat handoff rechecks current DNC and discards stale draft',async()=>{
  const Messaging=require('../src/v45-messaging');
  const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://www.torn.com/profiles.php?XID=993'});
  global.window=dom.window;
  global.document=dom.window.document;
  global.location=dom.window.location;
  global.localStorage=dom.window.localStorage;

  const db=await App.openDB(indexedDB);
  App._test.state.db=db;
  App._test.state.settings=App.mergeSettings({});
  await put(db,'companyRecruitment',{userId:'993',domain:'company',pipelineStage:'Not Contacted',doNotContact:true});
  const plan=Messaging.recruitmentChatPlan('company','Hello {name}',{userId:'993',name:'Blocked'});
  Messaging.queuePrivateChatDraft(plan,dom.window.localStorage,Date.now());

  await assert.rejects(()=>App._test.restorePendingPrivateChatDraft(20),/Do Not Contact is currently set/);
  assert.equal(dom.window.localStorage.getItem(Messaging.PRIVATE_CHAT_DRAFT_KEY),null);

  db.close();
  dom.window.close();
});


test('v4.9 private-chat input selection requires explicit target identity',()=>{
  const dom=new JSDOM('<!doctype html><html><body><div class="chat-window" data-user-id="111"><textarea id="wrong"></textarea></div><div class="chat-window"><a href="https://www.torn.com/profiles.php?XID=222">Target</a><textarea id="right"></textarea></div></body></html>',{url:'https://www.torn.com/profiles.php?XID=222'});
  global.window=dom.window;
  global.document=dom.window.document;
  global.location=dom.window.location;
  global.getComputedStyle=dom.window.getComputedStyle;
  for(const id of ['wrong','right'])document.getElementById(id).getBoundingClientRect=()=>({width:100,height:20});

  assert.equal(App._test.findPrivateChatInput('222')?.id,'right');
  assert.equal(App._test.findPrivateChatInput('333'),null);
  dom.window.close();
});
