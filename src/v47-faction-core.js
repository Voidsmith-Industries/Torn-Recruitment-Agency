(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V47FactionCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const FACTION_STAGES=Object.freeze([
    'Prospect','Contacted','Replied','Evaluating','Invite Ready','Joined','Rejected','Deferred'
  ]);
  const PROFILE_STATES=Object.freeze(['Draft','Active','Paused','Archived']);
  const REQUIREMENT_KINDS=Object.freeze(['Hard','Preferred']);

  function text(value){return String(value??'').trim();}
  function number(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
  function clamp(value,min=0,max=100){return Math.max(min,Math.min(max,number(value)));}

  function normalizeKind(value){return text(value).toLowerCase()==='hard'?'Hard':'Preferred';}
  function normalizeRequirement(raw={},index=0){
    const field=text(raw.field);
    return {
      id:text(raw.id)||`${field||'criterion'}-${index+1}`,
      field,
      operator:text(raw.operator||'gte').toLowerCase(),
      value:raw.value,
      value2:raw.value2,
      kind:normalizeKind(raw.kind),
      label:text(raw.label)||field||`Criterion ${index+1}`,
      weight:Math.max(0,number(raw.weight,1))
    };
  }

  function normalizeBaseline(config={}){
    return {
      criteria:(Array.isArray(config.criteria)?config.criteria:[]).map(normalizeRequirement),
      updatedAt:number(config.updatedAt,0)
    };
  }

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

  function compare(operator,actual,value,value2){
    if(actual===undefined||actual===null||actual==='')return {known:false,passed:false};
    const op=text(operator).toLowerCase();
    if(op==='gte'||op==='gt'||op==='lte'||op==='lt'){
      const a=Number(actual),b=Number(value);
      if(!Number.isFinite(a)||!Number.isFinite(b))return {known:false,passed:false};
      if(op==='gte')return {known:true,passed:a>=b};
      if(op==='gt')return {known:true,passed:a>b};
      if(op==='lte')return {known:true,passed:a<=b};
      return {known:true,passed:a<b};
    }
    if(op==='between'){
      const a=Number(actual),lo=Number(value),hi=Number(value2);
      if(![a,lo,hi].every(Number.isFinite))return {known:false,passed:false};
      return {known:true,passed:a>=Math.min(lo,hi)&&a<=Math.max(lo,hi)};
    }
    if(op==='contains')return {known:true,passed:text(actual).toLowerCase().includes(text(value).toLowerCase())};
    if(op==='oneof'){
      const allowed=(Array.isArray(value)?value:[value]).map(item=>text(item).toLowerCase());
      return {known:true,passed:allowed.includes(text(actual).toLowerCase())};
    }
    return {known:true,passed:text(actual).toLowerCase()===text(value).toLowerCase()};
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

  function evaluateCriteria(criteria=[],facts={},waivers=[],scope={context:'baseline'}){
    const normalized=(Array.isArray(criteria)?criteria:[]).map(normalizeRequirement);
    const results=normalized.map(req=>{
      const verdict=compare(req.operator,facts?.[req.field],req.value,req.value2);
      const waiver=req.kind==='Hard'&&verdict.known&&!verdict.passed?waiverFor(req.id,waivers,scope):null;
      return {
        ...req,
        known:verdict.known,
        passed:verdict.passed,
        waived:Boolean(waiver),
        waiver,
        effectivePass:verdict.passed||Boolean(waiver)
      };
    });
    const hardFailures=results.filter(result=>result.kind==='Hard'&&result.known&&!result.passed);
    const unknownHard=results.filter(result=>result.kind==='Hard'&&!result.known);
    const unwaivedHardFailures=hardFailures.filter(result=>!result.waived);
    const failures=results.filter(result=>result.known&&!result.passed);
    const known=results.filter(result=>result.known);
    const totalWeight=known.reduce((sum,result)=>sum+(result.weight||1),0);
    const earned=known.filter(result=>result.passed).reduce((sum,result)=>sum+(result.weight||1),0);
    const score=totalWeight?Math.round(earned/totalWeight*100):null;
    const hardFailed=unwaivedHardFailures.length>0;
    const eligibility=hardFailed?'NOT CURRENTLY ELIGIBLE':hardFailures.length?'Eligible by Waiver':unknownHard.length?'Unknown':'Eligible';
    return {results,failures,hardFailures,unknownHard,unwaivedHardFailures,hardFailed,eligibility,score};
  }

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
