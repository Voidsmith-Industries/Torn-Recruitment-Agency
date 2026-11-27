(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V46RecruitmentShared=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const text=value=>String(value??'').trim();
  const number=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  let idSequence=0;
  function makeId(prefix){const uuid=globalThis.crypto?.randomUUID?.();if(uuid)return `${prefix}-${uuid}`;idSequence=(idSequence+1)%1000000;return `${prefix}-${Date.now()}-${idSequence}`;}

  function normalizeKind(value){return text(value).toLowerCase()==='hard'?'Hard':'Preferred';}
  function normalizeRequirement(raw={},index=0){const field=text(raw.field);return{id:text(raw.id)||`${field||'criterion'}-${index+1}`,field,operator:text(raw.operator||'gte').toLowerCase(),value:raw.value,value2:raw.value2,kind:normalizeKind(raw.kind),label:text(raw.label)||field||`Criterion ${index+1}`,weight:Math.max(0,number(raw.weight,1))};}
  function normalizeBaseline(config={}){return{criteria:(Array.isArray(config.criteria)?config.criteria:[]).map(normalizeRequirement),updatedAt:number(config.updatedAt,0)};}
  function compare(operator,actual,value,value2){
    if(actual===undefined||actual===null||actual==='')return{known:false,passed:false};
    const op=text(operator).toLowerCase();
    if(op==='gte'||op==='gt'||op==='lte'||op==='lt'){const a=Number(actual),b=Number(value);if(!Number.isFinite(a)||!Number.isFinite(b))return{known:false,passed:false};if(op==='gte')return{known:true,passed:a>=b};if(op==='gt')return{known:true,passed:a>b};if(op==='lte')return{known:true,passed:a<=b};return{known:true,passed:a<b};}
    if(op==='between'){const a=Number(actual),lo=Number(value),hi=Number(value2);if(![a,lo,hi].every(Number.isFinite))return{known:false,passed:false};return{known:true,passed:a>=Math.min(lo,hi)&&a<=Math.max(lo,hi)};}
    if(op==='contains')return{known:true,passed:text(actual).toLowerCase().includes(text(value).toLowerCase())};
    if(op==='oneof'){const allowed=(Array.isArray(value)?value:[value]).map(item=>text(item).toLowerCase());return{known:true,passed:allowed.includes(text(actual).toLowerCase())};}
    return{known:true,passed:text(actual).toLowerCase()===text(value).toLowerCase()};
  }
  // waiverFor(requirementId) is supplied by each domain, so Company and Faction waiver scoping stay separate.
  function evaluateCriteria(criteria=[],facts={},waiverFor=()=>null){
    const results=(Array.isArray(criteria)?criteria:[]).map(normalizeRequirement).map(req=>{const verdict=compare(req.operator,facts?.[req.field],req.value,req.value2);const waiver=req.kind==='Hard'&&verdict.known&&!verdict.passed?waiverFor(req.id):null;return{...req,known:verdict.known,passed:verdict.passed,waived:Boolean(waiver),waiver,effectivePass:verdict.passed||Boolean(waiver)};});
    const hardFailures=results.filter(r=>r.kind==='Hard'&&r.known&&!r.passed),unknownHard=results.filter(r=>r.kind==='Hard'&&!r.known),unwaivedHardFailures=hardFailures.filter(r=>!r.waived),failures=results.filter(r=>r.known&&!r.passed),known=results.filter(r=>r.known);
    const totalWeight=known.reduce((sum,r)=>sum+(r.weight||1),0),earned=known.filter(r=>r.passed).reduce((sum,r)=>sum+(r.weight||1),0);
    const score=totalWeight?Math.round(earned/totalWeight*100):null,hardFailed=unwaivedHardFailures.length>0;
    const eligibility=hardFailed?'NOT CURRENTLY ELIGIBLE':hardFailures.length?'Eligible by Waiver':unknownHard.length?'Unknown':'Eligible';
    return{results,failures,hardFailures,unknownHard,unwaivedHardFailures,hardFailed,eligibility,score};
  }

  function applyStoreDefinitions(db,definitions){for(const[storeName,definition]of Object.entries(definitions)){if(db.objectStoreNames.contains(storeName))continue;const store=db.createObjectStore(storeName,{keyPath:definition.keyPath});for(const index of definition.indexes)store.createIndex(index.name,index.keyPath,{unique:false});}}
  function normalizeDomainConfig(raw,key,extra={}){const thresholds={};for(const[k,value]of Object.entries(raw.stageThresholds||{})){const days=Math.max(0,Math.floor(number(value,0)));if(days>0)thresholds[text(k)]=days;}const weights={};for(const[k,value]of Object.entries(raw.opportunityWeights||{}))weights[text(k)]=Math.max(0,number(value,0));return{key,baseline:normalizeBaseline(raw.baseline||{}),stageThresholds:thresholds,opportunityWeights:weights,...extra,updatedAt:number(raw.updatedAt,Date.now())};}

  const DEFAULT_SEARCH_FILTERS=Object.freeze({search:'',minEnd:'',minMan:'',minInt:'',onlineStatus:'',organization:'',organizationPresence:'any'});
  const DEFAULT_SORT=Object.freeze({key:'player',direction:'asc'});
  const RESULTS_PAGE_SIZE=100;
  const NUMERIC_SORT_KEYS=['level','age','end','man','int','activity30','activeStreak','networth','xanax30','recruitmentFit'];
  const SORT_KEYS=new Set(['player',...NUMERIC_SORT_KEYS,'lastActive']);
  function parseThreshold(value){const raw=text(value).toLowerCase().replace(/,/g,'');if(!raw)return null;const match=raw.match(/^(\d+(?:\.\d+)?|\.\d+)\s*([kmb])?$/);if(!match)return null;const mult={k:1e3,m:1e6,b:1e9}[match[2]]||1;const out=Number(match[1])*mult;return Number.isFinite(out)?out:null;}
  // spec: {player:'playerRecord'|'player', name:'currentCompany'|'factionName', id:'currentCompanyId'|'factionId', label:'Company'|'Faction', presence?:'companyPresence'}
  function organizationInfoFor(spec){return function organizationInfo(row={}){const player=row[spec.player]||{};const name=text(row[spec.name]||player[spec.name]);const rawId=row[spec.id]??player[spec.id];if(name)return{state:'has',label:name};if(rawId!==null&&rawId!==undefined&&rawId!==''){const id=Number(rawId);if(Number.isFinite(id)){if(id===0)return{state:'none',label:'None'};if(id>0)return{state:'has',label:`${spec.label} #${id}`};}}const presence=text(row[spec.presence]||player[spec.presence]);if(presence==='has')return{state:'has',label:`In a ${spec.label.toLowerCase()}`};if(presence==='none')return{state:'none',label:'None'};return{state:'unknown',label:'Unknown'};};}
  // Unknown stats (null/blank) stay listed; only a known stat below the minimum hides a row.
  function belowMin(row,key,min){const v=row[key];return min!==null&&v!==null&&v!==undefined&&text(v)!==''&&Number(v)<min;}
  function filterRows(rows,filters={},organizationInfo){const search=text(filters.search).toLowerCase(),minEnd=parseThreshold(filters.minEnd),minMan=parseThreshold(filters.minMan),minInt=parseThreshold(filters.minInt),onlineStatus=text(filters.onlineStatus).toLowerCase(),organization=text(filters.organization).toLowerCase(),presence=text(filters.organizationPresence).toLowerCase()||'any';return(Array.isArray(rows)?rows:[]).filter(row=>{if(search&&!`${text(row.name).toLowerCase()} ${text(row.userId)}`.includes(search))return false;if(belowMin(row,'end',minEnd)||belowMin(row,'man',minMan)||belowMin(row,'int',minInt))return false;if(onlineStatus&&text(row.onlineStatus).toLowerCase()!==onlineStatus)return false;const org=organizationInfo(row);if(organization&&(org.state!=='has'||!org.label.toLowerCase().includes(organization)))return false;if(presence==='has'&&org.state!=='has')return false;if(presence==='none'&&org.state!=='none')return false;return true;});}
  function sortValue(row,key,now){if(key==='player')return text(row.name).toLowerCase()||null;if(NUMERIC_SORT_KEYS.includes(key)){const raw=row[key];if(raw===null||raw===undefined||raw==='')return null;const value=Number(raw);return Number.isFinite(value)?value:null;}if(key==='lastActive'){const ts=Number(row.lastActive);if(Number.isFinite(ts)&&ts>0)return ts;const status=text(row.onlineStatus).toLowerCase();if(status==='online')return now+2;if(status==='idle')return now+1;if(status==='offline')return 0;return null;}return null;}
  function sortTieBreak(a,b){const byName=text(a.name).localeCompare(text(b.name),undefined,{sensitivity:'base'});if(byName)return byName;return text(a.userId).localeCompare(text(b.userId),undefined,{numeric:true});}
  function sortRows(rows,sortState=DEFAULT_SORT,now=Date.now()){const key=SORT_KEYS.has(text(sortState?.key))?text(sortState.key):DEFAULT_SORT.key;const sign=sortState?.direction==='desc'?-1:1;return[...(Array.isArray(rows)?rows:[])].sort((a,b)=>{const av=sortValue(a,key,now),bv=sortValue(b,key,now),am=av===null||av===undefined,bm=bv===null||bv===undefined;if(am!==bm)return am?1:-1;if(am&&bm)return sortTieBreak(a,b);const cmp=key==='player'?String(av).localeCompare(String(bv)):Number(av)-Number(bv);return cmp?cmp*sign:sortTieBreak(a,b);});}
  function toggleSort(current,key){const nextKey=SORT_KEYS.has(text(key))?text(key):DEFAULT_SORT.key;if(text(current?.key)===nextKey)return{key:nextKey,direction:current?.direction==='asc'?'desc':'asc'};return{key:nextKey,direction:nextKey==='player'?'asc':'desc'};}
  function normalizeResultsView(raw={}){const src=raw&&typeof raw.filters==='object'&&raw.filters?raw.filters:{};const filters={...DEFAULT_SEARCH_FILTERS};for(const key of Object.keys(DEFAULT_SEARCH_FILTERS))if(src[key]!==undefined&&src[key]!==null)filters[key]=text(src[key]);if(!['any','has','none'].includes(filters.organizationPresence))filters.organizationPresence='any';const key=SORT_KEYS.has(text(raw?.sort?.key))?text(raw.sort.key):DEFAULT_SORT.key;return{filters,sort:{key,direction:raw?.sort?.direction==='desc'?'desc':'asc'},resultPage:Math.max(0,Math.floor(number(raw?.resultPage,0))),profileId:text(raw?.profileId),profileVersion:text(raw?.profileVersion)};}

  function dbGetAll(db,store){return new Promise(resolve=>{try{const q=db.transaction(store,'readonly').objectStore(store).getAll();q.onsuccess=()=>resolve(q.result||[]);q.onerror=()=>resolve([]);}catch{resolve([]);}});}
  function dbGet(db,store,key){return new Promise(resolve=>{try{const q=db.transaction(store,'readonly').objectStore(store).get(key);q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>resolve(null);}catch{resolve(null);}});}
  function dbWrite(db,store,op,arg,result,verb){return new Promise((resolve,reject)=>{try{const tx=db.transaction(store,'readwrite');tx.objectStore(store)[op](arg);tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||new Error(`Failed to ${verb} ${store}.`));}catch(error){reject(error);}});}
  function dbPut(db,store,value){return dbWrite(db,store,'put',value,value,'save');}
  function dbDelete(db,store,key){return dbWrite(db,store,'delete',key,true,'delete from');}

  function relativeLastActive(value,now=Date.now(),onlineStatus=''){const ts=Number(value);if(!Number.isFinite(ts)||ts<=0)return text(onlineStatus)||'Unknown';const seconds=Math.max(0,Math.floor((now-ts)/1000));if(seconds<60)return 'just now';if(seconds<3600)return `${Math.floor(seconds/60)}m ago`;if(seconds<86400)return `${Math.floor(seconds/3600)}h ago`;return `${Math.floor(seconds/86400)}d ago`;}
  function stat(value){if(value===null||value===undefined||text(value)==='')return '—';const n=Number(value);return Number.isFinite(n)?n.toLocaleString():'—';}
  function lastOnlineHtml(row={}){const ts=Number(row.lastActive);if(Number.isFinite(ts)&&ts>0)return esc(relativeLastActive(row.lastActive,Date.now(),row.onlineStatus));const status=text(row.onlineStatus).toLowerCase();if(status==='online')return '<span class="ra-online-live">Online</span>';if(status==='idle')return '<span class="ra-online-idle">Idle</span>';if(status==='offline')return '<span class="ra-online-offline">Offline</span>';return 'Unknown';}
  function recruitmentFitCell(row={}){if(row.recruitmentFit===null||row.recruitmentFit===undefined||text(row.recruitmentFit)==='')return '<span class="ra-muted">—</span>';const value=Number(row.recruitmentFit);if(!Number.isFinite(value))return '<span class="ra-muted">—</span>';const confidence=text(row.recruitmentConfidence)||'Low';return `<span title="Recruitment Fit · ${esc(confidence)} confidence"><b>${value.toFixed(1)}</b><small class="ra-muted"> ${esc(confidence)}</small></span>`;}
  function provenanceCell(row={}){const p=row.prospectProvenance||{};const source=Array.isArray(p.sources)&&p.sources.length?p.sources[0]:'Unknown';const state=text(row.prospectState)||text(p.state)||'Known Candidate';return `<span title="${esc(state)}"><b>${esc(source)}</b><small class="ra-muted"> · ${esc(state)}</small></span>`;}
  const known=value=>value!==null&&value!==undefined&&text(value)!==''&&Number.isFinite(Number(value));
  function battleCell(row){const a=known(row.attacks30),r=known(row.rwHits30);if(!a&&!r)return '—';return `${a?Number(row.attacks30).toLocaleString():'—'} / ${r?Number(row.rwHits30).toLocaleString():'—'}`;}

  // Criterion editor rows. prefix '' keeps Company's data-criterion-* attributes; 'faction-' keeps Faction's.
  const CRITERION_FIELDS=Object.freeze(['level','ee','fit','activity30','xanax30','refills30','attacks30','rwHits30','networth']);
  const CRITERION_OPERATORS=Object.freeze(['gte','gt','lte','lt','between','equals']);
  function renderCriterionRow(raw={},scope='baseline',prefix='',defaultField='level'){
    const a=`data-${prefix}criterion`,req={id:text(raw.id),label:text(raw.label),field:text(raw.field)||defaultField,operator:text(raw.operator)||'gte',kind:text(raw.kind)==='Hard'?'Hard':'Preferred',value:raw.value??'',weight:Number.isFinite(Number(raw.weight))?Number(raw.weight):1};
    const options=(list,current)=>list.map(item=>`<option value="${item}" ${item===current?'selected':''}>${item}</option>`).join('');
    return `<div class="ra-formgrid" ${a}-row ${a}-id="${esc(req.id)}"${prefix?` ${a}-scope="${esc(scope)}"`:''} style="grid-template-columns:1.2fr 1fr .8fr .8fr 1fr .7fr auto;align-items:end;margin:6px 0"><div class="ra-field"><label>Label</label><input ${a}-field="label" value="${esc(req.label)}"></div><div class="ra-field"><label>Field</label><select ${a}-field="field">${options(CRITERION_FIELDS,req.field)}</select></div><div class="ra-field"><label>Operator</label><select ${a}-field="operator">${options(CRITERION_OPERATORS,req.operator)}</select></div><div class="ra-field"><label>Type</label><select ${a}-field="kind"><option value="Hard" ${req.kind==='Hard'?'selected':''}>Hard</option><option value="Preferred" ${req.kind==='Preferred'?'selected':''}>Preferred</option></select></div><div class="ra-field"><label>Value</label><input ${a}-field="value" value="${esc(req.value)}"></div><div class="ra-field"><label>Weight</label><input ${a}-field="weight" type="number" min="0" step="0.1" value="${esc(req.weight)}"></div><button type="button" class="ra-btn ra-danger" data-${prefix}remove-criterion="${esc(scope)}">×</button></div>`;
  }
  function readCriteria(host,prefix=''){if(!host)return[];const a=`data-${prefix}criterion`;return[...host.querySelectorAll(`[${a}-row]`)].map((row,index)=>{const get=key=>row.querySelector(`[${a}-field="${key}"]`)?.value??'';const rawValue=get('value');const numericValue=rawValue!==''&&Number.isFinite(Number(rawValue))?Number(rawValue):rawValue;return{id:text(row.getAttribute(`${a}-id`))||makeId(`criterion-${index+1}`),label:text(get('label')),field:text(get('field')),operator:text(get('operator'))||'gte',kind:text(get('kind'))==='Hard'?'Hard':'Preferred',value:numericValue,weight:Math.max(0,number(get('weight'),1))};});}

  // Results table. spec: {domain,label,orgHeader,orgPlaceholder,columns,contactedStages,messageCell,profileBar,headActions,extraButtons}
  function sortHeader(domain,key,label,sort={}){const active=text(sort.key)===key;const marker=active?(sort.direction==='desc'?' ▼':' ▲'):'';return `<button type="button" class="ra-sort-button${active?' active':''}" data-${domain}-sort="${key}" aria-pressed="${active?'true':'false'}">${esc(label)}${marker}</button>`;}
  const STAT_COLUMNS={level:'Level',age:'Age',man:'MAN',int:'INT',end:'END',networth:'Net Worth',activity30:'30d Active',activeStreak:'Streak',xanax30:'Xanax 30d'};
  function column(key,spec){
    if(STAT_COLUMNS[key])return[[key,STAT_COLUMNS[key]],row=>stat(row[key])];
    return({
      player:[['player','Player'],row=>`<a class="ra-link" href="#" data-player-card="${esc(row.userId)}" data-player-domain="${spec.domain}">${esc(row.name)}</a><small class="ra-muted"> ${esc(row.userId)}</small>`],
      drug:['Drug Use',row=>esc(text(row.drugUse)||'—')],
      battle:['Battle / RW',battleCell],
      org:[spec.orgHeader,row=>esc(row.currentOrganizationLabel||'Unknown')],
      lastActive:[['lastActive','Last Online'],lastOnlineHtml],
      recruitmentFit:[['recruitmentFit','Recruit Fit'],recruitmentFitCell],
      fit:['Recruit Fit',recruitmentFitCell],
      source:['Source',provenanceCell],
      contacted:['Contacted',row=>{if(Array.isArray(row.outcomes)&&row.outcomes.length)return 'Contacted';return spec.contactedStages.includes(text(row.pipelineStage).toLowerCase())?'Contacted':'Not yet';}],
      message:['Message',spec.messageCell]
    })[key];
  }
  function resultsTable(rows,keys,sort,spec,className){const cols=keys.map(key=>column(key,spec));const head=cols.map(([h])=>`<th>${Array.isArray(h)?sortHeader(spec.domain,h[0],h[1],sort):h}</th>`).join('');const body=rows.map(row=>`<tr>${cols.map(([,cell])=>`<td>${cell(row)}</td>`).join('')}</tr>`).join('');return `<table class="ra-table ra-core-results ${className}"><thead><tr>${head}</tr></thead><tbody>${body||`<tr><td colspan="${cols.length}">No matching ${spec.label} candidates.</td></tr>`}</tbody></table>`;}
  function renderResults(rows=[],options={},spec){
    rows=Array.isArray(rows)?rows:[];const d=spec.domain,L=spec.label,filters=options.filters||{},sort=options.sort||{key:'player',direction:'asc'},layout=options.layout==='compact'?'compact':'expanded';const total=Number.isFinite(Number(options.total))?Number(options.total):rows.length;
    const pagination=options.pagination||{page:0,pageCount:1,start:0,end:rows.length};const filteredTotal=Number.isFinite(Number(options.filteredTotal))?Number(options.filteredTotal):rows.length;
    const rangeText=filteredTotal?`${Number(pagination.start||0)+1}-${Number(pagination.end||0)}`:'0';
    const pager=`<div class="ra-actions"><button type="button" class="ra-btn" data-results-page="prev" ${Number(pagination.page||0)<=0?'disabled':''}>Previous</button><span class="ra-muted">${rangeText} of ${filteredTotal}</span><button type="button" class="ra-btn" data-results-page="next" ${Number(pagination.page||0)>=Number(pagination.pageCount||1)-1?'disabled':''}>Next</button></div>`;
    const table=layout==='compact'?resultsTable(rows,['player','end','man','int','lastActive','fit','message'],sort,spec,'ra-results-compact'):resultsTable(rows,spec.columns,sort,spec,'ra-results-expanded');
    const status=text(filters.onlineStatus).toLowerCase(),presence=filters.organizationPresence;
    const input=(key,label,value,placeholder)=>`<div class="ra-field"><label>${label}</label><input id="ra-${d}-filter-${key}" value="${esc(value||'')}" placeholder="${placeholder}"></div>`;
    return `<section class="ra-panel ra-search-panel"><div class="ra-panel-head"><div><h3>Search</h3><p>Find players, narrow the list with filters, then message the ones you want.</p></div>${spec.headActions||''}</div>${spec.profileBar||''}<div class="ra-formgrid ra-core-search-grid">${input('search','Name / ID',filters.search,'Player name or ID')}<div class="ra-field"><label>Status</label><select id="ra-${d}-filter-status"><option value="">Any</option>${['Online','Idle','Offline'].map(s=>`<option value="${s}" ${status===s.toLowerCase()?'selected':''}>${s}</option>`).join('')}</select></div>${input('organization',`Current ${L}`,filters.organization,spec.orgPlaceholder)}<div class="ra-field"><label>${L} Presence</label><select id="ra-${d}-filter-organization-presence"><option value="any" ${!presence||presence==='any'?'selected':''}>Any</option><option value="none" ${presence==='none'?'selected':''}>None</option><option value="has" ${presence==='has'?'selected':''}>Has ${L}</option></select></div>${input('end','END ≥',filters.minEnd,'e.g. 100k')}${input('man','MAN ≥',filters.minMan,'e.g. 50k')}${input('int','INT ≥',filters.minInt,'e.g. 50k')}</div><div class="ra-actions"><button type="button" class="ra-btn ra-primary" id="ra-${d}-search-apply">Search</button><button type="button" class="ra-btn" id="ra-${d}-search-clear">Clear</button>${options.searchMore?`<button type="button" class="ra-btn" id="ra-${d}-search-more" title="Ask Torn for up to 100 more players with the same filters">Search more</button>`:''}${spec.extraButtons||''}</div></section><section class="ra-panel ra-results-panel"><div class="ra-panel-head"><div><h3>Results</h3><p>${filteredTotal} matching of ${total} ${L} candidate(s).</p></div><div class="ra-actions"><button type="button" class="ra-btn ${layout==='expanded'?'ra-primary':''}" data-results-layout="expanded">Expanded</button><button type="button" class="ra-btn ${layout==='compact'?'ra-primary':''}" data-results-layout="compact">Compact</button></div></div><div class="ra-table-wrap">${table}</div><div class="ra-panel-foot">${pager}</div></section>`;
  }

  // Search & Results page controller. Each call builds an independent runtime, so Company and Faction
  // keep their own filters, sort, paging and profile state.
  // spec: {domain,label,logTag,routes,implemented,meta,organizationInfo,buildRows(app),selectProfile(app),beforePage(app,ctx),renderHtml(app,sorted,options,ctx),bindControls(),goPageSelector}
  function createResultsPlatform(spec){
    const d=spec.domain,route=`${d}-candidates`,IMPLEMENTED_ROUTES=new Set(spec.implemented);
    const runtime={app:null,observer:null,originalHandlers:new Map(),installed:false,searchFilters:{...DEFAULT_SEARCH_FILTERS},sort:{...DEFAULT_SORT},hofOffset:0,resultPage:0};
    const isRoute=value=>spec.routes.includes(text(value));
    function routeMeta(page){const [title,description]=spec.meta[text(page)]||spec.meta[`${d}-overview`];return{title,description};}
    const filter=(rows,filters)=>filterRows(rows,filters,spec.organizationInfo);
    function savedResultsView(app){const raw=app?._test?.state?.settings?.candidates?.resultsView?.[d];return raw&&typeof raw==='object'?normalizeResultsView(raw):null;}
    async function persistResultsView(app){if(typeof app?.saveResultsView!=='function')return;const view=normalizeResultsView({filters:runtime.searchFilters,sort:runtime.sort,resultPage:runtime.resultPage,profileId:runtime.profileFiltersId,profileVersion:runtime.profileFiltersVersion});const key=JSON.stringify(view);if(key===runtime.savedResultsViewKey)return;runtime.savedResultsViewKey=key;await app.saveResultsView(d,view);}
    async function persistRoute(app,page){const state=app?._test?.state;if(!state?.db)return false;state.page=page;state.settings=state.settings||{};state.settings.activePage=page;const meta=await dbGet(state.db,'meta','global')||{key:'global',settings:{}};meta.settings={...(meta.settings||{}),activePage:page};await dbPut(state.db,'meta',meta);return true;}
    function claimRoute(app,page){const state=app?._test?.state,r=text(page);if(!state||!IMPLEMENTED_ROUTES.has(r))return false;state.page=r;state.settings=state.settings||{};state.settings.activePage=r;return true;}
    function navigate(page,persist=true){const r=text(page);if(!runtime.app||!IMPLEMENTED_ROUTES.has(r))return Promise.resolve(false);if(typeof runtime.app.navigate==='function')return Promise.resolve(runtime.app.navigate(r,persist));claimRoute(runtime.app,r);return renderPage(r,{persist});}
    async function rowFor(userId){const rows=await spec.buildRows(runtime.app);const row=rows.find(item=>text(item.userId)===text(userId));if(!row)throw new Error(`${spec.label} candidate was not found.`);return row;}
    function reportError(error){console.error(spec.logTag,error);try{globalThis.alert?.(`${spec.label} Recruitment failed: ${error?.message||error}`);}catch{}}
    const rerender=()=>renderPage(route,{persist:false});
    function readVisibleSearchFilters(){const v=key=>text(document.getElementById(`ra-${d}-filter-${key}`)?.value);return{search:v('search'),minEnd:v('end'),minMan:v('man'),minInt:v('int'),onlineStatus:v('status'),organization:v('organization'),organizationPresence:v('organization-presence')||'any'};}
    function bindContentControls(){
      const search=(id,label,options)=>document.getElementById(`ra-${d}-${id}`)?.addEventListener('click',async()=>{const button=document.getElementById(`ra-${d}-${id}`);runtime.resultPage=0;runtime.searchFilters=readVisibleSearchFilters();try{if(button){button.disabled=true;button.textContent='Searching…';}if(typeof runtime.app?.searchCandidates!=='function')throw new Error('Active candidate search is unavailable.');const result=await runtime.app.searchCandidates(d,runtime.searchFilters,options);runtime.searchMore=result?.hasMore===true;await rerender();}catch(error){reportError(error);rerender().catch(reportError);}finally{if(button?.isConnected){button.disabled=false;button.textContent=label;}}});
      search('search-apply','Search');search('search-more','Search more',{more:true});
      document.getElementById(`ra-${d}-search-clear`)?.addEventListener('click',()=>{runtime.resultPage=0;runtime.searchFilters={...DEFAULT_SEARCH_FILTERS};rerender().catch(reportError);});
      document.querySelectorAll(`#ra-content [data-${d}-sort]`).forEach(button=>{button.onclick=()=>{runtime.resultPage=0;runtime.sort=toggleSort(runtime.sort,button.getAttribute(`data-${d}-sort`));rerender().catch(reportError);};});
      document.querySelectorAll('#ra-content [data-results-page]').forEach(button=>{button.onclick=()=>{runtime.resultPage=Math.max(0,runtime.resultPage+(button.dataset.resultsPage==='next'?1:-1));rerender().catch(reportError);};});
      document.querySelectorAll('#ra-content [data-results-layout]').forEach(button=>{button.onclick=()=>{if(typeof runtime.app?.setResultsLayout!=='function')return;runtime.app.setResultsLayout(button.dataset.resultsLayout).then(rerender).catch(reportError);};});
      document.querySelectorAll('#ra-content [data-player-card]').forEach(link=>{link.onclick=event=>{event.preventDefault();runtime.app?.openPlayerCard?.(d,link.dataset.playerCard);};});
      document.querySelectorAll(spec.goPageSelector).forEach(button=>{if(!isRoute(button.dataset.goPage))return;button.onclick=event=>{event?.preventDefault?.();navigate(button.dataset.goPage,true).catch(reportError);};});
      spec.bindControls();
    }
    async function renderPage(page,options={}){
      const app=runtime.app;page=text(page);
      if(!app||!IMPLEMENTED_ROUTES.has(page))return false;
      if(options.persist!==false)claimRoute(app,page);
      const title=document.getElementById('ra-page-title'),desc=document.getElementById('ra-page-desc'),content=document.getElementById('ra-content');
      if(!title||!desc||!content)throw new Error('Recruitment Agency shell is not mounted.');
      const rows=await spec.buildRows(app);
      const ctx=await spec.selectProfile(app);const selected=ctx.selected;const selectedId=text(selected?.profileId);const selectedVersion=text(selected?.updatedAt);
      if(!runtime.profileFiltersInitialized||runtime.profileFiltersId!==selectedId||runtime.profileFiltersVersion!==selectedVersion){const saved=runtime.profileFiltersInitialized?null:savedResultsView(app);if(saved)runtime.sort=saved.sort;if(saved&&saved.profileId===selectedId&&saved.profileVersion===selectedVersion){runtime.searchFilters=saved.filters;runtime.resultPage=saved.resultPage;}else{runtime.searchFilters=selected?spec.profileSearchFilters(selected):{...DEFAULT_SEARCH_FILTERS};runtime.resultPage=0;}runtime.profileFiltersInitialized=true;runtime.profileFiltersId=selectedId;runtime.profileFiltersVersion=selectedVersion;}
      const sortedAll=sortRows(filter(rows,runtime.searchFilters),runtime.sort).map(row=>({...row,currentOrganizationLabel:spec.organizationInfo(row).label}));
      if(spec.beforePage)await spec.beforePage(app,ctx);
      const pageCount=Math.max(1,Math.ceil(sortedAll.length/RESULTS_PAGE_SIZE));runtime.resultPage=Math.min(Math.max(0,runtime.resultPage),pageCount-1);const start=runtime.resultPage*RESULTS_PAGE_SIZE;const sorted=sortedAll.slice(start,start+RESULTS_PAGE_SIZE);
      await persistResultsView(app).catch(error=>console.warn('[RA] Results view was not saved.',error));
      const html=await spec.renderHtml(app,sorted,{filters:runtime.searchFilters,sort:runtime.sort,total:rows.length,filteredTotal:sortedAll.length,layout:app._test.state.settings?.candidates?.resultsLayout,searchMore:runtime.searchMore===true,pagination:{page:runtime.resultPage,pageSize:RESULTS_PAGE_SIZE,pageCount,start,end:start+sorted.length}},ctx);
      if(typeof app.navigate==='function'&&text(app._test.state.page)!==page)return false;
      const meta=routeMeta(page);title.textContent=meta.title;desc.textContent=meta.description;content.innerHTML=html;
      document.querySelectorAll('#ra-nav [data-page]').forEach(button=>button.classList.toggle('active',button.dataset.page===page));bindContentControls();if(options.persist!==false)await persistRoute(app,page);return true;
    }
    function bindNav(){if(!runtime.app)return;document.querySelectorAll('#ra-nav [data-page]').forEach(button=>{const page=text(button.dataset.page);if(!IMPLEMENTED_ROUTES.has(page))return;if(!runtime.originalHandlers.has(button))runtime.originalHandlers.set(button,button.onclick||null);button.onclick=event=>{event?.preventDefault?.();navigate(page,true).catch(reportError);};});}
    function syncNavigation(){bindNav();return true;}
    function install(app,options={}){if(!app?._test?.state?.db)throw new Error('A mounted Recruitment Agency app with DB state is required.');uninstall();runtime.app=app;runtime.installed=true;runtime.profileFiltersInitialized=false;runtime.savedResultsViewKey='';runtime.profileFiltersId='';runtime.profileFiltersVersion='';bindNav();const nav=document.getElementById('ra-nav');if(nav&&typeof MutationObserver==='function'){runtime.observer=new MutationObserver(()=>bindNav());runtime.observer.observe(nav,{childList:true,subtree:true});}const page=text(app._test.state.page||app._test.state.settings?.activePage);if(options.renderInitial!==false&&IMPLEMENTED_ROUTES.has(page))renderPage(page,{persist:false}).catch(reportError);return true;}
    function uninstall(){runtime.observer?.disconnect?.();runtime.observer=null;for(const[button,handler]of runtime.originalHandlers.entries())if(button?.isConnected)button.onclick=handler;runtime.originalHandlers.clear();runtime.app=null;runtime.installed=false;}
    return{runtime,route,IMPLEMENTED_ROUTES,isRoute,routeMeta,filterRows:filter,persistRoute,navigate,rowFor,reportError,rerender,readVisibleSearchFilters,renderPage,syncNavigation,install,uninstall};
  }

  return Object.freeze({
    text,number,esc,makeId,
    normalizeKind,normalizeRequirement,normalizeBaseline,compare,evaluateCriteria,
    applyStoreDefinitions,normalizeDomainConfig,
    DEFAULT_SEARCH_FILTERS,DEFAULT_SORT,RESULTS_PAGE_SIZE,SORT_KEYS,parseThreshold,organizationInfoFor,filterRows,sortRows,toggleSort,normalizeResultsView,
    dbGetAll,dbGet,dbPut,dbDelete,
    relativeLastActive,stat,lastOnlineHtml,recruitmentFitCell,provenanceCell,CRITERION_FIELDS,CRITERION_OPERATORS,renderCriterionRow,readCriteria,renderResults,
    createResultsPlatform
  });
});
