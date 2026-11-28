(function(root,factory){
  let Shared=root&&root.RA_V46RecruitmentShared;
  if(!Shared&&typeof module==='object'&&module.exports)Shared=require('./v46-recruitment-shared');
  const api=factory(Shared);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V47FactionCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Shared){
  'use strict';
  if(!Shared)throw new Error('RA_V46RecruitmentShared is required.');

  const FACTION_STAGES=Object.freeze([
    'Prospect','Contacted','Replied','Evaluating','Invite Ready','Joined','Rejected','Deferred'
  ]);
  const PROFILE_STATES=Object.freeze(['Draft','Active','Paused','Archived']);
  const REQUIREMENT_KINDS=Object.freeze(['Hard','Preferred']);

  const {text,number,normalizeRequirement,normalizeBaseline,compare}=Shared;
  function clamp(value,min=0,max=100){return Math.max(min,Math.min(max,number(value)));}

  const FACTION_SEARCH_FILTER_KEYS=Object.freeze(['search','minEnd','minMan','minInt','onlineStatus','organization','organizationPresence']);
  function normalizeFactionSearchFilters(input={}){
    const source=input&&typeof input==='object'?input:{},out={};
    for(const key of FACTION_SEARCH_FILTER_KEYS)out[key]=text(source[key]);
    const presence=text(out.organizationPresence).toLowerCase();
    out.organizationPresence=['any','none','has'].includes(presence)?presence:'any';
    const status=text(out.onlineStatus);
    out.onlineStatus=['Online','Idle','Offline'].includes(status)?status:'';
    return out;
  }

  function normalizeSpecialistProfile(raw={}){
    const statusRaw=text(raw.status).toLowerCase();
    const status=PROFILE_STATES.find(value=>value.toLowerCase()===statusRaw)||'Draft';
    return {
      profileId:text(raw.profileId??raw.id),
      name:text(raw.name),
      status,
      criteria:(Array.isArray(raw.criteria)?raw.criteria:[]).map(normalizeRequirement),
      searchFilters:normalizeFactionSearchFilters(raw.searchFilters),
      searchFiltersCustom:raw.searchFiltersCustom===true,
      notes:text(raw.notes),
      version:Math.max(1,Math.floor(number(raw.version,1))),
      createdAt:number(raw.createdAt,0),
      updatedAt:number(raw.updatedAt,0)
    };
  }

  function waiverFor(requirementId,waivers=[],scope={}){
    const wantedContext=text(scope.context||'baseline').toLowerCase();
    const wantedProfile=text(scope.profileId);
    return (Array.isArray(waivers)?waivers:[]).find(waiver=>{
      if(text(waiver.requirementId)!==text(requirementId))return false;
      if(!['active','review due'].includes(text(waiver.state).toLowerCase()))return false;
      const waiverContext=text(waiver.context||'baseline').toLowerCase();
      if(waiverContext!==wantedContext)return false;
      if(wantedContext==='specialist')return text(waiver.profileId)===wantedProfile;
      return !text(waiver.profileId);
    })||null;
  }

  function evaluateCriteria(criteria=[],facts={},waivers=[],scope={context:'baseline'}){return Shared.evaluateCriteria(criteria,facts,id=>waiverFor(id,waivers,scope));}

  function ratioScore(req,facts){
    const rawActual=facts?.[req.field],rawTarget=req.value;
    if(rawActual===null||rawActual===undefined||text(rawActual)===''||rawTarget===null||rawTarget===undefined||text(rawTarget)==='')return null;
    const actual=Number(rawActual);
    const target=Number(rawTarget);
    if(!Number.isFinite(actual)||!Number.isFinite(target))return null;
    if(['gte','gt'].includes(req.operator))return target<=0?100:clamp(actual/target*100);
    if(['lte','lt'].includes(req.operator))return actual<=target?100:(actual<=0?0:clamp(target/actual*100));
    return compare(req.operator,facts?.[req.field],req.value,req.value2).passed?100:0;
  }

  function evaluateSpecialistProfile(rawProfile,facts={},waivers=[]){
    const profile=normalizeSpecialistProfile(rawProfile);
    const criteria=evaluateCriteria(profile.criteria,facts,waivers,{context:'specialist',profileId:profile.profileId});
    const measured=profile.criteria.map(req=>({req,score:ratioScore(req,facts)})).filter(row=>row.score!==null);
    const totalWeight=measured.reduce((sum,row)=>sum+(row.req.weight||1),0);
    const raw=totalWeight?measured.reduce((sum,row)=>sum+row.score*(row.req.weight||1),0)/totalWeight:null;
    const matchScore=raw===null?null:Math.round(clamp(raw));
    return {
      profileId:profile.profileId,
      matchScore,
      eligible:criteria.eligibility==='Eligible'||criteria.eligibility==='Eligible by Waiver',
      hardFailed:criteria.hardFailed,
      eligibility:criteria.hardFailed?'NOT ELIGIBLE':criteria.eligibility==='Unknown'?'Unknown':criteria.hardFailures.length?'Eligible by Waiver':'Eligible',
      criteria
    };
  }

  function suggestSpecialistProfile(profiles=[],evaluations=[],pinnedProfileId=''){
    const activeIds=new Set((Array.isArray(profiles)?profiles:[])
      .map(normalizeSpecialistProfile)
      .filter(profile=>profile.status==='Active')
      .map(profile=>profile.profileId));
    const eligible=(Array.isArray(evaluations)?evaluations:[])
      .filter(evaluation=>evaluation&&evaluation.eligible===true&&activeIds.has(text(evaluation.profileId)))
      .sort((a,b)=>number(b.matchScore)-number(a.matchScore)||text(a.profileId).localeCompare(text(b.profileId)));
    const suggestedProfileId=text(eligible[0]?.profileId);
    const pinned=text(pinnedProfileId);
    return {
      suggestedProfileId,
      pinnedProfileId:pinned,
      bestChanged:Boolean(pinned&&suggestedProfileId&&pinned!==suggestedProfileId)
    };
  }






  return Object.freeze({
    FACTION_STAGES,
    PROFILE_STATES,
    REQUIREMENT_KINDS,
    normalizeBaseline,
    normalizeFactionSearchFilters,
    normalizeSpecialistProfile,
    evaluateCriteria,
    evaluateSpecialistProfile,
    suggestSpecialistProfile
  });
});
