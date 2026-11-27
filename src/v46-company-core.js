(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V46CompanyCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const REQUIREMENT_KINDS=Object.freeze(['Hard','Preferred']);

  function text(value){return String(value??'').trim();}
  function number(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}

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
    return {criteria:(Array.isArray(config.criteria)?config.criteria:[]).map(normalizeRequirement),updatedAt:number(config.updatedAt,0)};
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
      const allowed=(Array.isArray(value)?value:[value]).map(v=>text(v).toLowerCase());
      return {known:true,passed:allowed.includes(text(actual).toLowerCase())};
    }
    return {known:true,passed:text(actual).toLowerCase()===text(value).toLowerCase()};
  }

  function waiverFor(requirementId,waivers=[]){
    return (Array.isArray(waivers)?waivers:[]).find(w=>text(w.requirementId)===text(requirementId)&&['active','review due'].includes(text(w.state).toLowerCase()))||null;
  }

  function evaluateCriteria(criteria=[],facts={},waivers=[]){
    const normalized=(Array.isArray(criteria)?criteria:[]).map(normalizeRequirement);
    const results=normalized.map(req=>{
      const verdict=compare(req.operator,facts?.[req.field],req.value,req.value2);
      const waiver=req.kind==='Hard'&&verdict.known&&!verdict.passed?waiverFor(req.id,waivers):null;
      return {...req,known:verdict.known,passed:verdict.passed,waived:Boolean(waiver),waiver,effectivePass:verdict.passed||Boolean(waiver)};
    });
    const hardFailures=results.filter(r=>r.kind==='Hard'&&r.known&&!r.passed);
    const unknownHard=results.filter(r=>r.kind==='Hard'&&!r.known);
    const unwaivedHardFailures=hardFailures.filter(r=>!r.waived);
    const failures=results.filter(r=>r.known&&!r.passed);
    const known=results.filter(r=>r.known);
    const totalWeight=known.reduce((sum,r)=>sum+(r.weight||1),0);
    const earned=known.filter(r=>r.passed).reduce((sum,r)=>sum+(r.weight||1),0);
    const score=totalWeight?Math.round(earned/totalWeight*100):null;
    const hardFailed=unwaivedHardFailures.length>0;
    const eligibility=hardFailed?'NOT CURRENTLY ELIGIBLE':hardFailures.length?'Eligible by Waiver':unknownHard.length?'Unknown':'Eligible';
    return {results,failures,hardFailures,unknownHard,unwaivedHardFailures,hardFailed,eligibility,score};
  }

  return Object.freeze({
    REQUIREMENT_KINDS,normalizeBaseline,evaluateCriteria
  });
});
