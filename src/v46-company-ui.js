(function(root,factory){
  const deps={CompanyCore:root&&root.RA_V46CompanyCore,Shared:root&&root.RA_V46RecruitmentShared};
  if(typeof module==='object'&&module.exports){deps.CompanyCore=require('./v46-company-core');deps.Shared=require('./v46-recruitment-shared');}
  const api=factory(deps);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V46CompanyUI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(D){
  'use strict';

  const {CompanyCore,Shared}=D;
  if(!CompanyCore||!Shared)throw new Error('CompanyCore is required.');
  const COMPANY_STAGES=Object.freeze(['Not Contacted','Shortlisted','Contacted','Replied','Hired','Rejected']);
  const {text,esc}=Shared;
  function normalizeStage(value){const raw=text(value).toLowerCase();return COMPANY_STAGES.find(stage=>stage.toLowerCase()===raw)||'Not Contacted';}

  function buildCandidateRows(companyRecords=[],playerRecords=[],options={}){
    const players=new Map((Array.isArray(playerRecords)?playerRecords:[]).map(player=>[text(player?.userId),player]));
    const eligibilityFor=typeof options.eligibilityFor==='function'?options.eligibilityFor:()=>null;
    const rows=[];
    for(const record of Array.isArray(companyRecords)?companyRecords:[]){
      if(!record||text(record.domain).toLowerCase()==='faction')continue;
      const userId=text(record.userId);if(!userId)continue;
      const player=players.get(userId)||{userId};
      const evaluation=eligibilityFor(record,player)||{};
      rows.push({
        userId,name:text(player.name)||`User ${userId}`,level:player.level??null,age:player.age??player.ageDays??null,ee:player.ee??null,fit:player.fit??null,fitType:text(player.fitType),recruitmentFit:player.recruitmentFit??null,
        lastActive:player.lastActive??null,onlineStatus:text(player.onlineStatus),activity30:player.activity30??null,activeStreak:player.activestreak??player.activeStreak??null,drugUse:player.drugUse??player.drugUseLabel??null,xanax30:player.xanax30??null,refills30:player.refills30??null,
        attacks30:player.attacks30??null,rwHits30:player.rwHits30??null,networth:player.networth??null,currentCompany:text(player.currentCompany),
        pipelineStage:normalizeStage(record.pipelineStage),availability:text(record.availability)||'Unknown',desiredCompany:text(record.desiredCompany),desiredRole:text(record.desiredRole),
        expectedSalary:record.expectedSalary??null,recruiterNote:text(record.recruiterNote),followUps:Array.isArray(record.followUps)?record.followUps.map(item=>({...item})):[],
        campaigns:Array.isArray(record.campaigns)?[...record.campaigns]:[],outcomes:Array.isArray(record.outcomes)?record.outcomes.map(item=>({...item})):[],tags:Array.isArray(record.tags)?[...record.tags]:[],
        doNotContact:record.doNotContact===true,archived:record.archived===true,createdAt:record.createdAt??null,updatedAt:record.updatedAt??null,
        stageChangedAt:record.stageChangedAt??record.updatedAt??null,newlyDiscoveredAt:record.newlyDiscoveredAt??null,newlyEligibleAt:record.newlyEligibleAt??null,
        eligibility:text(evaluation.eligibility)||'Unknown',eligibilityScore:evaluation.score===null||evaluation.score===undefined||text(evaluation.score)===''?null:(Number.isFinite(Number(evaluation.score))?Number(evaluation.score):null),hardFailed:evaluation.hardFailed===true,
        companyRecord:record,playerRecord:player
      });
    }
    return rows.sort((a,b)=>a.name.localeCompare(b.name)||a.userId.localeCompare(b.userId,undefined,{numeric:true}));
  }




  const COLUMNS=['player','level','age','man','int','end','drug','activity30','activeStreak','org','lastActive','recruitmentFit','source','contacted','message'];
  function renderCandidates(rows=[],options={}){
    const profiles=Array.isArray(options.profiles)?options.profiles:[],activeProfileId=text(options.activeProfileId);
    const profileOptions=`<option value="" ${activeProfileId?'':'selected'}>No profile</option>`+profiles.map(profile=>`<option value="${esc(profile.profileId)}" ${text(profile.profileId)===activeProfileId?'selected':''}>${esc(profile.name)}</option>`).join('');
    const profileBar=`<div class="ra-actions ra-profile-bar"><label class="ra-muted" for="ra-company-profile-select">Recruitment profile</label><select id="ra-company-profile-select" class="ra-btn">${profileOptions}</select><button type="button" class="ra-btn" id="ra-company-profile-apply" ${profiles.length?'':'disabled'}>Apply Profile</button><button type="button" class="ra-btn" id="ra-company-profile-clear" ${activeProfileId?'':'hidden'}>Clear Profile</button><details class="ra-profile-more"><summary class="ra-btn">More…</summary><div class="ra-actions"><button type="button" class="ra-btn" id="ra-company-profile-save-search" ${profiles.length?'':'disabled'}>Save Search to Profile</button>${options.smartMatch?'<button type="button" class="ra-btn" id="ra-company-profile-manage">Manage Profiles</button>':'<span class="ra-muted">Turn on Smart Match in Settings to manage profiles.</span>'}</div></details></div>`;
    const messageCell=row=>row.doNotContact?`<button type="button" class="ra-btn ra-danger" data-company-recruit-override="${esc(row.userId)}">Override &amp; Message</button>`:`<button type="button" class="ra-btn ra-primary" data-company-recruit="${esc(row.userId)}">Message</button>`;
    return Shared.renderResults(rows,options,{domain:'company',label:'Company',orgHeader:'Employment',orgPlaceholder:'Company name or ID',columns:COLUMNS,contactedStages:['contacted','replied','hired'],messageCell,profileBar,extraButtons:`<button type="button" class="ra-btn" id="ra-company-hof-discover" title="Import one bounded page of public work-stat HOF prospects without per-player enrichment">${Number(options.hofOffset)>0?'Discover Next 100':'Discover Workstat Prospects'}</button>`});
  }

  function renderCriterionRow(raw={},scope='baseline'){return Shared.renderCriterionRow(raw,scope,'','ee');}

  function renderBaselineEditor(config={},options={}){
    const criteria=Array.isArray(config.baseline?.criteria)?config.baseline.criteria:[];
    return `<details class="ra-panel" id="ra-company-baseline-editor" ${options.open?'open':''}><summary><b>Eligibility baseline</b> <span class="ra-muted">${criteria.length} criteria</span></summary><p class="ra-muted">Hard criteria mark candidates as not eligible in results. Preferred criteria only affect quality.</p><div id="ra-company-baseline-criteria" data-criteria-host>${criteria.map(req=>renderCriterionRow(req,'baseline')).join('')}</div><div class="ra-actions"><button type="button" class="ra-btn" id="ra-company-baseline-add">Add criterion</button><button type="button" class="ra-btn ra-primary" id="ra-company-baseline-save">Save Baseline</button></div></details>`;
  }
  return Object.freeze({COMPANY_STAGES,buildCandidateRows,renderCandidates,renderCriterionRow,renderBaselineEditor});
});
