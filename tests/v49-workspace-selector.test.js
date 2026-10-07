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
