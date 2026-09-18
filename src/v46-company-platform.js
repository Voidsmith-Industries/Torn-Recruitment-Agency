(function(root,factory){
  const deps={
    CompanyCore:root&&root.RA_V46CompanyCore,
    CompanyUI:root&&root.RA_V46CompanyUI,
    Operations:root&&root.RA_V46CompanyOperations,
    Workflow:root&&root.RA_V46CompanyWorkflow,
    WorkflowUI:root&&root.RA_V46CompanyWorkflowUI,
    OpportunityUI:root&&root.RA_V46CompanyOpportunityUI,
    Messaging:root&&root.RA_V45Messaging
  };
  if(typeof module==='object'&&module.exports){
    deps.CompanyCore=require('./v46-company-core');
    deps.CompanyUI=require('./v46-company-ui');
    deps.Operations=require('./v46-company-operations');
    deps.Workflow=require('./v46-company-workflow');
    deps.WorkflowUI=require('./v46-company-workflow-ui');
    deps.OpportunityUI=require('./v46-company-opportunity-ui');
    deps.Messaging=require('./v45-messaging');
  }
  const api=factory(deps);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V46CompanyPlatform=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(D){
  'use strict';

  const {CompanyCore,CompanyUI,Operations,Workflow,WorkflowUI,OpportunityUI,Messaging}=D;
  if(!CompanyCore||!CompanyUI||!Operations||!Workflow||!WorkflowUI||!OpportunityUI||!Messaging)throw new Error('CompanyCore, CompanyUI, Operations, Workflow, WorkflowUI, OpportunityUI and Messaging are required.');

  const COMPANY_ROUTES=Object.freeze([
    'company-overview','company-today','company-discover','company-candidates','company-pipeline',
    'company-vacancies','company-campaigns','company-followups','company-timeline','company-stage-aging',
    'company-contact-outcomes','company-recruitment-sessions','company-talent-pool','company-reactivation',
    'company-opportunity','company-compare'
  ]);
  const IMPLEMENTED_ROUTES=new Set([
    'company-overview','company-today','company-candidates','company-pipeline','company-vacancies',
    'company-campaigns','company-followups','company-timeline','company-stage-aging','company-contact-outcomes',
    'company-recruitment-sessions','company-talent-pool','company-reactivation','company-opportunity','company-compare'
  ]);
  const META=Object.freeze({
    'company-overview':['Company Overview','Company recruitment status and work needing attention.'],
    'company-today':['Company Today','Prioritized Company recruitment work for today.'],
    'company-discover':['Company Discover','Company-only recruitment discovery and enrichment.'],
    'company-candidates':['Company Candidates','Search and manage Company recruitment candidates.'],
    'company-pipeline':['Company Pipeline','Move Company candidates through explicit recruitment stages.'],
    'company-vacancies':['Company Vacancies','Define and manage Company hiring needs.'],
    'company-campaigns':['Company Campaigns','Organize Company recruitment campaigns.'],
    'company-followups':['Company Follow-ups','Track Company candidate follow-ups.'],
    'company-timeline':['Company Timeline','Review Company recruitment history.'],
    'company-stage-aging':['Company Stage Aging','Review candidates aging in their current Company stage.'],
    'company-contact-outcomes':['Company Contact Outcomes','Track Company recruitment contact outcomes independently of stage.'],
    'company-recruitment-sessions':['Company Recruitment Sessions','Work focused Company recruitment queues.'],
    'company-talent-pool':['Company Talent Pool','Maintain reusable Company talent prospects.'],
    'company-reactivation':['Company Reactivation','Restart Company recruitment cycles without duplicating identity.'],
    'company-opportunity':['Company Opportunity Queue','Review explainable Company recruitment opportunities.'],
    'company-compare':['Company Compare','Compare Company candidates side by side.']
  });
  const DEFAULT_OPPORTUNITY_WEIGHTS=Object.freeze({match:30,fit:20,availability:15,activity:15,freshness:10,followUp:10,contactPenalty:10});

  const DEFAULT_SEARCH_FILTERS=Object.freeze({search:'',minEnd:'',minMan:'',minInt:'',onlineStatus:'',organization:'',organizationPresence:'any'});
  const DEFAULT_SORT=Object.freeze({key:'player',direction:'asc'});
  const SORT_KEYS=new Set(['player','end','man','int','lastActive']);
  const runtime={app:null,observer:null,originalHandlers:new Map(),installed:false,compareSelection:new Set(),searchFilters:{...DEFAULT_SEARCH_FILTERS},sort:{...DEFAULT_SORT}};
  const text=value=>String(value??'').trim();
  const number=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
  function parseThreshold(value){const raw=text(value).toLowerCase().replace(/,/g,'');if(!raw)return null;const match=raw.match(/^(\d+(?:\.\d+)?|\.\d+)\s*([kmb])?$/);if(!match)return null;const mult={k:1e3,m:1e6,b:1e9}[match[2]]||1;const out=Number(match[1])*mult;return Number.isFinite(out)?out:null;}
  function organizationInfo(row={}){const player=row.playerRecord||{};const name=text(row.currentCompany||player.currentCompany);const rawId=row.currentCompanyId??player.currentCompanyId;if(name)return{state:'has',label:name};if(rawId!==null&&rawId!==undefined&&rawId!==''){const id=Number(rawId);if(Number.isFinite(id)){if(id===0)return{state:'none',label:'None'};if(id>0)return{state:'has',label:`Company #${id}`};}}return{state:'unknown',label:'Unknown'};}
  function filterRows(rows,filters={}){const search=text(filters.search).toLowerCase(),minEnd=parseThreshold(filters.minEnd),minMan=parseThreshold(filters.minMan),minInt=parseThreshold(filters.minInt),onlineStatus=text(filters.onlineStatus).toLowerCase(),organization=text(filters.organization).toLowerCase(),presence=text(filters.organizationPresence).toLowerCase()||'any';return (Array.isArray(rows)?rows:[]).filter(row=>{if(search&&!`${text(row.name).toLowerCase()} ${text(row.userId)}`.includes(search))return false;if(minEnd!==null&&(!Number.isFinite(Number(row.end))||row.end===null||row.end===undefined||row.end===''||Number(row.end)<minEnd))return false;if(minMan!==null&&(!Number.isFinite(Number(row.man))||row.man===null||row.man===undefined||row.man===''||Number(row.man)<minMan))return false;if(minInt!==null&&(!Number.isFinite(Number(row.int))||row.int===null||row.int===undefined||row.int===''||Number(row.int)<minInt))return false;if(onlineStatus&&text(row.onlineStatus).toLowerCase()!==onlineStatus)return false;const org=organizationInfo(row);if(organization&&(org.state!=='has'||!org.label.toLowerCase().includes(organization)))return false;if(presence==='has'&&org.state!=='has')return false;if(presence==='none'&&org.state!=='none')return false;return true;});}
  function sortValue(row,key,now){if(key==='player')return text(row.name).toLowerCase()||null;if(key==='end'||key==='man'||key==='int'){const raw=row[key];if(raw===null||raw===undefined||raw==='')return null;const value=Number(raw);return Number.isFinite(value)?value:null;}if(key==='lastActive'){const ts=Number(row.lastActive);if(Number.isFinite(ts)&&ts>0)return ts;const status=text(row.onlineStatus).toLowerCase();if(status==='online')return now+2;if(status==='idle')return now+1;if(status==='offline')return 0;return null;}return null;}
  function sortTieBreak(a,b){const byName=text(a.name).localeCompare(text(b.name),undefined,{sensitivity:'base'});if(byName)return byName;return text(a.userId).localeCompare(text(b.userId),undefined,{numeric:true});}
  function sortRows(rows,sortState=DEFAULT_SORT,now=Date.now()){const key=SORT_KEYS.has(text(sortState?.key))?text(sortState.key):DEFAULT_SORT.key;const direction=sortState?.direction==='desc'?'desc':'asc';const sign=direction==='asc'?1:-1;return [...(Array.isArray(rows)?rows:[])].sort((a,b)=>{const av=sortValue(a,key,now),bv=sortValue(b,key,now),am=av===null||av===undefined,bm=bv===null||bv===undefined;if(am!==bm)return am?1:-1;if(am&&bm)return sortTieBreak(a,b);const cmp=key==='player'?String(av).localeCompare(String(bv)):Number(av)-Number(bv);return cmp?cmp*sign:sortTieBreak(a,b);});}
  function toggleSort(current,key){const nextKey=SORT_KEYS.has(text(key))?text(key):DEFAULT_SORT.key;if(text(current?.key)===nextKey)return{key:nextKey,direction:current?.direction==='asc'?'desc':'asc'};return{key:nextKey,direction:nextKey==='player'?'asc':'desc'};}
  let idSequence=0;
  function makeId(prefix){
    const uuid=globalThis.crypto?.randomUUID?.();
    if(uuid)return `${prefix}-${uuid}`;
    idSequence=(idSequence+1)%1000000;
    return `${prefix}-${Date.now()}-${idSequence}`;
  }
  const terminalStage=stage=>['Hired','Rejected'].includes(text(stage));

  function isCompanyRoute(value){return COMPANY_ROUTES.includes(text(value));}
  function routeMeta(route){const [title,description]=META[text(route)]||META['company-overview'];return{title,description};}
  function opportunityWeights(config={}){return{...DEFAULT_OPPORTUNITY_WEIGHTS,...(config.opportunityWeights||{})};}

  function dbGetAll(db,store){return new Promise(resolve=>{try{const q=db.transaction(store,'readonly').objectStore(store).getAll();q.onsuccess=()=>resolve(q.result||[]);q.onerror=()=>resolve([]);}catch{resolve([]);}});}
  function dbGet(db,store,key){return new Promise(resolve=>{try{const q=db.transaction(store,'readonly').objectStore(store).get(key);q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>resolve(null);}catch{resolve(null);}});}
  function dbPut(db,store,value){return new Promise((resolve,reject)=>{try{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error||new Error(`Failed to save ${store}.`));}catch(error){reject(error);}});}
  function dbDelete(db,store,key){return new Promise((resolve,reject)=>{try{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error||new Error(`Failed to delete from ${store}.`));}catch(error){reject(error);}});}

  async function getConfig(app){if(app?._test?.companyRepositories?.config?.get)return app._test.companyRepositories.config.get();return(await dbGet(app._test.state.db,'companyRecruitmentConfig','company'))||{key:'company',baseline:{criteria:[]},stageThresholds:{},opportunityWeights:{}};}
  async function saveConfig(app,patch){if(app?._test?.companyRepositories?.config?.save)return app._test.companyRepositories.config.save(patch);const existing=await getConfig(app);const next={...existing,...patch,key:'company',updatedAt:Date.now()};await dbPut(app._test.state.db,'companyRecruitmentConfig',next);return next;}
  async function getVacancies(app){if(app?._test?.companyRepositories?.vacancies?.list)return app._test.companyRepositories.vacancies.list();return dbGetAll(app._test.state.db,'companyVacancies');}
  async function saveVacancy(app,vacancy){if(app?._test?.companyRepositories?.vacancies?.save)return app._test.companyRepositories.vacancies.save(vacancy);const next=CompanyCore.normalizeVacancy({...vacancy,updatedAt:Date.now()});await dbPut(app._test.state.db,'companyVacancies',next);return next;}
  async function removeVacancy(app,vacancyId){if(app?._test?.companyRepositories?.vacancies?.remove)return app._test.companyRepositories.vacancies.remove(vacancyId);return dbDelete(app._test.state.db,'companyVacancies',text(vacancyId));}
  async function getCampaigns(app){if(app?._test?.companyRepositories?.campaigns?.list)return app._test.companyRepositories.campaigns.list();return dbGetAll(app._test.state.db,'companyCampaigns');}
  async function getCampaign(app,campaignId){if(app?._test?.companyRepositories?.campaigns?.get)return app._test.companyRepositories.campaigns.get(campaignId);return dbGet(app._test.state.db,'companyCampaigns',text(campaignId));}
  async function saveCampaign(app,campaign){if(app?._test?.companyRepositories?.campaigns?.save)return app._test.companyRepositories.campaigns.save(campaign);const next={...campaign,campaignId:text(campaign.campaignId)||makeId('campaign'),candidateIds:[...new Set((campaign.candidateIds||[]).map(text).filter(Boolean))],updatedAt:Date.now()};await dbPut(app._test.state.db,'companyCampaigns',next);return next;}
  async function removeCampaign(app,campaignId){if(app?._test?.companyRepositories?.campaigns?.remove)return app._test.companyRepositories.campaigns.remove(campaignId);return dbDelete(app._test.state.db,'companyCampaigns',text(campaignId));}
  async function getSessions(app){if(app?._test?.companyRepositories?.sessions?.list)return app._test.companyRepositories.sessions.list();return dbGetAll(app._test.state.db,'companyRecruitmentSessions');}
  async function getSession(app,sessionId){if(app?._test?.companyRepositories?.sessions?.get)return app._test.companyRepositories.sessions.get(sessionId);return dbGet(app._test.state.db,'companyRecruitmentSessions',text(sessionId));}
  async function saveSession(app,session){if(app?._test?.companyRepositories?.sessions?.save)return app._test.companyRepositories.sessions.save(session);const next={...session,sessionId:text(session.sessionId)||makeId('session'),candidateIds:[...new Set((session.candidateIds||[]).map(text).filter(Boolean))],updatedAt:Date.now()};await dbPut(app._test.state.db,'companyRecruitmentSessions',next);return next;}
  async function saveCompanyPatch(app,userId,patch){const id=text(userId);if(app?._test?.repositories?.company?.ensure)return app._test.repositories.company.ensure(id,patch,{source:'company-platform',observedAt:Date.now()});const existing=await dbGet(app._test.state.db,'companyRecruitment',id);if(!existing)throw new Error('Company candidate was not found.');const next={...existing,...patch,userId:id,domain:'company',updatedAt:Date.now()};await dbPut(app._test.state.db,'companyRecruitment',next);return next;}

  function evaluateCandidateVacancies(row,vacancies=[]){
    const open=(Array.isArray(vacancies)?vacancies:[]).filter(v=>text(v?.status)==='Open');
    const facts={level:row.level,ee:row.ee,fit:row.fit,activity30:row.activity30,xanax30:row.xanax30,refills30:row.refills30,attacks30:row.attacks30,rwHits30:row.rwHits30,networth:row.networth,availability:row.availability,desiredRole:row.desiredRole};
    const waivers=row.companyRecord?.waivers||[];
    const evaluations=open.map(vacancy=>CompanyCore.evaluateVacancy(vacancy,facts,waivers));
    const selection=CompanyCore.suggestVacancy(open,evaluations,row.companyRecord?.pinnedVacancyId||'');
    return{evaluations,selection};
  }
  function canMoveToStage(row,stage){return !(text(stage)==='Hired'&&row?.hardFailed===true);}

  async function buildRows(app){
    const db=app._test.state.db;
    const[companyRecords,players,candidateLocals,config,vacancies]=await Promise.all([dbGetAll(db,'companyRecruitment'),dbGetAll(db,'playerIntelligence'),dbGetAll(db,'candidateLocal'),getConfig(app),getVacancies(app)]);
    const baseline=CompanyCore.normalizeBaseline(config.baseline||{});
    const rows=CompanyUI.buildCandidateRows(companyRecords,players,{eligibilityFor:(record,player)=>CompanyCore.evaluateCriteria(baseline.criteria,player,record.waivers||[])});
    const vacancyMap=new Map(vacancies.map(v=>[text(v.vacancyId),v]));
    const candidateMap=new Map(candidateLocals.map(candidate=>[text(candidate?.userId??candidate?.id),candidate]));
    return rows.map(row=>{
      const result=evaluateCandidateVacancies(row,vacancies);
      const evaluationMap=new Map(result.evaluations.map(e=>[text(e.vacancyId),e]));
      const options=vacancies.filter(v=>text(v.status)==='Open').map(v=>({vacancyId:text(v.vacancyId),name:text(v.name)||text(v.role)||text(v.vacancyId),matchScore:evaluationMap.get(text(v.vacancyId))?.matchScore??null,eligible:evaluationMap.get(text(v.vacancyId))?.eligible===true}));
      const candidate=candidateMap.get(text(row.userId))||{};const stats=candidate.stats||{};const player=row.playerRecord||{};
      return{...row,man:player.man??stats.man??candidate.man??null,int:player.int??stats.int??candidate.int??null,end:player.end??stats.end??candidate.end??null,total:player.total??stats.total??candidate.total??null,onlineStatus:text(player.onlineStatus)||text(row.onlineStatus),talentPool:row.companyRecord?.talentPool===true,talentPoolReason:text(row.companyRecord?.talentPoolReason),vacancyEvaluations:result.evaluations,pinnedVacancyId:text(result.selection.pinnedVacancyId),suggestedVacancyId:text(result.selection.suggestedVacancyId),suggestedVacancyName:text(vacancyMap.get(text(result.selection.suggestedVacancyId))?.name),vacancyOptions:options};
    });
  }

  async function buildOpportunityRows(app,rows,now=Date.now()){
    const config=await getConfig(app);
    return OpportunityUI.buildOpportunityRows(rows,{weights:opportunityWeights(config),now});
  }

  async function persistRoute(app,page){const state=app?._test?.state;if(!state?.db)return false;state.page=page;state.settings=state.settings||{};state.settings.activePage=page;const meta=await dbGet(state.db,'meta','global')||{key:'global',settings:{}};meta.settings={...(meta.settings||{}),activePage:page};await dbPut(state.db,'meta',meta);return true;}
  function claimRoute(app,page){const state=app?._test?.state,route=text(page);if(!state||!IMPLEMENTED_ROUTES.has(route))return false;state.page=route;state.settings=state.settings||{};state.settings.activePage=route;return true;}
  function navigate(page,persist=true){const route=text(page);if(!runtime.app||!IMPLEMENTED_ROUTES.has(route))return Promise.resolve(false);if(typeof runtime.app.navigate==='function')return Promise.resolve(runtime.app.navigate(route,persist));claimRoute(runtime.app,route);return renderPage(route,{persist});}
  function readCriteria(host){if(!host)return[];return[...host.querySelectorAll('[data-criterion-row]')].map((row,index)=>{const get=key=>row.querySelector(`[data-criterion-field="${key}"]`)?.value??'';const rawValue=get('value');const numericValue=rawValue!==''&&Number.isFinite(Number(rawValue))?Number(rawValue):rawValue;return{id:text(row.dataset.criterionId)||makeId(`criterion-${index+1}`),label:text(get('label')),field:text(get('field')),operator:text(get('operator'))||'gte',kind:text(get('kind'))==='Hard'?'Hard':'Preferred',value:numericValue,weight:Math.max(0,number(get('weight'),1))};});}
  async function rowFor(userId){const rows=await buildRows(runtime.app);const row=rows.find(item=>text(item.userId)===text(userId));if(!row)throw new Error('Company candidate was not found.');return row;}
  async function saveOperationalRecord(userId,next){await saveCompanyPatch(runtime.app,userId,next);return next;}

  async function changeCompanyStage(userId,stage){const row=await rowFor(userId);if(!canMoveToStage(row,stage))throw new Error('This candidate cannot be moved to Hired while an unwaived Company baseline Hard requirement is failing.');return saveOperationalRecord(userId,Operations.changeStage(row.companyRecord,text(stage),Date.now()));}
  async function setVacancyPin(userId,vacancyId){await saveCompanyPatch(runtime.app,userId,{pinnedVacancyId:text(vacancyId),updatedAt:Date.now()});return true;}
  async function addFollowUpFromUi(){const userId=text(document.getElementById('ra-company-followup-player')?.value);const row=await rowFor(userId);const dueRaw=text(document.getElementById('ra-company-followup-due')?.value);const dueAt=Date.parse(dueRaw);if(!Number.isFinite(dueAt))throw new Error('Choose a valid follow-up date and time.');const unit=text(document.getElementById('ra-company-followup-recurrence-unit')?.value);const recurrence=unit?{unit,interval:Math.max(1,number(document.getElementById('ra-company-followup-recurrence-interval')?.value,1))}:null;const next=Operations.addFollowUp(row.companyRecord,{dueAt,reason:text(document.getElementById('ra-company-followup-reason')?.value),note:text(document.getElementById('ra-company-followup-note')?.value),recurrence},Date.now());return saveOperationalRecord(userId,next);}
  async function completeFollowUp(userId,followUpId){const row=await rowFor(userId);return saveOperationalRecord(userId,Operations.completeFollowUp(row.companyRecord,followUpId,Date.now()));}
  async function recordOutcomeFromUi(){const userId=text(document.getElementById('ra-company-outcome-player')?.value);const row=await rowFor(userId);const next=Operations.recordContactOutcome(row.companyRecord,{result:text(document.getElementById('ra-company-outcome-result')?.value),channel:text(document.getElementById('ra-company-outcome-channel')?.value),note:text(document.getElementById('ra-company-outcome-note')?.value)},Date.now());return saveOperationalRecord(userId,next);}
  async function toggleDnc(userId,enabled){const row=await rowFor(userId);const reason=text(document.querySelector(`[data-dnc-reason="${userId}"]`)?.value);return saveOperationalRecord(userId,Operations.setDoNotContact(row.companyRecord,enabled,reason,Date.now()));}
  async function addTimelineNoteFromUi(){const userId=text(document.getElementById('ra-company-timeline-player')?.value);const row=await rowFor(userId);const value=text(document.getElementById('ra-company-timeline-note')?.value);if(!value)throw new Error('Timeline note cannot be empty.');return saveOperationalRecord(userId,Operations.addTimelineNote(row.companyRecord,{text:value},Date.now()));}
  async function editTimelineNote(userId,noteId){const row=await rowFor(userId);const current=(row.companyRecord.timelineNotes||[]).find(note=>text(note.noteId)===text(noteId));if(!current)throw new Error('Timeline note not found.');const value=text(globalThis.prompt?.('Edit recruiter timeline note:',current.text));if(!value)return false;return saveOperationalRecord(userId,Operations.editTimelineNote(row.companyRecord,noteId,value,Date.now()));}
  async function deleteTimelineNote(userId,noteId){if(typeof globalThis.confirm==='function'&&!globalThis.confirm('Delete this recruiter timeline note?'))return false;const row=await rowFor(userId);return saveOperationalRecord(userId,Operations.deleteTimelineNote(row.companyRecord,noteId,Date.now()));}
  async function recruitPlayer(userId,override=false){const row=await rowFor(userId);if(!Operations.canMessage(row.companyRecord,override))throw new Error('This candidate is marked Do Not Contact. Use the explicit override only when you deliberately intend to contact them.');if(override&&typeof globalThis.confirm==='function'&&!globalThis.confirm('This candidate is marked Do Not Contact. Override it for this recruitment chat only?'))return false;if(typeof runtime.app?.recruitCandidate!=='function')throw new Error('Recruit workflow is unavailable.');return runtime.app.recruitCandidate?.('company',text(userId),row.name);}

  async function createCampaignFromUi(){return saveCampaign(runtime.app,{campaignId:makeId('campaign'),title:text(document.getElementById('ra-company-campaign-title')?.value)||'Untitled Campaign',target:text(document.getElementById('ra-company-campaign-target')?.value),vacancyId:text(document.getElementById('ra-company-campaign-vacancy')?.value),status:text(document.getElementById('ra-company-campaign-status')?.value)||'Draft',notes:text(document.getElementById('ra-company-campaign-notes')?.value),candidateIds:[],createdAt:Date.now()});}
  async function saveCampaignFromCard(campaignId,card){const existing=await getCampaign(runtime.app,campaignId)||{campaignId,candidateIds:[]};const field=key=>card?.querySelector(`[data-campaign-field="${key}"]`)?.value??'';return saveCampaign(runtime.app,{...existing,campaignId,title:text(field('title'))||existing.title,target:text(field('target')),vacancyId:text(field('vacancyId')),status:text(field('status'))||existing.status,notes:text(field('notes'))});}
  async function changeCampaignMembership(campaignId,userId,add){const campaign=await getCampaign(runtime.app,campaignId);if(!campaign)throw new Error('Company campaign was not found.');const row=await rowFor(userId);const ids=[...new Set((campaign.candidateIds||[]).map(text).filter(Boolean))];campaign.candidateIds=add?[...new Set([...ids,text(userId)])]:ids.filter(id=>id!==text(userId));const nextRecord=add?Workflow.addCampaignMembership(row.companyRecord,campaignId,Date.now()):Workflow.removeCampaignMembership(row.companyRecord,campaignId,Date.now());await Promise.all([saveCampaign(runtime.app,campaign),saveOperationalRecord(userId,nextRecord)]);return true;}
  async function setTalentPoolFromUi(enabled,userId=''){const id=text(userId)||text(document.getElementById('ra-company-talent-player')?.value);if(!id)throw new Error('Choose a Company candidate.');const row=await rowFor(id);const reason=enabled?text(document.getElementById('ra-company-talent-reason')?.value):'';return saveOperationalRecord(id,Workflow.setTalentPool(row.companyRecord,enabled,reason,Date.now()));}
  async function reactivateFromUi(userId){const row=await rowFor(userId);const reason=text(document.querySelector(`[data-reactivate-reason="${userId}"]`)?.value);if(!reason)throw new Error('A reactivation reason is required.');return saveOperationalRecord(userId,Workflow.reactivate(row.companyRecord,reason,Date.now()));}
  async function createSessionFromUi(){const rows=await buildRows(runtime.app);const candidateIds=rows.filter(row=>!row.archived&&!terminalStage(row.pipelineStage)).map(row=>text(row.userId));if(!candidateIds.length)throw new Error('No active Company candidates are available for this session.');return saveSession(runtime.app,{sessionId:makeId('session'),title:text(document.getElementById('ra-company-session-title')?.value)||'Recruitment Session',candidateIds,cursor:0,status:'Active',outcomes:[],filters:{source:text(document.getElementById('ra-company-session-source')?.value)||'active'},startedAt:Date.now(),createdAt:Date.now()});}
  async function recordSessionActionFromUi(sessionId,userId,action){const session=await getSession(runtime.app,sessionId);if(!session)throw new Error('Recruitment session was not found.');const note=text(document.querySelector(`[data-session-note="${sessionId}"]`)?.value);return saveSession(runtime.app,Workflow.recordSessionAction(session,{userId,action,note},Date.now()));}

  function bindContentControls(currentPage){
    const page=text(currentPage||runtime.app?._test?.state?.page);
    document.getElementById('ra-company-search-apply')?.addEventListener('click',async event=>{const button=event?.currentTarget;runtime.searchFilters={search:text(document.getElementById('ra-company-filter-search')?.value),minEnd:text(document.getElementById('ra-company-filter-end')?.value),minMan:text(document.getElementById('ra-company-filter-man')?.value),minInt:text(document.getElementById('ra-company-filter-int')?.value),onlineStatus:text(document.getElementById('ra-company-filter-status')?.value),organization:text(document.getElementById('ra-company-filter-organization')?.value),organizationPresence:text(document.getElementById('ra-company-filter-organization-presence')?.value)||'any'};try{if(button){button.disabled=true;button.textContent='Searching…';}if(typeof runtime.app?.searchCandidates!=='function')throw new Error('Active candidate search is unavailable.');await runtime.app.searchCandidates('company',runtime.searchFilters);await renderPage('company-candidates',{persist:false});}catch(error){reportError(error);}finally{if(button?.isConnected){button.disabled=false;button.textContent='Search';}}});
    document.getElementById('ra-company-search-clear')?.addEventListener('click',()=>{runtime.searchFilters={...DEFAULT_SEARCH_FILTERS};renderPage('company-candidates',{persist:false}).catch(reportError);});
    document.querySelectorAll('#ra-content [data-company-sort]').forEach(button=>{button.onclick=()=>{runtime.sort=toggleSort(runtime.sort,button.dataset.companySort);renderPage('company-candidates',{persist:false}).catch(reportError);};});
    document.querySelectorAll('#ra-content [data-go-page]').forEach(button=>{if(!isCompanyRoute(button.dataset.goPage))return;button.onclick=event=>{event?.preventDefault?.();navigate(button.dataset.goPage,true).catch(reportError);};});
    document.querySelectorAll('#ra-content [data-company-stage-select]').forEach(select=>{select.onchange=()=>changeCompanyStage(select.dataset.companyStageSelect,select.value).then(()=>renderPage(page,{persist:false})).catch(error=>{reportError(error);renderPage(page,{persist:false}).catch(reportError);});});
    document.querySelectorAll('#ra-content [data-company-vacancy-pin]').forEach(select=>{select.onchange=()=>setVacancyPin(select.dataset.companyVacancyPin,select.value).then(()=>renderPage('company-candidates',{persist:false})).catch(reportError);});
    document.querySelectorAll('#ra-content [data-company-recruit]').forEach(button=>{button.onclick=()=>recruitPlayer(button.dataset.companyRecruit,false).catch(reportError);});
    document.querySelectorAll('#ra-content [data-company-recruit-override]').forEach(button=>{button.onclick=()=>recruitPlayer(button.dataset.companyRecruitOverride,true).catch(reportError);});
    document.querySelectorAll('#ra-content [data-remove-criterion]').forEach(button=>{button.onclick=()=>button.closest('[data-criterion-row]')?.remove();});
    document.getElementById('ra-company-baseline-add')?.addEventListener('click',()=>document.getElementById('ra-company-baseline-criteria')?.insertAdjacentHTML('beforeend',CompanyUI.renderCriterionRow({id:makeId('baseline')},'baseline')));
    document.getElementById('ra-company-baseline-save')?.addEventListener('click',()=>saveConfig(runtime.app,{baseline:{criteria:readCriteria(document.getElementById('ra-company-baseline-criteria'))}}).then(()=>renderPage('company-vacancies',{persist:false})).catch(reportError));
    document.getElementById('ra-company-vacancy-new')?.addEventListener('click',()=>{const vacancy={vacancyId:makeId('vacancy'),name:text(document.getElementById('ra-company-new-vacancy-name')?.value)||'Untitled Vacancy',role:text(document.getElementById('ra-company-new-vacancy-role')?.value),openings:Math.max(1,Math.floor(number(document.getElementById('ra-company-new-vacancy-openings')?.value,1))),status:text(document.getElementById('ra-company-new-vacancy-status')?.value)||'Draft',criteria:[]};saveVacancy(runtime.app,vacancy).then(()=>renderPage('company-vacancies',{persist:false})).catch(reportError);});
    document.querySelectorAll('#ra-content [data-vacancy-add-criterion]').forEach(button=>{button.onclick=()=>button.closest('[data-vacancy-card]')?.querySelector('[data-criteria-host]')?.insertAdjacentHTML('beforeend',CompanyUI.renderCriterionRow({id:makeId('vacancy-criterion')},`vacancy:${button.dataset.vacancyAddCriterion}`));});
    document.querySelectorAll('#ra-content [data-vacancy-save]').forEach(button=>{button.onclick=()=>{const card=button.closest('[data-vacancy-card]');if(!card)return;const field=key=>card.querySelector(`[data-vacancy-field="${key}"]`)?.value??'';const vacancy={vacancyId:button.dataset.vacancySave,name:text(field('name')),role:text(field('role')),openings:Math.max(1,Math.floor(number(field('openings'),1))),status:text(field('status'))||'Draft',salaryBudget:field('salaryBudget')===''?null:number(field('salaryBudget')),availability:text(field('availability'))||'Unknown',notes:text(field('notes')),criteria:readCriteria(card.querySelector('[data-criteria-host]'))};saveVacancy(runtime.app,vacancy).then(()=>renderPage('company-vacancies',{persist:false})).catch(reportError);};});
    document.querySelectorAll('#ra-content [data-vacancy-delete]').forEach(button=>{button.onclick=()=>{if(typeof globalThis.confirm==='function'&&!globalThis.confirm('Delete this Company vacancy?'))return;removeVacancy(runtime.app,button.dataset.vacancyDelete).then(()=>renderPage('company-vacancies',{persist:false})).catch(reportError);};});
    document.getElementById('ra-company-followup-add')?.addEventListener('click',()=>addFollowUpFromUi().then(()=>renderPage('company-followups',{persist:false})).catch(reportError));
    document.querySelectorAll('#ra-content [data-followup-complete]').forEach(button=>{button.onclick=()=>completeFollowUp(button.dataset.followupUser,button.dataset.followupComplete).then(()=>renderPage('company-followups',{persist:false})).catch(reportError);});
    document.getElementById('ra-company-outcome-add')?.addEventListener('click',()=>recordOutcomeFromUi().then(()=>renderPage('company-contact-outcomes',{persist:false})).catch(reportError));
    document.querySelectorAll('#ra-content [data-company-dnc]').forEach(button=>{button.onclick=()=>toggleDnc(button.dataset.companyDnc,button.dataset.dncEnable==='true').then(()=>renderPage('company-contact-outcomes',{persist:false})).catch(reportError);});
    document.getElementById('ra-company-timeline-add')?.addEventListener('click',()=>addTimelineNoteFromUi().then(()=>renderPage('company-timeline',{persist:false})).catch(reportError));
    document.querySelectorAll('#ra-content [data-timeline-note-edit]').forEach(button=>{button.onclick=()=>editTimelineNote(button.dataset.timelineUser,button.dataset.timelineNoteEdit).then(()=>renderPage('company-timeline',{persist:false})).catch(reportError);});
    document.querySelectorAll('#ra-content [data-timeline-note-delete]').forEach(button=>{button.onclick=()=>deleteTimelineNote(button.dataset.timelineUser,button.dataset.timelineNoteDelete).then(()=>renderPage('company-timeline',{persist:false})).catch(reportError);});
    document.getElementById('ra-company-campaign-new')?.addEventListener('click',()=>createCampaignFromUi().then(()=>renderPage('company-campaigns',{persist:false})).catch(reportError));
    document.querySelectorAll('#ra-content [data-campaign-save]').forEach(button=>{button.onclick=()=>saveCampaignFromCard(button.dataset.campaignSave,button.closest('[data-campaign-card]')).then(()=>renderPage('company-campaigns',{persist:false})).catch(reportError);});
    document.querySelectorAll('#ra-content [data-campaign-delete]').forEach(button=>{button.onclick=()=>{if(typeof globalThis.confirm==='function'&&!globalThis.confirm('Delete this Company campaign?'))return;removeCampaign(runtime.app,button.dataset.campaignDelete).then(()=>renderPage('company-campaigns',{persist:false})).catch(reportError);};});
    document.querySelectorAll('#ra-content [data-campaign-add-member]').forEach(button=>{button.onclick=()=>{const id=text(document.querySelector(`[data-campaign-member-select="${button.dataset.campaignAddMember}"]`)?.value);if(!id)return;changeCampaignMembership(button.dataset.campaignAddMember,id,true).then(()=>renderPage('company-campaigns',{persist:false})).catch(reportError);};});
    document.querySelectorAll('#ra-content [data-campaign-remove-member]').forEach(button=>{button.onclick=()=>changeCampaignMembership(button.dataset.campaignRemoveMember,button.dataset.campaignUser,false).then(()=>renderPage('company-campaigns',{persist:false})).catch(reportError);});
    document.getElementById('ra-company-talent-add')?.addEventListener('click',()=>setTalentPoolFromUi(true).then(()=>renderPage('company-talent-pool',{persist:false})).catch(reportError));
    document.querySelectorAll('#ra-content [data-talent-remove]').forEach(button=>{button.onclick=()=>setTalentPoolFromUi(false,button.dataset.talentRemove).then(()=>renderPage('company-talent-pool',{persist:false})).catch(reportError);});
    document.querySelectorAll('#ra-content [data-reactivate-player]').forEach(button=>{button.onclick=()=>reactivateFromUi(button.dataset.reactivatePlayer).then(()=>renderPage('company-reactivation',{persist:false})).catch(reportError);});
    document.getElementById('ra-company-session-new')?.addEventListener('click',()=>createSessionFromUi().then(()=>renderPage('company-recruitment-sessions',{persist:false})).catch(reportError));
    document.querySelectorAll('#ra-content [data-session-action]').forEach(button=>{button.onclick=()=>recordSessionActionFromUi(button.dataset.sessionAction,button.dataset.sessionUser,button.value).then(()=>renderPage('company-recruitment-sessions',{persist:false})).catch(reportError);});
    document.querySelectorAll('#ra-content [data-company-compare-select]').forEach(input=>{input.onchange=()=>{const id=text(input.dataset.companyCompareSelect);if(input.checked){if(runtime.compareSelection.size>=4){input.checked=false;reportError(new Error('Compare supports up to four players.'));return;}runtime.compareSelection.add(id);}else runtime.compareSelection.delete(id);renderPage('company-compare',{persist:false}).catch(reportError);};});
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
    if(page==='company-overview')html=CompanyUI.renderOverview(CompanyUI.buildOverviewModel(rows,await getVacancies(app)));
    else if(page==='company-today'){
      const config=await getConfig(app),now=Date.now();
      const opportunityRows=OpportunityUI.buildOpportunityRows(rows,{weights:opportunityWeights(config),now});
      const opportunities=Object.fromEntries(opportunityRows.map(row=>[row.userId,row.opportunity.score]));
      html=CompanyUI.renderToday(CompanyUI.buildTodayModel(rows,{now,stageThresholds:config.stageThresholds||{},opportunities}));
    }
    else if(page==='company-candidates'){const filtered=filterRows(rows,runtime.searchFilters);const sorted=sortRows(filtered,runtime.sort).map(row=>({...row,currentOrganizationLabel:organizationInfo(row).label}));html=CompanyUI.renderCandidates(sorted,{filters:runtime.searchFilters,sort:runtime.sort,total:rows.length});}
    else if(page==='company-pipeline')html=CompanyUI.renderPipeline(CompanyUI.buildPipelineModel(rows));
    else if(page==='company-vacancies')html=CompanyUI.renderVacanciesPage({config:await getConfig(app),vacancies:await getVacancies(app),rows});
    else if(page==='company-followups')html=CompanyUI.renderFollowUpsPage(rows,{now:Date.now()});
    else if(page==='company-contact-outcomes')html=CompanyUI.renderContactOutcomesPage(rows);
    else if(page==='company-stage-aging'){const config=await getConfig(app);html=CompanyUI.renderStageAgingPage(rows.map(row=>({...row,aging:Operations.stageAging(row.companyRecord,config.stageThresholds||{},Date.now())})));}
    else if(page==='company-timeline')html=CompanyUI.renderTimelinePage(rows);
    else if(page==='company-campaigns')html=WorkflowUI.renderCampaignsPage({campaigns:await getCampaigns(app),rows,vacancies:await getVacancies(app)});
    else if(page==='company-talent-pool')html=WorkflowUI.renderTalentPoolPage(rows);
    else if(page==='company-reactivation')html=WorkflowUI.renderReactivationPage(rows);
    else if(page==='company-recruitment-sessions')html=WorkflowUI.renderRecruitmentSessionsPage({sessions:await getSessions(app),rows});
    else if(page==='company-opportunity')html=OpportunityUI.renderOpportunityPage(await buildOpportunityRows(app,rows,Date.now()));
    else if(page==='company-compare')html=OpportunityUI.renderComparePage(rows,[...runtime.compareSelection]);
    if(typeof app.navigate==='function'&&text(app._test.state.page)!==page)return false;
    const meta=routeMeta(page);title.textContent=meta.title;desc.textContent=meta.description;content.innerHTML=html;
    syncActiveNav(page);bindContentControls(page);if(options.persist!==false)await persistRoute(app,page);return true;
  }

  function bindNav(){if(!runtime.app)return;document.querySelectorAll('#ra-nav [data-page]').forEach(button=>{const page=text(button.dataset.page);if(!IMPLEMENTED_ROUTES.has(page))return;if(!runtime.originalHandlers.has(button))runtime.originalHandlers.set(button,button.onclick||null);button.onclick=event=>{event?.preventDefault?.();navigate(page,true).catch(reportError);};});}
  function syncNavigation(){bindNav();return true;}
  function install(app,options={}){if(!app?._test?.state?.db)throw new Error('A mounted Recruitment Agency app with DB state is required.');uninstall();runtime.app=app;runtime.installed=true;bindNav();const nav=document.getElementById('ra-nav');if(nav&&typeof MutationObserver==='function'){runtime.observer=new MutationObserver(()=>bindNav());runtime.observer.observe(nav,{childList:true,subtree:true});}const page=text(app._test.state.page||app._test.state.settings?.activePage);if(options.renderInitial!==false&&IMPLEMENTED_ROUTES.has(page))renderPage(page,{persist:false}).catch(reportError);return true;}
  function uninstall(){runtime.observer?.disconnect?.();runtime.observer=null;for(const[button,handler]of runtime.originalHandlers.entries())if(button?.isConnected)button.onclick=handler;runtime.originalHandlers.clear();runtime.compareSelection.clear();runtime.app=null;runtime.installed=false;}

  return Object.freeze({COMPANY_ROUTES,isCompanyRoute,routeMeta,install,uninstall,renderPage,syncNavigation,_test:{buildRows,buildOpportunityRows,persistRoute,dbGetAll,dbGet,dbPut,dbDelete,evaluateCandidateVacancies,canMoveToStage,readCriteria,getCampaigns,getSessions,opportunityWeights,filterRows,sortRows,toggleSort,organizationInfo,IMPLEMENTED_ROUTES}});
});
