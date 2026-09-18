(function(root,factory){
  const deps={
    FactionCore:root&&root.RA_V47FactionCore,
    FactionUI:root&&root.RA_V47FactionUI,
    Operations:root&&root.RA_V47FactionOperations,
    Workflow:root&&root.RA_V47FactionWorkflow,
    WorkflowUI:root&&root.RA_V47FactionWorkflowUI,
    OpportunityUI:root&&root.RA_V47FactionOpportunityUI,
    Messaging:root&&root.RA_V45Messaging
  };
  if(typeof module==='object'&&module.exports){
    deps.FactionCore=require('./v47-faction-core');
    deps.FactionUI=require('./v47-faction-ui');
    deps.Operations=require('./v47-faction-operations');
    deps.Workflow=require('./v47-faction-workflow');
    deps.WorkflowUI=require('./v47-faction-workflow-ui');
    deps.OpportunityUI=require('./v47-faction-opportunity-ui');
    deps.Messaging=require('./v45-messaging');
  }
  const api=factory(deps);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V47FactionPlatform=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(D){
  'use strict';

  const {FactionCore,FactionUI,Operations,Workflow,WorkflowUI,OpportunityUI,Messaging}=D;
  if(!FactionCore||!FactionUI||!Operations||!Workflow||!WorkflowUI||!OpportunityUI||!Messaging)throw new Error('Faction platform dependencies are required.');

  const FACTION_ROUTES=Object.freeze([
    'faction-overview','faction-today','faction-discover','faction-candidates','faction-pipeline',
    'faction-requirements','faction-campaigns','faction-followups','faction-timeline','faction-stage-aging',
    'faction-contact-outcomes','faction-recruitment-sessions','faction-reactivation','faction-opportunity','faction-compare'
  ]);
  const IMPLEMENTED_ROUTES=new Set(FACTION_ROUTES);
  const META=Object.freeze({
    'faction-overview':['Faction Overview','Faction recruitment status and work needing attention.'],
    'faction-today':['Faction Today','Prioritized Faction recruitment work for today.'],
    'faction-discover':['Faction Discover','Add and review Faction recruitment prospects without creating Company workflow state.'],
    'faction-candidates':['Faction Candidates','Search and manage Faction recruitment candidates.'],
    'faction-pipeline':['Faction Pipeline','Move Faction candidates through explicit recruitment stages.'],
    'faction-requirements':['Faction Requirements','Manage Faction Baseline requirements and specialist profiles.'],
    'faction-campaigns':['Faction Campaigns','Organize Faction recruitment campaigns.'],
    'faction-followups':['Faction Follow-ups','Track Faction candidate follow-ups.'],
    'faction-timeline':['Faction Timeline','Review immutable Faction history and recruiter notes.'],
    'faction-stage-aging':['Faction Stage Aging','Review candidates aging in their current Faction stage.'],
    'faction-contact-outcomes':['Faction Contact Outcomes','Track contact outcomes and Do Not Contact independently of stage.'],
    'faction-recruitment-sessions':['Faction Recruitment Sessions','Work focused Faction recruitment queues one explicit action at a time.'],
    'faction-reactivation':['Faction Reactivation','Restart Faction recruitment cycles without duplicating identity.'],
    'faction-opportunity':['Faction Opportunity Queue','Review explainable Faction recruitment opportunities.'],
    'faction-compare':['Faction Compare','Compare Faction candidates side by side.']
  });
  const DEFAULT_OPPORTUNITY_WEIGHTS=Object.freeze({match:30,fit:20,availability:15,activity:15,freshness:10,followUp:10,contactPenalty:10});
  const DEFAULT_SEARCH_FILTERS=Object.freeze({search:'',minEnd:'',minMan:'',minInt:'',onlineStatus:'',organization:'',organizationPresence:'any'});
  const DEFAULT_SORT=Object.freeze({key:'player',direction:'asc'});
  const SORT_KEYS=new Set(['player','end','man','int','lastActive']);
  const runtime={app:null,observer:null,originalHandlers:new Map(),installed:false,compareSelection:new Set(),searchFilters:{...DEFAULT_SEARCH_FILTERS},sort:{...DEFAULT_SORT}};

  const text=value=>String(value??'').trim();
  const number=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
  function parseThreshold(value){const raw=text(value).toLowerCase().replace(/,/g,'');if(!raw)return null;const match=raw.match(/^(\d+(?:\.\d+)?|\.\d+)\s*([kmb])?$/);if(!match)return null;const mult={k:1e3,m:1e6,b:1e9}[match[2]]||1;const out=Number(match[1])*mult;return Number.isFinite(out)?out:null;}
  function organizationInfo(row={}){const player=row.player||{};const name=text(row.factionName||player.factionName);const rawId=row.factionId??player.factionId;if(name)return{state:'has',label:name};if(rawId!==null&&rawId!==undefined&&rawId!==''){const id=Number(rawId);if(Number.isFinite(id)){if(id===0)return{state:'none',label:'None'};if(id>0)return{state:'has',label:`Faction #${id}`};}}return{state:'unknown',label:'Unknown'};}
  function filterRows(rows,filters={}){const search=text(filters.search).toLowerCase(),minEnd=parseThreshold(filters.minEnd),minMan=parseThreshold(filters.minMan),minInt=parseThreshold(filters.minInt),onlineStatus=text(filters.onlineStatus).toLowerCase(),organization=text(filters.organization).toLowerCase(),presence=text(filters.organizationPresence).toLowerCase()||'any';return (Array.isArray(rows)?rows:[]).filter(row=>{if(search&&!`${text(row.name).toLowerCase()} ${text(row.userId)}`.includes(search))return false;if(minEnd!==null&&(!Number.isFinite(Number(row.end))||row.end===null||row.end===undefined||row.end===''||Number(row.end)<minEnd))return false;if(minMan!==null&&(!Number.isFinite(Number(row.man))||row.man===null||row.man===undefined||row.man===''||Number(row.man)<minMan))return false;if(minInt!==null&&(!Number.isFinite(Number(row.int))||row.int===null||row.int===undefined||row.int===''||Number(row.int)<minInt))return false;if(onlineStatus&&text(row.onlineStatus).toLowerCase()!==onlineStatus)return false;const org=organizationInfo(row);if(organization&&(org.state!=='has'||!org.label.toLowerCase().includes(organization)))return false;if(presence==='has'&&org.state!=='has')return false;if(presence==='none'&&org.state!=='none')return false;return true;});}
  function sortValue(row,key,now){if(key==='player')return text(row.name).toLowerCase()||null;if(key==='end'||key==='man'||key==='int'){const raw=row[key];if(raw===null||raw===undefined||raw==='')return null;const value=Number(raw);return Number.isFinite(value)?value:null;}if(key==='lastActive'){const ts=Number(row.lastActive);if(Number.isFinite(ts)&&ts>0)return ts;const status=text(row.onlineStatus).toLowerCase();if(status==='online')return now+2;if(status==='idle')return now+1;if(status==='offline')return 0;return null;}return null;}
  function sortTieBreak(a,b){const byName=text(a.name).localeCompare(text(b.name),undefined,{sensitivity:'base'});if(byName)return byName;return text(a.userId).localeCompare(text(b.userId),undefined,{numeric:true});}
  function sortRows(rows,sortState=DEFAULT_SORT,now=Date.now()){const key=SORT_KEYS.has(text(sortState?.key))?text(sortState.key):DEFAULT_SORT.key;const direction=sortState?.direction==='desc'?'desc':'asc';const sign=direction==='asc'?1:-1;return [...(Array.isArray(rows)?rows:[])].sort((a,b)=>{const av=sortValue(a,key,now),bv=sortValue(b,key,now),am=av===null||av===undefined,bm=bv===null||bv===undefined;if(am!==bm)return am?1:-1;if(am&&bm)return sortTieBreak(a,b);const cmp=key==='player'?String(av).localeCompare(String(bv)):Number(av)-Number(bv);return cmp?cmp*sign:sortTieBreak(a,b);});}
  function toggleSort(current,key){const nextKey=SORT_KEYS.has(text(key))?text(key):DEFAULT_SORT.key;if(text(current?.key)===nextKey)return{key:nextKey,direction:current?.direction==='asc'?'desc':'asc'};return{key:nextKey,direction:nextKey==='player'?'asc':'desc'};}
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  let idSequence=0;
  function makeId(prefix){
    const uuid=globalThis.crypto?.randomUUID?.();
    if(uuid)return `${prefix}-${uuid}`;
    idSequence=(idSequence+1)%1000000;
    return `${prefix}-${Date.now()}-${idSequence}`;
  }
  const unique=values=>[...new Set((Array.isArray(values)?values:[]).map(text).filter(Boolean))];
  const terminalStage=stage=>['Joined','Rejected'].includes(text(stage));

  function isFactionRoute(value){return FACTION_ROUTES.includes(text(value));}
  function routeMeta(route){const [title,description]=META[text(route)]||META['faction-overview'];return{title,description};}
  function opportunityWeights(config={}){return{...DEFAULT_OPPORTUNITY_WEIGHTS,...(config.opportunityWeights||{})};}

  function dbGetAll(db,store){return new Promise(resolve=>{try{const q=db.transaction(store,'readonly').objectStore(store).getAll();q.onsuccess=()=>resolve(q.result||[]);q.onerror=()=>resolve([]);}catch{resolve([]);}});}
  function dbGet(db,store,key){return new Promise(resolve=>{try{const q=db.transaction(store,'readonly').objectStore(store).get(key);q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>resolve(null);}catch{resolve(null);}});}
  function dbPut(db,store,value){return new Promise((resolve,reject)=>{try{const tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error||new Error(`Failed to save ${store}.`));}catch(error){reject(error);}});}
  function dbDelete(db,store,key){return new Promise((resolve,reject)=>{try{const tx=db.transaction(store,'readwrite');tx.objectStore(store).delete(key);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error||new Error(`Failed to delete from ${store}.`));}catch(error){reject(error);}});}

  async function getConfig(app){if(app?._test?.factionRepositories?.config?.get)return app._test.factionRepositories.config.get();return(await dbGet(app._test.state.db,'factionRecruitmentConfig','faction'))||{key:'faction',baseline:{criteria:[]},stageThresholds:{},opportunityWeights:{}};}
  async function saveConfig(app,patch){if(app?._test?.factionRepositories?.config?.save)return app._test.factionRepositories.config.save(patch);const existing=await getConfig(app);const next={...existing,...patch,key:'faction',updatedAt:Date.now()};await dbPut(app._test.state.db,'factionRecruitmentConfig',next);return next;}
  async function getProfiles(app){if(app?._test?.factionRepositories?.profiles?.list)return app._test.factionRepositories.profiles.list();return dbGetAll(app._test.state.db,'factionSpecialistProfiles');}
  async function saveProfile(app,profile){if(app?._test?.factionRepositories?.profiles?.save)return app._test.factionRepositories.profiles.save(profile);const next=FactionCore.normalizeSpecialistProfile({...profile,profileId:text(profile.profileId)||makeId('profile'),updatedAt:Date.now()});await dbPut(app._test.state.db,'factionSpecialistProfiles',next);return next;}
  async function removeProfile(app,profileId){if(app?._test?.factionRepositories?.profiles?.remove)return app._test.factionRepositories.profiles.remove(profileId);return dbDelete(app._test.state.db,'factionSpecialistProfiles',text(profileId));}
  async function getCampaigns(app){if(app?._test?.factionRepositories?.campaigns?.list)return app._test.factionRepositories.campaigns.list();return dbGetAll(app._test.state.db,'factionCampaigns');}
  async function getCampaign(app,campaignId){if(app?._test?.factionRepositories?.campaigns?.get)return app._test.factionRepositories.campaigns.get(campaignId);return dbGet(app._test.state.db,'factionCampaigns',text(campaignId));}
  async function saveCampaign(app,campaign){if(app?._test?.factionRepositories?.campaigns?.save)return app._test.factionRepositories.campaigns.save(campaign);const next={...campaign,campaignId:text(campaign.campaignId)||makeId('faction-campaign'),candidateIds:unique(campaign.candidateIds),updatedAt:Date.now()};await dbPut(app._test.state.db,'factionCampaigns',next);return next;}
  async function removeCampaign(app,campaignId){if(app?._test?.factionRepositories?.campaigns?.remove)return app._test.factionRepositories.campaigns.remove(campaignId);return dbDelete(app._test.state.db,'factionCampaigns',text(campaignId));}
  async function getSessions(app){if(app?._test?.factionRepositories?.sessions?.list)return app._test.factionRepositories.sessions.list();return dbGetAll(app._test.state.db,'factionRecruitmentSessions');}
  async function getSession(app,sessionId){if(app?._test?.factionRepositories?.sessions?.get)return app._test.factionRepositories.sessions.get(sessionId);return dbGet(app._test.state.db,'factionRecruitmentSessions',text(sessionId));}
  async function saveSession(app,session){if(app?._test?.factionRepositories?.sessions?.save)return app._test.factionRepositories.sessions.save(session);const next={...session,sessionId:text(session.sessionId)||makeId('faction-session'),candidateIds:unique(session.candidateIds),updatedAt:Date.now()};await dbPut(app._test.state.db,'factionRecruitmentSessions',next);return next;}

  async function saveFactionPatch(app,userId,patch){
    const id=text(userId);
    if(!/^\d+$/.test(id))throw new Error('A valid Torn player ID is required.');
    if(app?._test?.repositories?.faction?.ensure)return app._test.repositories.faction.ensure(id,patch,{source:'faction-platform',observedAt:Date.now()});
    const existing=await dbGet(app._test.state.db,'factionRecruitment',id);
    if(!existing)throw new Error('Faction candidate was not found.');
    const next={...existing,...patch,userId:id,domain:'faction',updatedAt:Date.now()};
    await dbPut(app._test.state.db,'factionRecruitment',next);
    return next;
  }

  async function ensureFactionCandidate(app,userId){
    const id=text(userId);
    if(!/^\d+$/.test(id)||Number(id)<=0)throw new Error('Enter a valid Torn player ID.');
    const existing=await dbGet(app._test.state.db,'factionRecruitment',id);
    const sources=unique([...(existing?.discoverySources||[]),'FACTION MANUAL']);
    if(app?._test?.repositories?.faction?.ensure)return app._test.repositories.faction.ensure(id,{pipelineStage:existing?.pipelineStage||'Prospect',discoverySources:sources,newlyDiscoveredAt:existing?.newlyDiscoveredAt||Date.now()},{source:'faction-manual',observedAt:Date.now()});
    const next={...(existing||{}),userId:id,domain:'faction',pipelineStage:existing?.pipelineStage||'Prospect',availability:existing?.availability||'Unknown',discoverySources:sources,newlyDiscoveredAt:existing?.newlyDiscoveredAt||Date.now(),createdAt:existing?.createdAt||Date.now(),updatedAt:Date.now()};
    await dbPut(app._test.state.db,'factionRecruitment',next);
    return next;
  }

  async function buildRows(app){
    const db=app._test.state.db;
    const[factionRecords,players,candidateLocals,config,profiles]=await Promise.all([dbGetAll(db,'factionRecruitment'),dbGetAll(db,'playerIntelligence'),dbGetAll(db,'candidateLocal'),getConfig(app),getProfiles(app)]);
    const candidateMap=new Map(candidateLocals.map(candidate=>[text(candidate?.userId??candidate?.id),candidate]));
    return FactionUI.buildCandidateRows(factionRecords,players,{baseline:config.baseline||{},profiles}).map(row=>{const candidate=candidateMap.get(text(row.userId))||{};const stats=candidate.stats||{};const player=row.player||{};return{...row,man:player.man??stats.man??candidate.man??null,int:player.int??stats.int??candidate.int??null,end:player.end??stats.end??candidate.end??null,total:player.total??stats.total??candidate.total??null,onlineStatus:text(player.onlineStatus)||text(row.onlineStatus)};});
  }

  async function buildOpportunityRows(app,rows,now=Date.now()){
    const config=await getConfig(app);
    return OpportunityUI.buildOpportunityRows(rows,{weights:opportunityWeights(config),now});
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
  async function saveOperationalRecord(userId,next){await saveFactionPatch(runtime.app,userId,next);return next;}

  async function changeFactionStage(userId,stage){
    const row=await rowFor(userId);
    const next=Workflow.changeStage(row.factionRecord,text(stage),{baselineHardFailed:row.hardFailed===true,now:Date.now()});
    return saveOperationalRecord(userId,next);
  }
  async function setProfilePin(userId,profileId){await saveFactionPatch(runtime.app,userId,{pinnedSpecialistProfileId:text(profileId),updatedAt:Date.now()});return true;}

  async function addFollowUpFromUi(){
    const userId=text(document.getElementById('ra-faction-followup-player')?.value);const row=await rowFor(userId);
    const dueAt=Date.parse(text(document.getElementById('ra-faction-followup-due')?.value));if(!Number.isFinite(dueAt))throw new Error('Choose a valid follow-up date and time.');
    const unit=text(document.getElementById('ra-faction-followup-recurrence-unit')?.value);const recurrence=unit?{unit,interval:Math.max(1,number(document.getElementById('ra-faction-followup-recurrence-interval')?.value,1))}:null;
    return saveOperationalRecord(userId,Operations.addFollowUp(row.factionRecord,{dueAt,reason:text(document.getElementById('ra-faction-followup-reason')?.value),note:text(document.getElementById('ra-faction-followup-note')?.value),recurrence},Date.now()));
  }
  async function completeFollowUp(userId,followUpId){const row=await rowFor(userId);return saveOperationalRecord(userId,Operations.completeFollowUp(row.factionRecord,followUpId,Date.now()));}
  async function recordOutcomeFromUi(){const userId=text(document.getElementById('ra-faction-outcome-player')?.value);const row=await rowFor(userId);return saveOperationalRecord(userId,Operations.recordContactOutcome(row.factionRecord,{result:text(document.getElementById('ra-faction-outcome-result')?.value),channel:text(document.getElementById('ra-faction-outcome-channel')?.value),note:text(document.getElementById('ra-faction-outcome-note')?.value)},Date.now()));}
  async function toggleDnc(userId,enabled){const row=await rowFor(userId);const reason=text(document.querySelector(`[data-faction-dnc-reason="${userId}"]`)?.value);return saveOperationalRecord(userId,Operations.setDoNotContact(row.factionRecord,enabled,reason,Date.now()));}
  async function addTimelineNoteFromUi(){const userId=text(document.getElementById('ra-faction-timeline-player')?.value);const row=await rowFor(userId);const value=text(document.getElementById('ra-faction-timeline-note')?.value);if(!value)throw new Error('Timeline note cannot be empty.');return saveOperationalRecord(userId,Operations.addTimelineNote(row.factionRecord,{text:value},Date.now()));}
  async function editTimelineNote(userId,noteId){const row=await rowFor(userId);const current=(row.factionRecord.timelineNotes||[]).find(note=>text(note.noteId)===text(noteId));if(!current)throw new Error('Timeline note not found.');const value=globalThis.prompt?.('Edit recruiter note',text(current.text));if(value==null)return false;return saveOperationalRecord(userId,Operations.editTimelineNote(row.factionRecord,noteId,value,Date.now()));}
  async function deleteTimelineNote(userId,noteId){const row=await rowFor(userId);if(globalThis.confirm&&!globalThis.confirm('Delete this recruiter note?'))return false;return saveOperationalRecord(userId,Operations.deleteTimelineNote(row.factionRecord,noteId,Date.now()));}
  async function reactivatePlayer(userId){const row=await rowFor(userId);const reason=text(document.querySelector(`[data-faction-reactivate-reason="${userId}"]`)?.value);return saveOperationalRecord(userId,Workflow.reactivate(row.factionRecord,reason,Date.now()));}

  async function createCampaignFromUi(){return saveCampaign(runtime.app,{campaignId:makeId('faction-campaign'),title:text(document.getElementById('ra-faction-campaign-title')?.value)||'Untitled Campaign',target:text(document.getElementById('ra-faction-campaign-target')?.value),profileId:text(document.getElementById('ra-faction-campaign-profile')?.value),status:text(document.getElementById('ra-faction-campaign-status')?.value)||'Draft',notes:text(document.getElementById('ra-faction-campaign-notes')?.value),candidateIds:[]});}
  async function saveCampaignFromCard(campaignId){const card=document.querySelector(`[data-faction-campaign-card="${campaignId}"]`);const existing=await getCampaign(runtime.app,campaignId);if(!existing||!card)throw new Error('Faction campaign was not found.');const get=field=>card.querySelector(`[data-faction-campaign-field="${field}"]`)?.value??'';return saveCampaign(runtime.app,{...existing,title:text(get('title')),target:text(get('target')),profileId:text(get('profileId')),status:text(get('status'))||'Draft',notes:text(get('notes'))});}
  async function addCampaignMember(campaignId){const campaign=await getCampaign(runtime.app,campaignId);if(!campaign)throw new Error('Faction campaign was not found.');const userId=text(document.querySelector(`[data-faction-campaign-member-select="${campaignId}"]`)?.value);if(!userId)throw new Error('Choose a candidate first.');await saveCampaign(runtime.app,{...campaign,candidateIds:unique([...(campaign.candidateIds||[]),userId])});const row=await rowFor(userId);await saveOperationalRecord(userId,Workflow.addCampaignMembership(row.factionRecord,campaignId,Date.now()));}
  async function removeCampaignMember(campaignId,userId){const campaign=await getCampaign(runtime.app,campaignId);if(!campaign)throw new Error('Faction campaign was not found.');await saveCampaign(runtime.app,{...campaign,candidateIds:(campaign.candidateIds||[]).filter(id=>text(id)!==text(userId))});const row=await rowFor(userId);await saveOperationalRecord(userId,Workflow.removeCampaignMembership(row.factionRecord,campaignId,Date.now()));}

  async function createSessionFromUi(){const rows=await buildRows(runtime.app);const candidateIds=rows.filter(row=>!row.archived&&!terminalStage(row.pipelineStage)).map(row=>row.userId);return saveSession(runtime.app,{sessionId:makeId('faction-session'),title:text(document.getElementById('ra-faction-session-title')?.value)||'Recruitment Session',candidateIds,cursor:0,status:candidateIds.length?'Draft':'Completed',outcomes:[],filters:{source:'active'}});}
  async function runSessionAction(sessionId,userId,action){const session=await getSession(runtime.app,sessionId);if(!session)throw new Error('Faction recruitment session was not found.');const note=text(document.querySelector(`[data-faction-session-note="${sessionId}"]`)?.value);if(action!=='Skip'&&FactionCore.FACTION_STAGES.includes(action))await changeFactionStage(userId,action);const next=Workflow.recordSessionAction(session,{userId,action,note},Date.now());return saveSession(runtime.app,next);}

  async function saveBaselineFromUi(){const host=document.getElementById('ra-faction-baseline-criteria');return saveConfig(runtime.app,{baseline:{criteria:readCriteria(host)}});}
  async function createProfile(){return saveProfile(runtime.app,{profileId:makeId('profile'),name:'New Specialist Profile',status:'Draft',criteria:[],notes:''});}
  async function saveProfileFromCard(profileId){const card=document.querySelector(`[data-faction-profile-card="${profileId}"]`);if(!card)throw new Error('Specialist profile was not found.');const profiles=await getProfiles(runtime.app);const existing=profiles.find(profile=>text(profile.profileId)===text(profileId));if(!existing)throw new Error('Specialist profile was not found.');const criteriaHost=card.querySelector('[data-faction-profile-criteria]');return saveProfile(runtime.app,{...existing,name:text(card.querySelector('[data-faction-profile-field="name"]')?.value),status:text(card.querySelector('[data-faction-profile-field="status"]')?.value)||'Draft',notes:text(card.querySelector('[data-faction-profile-field="notes"]')?.value),criteria:readCriteria(criteriaHost)});}

  async function grantWaiverFromUi(){
    const userId=text(document.getElementById('ra-faction-waiver-player')?.value);
    if(!userId)throw new Error('Choose a Faction candidate.');
    const row=await rowFor(userId);
    const context=text(document.getElementById('ra-faction-waiver-context')?.value).toLowerCase()==='specialist'?'specialist':'baseline';
    const profileId=context==='specialist'?text(document.getElementById('ra-faction-waiver-profile')?.value):'';
    if(context==='specialist'&&!profileId)throw new Error('Choose a specialist profile for this waiver.');
    const requirementId=text(document.getElementById('ra-faction-waiver-requirement')?.value);
    if(!requirementId)throw new Error('Choose a requirement to waive.');
    const reason=text(document.getElementById('ra-faction-waiver-reason')?.value);
    if(!reason)throw new Error('A waiver reason is required.');
    const[config,profiles]=await Promise.all([getConfig(runtime.app),getProfiles(runtime.app)]);
    const baseline=FactionCore.normalizeBaseline(config.baseline||{});
    const profile=context==='specialist'?profiles.map(FactionCore.normalizeSpecialistProfile).find(item=>text(item.profileId)===profileId):null;
    if(context==='specialist'&&!profile)throw new Error('Specialist profile was not found.');
    const criteria=context==='specialist'?(profile.criteria||[]):baseline.criteria;
    if(!criteria.some(item=>text(item.id)===requirementId))throw new Error('The selected requirement does not belong to the selected waiver context.');
    const duplicate=(row.factionRecord.waivers||[]).some(item=>text(item.state)==='Active'&&text(item.requirementId)===requirementId&&text(item.context)===context&&text(item.profileId)===profileId);
    if(duplicate)throw new Error('This requirement already has an active waiver for the candidate.');
    const reviewRaw=text(document.getElementById('ra-faction-waiver-review')?.value);
    let reviewAt=null;
    if(reviewRaw){reviewAt=Date.parse(reviewRaw);if(!Number.isFinite(reviewAt))throw new Error('Choose a valid waiver review date and time.');}
    const next=Operations.grantWaiver(row.factionRecord,{requirementId,context,profileId,reason,reviewAt},Date.now());
    return saveOperationalRecord(userId,next);
  }

  async function resolveWaiverFromUi(userId,waiverId){
    const row=await rowFor(userId);
    const waiver=(row.factionRecord.waivers||[]).find(item=>text(item.waiverId)===text(waiverId));
    if(!waiver)throw new Error('Waiver not found.');
    if(text(waiver.state)!=='Active')throw new Error('Only an active waiver can be resolved.');
    const answer=globalThis.prompt?globalThis.prompt('Resolution reason (optional)',''):'';
    if(answer==null)return false;
    const next=Operations.resolveWaiver(row.factionRecord,waiverId,text(answer),Date.now());
    return saveOperationalRecord(userId,next);
  }

  function recruitPlayer(row,override=false){
    if(row.doNotContact&&!override)throw new Error('This player is marked Do Not Contact. Use the deliberate override control if contact is still required.');
    if(override&&typeof globalThis.confirm==='function'&&!globalThis.confirm('This player is marked Do Not Contact. Override it for this recruitment chat only?'))return false;
    if(typeof runtime.app?.recruitCandidate!=='function')throw new Error('Recruit workflow is unavailable.');
    return runtime.app.recruitCandidate?.('faction',row.userId,row.name);
  }

  function renderDiscover(rows=[]){
    const manual=rows.filter(row=>(row.factionRecord?.discoverySources||[]).some(source=>text(source).toUpperCase().includes('FACTION')));
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Faction Discover</h3><p>Add a Torn player ID directly to the Faction workflow. This does not create or change a Company recruitment record.</p></div></div><div class="ra-actions"><input id="ra-faction-discover-id" inputmode="numeric" placeholder="Torn player ID"><button class="ra-btn ra-primary" id="ra-faction-discover-add">Add Faction Prospect</button></div></section><section class="ra-panel"><h3>Faction discovery provenance</h3>${manual.map(row=>`<div>${esc(row.name)} <span class="ra-muted">[${esc(row.userId)}] · ${esc((row.factionRecord.discoverySources||[]).join(', '))}</span></div>`).join('')||'<div class="ra-muted">No Faction discovery records yet.</div>'}</section>`;
  }

  function syncActiveNav(page){document.querySelectorAll('#ra-nav [data-page]').forEach(button=>button.classList.toggle('active',button.dataset.page===page));}
  function reportError(error){console.error('[RA v4.7 Faction]',error);try{globalThis.alert?.(`Faction Recruitment failed: ${error?.message||error}`);}catch{}}

  function addCriterionRow(host,scope){if(!host)return;host.insertAdjacentHTML('beforeend',FactionUI.renderCriterionRow({id:makeId('criterion'),field:'level',operator:'gte',kind:'Preferred',weight:1},scope));bindContentControls();}

  function syncWaiverControls(){
    const contextSelect=document.getElementById('ra-faction-waiver-context');
    const profileSelect=document.getElementById('ra-faction-waiver-profile');
    const requirementSelect=document.getElementById('ra-faction-waiver-requirement');
    if(!contextSelect||!profileSelect||!requirementSelect)return;
    const context=text(contextSelect.value).toLowerCase()==='specialist'?'specialist':'baseline';
    const profileId=text(profileSelect.value);
    profileSelect.disabled=context!=='specialist';
    let first='';let currentAllowed=false;
    [...requirementSelect.options].forEach(option=>{
      if(!option.value)return;
      const optionContext=text(option.dataset.waiverContext)||'baseline';
      const optionProfile=text(option.dataset.waiverProfile);
      const allowed=optionContext===context&&(context!=='specialist'||!profileId||optionProfile===profileId);
      option.hidden=!allowed;option.disabled=!allowed;
      if(allowed&&!first)first=option.value;
      if(allowed&&option.value===requirementSelect.value)currentAllowed=true;
    });
    if(!currentAllowed)requirementSelect.value=first;
  }

  function bindContentControls(currentPage){
    const page=text(currentPage||runtime.app?._test?.state?.page);
    document.getElementById('ra-faction-search-apply')?.addEventListener('click',async event=>{const button=event?.currentTarget;runtime.searchFilters={search:text(document.getElementById('ra-faction-filter-search')?.value),minEnd:text(document.getElementById('ra-faction-filter-end')?.value),minMan:text(document.getElementById('ra-faction-filter-man')?.value),minInt:text(document.getElementById('ra-faction-filter-int')?.value),onlineStatus:text(document.getElementById('ra-faction-filter-status')?.value),organization:text(document.getElementById('ra-faction-filter-organization')?.value),organizationPresence:text(document.getElementById('ra-faction-filter-organization-presence')?.value)||'any'};try{if(button){button.disabled=true;button.textContent='Searching…';}if(typeof runtime.app?.searchCandidates!=='function')throw new Error('Active candidate search is unavailable.');await runtime.app.searchCandidates('faction',runtime.searchFilters);await renderPage('faction-candidates',{persist:false});}catch(error){reportError(error);}finally{if(button?.isConnected){button.disabled=false;button.textContent='Search';}}});
    document.getElementById('ra-faction-search-clear')?.addEventListener('click',()=>{runtime.searchFilters={...DEFAULT_SEARCH_FILTERS};renderPage('faction-candidates',{persist:false}).catch(reportError);});
    document.querySelectorAll('#ra-content [data-faction-sort]').forEach(button=>{button.onclick=()=>{runtime.sort=toggleSort(runtime.sort,button.dataset.factionSort);renderPage('faction-candidates',{persist:false}).catch(reportError);};});
    document.querySelectorAll('[data-go-page]').forEach(button=>{const route=text(button.dataset.goPage);if(isFactionRoute(route))button.onclick=event=>{event?.preventDefault?.();navigate(route,true).catch(reportError);};});
    document.querySelectorAll('[data-faction-stage-select]').forEach(select=>select.onchange=async()=>{try{await changeFactionStage(select.dataset.factionStageSelect,select.value);await renderPage(page,{persist:false});}catch(error){reportError(error);await renderPage(page,{persist:false});}});
    document.querySelectorAll('[data-faction-profile-pin]').forEach(select=>select.onchange=async()=>{try{await setProfilePin(select.dataset.factionProfilePin,select.value);await renderPage(page,{persist:false});}catch(error){reportError(error);}});
    document.querySelectorAll('[data-faction-recruit]').forEach(button=>button.onclick=()=>rowFor(button.dataset.factionRecruit).then(row=>recruitPlayer(row,false)).catch(reportError));
    document.querySelectorAll('[data-faction-recruit-override]').forEach(button=>button.onclick=()=>rowFor(button.dataset.factionRecruitOverride).then(row=>recruitPlayer(row,true)).catch(reportError));

    const discover=document.getElementById('ra-faction-discover-add');if(discover)discover.onclick=async()=>{try{await ensureFactionCandidate(runtime.app,document.getElementById('ra-faction-discover-id')?.value);await renderPage('faction-discover',{persist:false});}catch(error){reportError(error);}};

    const baselineAdd=document.getElementById('ra-faction-baseline-add');if(baselineAdd)baselineAdd.onclick=()=>addCriterionRow(document.getElementById('ra-faction-baseline-criteria'),'baseline');
    const baselineSave=document.getElementById('ra-faction-baseline-save');if(baselineSave)baselineSave.onclick=async()=>{try{await saveBaselineFromUi();await renderPage('faction-requirements',{persist:false});}catch(error){reportError(error);}};
    const profileNew=document.getElementById('ra-faction-profile-new');if(profileNew)profileNew.onclick=async()=>{try{await createProfile();await renderPage('faction-requirements',{persist:false});}catch(error){reportError(error);}};
    document.querySelectorAll('[data-faction-profile-save]').forEach(button=>button.onclick=async()=>{try{await saveProfileFromCard(button.dataset.factionProfileSave);await renderPage('faction-requirements',{persist:false});}catch(error){reportError(error);}});
    document.querySelectorAll('[data-faction-profile-delete]').forEach(button=>button.onclick=async()=>{try{if(globalThis.confirm&&!globalThis.confirm('Delete this specialist profile?'))return;await removeProfile(runtime.app,button.dataset.factionProfileDelete);await renderPage('faction-requirements',{persist:false});}catch(error){reportError(error);}});
    document.querySelectorAll('[data-faction-profile-add-criterion]').forEach(button=>button.onclick=()=>{const card=document.querySelector(`[data-faction-profile-card="${button.dataset.factionProfileAddCriterion}"]`);addCriterionRow(card?.querySelector('[data-faction-profile-criteria]'),`profile:${button.dataset.factionProfileAddCriterion}`);});
    document.querySelectorAll('[data-faction-remove-criterion]').forEach(button=>button.onclick=()=>button.closest('[data-faction-criterion-row]')?.remove());

    const waiverContext=document.getElementById('ra-faction-waiver-context');if(waiverContext)waiverContext.onchange=syncWaiverControls;
    const waiverProfile=document.getElementById('ra-faction-waiver-profile');if(waiverProfile)waiverProfile.onchange=syncWaiverControls;
    syncWaiverControls();
    const waiverGrant=document.getElementById('ra-faction-waiver-grant');if(waiverGrant)waiverGrant.onclick=async()=>{try{await grantWaiverFromUi();await renderPage('faction-requirements',{persist:false});}catch(error){reportError(error);}};
    document.querySelectorAll('[data-faction-waiver-resolve]').forEach(button=>button.onclick=async()=>{try{const changed=await resolveWaiverFromUi(button.dataset.factionWaiverPlayer,button.dataset.factionWaiverResolve);if(changed!==false)await renderPage('faction-requirements',{persist:false});}catch(error){reportError(error);}});

    const campaignNew=document.getElementById('ra-faction-campaign-new');if(campaignNew)campaignNew.onclick=async()=>{try{await createCampaignFromUi();await renderPage('faction-campaigns',{persist:false});}catch(error){reportError(error);}};
    document.querySelectorAll('[data-faction-campaign-save]').forEach(button=>button.onclick=async()=>{try{await saveCampaignFromCard(button.dataset.factionCampaignSave);await renderPage('faction-campaigns',{persist:false});}catch(error){reportError(error);}});
    document.querySelectorAll('[data-faction-campaign-delete]').forEach(button=>button.onclick=async()=>{try{if(globalThis.confirm&&!globalThis.confirm('Delete this Faction campaign?'))return;await removeCampaign(runtime.app,button.dataset.factionCampaignDelete);await renderPage('faction-campaigns',{persist:false});}catch(error){reportError(error);}});
    document.querySelectorAll('[data-faction-campaign-add-member]').forEach(button=>button.onclick=async()=>{try{await addCampaignMember(button.dataset.factionCampaignAddMember);await renderPage('faction-campaigns',{persist:false});}catch(error){reportError(error);}});
    document.querySelectorAll('[data-faction-campaign-remove-member]').forEach(button=>button.onclick=async()=>{try{await removeCampaignMember(button.dataset.factionCampaignRemoveMember,button.dataset.factionCampaignUser);await renderPage('faction-campaigns',{persist:false});}catch(error){reportError(error);}});

    const followupAdd=document.getElementById('ra-faction-followup-add');if(followupAdd)followupAdd.onclick=async()=>{try{await addFollowUpFromUi();await renderPage('faction-followups',{persist:false});}catch(error){reportError(error);}};
    document.querySelectorAll('[data-faction-followup-complete]').forEach(button=>button.onclick=async()=>{try{await completeFollowUp(button.dataset.factionFollowupUser,button.dataset.factionFollowupComplete);await renderPage('faction-followups',{persist:false});}catch(error){reportError(error);}});

    const noteAdd=document.getElementById('ra-faction-timeline-add');if(noteAdd)noteAdd.onclick=async()=>{try{await addTimelineNoteFromUi();await renderPage('faction-timeline',{persist:false});}catch(error){reportError(error);}};
    document.querySelectorAll('[data-faction-note-edit]').forEach(button=>button.onclick=async()=>{try{await editTimelineNote(button.dataset.factionNoteUser,button.dataset.factionNoteEdit);await renderPage('faction-timeline',{persist:false});}catch(error){reportError(error);}});
    document.querySelectorAll('[data-faction-note-delete]').forEach(button=>button.onclick=async()=>{try{await deleteTimelineNote(button.dataset.factionNoteUser,button.dataset.factionNoteDelete);await renderPage('faction-timeline',{persist:false});}catch(error){reportError(error);}});

    const outcomeAdd=document.getElementById('ra-faction-outcome-add');if(outcomeAdd)outcomeAdd.onclick=async()=>{try{await recordOutcomeFromUi();await renderPage('faction-contact-outcomes',{persist:false});}catch(error){reportError(error);}};
    document.querySelectorAll('[data-faction-dnc-toggle]').forEach(button=>button.onclick=async()=>{try{await toggleDnc(button.dataset.factionDncToggle,button.dataset.factionDncEnabled==='true');await renderPage('faction-contact-outcomes',{persist:false});}catch(error){reportError(error);}});

    const sessionNew=document.getElementById('ra-faction-session-new');if(sessionNew)sessionNew.onclick=async()=>{try{await createSessionFromUi();await renderPage('faction-recruitment-sessions',{persist:false});}catch(error){reportError(error);}};
    document.querySelectorAll('[data-faction-session-action]').forEach(button=>button.onclick=async()=>{try{await runSessionAction(button.dataset.factionSessionAction,button.dataset.factionSessionUser,button.value);await renderPage('faction-recruitment-sessions',{persist:false});}catch(error){reportError(error);}});

    document.querySelectorAll('[data-faction-reactivate-player]').forEach(button=>button.onclick=async()=>{try{await reactivatePlayer(button.dataset.factionReactivatePlayer);await renderPage('faction-reactivation',{persist:false});}catch(error){reportError(error);}});
    document.querySelectorAll('[data-faction-compare-select]').forEach(input=>input.onchange=async()=>{const id=text(input.dataset.factionCompareSelect);if(input.checked){if(runtime.compareSelection.size>=4){input.checked=false;globalThis.alert?.('Faction Compare supports up to four players.');return;}runtime.compareSelection.add(id);}else runtime.compareSelection.delete(id);await renderPage('faction-compare',{persist:false});});
  }

  async function renderPage(page,options={}){
    const app=runtime.app;page=text(page);
    if(!app||!IMPLEMENTED_ROUTES.has(page))return false;
    if(options.persist!==false)claimRoute(app,page);
    const title=document.getElementById('ra-page-title'),desc=document.getElementById('ra-page-desc'),content=document.getElementById('ra-content');
    if(!title||!desc||!content)throw new Error('Recruitment Agency shell is not mounted.');
    const rows=await buildRows(app);
    let html='';
    const[config,profiles,campaigns,sessions]=await Promise.all([getConfig(app),getProfiles(app),getCampaigns(app),getSessions(app)]);

    if(page==='faction-overview')html=FactionUI.renderOverview(FactionUI.buildOverviewModel(rows,profiles));
    else if(page==='faction-today'){
      const opportunities=await buildOpportunityRows(app,rows,Date.now());
      html=FactionUI.renderToday(FactionUI.buildTodayModel(rows,{now:Date.now(),stageThresholds:config.stageThresholds||{},opportunities:Object.fromEntries(opportunities.map(item=>[item.userId,item.opportunity.score]))}));
    }
    else if(page==='faction-discover')html=renderDiscover(rows);
    else if(page==='faction-candidates'){const filtered=filterRows(rows,runtime.searchFilters);const sorted=sortRows(filtered,runtime.sort).map(row=>({...row,currentOrganizationLabel:organizationInfo(row).label}));html=FactionUI.renderCandidates(sorted,{filters:runtime.searchFilters,sort:runtime.sort,total:rows.length});}
    else if(page==='faction-pipeline')html=FactionUI.renderPipeline(FactionUI.buildPipelineModel(rows));
    else if(page==='faction-requirements')html=FactionUI.renderRequirementsPage({config,profiles,rows});
    else if(page==='faction-campaigns')html=WorkflowUI.renderCampaignsPage({campaigns,rows,profiles});
    else if(page==='faction-followups')html=WorkflowUI.renderFollowUpsPage(rows);
    else if(page==='faction-timeline')html=WorkflowUI.renderTimelinePage(rows);
    else if(page==='faction-stage-aging')html=WorkflowUI.renderStageAgingPage(rows.map(row=>({...row,stageAging:Operations.stageAging(row.factionRecord,config.stageThresholds||{},Date.now())})));
    else if(page==='faction-contact-outcomes')html=WorkflowUI.renderContactOutcomesPage(rows);
    else if(page==='faction-recruitment-sessions')html=WorkflowUI.renderRecruitmentSessionsPage({sessions,rows});
    else if(page==='faction-reactivation')html=WorkflowUI.renderReactivationPage(rows);
    else if(page==='faction-opportunity')html=OpportunityUI.renderOpportunityPage(await buildOpportunityRows(app,rows,Date.now()));
    else if(page==='faction-compare')html=OpportunityUI.renderComparePage(rows,[...runtime.compareSelection]);
    if(typeof app.navigate==='function'&&text(app._test.state.page)!==page)return false;
    const meta=routeMeta(page);title.textContent=meta.title;desc.textContent=meta.description;content.innerHTML=html;
    syncActiveNav(page);bindContentControls(page);if(options.persist!==false)await persistRoute(app,page);return true;
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
    uninstall();runtime.app=app;runtime.installed=true;bindNav();
    const nav=document.getElementById('ra-nav');if(nav&&typeof MutationObserver==='function'){runtime.observer=new MutationObserver(()=>bindNav());runtime.observer.observe(nav,{childList:true,subtree:true});}
    const page=text(app._test.state.page||app._test.state.settings?.activePage);if(options.renderInitial!==false&&IMPLEMENTED_ROUTES.has(page))renderPage(page,{persist:false}).catch(reportError);
    return true;
  }
  function uninstall(){runtime.observer?.disconnect?.();runtime.observer=null;for(const[button,handler]of runtime.originalHandlers.entries())if(button?.isConnected)button.onclick=handler;runtime.originalHandlers.clear();runtime.compareSelection.clear();runtime.app=null;runtime.installed=false;}

  return Object.freeze({
    FACTION_ROUTES,
    isFactionRoute,
    routeMeta,
    install,
    uninstall,
    renderPage,
    syncNavigation,
    _test:{IMPLEMENTED_ROUTES,buildRows,buildOpportunityRows,persistRoute,dbGetAll,dbGet,dbPut,dbDelete,getConfig,getProfiles,getCampaigns,getSessions,readCriteria,ensureFactionCandidate,changeFactionStage,setProfilePin,opportunityWeights,filterRows,sortRows,toggleSort,organizationInfo}
  });
});
