(function(root,factory){
  let Shared=root&&root.RA_V46RecruitmentShared;
  if(!Shared&&typeof module==='object'&&module.exports)Shared=require('./v46-recruitment-shared');
  const api=factory(Shared);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V46CompanyCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(Shared){
  'use strict';
  if(!Shared)throw new Error('RA_V46RecruitmentShared is required.');

  const REQUIREMENT_KINDS=Object.freeze(['Hard','Preferred']);
  const {text}=Shared;

  function waiverFor(requirementId,waivers=[]){
    return (Array.isArray(waivers)?waivers:[]).find(w=>text(w.requirementId)===text(requirementId)&&['active','review due'].includes(text(w.state).toLowerCase()))||null;
  }

  function evaluateCriteria(criteria=[],facts={},waivers=[]){return Shared.evaluateCriteria(criteria,facts,id=>waiverFor(id,waivers));}

  return Object.freeze({
    REQUIREMENT_KINDS,normalizeBaseline:Shared.normalizeBaseline,evaluateCriteria
  });
});
