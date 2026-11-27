const test=require('node:test');
const assert=require('node:assert/strict');
const {indexedDB}=require('fake-indexeddb');
const App=require('../src/v45-app');
const Shared=require('../src/v46-recruitment-shared');
const CompanyPlatform=require('../src/v46-company-platform');
const FactionPlatform=require('../src/v47-faction-platform');

// Spec-shaped Torn v2 user/search stub: 25 records per call, opaque cursor in _metadata.links.next.
function tornSearch(total){
  const calls=[];
  const request=async(apiPath,params)=>{
    calls.push([apiPath,{...params}]);
    if(apiPath!=='user/search')throw new Error(`unexpected ${apiPath}`);
    const page=params.cursor?Number(String(params.cursor).slice(1)):Math.floor(Number(params.offset||0)/25);
    const search=[];
    for(let i=page*25;i<Math.min(total,(page+1)*25);i++)search.push({id:5000+i,name:`P${i}`,level:10,online:'Offline',faction_id:0,icons:[]});
    const more=(page+1)*25<total;
    const filters=params.filters?`filters=${encodeURIComponent(params.filters)}&`:'';
    return{search,_metadata:{links:{next:more?`https://api.torn.com/v2/user/search?${filters}limit=25&cursor=c${page+1}`:null,prev:page?`https://api.torn.com/v2/user/search?cursor=p${page}`:null},total}};
  };
  return{calls,request};
}

function deps(request,extra={}){
  const persisted=[];
  return{persisted,deps:{
    syncDomainForums:async()=>({postsExamined:0,candidatesCreated:0,candidatesUpdated:0}),
    tornRequest:request,
    persistApiCandidate:async(domain,candidate,context)=>{persisted.push({domain,id:candidate.id,context});return true;},
    ...extra
  }};
}

const searchParams=calls=>calls.map(([,params])=>params);

test('Search sends the visible Company/Faction filters to Torn user/search',async()=>{
  const cases=[
    ['company',{},'lastActionRecent'],
    ['company',{organizationPresence:'none'},'notInCompany,lastActionRecent'],
    ['company',{organizationPresence:'has',onlineStatus:'Online'},'inCompany,lastActionNow'],
    ['company',{organizationPresence:'any',onlineStatus:'Idle'},'lastActionRecent'],
    ['company',{onlineStatus:'Offline'},'lastActionHourAgo'],
    ['faction',{organizationPresence:'none',onlineStatus:'Online'},'notInFaction,lastActionNow'],
    ['faction',{organizationPresence:'has'},'inFaction,lastActionRecent'],
    ['faction',{organizationPresence:'none',minEnd:'100k',minMan:'50k',minInt:'1'},'notInFaction,lastActionRecent']
  ];
  for(const[domain,filters,expected]of cases){
    const {calls,request}=tornSearch(10);
    const {deps:d}=deps(request);
    await App._test.searchCandidates(domain,filters,d);
    assert.deepEqual(searchParams(calls),[{filters:expected}],`${domain} ${JSON.stringify(filters)}`);
  }
});

test('Search pages user/search with the _metadata.links.next cursor, at most 4 calls (100 players)',async()=>{
  const {calls,request}=tornSearch(500);
  const {deps:d,persisted}=deps(request);
  const result=await App._test.searchCandidates('company',{organizationPresence:'none'},d);
  assert.deepEqual(searchParams(calls),[
    {filters:'notInCompany,lastActionRecent'},
    {filters:'notInCompany,lastActionRecent',cursor:'c1'},
    {filters:'notInCompany,lastActionRecent',cursor:'c2'},
    {filters:'notInCompany,lastActionRecent',cursor:'c3'}
  ]);
  assert.equal(result.apiCount,100);
  assert.equal(persisted.length,100);
  assert.equal(result.hasMore,true);
  assert.deepEqual(persisted[0].context,{presence:'none'});
});

test('Search stops paging when Torn returns no next link, even when the forum sync fails',async()=>{
  const {calls,request}=tornSearch(30);
  const {deps:d}=deps(request,{syncDomainForums:async()=>{throw new Error('forum down');}});
  const result=await App._test.searchCandidates('faction',{},d);
  assert.equal(calls.length,2);
  assert.equal(result.apiCount,30);
  assert.equal(result.hasMore,false);
  assert.deepEqual(result.warnings,['Forum: forum down'],'a forum failure does not block Torn API results');
});

test('Search more continues from the stored cursor without re-running the forum sync',async()=>{
  const {calls,request}=tornSearch(190);
  let forum=0;
  const {deps:d}=deps(request,{syncDomainForums:async()=>{forum++;return{postsExamined:0};}});
  await App._test.searchCandidates('company',{organizationPresence:'has'},d);
  assert.equal(forum,1);
  calls.length=0;
  const more=await App._test.searchCandidates('company',{organizationPresence:'has'},d,{more:true});
  assert.equal(forum,1,'Search more only asks Torn for more players');
  assert.deepEqual(searchParams(calls),[
    {filters:'inCompany,lastActionRecent',cursor:'c4'},
    {filters:'inCompany,lastActionRecent',cursor:'c5'},
    {filters:'inCompany,lastActionRecent',cursor:'c6'},
    {filters:'inCompany,lastActionRecent',cursor:'c7'}
  ]);
  assert.equal(more.apiCount,90);
  assert.equal(more.hasMore,false);
  calls.length=0;
  const done=await App._test.searchCandidates('company',{organizationPresence:'has'},d,{more:true});
  assert.equal(calls.length,0,'an exhausted search makes no further calls');
  assert.equal(done.apiCount,0);
});

test('Search more starts over when the filters changed, and the other workspace keeps its own cursor',async()=>{
  const {calls,request}=tornSearch(500);
  const {deps:d}=deps(request);
  await App._test.searchCandidates('company',{organizationPresence:'none'},d);
  await App._test.searchCandidates('faction',{organizationPresence:'none'},d);
  calls.length=0;
  await App._test.searchCandidates('company',{organizationPresence:'none',onlineStatus:'Online'},d,{more:true});
  assert.deepEqual(searchParams(calls)[0],{filters:'notInCompany,lastActionNow'},'changed filters reset the cursor');
  calls.length=0;
  await App._test.searchCandidates('faction',{organizationPresence:'none'},d,{more:true});
  assert.deepEqual(searchParams(calls)[0],{filters:'notInFaction,lastActionRecent',cursor:'c4'});
});

test('Name search keeps name-only params by default, adds chosen filters and pages by offset',async()=>{
  const {calls,request}=tornSearch(60);
  const {deps:d}=deps(request);
  await App._test.searchCandidates('company',{search:'Alice',organizationPresence:'none'},d);
  assert.deepEqual(searchParams(calls),[
    {name:'Alice',filters:'notInCompany'},
    {name:'Alice',filters:'notInCompany',offset:25},
    {name:'Alice',filters:'notInCompany',offset:50}
  ]);
  calls.length=0;
  await App._test.searchCandidates('faction',{search:'Bob',onlineStatus:'Online'},d);
  assert.deepEqual(searchParams(calls)[0],{name:'Bob',filters:'lastActionNow'});
});

test('completion toast explains that END/MAN/INT are not public in Torn API',()=>{
  assert.equal(App._test.searchSummary(100,3),"Search complete: 100 players from Torn, 3 from forum posts. END/MAN/INT aren't public in Torn's API, so they show as Unknown until known.");
});

test('stat minimums keep players whose stat is Unknown but drop known stats below the minimum',()=>{
  const org=()=>({state:'unknown',label:'Unknown'});
  const rows=[
    {userId:'1',name:'Unknown',end:null,man:undefined,int:''},
    {userId:'2',name:'Low',end:50000,man:90000,int:90000},
    {userId:'3',name:'High',end:200000,man:90000,int:90000},
    {userId:'4',name:'LowMan',end:200000,man:10,int:null}
  ];
  const ids=list=>list.map(row=>row.userId);
  assert.deepEqual(ids(Shared.filterRows(rows,{minEnd:'100k'},org)),['1','3','4']);
  assert.deepEqual(ids(Shared.filterRows(rows,{minEnd:'100k',minMan:'50k',minInt:'50k'},org)),['1','3']);
  for(const platform of [CompanyPlatform,FactionPlatform])assert.deepEqual(ids(platform._test.filterRows(rows,{minEnd:'100k'})),['1','3','4']);
  for(const direction of ['asc','desc'])assert.equal(Shared.sortRows(rows,{key:'end',direction}).at(-1).userId,'1','Unknown stats sort last');
});

test('Company presence seen by a Torn filtered search is recorded without inventing a company',async()=>{
  const db=await App.openDB(indexedDB);App._test.state.db=db;
  await App._test.clearRecruitmentData();
  const read=(store,key)=>new Promise((resolve,reject)=>{const q=db.transaction(store,'readonly').objectStore(store).get(key);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
  const raw={id:321,name:'Free Agent',level:12,online:'Online',faction_id:0,icons:[]};
  await App._test.persistApiSearchCandidate('company',raw,{presence:'none'});
  let player=await read('playerIntelligence','321');
  assert.equal(player.currentCompanyId,0);
  assert.equal(player.end,undefined,'no work stats are fabricated');
  assert.deepEqual(CompanyPlatform._test.organizationInfo({playerRecord:player}),{state:'none',label:'None'});
  await App._test.persistApiSearchCandidate('company',raw,{presence:'has'});
  player=await read('playerIntelligence','321');
  assert.equal(player.currentCompanyId,null,'a stale "no company" is cleared, no company id is invented');
  assert.deepEqual(CompanyPlatform._test.organizationInfo({playerRecord:player}),{state:'has',label:'In a company'});
  assert.equal(CompanyPlatform._test.filterRows([{userId:'321',playerRecord:player}],{organizationPresence:'has'}).length,1);
  db.close();
});
