(function(root,factory){
  const deps={
    FactionCore:root&&root.RA_V47FactionCore,
    FactionUI:root&&root.RA_V47FactionUI,
    Messaging:root&&root.RA_V45Messaging,
    ResultsCore:root&&root.RA_ResultsCore
  };
  if(typeof module==='object'&&module.exports){
    deps.FactionCore=require('./v47-faction-core');
    deps.FactionUI=require('./v47-faction-ui');
    deps.Messaging=require('./v45-messaging');
    deps.ResultsCore=require('./results-core');
  }
  const api=factory(deps);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V47FactionPlatform=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(D){
  'use strict';

  const {FactionCore,FactionUI,Messaging,ResultsCore}=D;
  if(!FactionCore||!FactionUI||!Messaging||!ResultsCore)throw new Error('Faction platform dependencies are required.');

  const FACTION_ROUTES=Object.freeze(['faction-candidates']);
  const IMPLEMENTED_ROUTES=new Set(FACTION_ROUTES);
  const META=Object.freeze({
    'faction-candidates':['Faction Candidates','Search and manage Faction recruitment candidates.']
  });
  const DEFAULT_SEARCH_FILTERS=Object.freeze({search:'',minEnd:'',minMan:'',minInt:'',onlineStatus:'',organization:'',organizationPresence:'any'});
  const DEFAULT_SORT=Object.freeze({key:'player',direction:'asc'});
  const RESULTS_PAGE_SIZE=100;
  const SORT_KEYS=new Set(['player','level','age','end','man','int','activity30','activeStreak','networth','xanax30','recruitmentFit','lastActive']);
  const runtime={app:null,observer:null,originalHandlers:new Map(),installed:false,searchFilters:{...DEFAULT_SEARCH_FILTERS},sort:{...DEFAULT_SORT},resultPage:0};

  const text=value=>String(value??'').trim();
  const number=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
  function parseThreshold(value){const raw=text(value).toLowerCase().replace(/,/g,'');if(!raw)return null;const match=raw.match(/^(\d+(?:\.\d+)?|\.\d+)\s*([kmb])?$/);if(!match)return null;const mult={k:1e3,m:1e6,b:1e9}[match[2]]||1;const out=Number(match[1])*mult;return Number.isFinite(out)?out:null;}
  function organizationInfo(row={}){const player=row.player||{};const name=text(row.factionName||player.factionName);const rawId=row.factionId??player.factionId;if(name)return{state:'has',label:name};if(rawId!==null&&rawId!==undefined&&rawId!==''){const id=Number(rawId);if(Number.isFinite(id)){if(id===0)return{state:'none',label:'None'};if(id>0)return{state:'has',label:`Faction #${id}`};}}return{state:'unknown',label:'Unknown'};}
  function filterRows(rows,filters={}){const search=text(filters.search).toLowerCase(),minEnd=parseThreshold(filters.minEnd),minMan=parseThreshold(filters.minMan),minInt=parseThreshold(filters.minInt),onlineStatus=text(filters.onlineStatus).toLowerCase(),organization=text(filters.organization).toLowerCase(),presence=text(filters.organizationPresence).toLowerCase()||'any';return (Array.isArray(rows)?rows:[]).filter(row=>{if(search&&!`${text(row.name).toLowerCase()} ${text(row.userId)}`.includes(search))return false;if(minEnd!==null&&(!Number.isFinite(Number(row.end))||row.end===null||row.end===undefined||row.end===''||Number(row.end)<minEnd))return false;if(minMan!==null&&(!Number.isFinite(Number(row.man))||row.man===null||row.man===undefined||row.man===''||Number(row.man)<minMan))return false;if(minInt!==null&&(!Number.isFinite(Number(row.int))||row.int===null||row.int===undefined||row.int===''||Number(row.int)<minInt))return false;if(onlineStatus&&text(row.onlineStatus).toLowerCase()!==onlineStatus)return false;const org=organizationInfo(row);if(organization&&(org.state!=='has'||!org.label.toLowerCase().includes(organization)))return false;if(presence==='has'&&org.state!=='has')return false;if(presence==='none'&&org.state!=='none')return false;return true;});}
  function sortValue(row,key,now){if(key==='player')return text(row.name).toLowerCase()||null;if(['level','age','end','man','int','activity30','activeStreak','networth','xanax30','recruitmentFit'].includes(key)){const raw=row[key];if(raw===null||raw===undefined||raw==='')return null;const value=Number(raw);return Number.isFinite(value)?value:null;}if(key==='lastActive'){const ts=Number(row.lastActive);if(Number.isFinite(ts)&&ts>0)return ts;const status=text(row.onlineStatus).toLowerCase();if(status==='online')return now+2;if(status==='idle')return now+1;if(status==='offline')return 0;return null;}return null;}
  function sortTieBreak(a,b){const byName=text(a.name).localeCompare(text(b.name),undefined,{sensitivity:'base'});if(byName)return byName;return text(a.userId).localeCompare(text(b.userId),undefined,{numeric:true});}
  function sortRows(rows,sortState=DEFAULT_SORT,now=Date.now()){const key=SORT_KEYS.has(text(sortState?.key))?text(sortState.key):DEFAULT_SORT.key;const direction=sortState?.direction==='desc'?'desc':'asc';const sign=direction==='asc'?1:-1;return [...(Array.isArray(rows)?rows:[])].sort((a,b)=>{const av=sortValue(a,key,now),bv=sortValue(b,key,now),am=av===null||av===undefined,bm=bv===null||bv===undefined;if(am!==bm)return am?1:-1;if(am&&bm)return sortTieBreak(a,b);const cmp=key==='player'?String(av).localeCompare(String(bv)):Number(av)-Number(bv);return cmp?cmp*sign:sortTieBreak(a,b);});}
  function toggleSort(current,key){const nextKey=SORT_KEYS.has(text(key))?text(key):DEFAULT_SORT.key;if(text(current?.key)===nextKey)return{key:nextKey,direction:current?.direction==='asc'?'desc':'asc'};return{key:nextKey,direction:nextKey==='player'?'asc':'desc'};}
  function normalizeResultsView(raw={}){const src=raw&&typeof raw.filters==='object'&&raw.filters?raw.filters:{};const filters={...DEFAULT_SEARCH_FILTERS};for(const key of Object.keys(DEFAULT_SEARCH_FILTERS))if(src[key]!==undefined&&src[key]!==null)filters[key]=text(src[key]);if(!['any','has','none'].includes(filters.organizationPresence))filters.organizationPresence='any';const key=SORT_KEYS.has(text(raw?.sort?.key))?text(raw.sort.key):DEFAULT_SORT.key;return{filters,sort:{key,direction:raw?.sort?.direction==='desc'?'desc':'asc'},resultPage:Math.max(0,Math.floor(number(raw?.resultPage,0))),profileId:text(raw?.profileId),profileVersion:text(raw?.profileVersion)};}
  function savedResultsView(app){const raw=app?._test?.state?.settings?.candidates?.resultsView?.faction;return raw&&typeof raw==='object'?normalizeResultsView(raw):null;}
  async function persistResultsView(app){if(typeof app?.saveResultsView!=='function')return;const view=normalizeResultsView({filters:runtime.searchFilters,sort:runtime.sort,resultPage:runtime.resultPage,profileId:runtime.profileFiltersId,profileVersion:runtime.profileFiltersVersion});const key=JSON.stringify(view);if(key===runtime.savedResultsViewKey)return;runtime.savedResultsViewKey=key;await app.saveResultsView('faction',view);}
  let idSequence=0;
  function makeId(prefix){
    const uuid=globalThis.crypto?.randomUUID?.();
    if(uuid)return `${prefix}-${uuid}`;
    idSequence=(idSequence+1)%1000000;
    return `${prefix}-${Date.now()}-${idSequence}`;
  }

  function isFactionRoute(value){return FACTION_ROUTES.includes(text(value));}
  function routeMeta(route){const [title,description]=META[text(route)]||META['faction-overview'];return{title,description};}
  function profileSearchFilters(profile={}){
    const saved=FactionCore.normalizeFactionSearchFilters(profile?.searchFilters||{});
    const out={...DEFAULT_SEARCH_FILTERS,...saved};
    for(const [field,key] of [['end','minEnd'],['man','minMan'],['int','minInt']]){
      if(profile.searchFiltersCustom===true||text(out[key]))continue;
      const req=(Array.isArray(profile?.criteria)?profile.criteria:[]).find(item=>text(item.field).toLowerCase()===field&&['gte','gt'].includes(text(item.operator).toLowerCase())&&Number.isFinite(Number(item.value))&&Number(item.value)>0);
      if(req)out[key]=String(req.value);
    }
    return out;
  }
  function activeResultsProfile(config={},profiles=[]){
    const id=text(config.activeResultsProfileId);
    return id?(Array.isArray(profiles)?profiles:[]).map(FactionCore.normalizeSpecialistProfile).find(profile=>profile.profileId===id)||null:null;
  }

  function dbGetAll(db,store){return new Promise(resolve=>{try{const q=db.transaction(store,'readonly').objectStore(store).getAll();q.onsuccess=()=>resolve(q.result||[]);q.onerror=()=>resolve([]);}catch{resolve([]);}});}
  function dbGet(db,store,key){return new Promise(resolve=>{try{const q=db.transaction(store,'readonly').objectStore(store).get(key);q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>resolve(null);}catch{resolve(null);}});}
  function dbPut(db,store,value){return new Promise((resolve,reject)=>{try{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error||new Error(`Failed to save ${store}.`));}catch(error){reject(error);}});}
  function dbDelete(db,store,key){return new Promise((resolve,reject)=>{try{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error||new Error(`Failed to delete from ${store}.`));}catch(error){reject(error);}});}

  async function getConfig(app){if(app?._test?.factionRepositories?.config?.get)return app._test.factionRepositories.config.get();return(await dbGet(app._test.state.db,'factionRecruitmentConfig','faction'))||{key:'faction',baseline:{criteria:[]},stageThresholds:{},opportunityWeights:{}};}
  async function saveConfig(app,patch){if(app?._test?.factionRepositories?.config?.save)return app._test.factionRepositories.config.save(patch);const existing=await getConfig(app);const next={...existing,...patch,key:'faction',updatedAt:Date.now()};await dbPut(app._test.state.db,'factionRecruitmentConfig',next);return next;}
  async function getProfiles(app){if(app?._test?.factionRepositories?.profiles?.list)return app._test.factionRepositories.profiles.list();return dbGetAll(app._test.state.db,'factionSpecialistProfiles');}
  async function saveProfile(app,profile){if(app?._test?.factionRepositories?.profiles?.save)return app._test.factionRepositories.profiles.save(profile);const next=FactionCore.normalizeSpecialistProfile({...profile,profileId:text(profile.profileId)||makeId('profile'),updatedAt:Date.now()});await dbPut(app._test.state.db,'factionSpecialistProfiles',next);return next;}
  async function removeProfile(app,profileId){if(app?._test?.factionRepositories?.profiles?.remove)return app._test.factionRepositories.profiles.remove(profileId);return dbDelete(app._test.state.db,'factionSpecialistProfiles',text(profileId));}



  async function buildRows(app){
    const db=app._test.state.db;
    const[factionRecords,players,candidateLocals,config,profiles]=await Promise.all([dbGetAll(db,'factionRecruitment'),dbGetAll(db,'playerIntelligence'),dbGetAll(db,'candidateLocal'),getConfig(app),getProfiles(app)]);
    const candidateMap=new Map(candidateLocals.map(candidate=>[text(candidate?.userId??candidate?.id),candidate]));
    const activeProfile=activeResultsProfile(config,profiles);
    return FactionUI.buildCandidateRows(factionRecords,players,{baseline:config.baseline||{},profiles}).map(row=>{const candidate=candidateMap.get(text(row.userId))||{};const stats=candidate.stats||{};const player=row.player||{};const selectedEvaluation=activeProfile?(row.profileEvaluations||[]).find(item=>text(item.profileId)===activeProfile.profileId):null;const enriched={...row,man:player.man??stats.man??candidate.man??null,int:player.int??stats.int??candidate.int??null,end:player.end??stats.end??candidate.end??null,total:player.total??stats.total??candidate.total??null,onlineStatus:text(player.onlineStatus)||text(row.onlineStatus),candidateLocal:candidate,eligibilityScore:selectedEvaluation?.matchScore??null,eligibility:selectedEvaluation?.eligibility??null};const intelligence=ResultsCore.recruitmentFit(enriched,{domain:'faction',useEligibility:Boolean(activeProfile)});return{...enriched,recruitmentFit:intelligence.score,recruitmentConfidence:intelligence.confidence,recruitmentFitBreakdown:intelligence.components,prospectProvenance:intelligence.provenance,prospectState:intelligence.provenance.state,intelligenceFreshness:intelligence.provenance.freshness,activeRecruitmentProfileId:activeProfile?.profileId||'',activeRecruitmentProfileName:activeProfile?.name||''};});
  }


  async function persistRoute(app,page){
    const state=app?._test?.state;if(!state?.db)return false;
    state.page=page;state.settings=state.settings||{};state.settings.activePage=page;
    const meta=await dbGet(state.db,'meta','global')||{key:'global',settings:{}};
    meta.settings={...(meta.settings||{}),activePage:page};
    await dbPut(state.db,'meta',meta);
    return true;
  }

  function claimRoute(app,page){const state=app?._test?.state,route=text(page);if(!state||!IMPLEMENTED_ROUTES.has(route))return false;state.page=route;state.settings=state.settings||{};state.settings.activePage=route;return true;}
  function navigate(page,persist=true){const route=text(page);if(!runtime.app||!IMPLEMENTED_ROUTES.has(route))return Promise.resolve(false);if(typeof runtime.app.navigate==='function')return Promise.resolve(runtime.app.navigate(route,persist));claimRoute(runtime.app,route);return renderPage(route,{persist});}

  function readCriteria(host){
    if(!host)return[];
    return[...host.querySelectorAll('[data-faction-criterion-row]')].map((row,index)=>{
      const get=key=>row.querySelector(`[data-faction-criterion-field="${key}"]`)?.value??'';
      const rawValue=get('value');const numericValue=rawValue!==''&&Number.isFinite(Number(rawValue))?Number(rawValue):rawValue;
      return{id:text(row.dataset.factionCriterionId)||makeId(`criterion-${index+1}`),label:text(get('label')),field:text(get('field')),operator:text(get('operator'))||'gte',kind:text(get('kind'))==='Hard'?'Hard':'Preferred',value:numericValue,weight:Math.max(0,number(get('weight'),1))};
    });
  }

  async function rowFor(userId){const rows=await buildRows(runtime.app);const row=rows.find(item=>text(item.userId)===text(userId));if(!row)throw new Error('Faction candidate was not found.');return row;}





  async function saveBaselineFromUi(){const host=document.getElementById('ra-faction-baseline-criteria');return saveConfig(runtime.app,{baseline:{criteria:readCriteria(host)}});}
  async function createProfile(){return saveProfile(runtime.app,{profileId:makeId('profile'),name:'New Specialist Profile',status:'Draft',criteria:[],notes:''});}
  async function saveProfileFromCard(profileId){const card=document.querySelector(`[data-faction-profile-card="${profileId}"]`);if(!card)throw new Error('Specialist profile was not found.');const profiles=await getProfiles(runtime.app);const existing=profiles.find(profile=>text(profile.profileId)===text(profileId));if(!existing)throw new Error('Specialist profile was not found.');const criteriaHost=card.querySelector('[data-faction-profile-criteria]');return saveProfile(runtime.app,{...existing,name:text(card.querySelector('[data-faction-profile-field="name"]')?.value),status:text(card.querySelector('[data-faction-profile-field="status"]')?.value)||'Draft',notes:text(card.querySelector('[data-faction-profile-field="notes"]')?.value),criteria:readCriteria(criteriaHost)});}



  function recruitPlayer(row,override=false){
    if(row.doNotContact&&!override)throw new Error('This player is marked Do Not Contact. Use the deliberate override control if contact is still required.');
    if(override){if(typeof globalThis.confirm!=='function')throw new Error('Do Not Contact override confirmation is unavailable. Recruitment stopped.');if(!globalThis.confirm('This player is marked Do Not Contact. Override it for this recruitment chat only?'))return false;}
    if(typeof runtime.app?.recruitCandidate!=='function')throw new Error('Recruit workflow is unavailable.');
    return runtime.app.recruitCandidate?.('faction',row.userId,row.name,{overrideDnc:override,dncConfirmed:override});
  }


  function syncActiveNav(page){document.querySelectorAll('#ra-nav [data-page]').forEach(button=>button.classList.toggle('active',button.dataset.page===page));}
  function reportError(error){console.error('[RA v4.7 Faction]',error);try{globalThis.alert?.(`Faction Recruitment failed: ${error?.message||error}`);}catch{}}

  function addCriterionRow(host,scope){if(!host)return;host.insertAdjacentHTML('beforeend',FactionUI.renderCriterionRow({id:makeId('criterion'),field:'level',operator:'gte',kind:'Preferred',weight:1},scope));}
  function bindProfileEditor(){
    const editor=document.getElementById('ra-faction-profile-editor');if(!editor)return;
    const rerender=async work=>{try{runtime.profileEditorOpen=true;await work();await renderPage('faction-candidates',{persist:false});}catch(error){reportError(error);}};
    editor.ontoggle=()=>{runtime.profileEditorOpen=editor.open;};
    editor.onclick=event=>{
      const target=event.target?.closest?.('button');if(!target)return;const data=target.dataset;
      if(data.factionRemoveCriterion!==undefined)target.closest('[data-faction-criterion-row]')?.remove();
      else if(target.id==='ra-faction-baseline-add')addCriterionRow(document.getElementById('ra-faction-baseline-criteria'),'baseline');
      else if(target.id==='ra-faction-baseline-save')rerender(saveBaselineFromUi);
      else if(target.id==='ra-faction-profile-new')rerender(createProfile);
      else if(data.factionProfileAddCriterion)addCriterionRow(document.querySelector(`[data-faction-profile-card="${data.factionProfileAddCriterion}"] [data-faction-profile-criteria]`),`profile:${data.factionProfileAddCriterion}`);
      else if(data.factionProfileSave)rerender(()=>saveProfileFromCard(data.factionProfileSave));
      else if(data.factionProfileDelete){if(globalThis.confirm&&!globalThis.confirm('Delete this specialist profile?'))return;rerender(()=>removeProfile(runtime.app,data.factionProfileDelete));}
    };
  }


  function readVisibleSearchFilters(){return {search:text(document.getElementById('ra-faction-filter-search')?.value),minEnd:text(document.getElementById('ra-faction-filter-end')?.value),minMan:text(document.getElementById('ra-faction-filter-man')?.value),minInt:text(document.getElementById('ra-faction-filter-int')?.value),onlineStatus:text(document.getElementById('ra-faction-filter-status')?.value),organization:text(document.getElementById('ra-faction-filter-organization')?.value),organizationPresence:text(document.getElementById('ra-faction-filter-organization-presence')?.value)||'any'};}
  function bindContentControls(){
    document.getElementById('ra-faction-search-apply')?.addEventListener('click',async event=>{const button=event?.currentTarget;runtime.resultPage=0;runtime.searchFilters=readVisibleSearchFilters();try{if(button){button.disabled=true;button.textContent='Searching…';}if(typeof runtime.app?.searchCandidates!=='function')throw new Error('Active candidate search is unavailable.');await runtime.app.searchCandidates('faction',runtime.searchFilters);await renderPage('faction-candidates',{persist:false});}catch(error){reportError(error);renderPage('faction-candidates',{persist:false}).catch(reportError);}finally{if(button?.isConnected){button.disabled=false;button.textContent='Search';}}});
    document.getElementById('ra-faction-search-clear')?.addEventListener('click',()=>{runtime.resultPage=0;runtime.searchFilters={...DEFAULT_SEARCH_FILTERS};renderPage('faction-candidates',{persist:false}).catch(reportError);});
    document.getElementById('ra-faction-profile-apply')?.addEventListener('click',async()=>{try{const profileId=text(document.getElementById('ra-faction-results-profile')?.value);const profiles=await getProfiles(runtime.app);const profile=profileId?profiles.find(item=>text(item.profileId)===profileId):null;if(profileId&&!profile)throw new Error('Faction specialist profile was not found.');await saveConfig(runtime.app,{activeResultsProfileId:profileId});runtime.resultPage=0;runtime.searchFilters=profile?profileSearchFilters(profile):{...DEFAULT_SEARCH_FILTERS};await renderPage('faction-candidates',{persist:false});}catch(error){reportError(error);}});
    document.getElementById('ra-faction-profile-clear')?.addEventListener('click',async()=>{try{await saveConfig(runtime.app,{activeResultsProfileId:''});runtime.resultPage=0;runtime.searchFilters={...DEFAULT_SEARCH_FILTERS};await renderPage('faction-candidates',{persist:false});}catch(error){reportError(error);}});
    document.getElementById('ra-faction-profile-save-search')?.addEventListener('click',async()=>{try{const profileId=text(document.getElementById('ra-faction-results-profile')?.value);if(!profileId)throw new Error('Choose a Faction specialist profile first.');const profiles=await getProfiles(runtime.app);const profile=profiles.find(item=>text(item.profileId)===profileId);if(!profile)throw new Error('Faction specialist profile was not found.');runtime.searchFilters=readVisibleSearchFilters();await saveProfile(runtime.app,{...profile,searchFilters:runtime.searchFilters,searchFiltersCustom:true});await saveConfig(runtime.app,{activeResultsProfileId:profileId});await renderPage('faction-candidates',{persist:false});}catch(error){reportError(error);}});
    document.querySelectorAll('#ra-content [data-faction-sort]').forEach(button=>{button.onclick=()=>{runtime.resultPage=0;runtime.sort=toggleSort(runtime.sort,button.dataset.factionSort);renderPage('faction-candidates',{persist:false}).catch(reportError);};});document.querySelectorAll('#ra-content [data-results-page]').forEach(button=>{button.onclick=()=>{runtime.resultPage=Math.max(0,runtime.resultPage+(button.dataset.resultsPage==='next'?1:-1));renderPage('faction-candidates',{persist:false}).catch(reportError);};});document.querySelectorAll('#ra-content [data-results-layout]').forEach(button=>{button.onclick=()=>{if(typeof runtime.app?.setResultsLayout!=='function')return;runtime.app.setResultsLayout(button.dataset.resultsLayout).then(()=>renderPage('faction-candidates',{persist:false})).catch(reportError);};});document.querySelectorAll('#ra-content [data-player-card]').forEach(link=>{link.onclick=event=>{event.preventDefault();runtime.app?.openPlayerCard?.('faction',link.dataset.playerCard);};});
    document.querySelectorAll('[data-go-page]').forEach(button=>{const route=text(button.dataset.goPage);if(isFactionRoute(route))button.onclick=event=>{event?.preventDefault?.();navigate(route,true).catch(reportError);};});
    bindProfileEditor();
    document.querySelectorAll('[data-faction-recruit]').forEach(button=>button.onclick=()=>rowFor(button.dataset.factionRecruit).then(row=>recruitPlayer(row,false)).catch(reportError));
    document.querySelectorAll('[data-faction-recruit-override]').forEach(button=>button.onclick=()=>rowFor(button.dataset.factionRecruitOverride).then(row=>recruitPlayer(row,true)).catch(reportError));









  }

  async function renderPage(page,options={}){
    const app=runtime.app;page=text(page);
    if(!app||!IMPLEMENTED_ROUTES.has(page))return false;
    if(options.persist!==false)claimRoute(app,page);
    const title=document.getElementById('ra-page-title'),desc=document.getElementById('ra-page-desc'),content=document.getElementById('ra-content');
    if(!title||!desc||!content)throw new Error('Recruitment Agency shell is not mounted.');
    const rows=await buildRows(app);
    let html='';

    if(page==='faction-candidates'){const [config,profiles]=await Promise.all([getConfig(app),getProfiles(app)]);const selected=activeResultsProfile(config,profiles);const selectedId=text(selected?.profileId);const selectedVersion=text(selected?.updatedAt);if(!runtime.profileFiltersInitialized||runtime.profileFiltersId!==selectedId||runtime.profileFiltersVersion!==selectedVersion){const saved=runtime.profileFiltersInitialized?null:savedResultsView(app);if(saved)runtime.sort=saved.sort;if(saved&&saved.profileId===selectedId&&saved.profileVersion===selectedVersion){runtime.searchFilters=saved.filters;runtime.resultPage=saved.resultPage;}else{runtime.searchFilters=selected?profileSearchFilters(selected):{...DEFAULT_SEARCH_FILTERS};runtime.resultPage=0;}runtime.profileFiltersInitialized=true;runtime.profileFiltersId=selectedId;runtime.profileFiltersVersion=selectedVersion;}const filtered=filterRows(rows,runtime.searchFilters);const sortedAll=sortRows(filtered,runtime.sort).map(row=>({...row,currentOrganizationLabel:organizationInfo(row).label}));const pageCount=Math.max(1,Math.ceil(sortedAll.length/RESULTS_PAGE_SIZE));runtime.resultPage=Math.min(Math.max(0,runtime.resultPage),pageCount-1);const start=runtime.resultPage*RESULTS_PAGE_SIZE;const sorted=sortedAll.slice(start,start+RESULTS_PAGE_SIZE);await persistResultsView(app).catch(error=>console.warn('[RA] Results view was not saved.',error));html=FactionUI.renderCandidates(sorted,{filters:runtime.searchFilters,sort:runtime.sort,total:rows.length,filteredTotal:sortedAll.length,layout:app._test.state.settings?.candidates?.resultsLayout,profiles,activeProfileId:text(config.activeResultsProfileId),pagination:{page:runtime.resultPage,pageSize:RESULTS_PAGE_SIZE,pageCount,start,end:start+sorted.length}})+FactionUI.renderProfileEditor({config,profiles,open:runtime.profileEditorOpen===true});}
    if(typeof app.navigate==='function'&&text(app._test.state.page)!==page)return false;
    const meta=routeMeta(page);title.textContent=meta.title;desc.textContent=meta.description;content.innerHTML=html;
    syncActiveNav(page);bindContentControls();if(options.persist!==false)await persistRoute(app,page);return true;
  }

  function bindNav(){
    if(!runtime.app)return;
    document.querySelectorAll('#ra-nav [data-page]').forEach(button=>{
      const page=text(button.dataset.page);if(!IMPLEMENTED_ROUTES.has(page))return;
      if(!runtime.originalHandlers.has(button))runtime.originalHandlers.set(button,button.onclick||null);
      button.onclick=event=>{event?.preventDefault?.();navigate(page,true).catch(reportError);};
    });
  }
  function syncNavigation(){bindNav();return true;}
  function install(app,options={}){
    if(!app?._test?.state?.db)throw new Error('A mounted Recruitment Agency app with DB state is required.');
    uninstall();runtime.app=app;runtime.installed=true;runtime.profileFiltersInitialized=false;runtime.savedResultsViewKey='';runtime.profileFiltersId='';runtime.profileFiltersVersion='';bindNav();
    const nav=document.getElementById('ra-nav');if(nav&&typeof MutationObserver==='function'){runtime.observer=new MutationObserver(()=>bindNav());runtime.observer.observe(nav,{childList:true,subtree:true});}
    const page=text(app._test.state.page||app._test.state.settings?.activePage);if(options.renderInitial!==false&&IMPLEMENTED_ROUTES.has(page))renderPage(page,{persist:false}).catch(reportError);
    return true;
  }
  function uninstall(){runtime.observer?.disconnect?.();runtime.observer=null;for(const[button,handler]of runtime.originalHandlers.entries())if(button?.isConnected)button.onclick=handler;runtime.originalHandlers.clear();runtime.app=null;runtime.installed=false;}

  return Object.freeze({
    FACTION_ROUTES,
    isFactionRoute,
    routeMeta,
    install,
    uninstall,
    renderPage,
    syncNavigation,
    _test:{IMPLEMENTED_ROUTES,buildRows,persistRoute,dbGetAll,dbGet,dbPut,dbDelete,getConfig,getProfiles,readCriteria,profileSearchFilters,activeResultsProfile,filterRows,sortRows,toggleSort,organizationInfo,RESULTS_PAGE_SIZE}
  });
});
