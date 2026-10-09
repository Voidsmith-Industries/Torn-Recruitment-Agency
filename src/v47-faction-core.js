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
  const DAY_MS=86400000;

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

  function normalizeSpecialistProfile(raw={}){
    const statusRaw=text(raw.status).toLowerCase();
    const status=PROFILE_STATES.find(value=>value.toLowerCase()===statusRaw)||'Draft';
    return {
      profileId:text(raw.profileId??raw.id),
      name:text(raw.name),
      status,
      criteria:(Array.isArray(raw.criteria)?raw.criteria:[]).map(normalizeRequirement),
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
      const waiver=req.kind==='Hard'&&!verdict.passed?waiverFor(req.id,waivers,scope):null;
      return {
        ...req,
        known:verdict.known,
        passed:verdict.passed,
        waived:Boolean(waiver),
        waiver,
        effectivePass:verdict.passed||Boolean(waiver)
      };
    });
    const hardFailures=results.filter(result=>result.kind==='Hard'&&!result.passed);
    const unwaivedHardFailures=hardFailures.filter(result=>!result.waived);
    const failures=results.filter(result=>!result.passed);
    const known=results.filter(result=>result.known);
    const totalWeight=known.reduce((sum,result)=>sum+(result.weight||1),0);
    const earned=known.filter(result=>result.passed).reduce((sum,result)=>sum+(result.weight||1),0);
    const score=totalWeight?Math.round(earned/totalWeight*100):null;
    const hardFailed=unwaivedHardFailures.length>0;
    const eligibility=hardFailed?'NOT CURRENTLY ELIGIBLE':hardFailures.length?'Eligible by Waiver':'Eligible';
    return {results,failures,hardFailures,unwaivedHardFailures,hardFailed,eligibility,score};
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
      eligible:!criteria.hardFailed,
      hardFailed:criteria.hardFailed,
      eligibility:criteria.hardFailed?'NOT ELIGIBLE':criteria.hardFailures.length?'Eligible by Waiver':'Eligible',
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

  function opportunityComponent(label,value,weight){
    const w=Math.max(0,number(weight));
    const known=value!==null&&value!==undefined&&text(value)!==''&&Number.isFinite(Number(value));
    return {label,value:known?clamp(value):null,weight:w,known,contribution:0};
  }

  function computeOpportunity(input={},weights={}){
    const availabilityText=text(input.availability).toLowerCase();
    const availability=availabilityText==='available'?100:availabilityText==='unavailable'?0:null;
    const ageKnown=input.lastActiveAgeHours!==null&&input.lastActiveAgeHours!==undefined&&text(input.lastActiveAgeHours)!==''&&Number.isFinite(Number(input.lastActiveAgeHours));
    const age=ageKnown?Math.max(0,Number(input.lastActiveAgeHours)):null;
    const activity=age===null?null:(age<=6?100:age<=24?80:age<=72?55:age<=168?30:10);
    const freshMap={fresh:100,aging:70,stale:40,'very stale':15};
    const freshness=freshMap[text(input.intelligenceFreshness).toLowerCase()]??null;
    const rows=[
      opportunityComponent('Match',input.match,weights.match),
      opportunityComponent('Fit',input.fit,weights.fit),
      opportunityComponent('Availability',availability,weights.availability),
      opportunityComponent('Activity',activity,weights.activity),
      opportunityComponent('Freshness',freshness,weights.freshness),
      opportunityComponent('Follow-up',input.followUpDue?100:0,weights.followUp),
      {label:'Contact penalty',value:clamp(input.contactPenalty),weight:Math.max(0,number(weights.contactPenalty)),known:true,contribution:0}
    ];
    const scoredRows=rows.slice(0,6);
    const availableWeight=scoredRows.reduce((sum,row)=>sum+(row.known?row.weight:0),0);
    for(const row of scoredRows)row.contribution=row.known&&availableWeight>0?Math.round((row.value*row.weight/availableWeight)*100)/100:0;
    const rawScore=Math.round(scoredRows.reduce((sum,row)=>sum+row.contribution,0)*100)/100;
    const penalty=Math.round(clamp(input.contactPenalty)*Math.max(0,number(weights.contactPenalty)))/100;
    const score=Math.round(clamp(rawScore-penalty));
    const explanation=rows.slice(0,6)
      .map(row=>row.known?`${row.label}: ${row.value} × ${row.weight}/${availableWeight} = ${row.contribution}`:`${row.label}: Unknown (excluded)`)
      .join('; ')+(penalty?`; Contact penalty: -${penalty}`:'');
    return {score,rawScore,penalty,breakdown:rows,explanation};
  }

  function stageAgeStatus(record={},thresholds={},now=Date.now()){
    const changed=number(record.stageChangedAt??record.updatedAt,now);
    const daysInStage=Math.max(0,Math.floor((number(now)-changed)/DAY_MS));
    const threshold=Math.max(0,number(thresholds?.[record.pipelineStage],0));
    return {
      pipelineStage:text(record.pipelineStage),
      daysInStage,
      thresholdDays:threshold,
      stale:threshold>0&&daysInStage>=threshold
    };
  }

  function followUpTimestamp(followUp){
    if(Number.isFinite(Number(followUp?.dueAt)))return Number(followUp.dueAt);
    const raw=text(followUp?.date)+(text(followUp?.time)?`T${text(followUp.time)}`:'T23:59:59');
    const parsed=Date.parse(raw);
    return Number.isFinite(parsed)?parsed:Infinity;
  }

  function buildTodayQueue(records=[],context={}){
    const now=number(context.now,Date.now());
    const opportunities=context.opportunities||{};
    const out=[];
    for(const record of Array.isArray(records)?records:[]){
      if(record?.archived===true)continue;
      const reasons=[];
      let priority=0;
      if(text(record.pipelineStage)==='Replied'){
        reasons.push('Reply waiting');
        priority=Math.max(priority,100);
      }
      const overdue=(Array.isArray(record.followUps)?record.followUps:[])
        .filter(followUp=>!['completed','cancelled'].includes(text(followUp.state).toLowerCase())&&followUpTimestamp(followUp)<now);
      if(overdue.length){
        reasons.push(`Overdue follow-up (${overdue.length})`);
        priority=Math.max(priority,85);
      }
      const aging=stageAgeStatus(record,context.stageThresholds||{},now);
      if(aging.stale){
        reasons.push('Stale stage');
        priority=Math.max(priority,75);
      }
      if(number(record.newlyEligibleAt,0)>0&&now-number(record.newlyEligibleAt)<=DAY_MS){
        reasons.push('Newly eligible');
        priority=Math.max(priority,70);
      }
      if(number(record.newlyDiscoveredAt,0)>0&&now-number(record.newlyDiscoveredAt)<=DAY_MS){
        reasons.push('Newly discovered');
        priority=Math.max(priority,60);
      }
      if(number(opportunities?.[record.userId],0)>=80){
        reasons.push('High opportunity');
        priority=Math.max(priority,55);
      }
      if(reasons.length)out.push({userId:text(record.userId),pipelineStage:text(record.pipelineStage),priority,reasons});
    }
    return out.sort((a,b)=>b.priority-a.priority||a.userId.localeCompare(b.userId,undefined,{numeric:true}));
  }

  return Object.freeze({
    FACTION_STAGES,
    PROFILE_STATES,
    REQUIREMENT_KINDS,
    normalizeBaseline,
    normalizeSpecialistProfile,
    evaluateCriteria,
    evaluateSpecialistProfile,
    suggestSpecialistProfile,
    computeOpportunity,
    stageAgeStatus,
    buildTodayQueue
  });
});
