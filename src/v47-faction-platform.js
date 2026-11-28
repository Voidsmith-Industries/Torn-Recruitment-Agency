(function(root,factory){
  const deps={
    FactionCore:root&&root.RA_V47FactionCore,
    FactionUI:root&&root.RA_V47FactionUI,
    Messaging:root&&root.RA_V45Messaging,
    ResultsCore:root&&root.RA_ResultsCore,
    Shared:root&&root.RA_V46RecruitmentShared
  };
  if(typeof module==='object'&&module.exports){
    deps.FactionCore=require('./v47-faction-core');
    deps.FactionUI=require('./v47-faction-ui');
    deps.Messaging=require('./v45-messaging');
    deps.ResultsCore=require('./results-core');
    deps.Shared=require('./v46-recruitment-shared');
  }
  const api=factory(deps);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V47FactionPlatform=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(D){
  'use strict';

  const {FactionCore,FactionUI,Messaging,ResultsCore,Shared}=D;
  if(!FactionCore||!FactionUI||!Messaging||!ResultsCore||!Shared)throw new Error('Faction platform dependencies are required.');

  const {text,makeId,dbGetAll,dbGet,dbPut,dbDelete,DEFAULT_SEARCH_FILTERS,RESULTS_PAGE_SIZE,sortRows,toggleSort}=Shared;
  const FACTION_ROUTES=Object.freeze(['faction-candidates']);
  const organizationInfo=Shared.organizationInfoFor({player:'player',name:'factionName',id:'factionId',label:'Faction'});
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
    // Criteria see work stats from the candidate record too, so MAN/INT/END requirements apply; unknown stays unknown.
    const playerMap=new Map(players.map(player=>[text(player?.userId),player]));
    const facts=factionRecords.map(record=>{const id=text(record?.userId);return Shared.factsWithStats(playerMap.get(id)||{userId:id},candidateMap.get(id));});
    return FactionUI.buildCandidateRows(factionRecords,facts,{baseline:config.baseline||{},profiles}).map(row=>{const candidate=candidateMap.get(text(row.userId))||{};const stats=candidate.stats||{};const player=row.player||{};const selectedEvaluation=activeProfile?(row.profileEvaluations||[]).find(item=>text(item.profileId)===activeProfile.profileId):null;const enriched={...row,man:player.man??stats.man??candidate.man??null,int:player.int??stats.int??candidate.int??null,end:player.end??stats.end??candidate.end??null,total:player.total??stats.total??candidate.total??null,onlineStatus:text(player.onlineStatus)||text(row.onlineStatus),candidateLocal:candidate,eligibilityScore:selectedEvaluation?.matchScore??null,eligibility:selectedEvaluation?.eligibility??null,ineligibleReasons:[...(row.ineligibleReasons||[]),...Shared.hardFailureReasons(selectedEvaluation?.criteria)]};const intelligence=ResultsCore.recruitmentFit(enriched,{domain:'faction',useEligibility:Boolean(activeProfile)});return{...enriched,recruitmentFit:intelligence.score,recruitmentConfidence:intelligence.confidence,recruitmentFitBreakdown:intelligence.components,prospectProvenance:intelligence.provenance,prospectState:intelligence.provenance.state,intelligenceFreshness:intelligence.provenance.freshness,activeRecruitmentProfileId:activeProfile?.profileId||'',activeRecruitmentProfileName:activeProfile?.name||''};});
  }

  const P=Shared.createResultsPlatform({
    domain:'faction',label:'Faction',logTag:'[RA v4.7 Faction]',routes:FACTION_ROUTES,implemented:FACTION_ROUTES,goPageSelector:'[data-go-page]',
    meta:{'faction-candidates':['Faction Search & Results','Find, filter and message Faction recruitment candidates.']},
    organizationInfo,buildRows,profileSearchFilters,
    async selectProfile(app){const [config,profiles]=await Promise.all([getConfig(app),getProfiles(app)]);return{config,profiles,selected:activeResultsProfile(config,profiles)};},
    renderHtml(app,sorted,options,{config,profiles}){return FactionUI.renderCandidates(sorted,{...options,profiles,activeProfileId:text(config.activeResultsProfileId)})+FactionUI.renderProfileEditor({config,profiles,open:runtime.profileEditorOpen===true});},
    bindControls
  });
  const {runtime,renderPage,reportError}=P;
  const readCriteria=host=>Shared.readCriteria(host,'faction-');

  async function saveBaselineFromUi(){const host=document.getElementById('ra-faction-baseline-criteria');return saveConfig(runtime.app,{baseline:{criteria:readCriteria(host)}});}
  async function createProfile(){return saveProfile(runtime.app,{profileId:makeId('profile'),name:'New Specialist Profile',status:'Draft',criteria:[],notes:''});}
  async function saveProfileFromCard(profileId){const card=document.querySelector(`[data-faction-profile-card="${profileId}"]`);if(!card)throw new Error('Specialist profile was not found.');const profiles=await getProfiles(runtime.app);const existing=profiles.find(profile=>text(profile.profileId)===text(profileId));if(!existing)throw new Error('Specialist profile was not found.');const criteriaHost=card.querySelector('[data-faction-profile-criteria]');return saveProfile(runtime.app,{...existing,name:text(card.querySelector('[data-faction-profile-field="name"]')?.value),status:text(card.querySelector('[data-faction-profile-field="status"]')?.value)||'Draft',notes:text(card.querySelector('[data-faction-profile-field="notes"]')?.value),criteria:readCriteria(criteriaHost)});}

  function recruitPlayer(row,override=false){
    if(row.doNotContact&&!override)throw new Error('This player is marked Do Not Contact. Use the deliberate override control if contact is still required.');
    if(override){if(typeof globalThis.confirm!=='function')throw new Error('Do Not Contact override confirmation is unavailable. Recruitment stopped.');if(!globalThis.confirm('This player is marked Do Not Contact. Override it for this recruitment chat only?'))return false;}
    if(typeof runtime.app?.recruitCandidate!=='function')throw new Error('Recruit workflow is unavailable.');
    return runtime.app.recruitCandidate?.('faction',row.userId,row.name,{overrideDnc:override,dncConfirmed:override});
  }

  function addCriterionRow(host,scope){if(!host)return;host.insertAdjacentHTML('beforeend',FactionUI.renderCriterionRow({id:makeId('criterion'),field:'level',operator:'gte',kind:'Preferred',weight:1},scope));}
  function bindProfileEditor(){
    const editor=document.getElementById('ra-faction-profile-editor');if(!editor)return;
    const rerender=async work=>{try{runtime.profileEditorOpen=true;await work();await P.rerender();}catch(error){reportError(error);}};
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

  function bindControls(){
    const on=(id,handler)=>document.getElementById(id)?.addEventListener('click',handler);
    on('ra-faction-profile-apply',async()=>{try{const profileId=text(document.getElementById('ra-faction-results-profile')?.value);const profiles=await getProfiles(runtime.app);const profile=profileId?profiles.find(item=>text(item.profileId)===profileId):null;if(profileId&&!profile)throw new Error('Faction specialist profile was not found.');await saveConfig(runtime.app,{activeResultsProfileId:profileId});runtime.resultPage=0;runtime.searchFilters=profile?profileSearchFilters(profile):{...DEFAULT_SEARCH_FILTERS};await P.rerender();}catch(error){reportError(error);}});
    on('ra-faction-profile-clear',async()=>{try{await saveConfig(runtime.app,{activeResultsProfileId:''});runtime.resultPage=0;runtime.searchFilters={...DEFAULT_SEARCH_FILTERS};await P.rerender();}catch(error){reportError(error);}});
    on('ra-faction-profile-save-search',async()=>{try{const profileId=text(document.getElementById('ra-faction-results-profile')?.value);if(!profileId)throw new Error('Choose a Faction specialist profile first.');const profiles=await getProfiles(runtime.app);const profile=profiles.find(item=>text(item.profileId)===profileId);if(!profile)throw new Error('Faction specialist profile was not found.');runtime.searchFilters=P.readVisibleSearchFilters();await saveProfile(runtime.app,{...profile,searchFilters:runtime.searchFilters,searchFiltersCustom:true});await saveConfig(runtime.app,{activeResultsProfileId:profileId});await P.rerender();}catch(error){reportError(error);}});
    bindProfileEditor();
    document.querySelectorAll('[data-faction-recruit]').forEach(button=>button.onclick=()=>P.rowFor(button.dataset.factionRecruit).then(row=>recruitPlayer(row,false)).catch(reportError));
    document.querySelectorAll('[data-faction-recruit-override]').forEach(button=>button.onclick=()=>P.rowFor(button.dataset.factionRecruitOverride).then(row=>recruitPlayer(row,true)).catch(reportError));
  }

  return Object.freeze({
    FACTION_ROUTES,isFactionRoute:P.isRoute,routeMeta:P.routeMeta,install:P.install,uninstall:P.uninstall,renderPage,syncNavigation:P.syncNavigation,
    _test:{IMPLEMENTED_ROUTES:P.IMPLEMENTED_ROUTES,buildRows,persistRoute:P.persistRoute,dbGetAll,dbGet,dbPut,dbDelete,getConfig,getProfiles,readCriteria,profileSearchFilters,activeResultsProfile,filterRows:P.filterRows,sortRows,toggleSort,organizationInfo,RESULTS_PAGE_SIZE}
  });
});
