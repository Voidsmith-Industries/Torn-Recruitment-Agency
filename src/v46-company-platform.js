(function(root,factory){
  const deps={
    CompanyCore:root&&root.RA_V46CompanyCore,
    CompanyUI:root&&root.RA_V46CompanyUI,
    Messaging:root&&root.RA_V45Messaging,
    ResultsCore:root&&root.RA_ResultsCore
  };
  if(typeof module==='object'&&module.exports){
    deps.CompanyCore=require('./v46-company-core');
    deps.CompanyUI=require('./v46-company-ui');
    deps.Messaging=require('./v45-messaging');
    deps.ResultsCore=require('./results-core');
  }
  const api=factory(deps);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V46CompanyPlatform=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(D){
  'use strict';

  const {CompanyCore,CompanyUI,Messaging,ResultsCore}=D;
  if(!CompanyCore||!CompanyUI||!Messaging||!ResultsCore)throw new Error('CompanyCore, CompanyUI, Messaging and ResultsCore are required.');

  const COMPANY_ROUTES=Object.freeze(['company-discover','company-candidates']);
  const IMPLEMENTED_ROUTES=new Set(['company-candidates']);
  const META=Object.freeze({
    'company-discover':['Forum Discovery','Official Torn forum recruitment sources.'],
    'company-candidates':['Company Candidates','Search and manage Company recruitment candidates.']
  });

  const DEFAULT_SEARCH_FILTERS=Object.freeze({search:'',minEnd:'',minMan:'',minInt:'',onlineStatus:'',organization:'',organizationPresence:'any'});
  const DEFAULT_SORT=Object.freeze({key:'player',direction:'asc'});
  const RESULTS_PAGE_SIZE=100;
  const SORT_KEYS=new Set(['player','level','age','end','man','int','activity30','activeStreak','networth','xanax30','recruitmentFit','lastActive']);
  const runtime={app:null,observer:null,originalHandlers:new Map(),installed:false,searchFilters:{...DEFAULT_SEARCH_FILTERS},sort:{...DEFAULT_SORT},hofOffset:0,resultPage:0};
  const text=value=>String(value??'').trim();
  const number=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
  function parseThreshold(value){const raw=text(value).toLowerCase().replace(/,/g,'');if(!raw)return null;const match=raw.match(/^(\d+(?:\.\d+)?|\.\d+)\s*([kmb])?$/);if(!match)return null;const mult={k:1e3,m:1e6,b:1e9}[match[2]]||1;const out=Number(match[1])*mult;return Number.isFinite(out)?out:null;}
  function organizationInfo(row={}){const player=row.playerRecord||{};const name=text(row.currentCompany||player.currentCompany);const rawId=row.currentCompanyId??player.currentCompanyId;if(name)return{state:'has',label:name};if(rawId!==null&&rawId!==undefined&&rawId!==''){const id=Number(rawId);if(Number.isFinite(id)){if(id===0)return{state:'none',label:'None'};if(id>0)return{state:'has',label:`Company #${id}`};}}return{state:'unknown',label:'Unknown'};}
  function filterRows(rows,filters={}){const search=text(filters.search).toLowerCase(),minEnd=parseThreshold(filters.minEnd),minMan=parseThreshold(filters.minMan),minInt=parseThreshold(filters.minInt),onlineStatus=text(filters.onlineStatus).toLowerCase(),organization=text(filters.organization).toLowerCase(),presence=text(filters.organizationPresence).toLowerCase()||'any';return (Array.isArray(rows)?rows:[]).filter(row=>{if(search&&!`${text(row.name).toLowerCase()} ${text(row.userId)}`.includes(search))return false;if(minEnd!==null&&(!Number.isFinite(Number(row.end))||row.end===null||row.end===undefined||row.end===''||Number(row.end)<minEnd))return false;if(minMan!==null&&(!Number.isFinite(Number(row.man))||row.man===null||row.man===undefined||row.man===''||Number(row.man)<minMan))return false;if(minInt!==null&&(!Number.isFinite(Number(row.int))||row.int===null||row.int===undefined||row.int===''||Number(row.int)<minInt))return false;if(onlineStatus&&text(row.onlineStatus).toLowerCase()!==onlineStatus)return false;const org=organizationInfo(row);if(organization&&(org.state!=='has'||!org.label.toLowerCase().includes(organization)))return false;if(presence==='has'&&org.state!=='has')return false;if(presence==='none'&&org.state!=='none')return false;return true;});}
  function sortValue(row,key,now){if(key==='player')return text(row.name).toLowerCase()||null;if(['level','age','end','man','int','activity30','activeStreak','networth','xanax30','recruitmentFit'].includes(key)){const raw=row[key];if(raw===null||raw===undefined||raw==='')return null;const value=Number(raw);return Number.isFinite(value)?value:null;}if(key==='lastActive'){const ts=Number(row.lastActive);if(Number.isFinite(ts)&&ts>0)return ts;const status=text(row.onlineStatus).toLowerCase();if(status==='online')return now+2;if(status==='idle')return now+1;if(status==='offline')return 0;return null;}return null;}
  function sortTieBreak(a,b){const byName=text(a.name).localeCompare(text(b.name),undefined,{sensitivity:'base'});if(byName)return byName;return text(a.userId).localeCompare(text(b.userId),undefined,{numeric:true});}
  function sortRows(rows,sortState=DEFAULT_SORT,now=Date.now()){const key=SORT_KEYS.has(text(sortState?.key))?text(sortState.key):DEFAULT_SORT.key;const direction=sortState?.direction==='desc'?'desc':'asc';const sign=direction==='asc'?1:-1;return [...(Array.isArray(rows)?rows:[])].sort((a,b)=>{const av=sortValue(a,key,now),bv=sortValue(b,key,now),am=av===null||av===undefined,bm=bv===null||bv===undefined;if(am!==bm)return am?1:-1;if(am&&bm)return sortTieBreak(a,b);const cmp=key==='player'?String(av).localeCompare(String(bv)):Number(av)-Number(bv);return cmp?cmp*sign:sortTieBreak(a,b);});}
  function toggleSort(current,key){const nextKey=SORT_KEYS.has(text(key))?text(key):DEFAULT_SORT.key;if(text(current?.key)===nextKey)return{key:nextKey,direction:current?.direction==='asc'?'desc':'asc'};return{key:nextKey,direction:nextKey==='player'?'asc':'desc'};}
  function normalizeResultsView(raw={}){const src=raw&&typeof raw.filters==='object'&&raw.filters?raw.filters:{};const filters={...DEFAULT_SEARCH_FILTERS};for(const key of Object.keys(DEFAULT_SEARCH_FILTERS))if(src[key]!==undefined&&src[key]!==null)filters[key]=text(src[key]);if(!['any','has','none'].includes(filters.organizationPresence))filters.organizationPresence='any';const key=SORT_KEYS.has(text(raw?.sort?.key))?text(raw.sort.key):DEFAULT_SORT.key;return{filters,sort:{key,direction:raw?.sort?.direction==='desc'?'desc':'asc'},resultPage:Math.max(0,Math.floor(number(raw?.resultPage,0))),profileId:text(raw?.profileId),profileVersion:text(raw?.profileVersion)};}
  function savedResultsView(app){const raw=app?._test?.state?.settings?.candidates?.resultsView?.company;return raw&&typeof raw==='object'?normalizeResultsView(raw):null;}
  async function persistResultsView(app){if(typeof app?.saveResultsView!=='function')return;const view=normalizeResultsView({filters:runtime.searchFilters,sort:runtime.sort,resultPage:runtime.resultPage,profileId:runtime.profileFiltersId,profileVersion:runtime.profileFiltersVersion});const key=JSON.stringify(view);if(key===runtime.savedResultsViewKey)return;runtime.savedResultsViewKey=key;await app.saveResultsView('company',view);}
  function profileRequirements(profile={}){
    const criteria=profile?.criteria||{},out={};
    for(const [key,target] of [['man','minMan'],['int','minInt'],['end','minEnd']]){
      const criterion=criteria[key];
      const value=criterion?.enabled===true?Number(criterion.target):NaN;
      if(Number.isFinite(value)&&value>0)out[target]=value;
    }
    return out;
  }
  function profileSearchFilters(profile={}){
    const saved=profile?.searchFilters?.company||{};
    const filters={...DEFAULT_SEARCH_FILTERS,...saved};
    const requirements=profileRequirements(profile);
    if(profile.searchFiltersCustom!==true&&!text(saved.minMan)&&requirements.minMan)filters.minMan=String(requirements.minMan);
    if(profile.searchFiltersCustom!==true&&!text(saved.minInt)&&requirements.minInt)filters.minInt=String(requirements.minInt);
    if(profile.searchFiltersCustom!==true&&!text(saved.minEnd)&&requirements.minEnd)filters.minEnd=String(requirements.minEnd);
    return filters;
  }
  let idSequence=0;
  function makeId(prefix){
    const uuid=globalThis.crypto?.randomUUID?.();
    if(uuid)return `${prefix}-${uuid}`;
    idSequence=(idSequence+1)%1000000;
    return `${prefix}-${Date.now()}-${idSequence}`;
  }

  function isCompanyRoute(value){return COMPANY_ROUTES.includes(text(value));}
  function routeMeta(route){const [title,description]=META[text(route)]||META['company-overview'];return{title,description};}

  function dbGetAll(db,store){return new Promise(resolve=>{try{const q=db.transaction(store,'readonly').objectStore(store).getAll();q.onsuccess=()=>resolve(q.result||[]);q.onerror=()=>resolve([]);}catch{resolve([]);}});}
  function dbGet(db,store,key){return new Promise(resolve=>{try{const q=db.transaction(store,'readonly').objectStore(store).get(key);q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>resolve(null);}catch{resolve(null);}});}
  function dbPut(db,store,value){return new Promise((resolve,reject)=>{try{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error||new Error(`Failed to save ${store}.`));}catch(error){reject(error);}});}

  async function getConfig(app){if(app?._test?.companyRepositories?.config?.get)return app._test.companyRepositories.config.get();return(await dbGet(app._test.state.db,'companyRecruitmentConfig','company'))||{key:'company',baseline:{criteria:[]},stageThresholds:{},opportunityWeights:{}};}
  async function saveConfig(app,patch){if(app?._test?.companyRepositories?.config?.save)return app._test.companyRepositories.config.save(patch);const existing=await getConfig(app);const next={...existing,...patch,key:'company',updatedAt:Date.now()};await dbPut(app._test.state.db,'companyRecruitmentConfig',next);return next;}


  async function buildRows(app){
    const db=app._test.state.db;
    const[companyRecords,players,candidateLocals,config,activeProfile]=await Promise.all([dbGetAll(db,'companyRecruitment'),dbGetAll(db,'playerIntelligence'),dbGetAll(db,'candidateLocal'),getConfig(app),typeof app.getActiveMatchProfile==='function'?app.getActiveMatchProfile():Promise.resolve(null)]);
    const baseline=CompanyCore.normalizeBaseline(config.baseline||{});
    const rows=CompanyUI.buildCandidateRows(companyRecords,players,{eligibilityFor:(record,player)=>CompanyCore.evaluateCriteria(baseline.criteria,player,record.waivers||[])});
    const candidateMap=new Map(candidateLocals.map(candidate=>[text(candidate?.userId??candidate?.id),candidate]));
    return rows.map(row=>{
      const candidate=candidateMap.get(text(row.userId))||{};const stats=candidate.stats||{};const player=row.playerRecord||{};
      const enriched={...row,man:player.man??stats.man??candidate.man??null,int:player.int??stats.int??candidate.int??null,end:player.end??stats.end??candidate.end??null,total:player.total??stats.total??candidate.total??null,onlineStatus:text(player.onlineStatus)||text(row.onlineStatus),candidateLocal:candidate};
      const intelligence=ResultsCore.recruitmentFit(enriched,{domain:'company',useEligibility:false,requirements:profileRequirements(activeProfile||{})});
      return{...enriched,recruitmentFit:intelligence.score,recruitmentConfidence:intelligence.confidence,recruitmentFitBreakdown:intelligence.components,prospectProvenance:intelligence.provenance,prospectState:intelligence.provenance.state,intelligenceFreshness:intelligence.provenance.freshness};
    });
  }


  async function persistRoute(app,page){const state=app?._test?.state;if(!state?.db)return false;state.page=page;state.settings=state.settings||{};state.settings.activePage=page;const meta=await dbGet(state.db,'meta','global')||{key:'global',settings:{}};meta.settings={...(meta.settings||{}),activePage:page};await dbPut(state.db,'meta',meta);return true;}
  function claimRoute(app,page){const state=app?._test?.state,route=text(page);if(!state||!IMPLEMENTED_ROUTES.has(route))return false;state.page=route;state.settings=state.settings||{};state.settings.activePage=route;return true;}
  function navigate(page,persist=true){const route=text(page);if(!runtime.app||!IMPLEMENTED_ROUTES.has(route))return Promise.resolve(false);if(typeof runtime.app.navigate==='function')return Promise.resolve(runtime.app.navigate(route,persist));claimRoute(runtime.app,route);return renderPage(route,{persist});}
  function readCriteria(host){if(!host)return[];return[...host.querySelectorAll('[data-criterion-row]')].map((row,index)=>{const get=key=>row.querySelector(`[data-criterion-field="${key}"]`)?.value??'';const rawValue=get('value');const numericValue=rawValue!==''&&Number.isFinite(Number(rawValue))?Number(rawValue):rawValue;return{id:text(row.dataset.criterionId)||makeId(`criterion-${index+1}`),label:text(get('label')),field:text(get('field')),operator:text(get('operator'))||'gte',kind:text(get('kind'))==='Hard'?'Hard':'Preferred',value:numericValue,weight:Math.max(0,number(get('weight'),1))};});}
  async function rowFor(userId){const rows=await buildRows(runtime.app);const row=rows.find(item=>text(item.userId)===text(userId));if(!row)throw new Error('Company candidate was not found.');return row;}

  async function recruitPlayer(userId,override=false){const row=await rowFor(userId);if(row.companyRecord?.doNotContact===true&&override!==true)throw new Error('This candidate is marked Do Not Contact. Use the explicit override only when you deliberately intend to contact them.');if(override){if(typeof globalThis.confirm!=='function')throw new Error('Do Not Contact override confirmation is unavailable. Recruitment stopped.');if(!globalThis.confirm('This candidate is marked Do Not Contact. Override it for this recruitment chat only?'))return false;}if(typeof runtime.app?.recruitCandidate!=='function')throw new Error('Recruit workflow is unavailable.');return runtime.app.recruitCandidate?.('company',text(userId),row.name,{overrideDnc:override,dncConfirmed:override});}


  function readVisibleSearchFilters(){return {search:text(document.getElementById('ra-company-filter-search')?.value),minEnd:text(document.getElementById('ra-company-filter-end')?.value),minMan:text(document.getElementById('ra-company-filter-man')?.value),minInt:text(document.getElementById('ra-company-filter-int')?.value),onlineStatus:text(document.getElementById('ra-company-filter-status')?.value),organization:text(document.getElementById('ra-company-filter-organization')?.value),organizationPresence:text(document.getElementById('ra-company-filter-organization-presence')?.value)||'any'};}
  function bindContentControls(){
    document.getElementById('ra-company-search-apply')?.addEventListener('click',async event=>{const button=event?.currentTarget;runtime.resultPage=0;runtime.searchFilters=readVisibleSearchFilters();try{if(button){button.disabled=true;button.textContent='Searching…';}if(typeof runtime.app?.searchCandidates!=='function')throw new Error('Active candidate search is unavailable.');await runtime.app.searchCandidates('company',runtime.searchFilters);await renderPage('company-candidates',{persist:false});}catch(error){reportError(error);renderPage('company-candidates',{persist:false}).catch(reportError);}finally{if(button?.isConnected){button.disabled=false;button.textContent='Search';}}});
    document.getElementById('ra-company-search-clear')?.addEventListener('click',()=>{runtime.resultPage=0;runtime.searchFilters={...DEFAULT_SEARCH_FILTERS};renderPage('company-candidates',{persist:false}).catch(reportError);});
    document.getElementById('ra-company-profile-apply')?.addEventListener('click',async()=>{try{const id=text(document.getElementById('ra-company-profile-select')?.value);if(!id)throw new Error('Choose a Match Profile first.');if(typeof runtime.app?.setActiveMatchProfile!=='function')throw new Error('Match Profiles are unavailable.');const profile=await runtime.app.setActiveMatchProfile(id);runtime.resultPage=0;runtime.searchFilters=profileSearchFilters(profile);await renderPage('company-candidates',{persist:false});}catch(error){reportError(error);}});
    document.getElementById('ra-company-profile-clear')?.addEventListener('click',async()=>{try{if(typeof runtime.app?.setActiveMatchProfile!=='function')throw new Error('Match Profiles are unavailable.');await runtime.app.setActiveMatchProfile('');runtime.resultPage=0;runtime.searchFilters={...DEFAULT_SEARCH_FILTERS};await renderPage('company-candidates',{persist:false});}catch(error){reportError(error);}});
    document.getElementById('ra-company-profile-save-search')?.addEventListener('click',async()=>{try{const id=text(document.getElementById('ra-company-profile-select')?.value);if(!id)throw new Error('Choose a Match Profile first.');if(typeof runtime.app?.saveCompanySearchProfile!=='function')throw new Error('Saving Match Profile searches is unavailable.');runtime.searchFilters=readVisibleSearchFilters();await runtime.app.saveCompanySearchProfile(id,runtime.searchFilters);await renderPage('company-candidates',{persist:false});}catch(error){reportError(error);}});
    document.getElementById('ra-company-profile-manage')?.addEventListener('click',()=>runtime.app?.navigate?.('smart-match',true));
    document.getElementById('ra-company-hof-discover')?.addEventListener('click',async event=>{const button=event?.currentTarget;try{if(button){button.disabled=true;button.textContent=runtime.hofOffset>0?'Loading next 100…':'Discovering…';}if(typeof runtime.app?.discoverWorkstatProspects!=='function')throw new Error('Work-stat HOF discovery is unavailable.');const result=await runtime.app.discoverWorkstatProspects({limit:100,offset:runtime.hofOffset});runtime.hofOffset=Math.max(runtime.hofOffset,Number(result?.nextOffset||runtime.hofOffset));await renderPage('company-candidates',{persist:false});}catch(error){reportError(error);}finally{if(button?.isConnected){button.disabled=false;button.textContent=runtime.hofOffset>0?'Discover Next 100':'Discover Workstat Prospects';}}});
    document.querySelectorAll('#ra-content [data-company-sort]').forEach(button=>{button.onclick=()=>{runtime.resultPage=0;runtime.sort=toggleSort(runtime.sort,button.dataset.companySort);renderPage('company-candidates',{persist:false}).catch(reportError);};});document.querySelectorAll('#ra-content [data-results-page]').forEach(button=>{button.onclick=()=>{runtime.resultPage=Math.max(0,runtime.resultPage+(button.dataset.resultsPage==='next'?1:-1));renderPage('company-candidates',{persist:false}).catch(reportError);};});document.querySelectorAll('#ra-content [data-results-layout]').forEach(button=>{button.onclick=()=>{if(typeof runtime.app?.setResultsLayout!=='function')return;runtime.app.setResultsLayout(button.dataset.resultsLayout).then(()=>renderPage('company-candidates',{persist:false})).catch(reportError);};});document.querySelectorAll('#ra-content [data-player-card]').forEach(link=>{link.onclick=event=>{event.preventDefault();runtime.app?.openPlayerCard?.('company',link.dataset.playerCard);};});
    document.querySelectorAll('#ra-content [data-go-page]').forEach(button=>{if(!isCompanyRoute(button.dataset.goPage))return;button.onclick=event=>{event?.preventDefault?.();navigate(button.dataset.goPage,true).catch(reportError);};});
    const baselineEditor=document.getElementById('ra-company-baseline-editor');
    if(baselineEditor){baselineEditor.ontoggle=()=>{runtime.baselineEditorOpen=baselineEditor.open;};baselineEditor.onclick=event=>{const target=event.target;if(target?.closest?.('[data-remove-criterion]')){target.closest('[data-criterion-row]')?.remove();return;}if(target?.id==='ra-company-baseline-add'){document.getElementById('ra-company-baseline-criteria')?.insertAdjacentHTML('beforeend',CompanyUI.renderCriterionRow({id:makeId('baseline')},'baseline'));return;}if(target?.id==='ra-company-baseline-save'){runtime.baselineEditorOpen=true;saveConfig(runtime.app,{baseline:{criteria:readCriteria(document.getElementById('ra-company-baseline-criteria'))}}).then(()=>renderPage('company-candidates',{persist:false})).catch(reportError);}};}
    document.querySelectorAll('#ra-content [data-company-recruit]').forEach(button=>{button.onclick=()=>recruitPlayer(button.dataset.companyRecruit,false).catch(reportError);});
    document.querySelectorAll('#ra-content [data-company-recruit-override]').forEach(button=>{button.onclick=()=>recruitPlayer(button.dataset.companyRecruitOverride,true).catch(reportError);});
  }

  function syncActiveNav(page){document.querySelectorAll('#ra-nav [data-page]').forEach(button=>button.classList.toggle('active',button.dataset.page===page));}
  function reportError(error){console.error('[RA v4.6 Company]',error);try{globalThis.alert?.(`Company Recruitment failed: ${error?.message||error}`);}catch{}}

  async function renderPage(page,options={}){
    const app=runtime.app;page=text(page);
    if(!app||!IMPLEMENTED_ROUTES.has(page))return false;
    if(options.persist!==false)claimRoute(app,page);
    const title=document.getElementById('ra-page-title'),desc=document.getElementById('ra-page-desc'),content=document.getElementById('ra-content');
    if(!title||!desc||!content)throw new Error('Recruitment Agency shell is not mounted.');
    const rows=await buildRows(app);
    let html='';
    if(page==='company-candidates'){const selected=typeof app.getActiveMatchProfile==='function'?await app.getActiveMatchProfile():null;const selectedId=text(selected?.profileId);const selectedVersion=text(selected?.updatedAt);if(!runtime.profileFiltersInitialized||runtime.profileFiltersId!==selectedId||runtime.profileFiltersVersion!==selectedVersion){const saved=runtime.profileFiltersInitialized?null:savedResultsView(app);if(saved)runtime.sort=saved.sort;if(saved&&saved.profileId===selectedId&&saved.profileVersion===selectedVersion){runtime.searchFilters=saved.filters;runtime.resultPage=saved.resultPage;}else{runtime.searchFilters=selected?profileSearchFilters(selected):{...DEFAULT_SEARCH_FILTERS};runtime.resultPage=0;}runtime.profileFiltersInitialized=true;runtime.profileFiltersId=selectedId;runtime.profileFiltersVersion=selectedVersion;}const filtered=filterRows(rows,runtime.searchFilters);const sortedAll=sortRows(filtered,runtime.sort).map(row=>({...row,currentOrganizationLabel:organizationInfo(row).label}));const profiles=typeof app.listMatchProfiles==='function'?await app.listMatchProfiles():[];const activeProfile=typeof app.getActiveMatchProfile==='function'?await app.getActiveMatchProfile():null;const pageCount=Math.max(1,Math.ceil(sortedAll.length/RESULTS_PAGE_SIZE));runtime.resultPage=Math.min(Math.max(0,runtime.resultPage),pageCount-1);const start=runtime.resultPage*RESULTS_PAGE_SIZE;const sorted=sortedAll.slice(start,start+RESULTS_PAGE_SIZE);await persistResultsView(app).catch(error=>console.warn('[RA] Results view was not saved.',error));const baselineHtml=CompanyUI.renderBaselineEditor(await getConfig(app),{open:runtime.baselineEditorOpen===true});html=CompanyUI.renderCandidates(sorted,{filters:runtime.searchFilters,sort:runtime.sort,total:rows.length,filteredTotal:sortedAll.length,layout:app._test.state.settings?.candidates?.resultsLayout,profiles,activeProfileId:activeProfile?.profileId||'',pagination:{page:runtime.resultPage,pageSize:RESULTS_PAGE_SIZE,pageCount,start,end:start+sorted.length}})+baselineHtml;}
    if(typeof app.navigate==='function'&&text(app._test.state.page)!==page)return false;
    const meta=routeMeta(page);title.textContent=meta.title;desc.textContent=meta.description;content.innerHTML=html;
    syncActiveNav(page);bindContentControls();if(options.persist!==false)await persistRoute(app,page);return true;
  }

  function bindNav(){if(!runtime.app)return;document.querySelectorAll('#ra-nav [data-page]').forEach(button=>{const page=text(button.dataset.page);if(!IMPLEMENTED_ROUTES.has(page))return;if(!runtime.originalHandlers.has(button))runtime.originalHandlers.set(button,button.onclick||null);button.onclick=event=>{event?.preventDefault?.();navigate(page,true).catch(reportError);};});}
  function syncNavigation(){bindNav();return true;}
  function install(app,options={}){if(!app?._test?.state?.db)throw new Error('A mounted Recruitment Agency app with DB state is required.');uninstall();runtime.app=app;runtime.installed=true;runtime.profileFiltersInitialized=false;runtime.savedResultsViewKey='';runtime.profileFiltersId='';runtime.profileFiltersVersion='';bindNav();const nav=document.getElementById('ra-nav');if(nav&&typeof MutationObserver==='function'){runtime.observer=new MutationObserver(()=>bindNav());runtime.observer.observe(nav,{childList:true,subtree:true});}const page=text(app._test.state.page||app._test.state.settings?.activePage);if(options.renderInitial!==false&&IMPLEMENTED_ROUTES.has(page))renderPage(page,{persist:false}).catch(reportError);return true;}
  function uninstall(){runtime.observer?.disconnect?.();runtime.observer=null;for(const[button,handler]of runtime.originalHandlers.entries())if(button?.isConnected)button.onclick=handler;runtime.originalHandlers.clear();runtime.app=null;runtime.installed=false;}

  return Object.freeze({COMPANY_ROUTES,isCompanyRoute,routeMeta,install,uninstall,renderPage,syncNavigation,_test:{buildRows,persistRoute,dbGetAll,dbGet,dbPut,readCriteria,filterRows,sortRows,toggleSort,profileRequirements,profileSearchFilters,organizationInfo,RESULTS_PAGE_SIZE,IMPLEMENTED_ROUTES}});
});
