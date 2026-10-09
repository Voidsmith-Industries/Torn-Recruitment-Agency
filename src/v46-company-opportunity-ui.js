(function(root,factory){
  let CompanyCore=root&&root.RA_V46CompanyCore;
  if(!CompanyCore&&typeof module==='object'&&module.exports)CompanyCore=require('./v46-company-core');
  const api=factory(CompanyCore);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V46CompanyOpportunityUI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(CompanyCore){
  'use strict';
  if(!CompanyCore)throw new Error('CompanyCore is required.');

  const text=value=>String(value??'').trim();
  const number=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const hours=(now,at)=>Math.max(0,(number(now)-number(at,0))/3600000);
  const money=value=>Number.isFinite(Number(value))?`$${Math.round(Number(value)).toLocaleString()}`:'—';
  const metric=value=>Number.isFinite(Number(value))?Number(value).toLocaleString():'—';
  const score=value=>value===null||value===undefined||text(value)===''?'—':(Number.isFinite(Number(value))?Math.round(Number(value)):'—');

  function freshness(lastScoutAt,now){
    if(!Number.isFinite(Number(lastScoutAt))||Number(lastScoutAt)<=0)return 'Unknown';
    const age=hours(now,lastScoutAt);
    if(age<=24)return 'Fresh';
    if(age<=72)return 'Aging';
    if(age<=168)return 'Stale';
    return 'Very stale';
  }

  function selectedVacancy(row={}){
    const preferred=text(row.pinnedVacancyId)||text(row.suggestedVacancyId);
    const evaluations=Array.isArray(row.vacancyEvaluations)?row.vacancyEvaluations:[];
    const evaluation=evaluations.find(item=>text(item.vacancyId)===preferred)||[...evaluations].sort((a,b)=>number(b.matchScore)-number(a.matchScore)||text(a.vacancyId).localeCompare(text(b.vacancyId)))[0]||null;
    const selectedId=text(evaluation?.vacancyId)||preferred;
    const option=(Array.isArray(row.vacancyOptions)?row.vacancyOptions:[]).find(item=>text(item.vacancyId)===selectedId);
    return{selectedVacancyId:selectedId,selectedVacancyName:text(option?.name)||selectedId||'No active vacancy',evaluation};
  }

  function followUpDue(record={},now=Date.now()){
    return (Array.isArray(record.followUps)?record.followUps:[]).some(item=>{
      if(['completed','cancelled'].includes(text(item.state).toLowerCase()))return false;
      const due=Number(item.dueAt);
      return Number.isFinite(due)&&due<=Number(now);
    });
  }

  function buildOpportunityRows(rows=[],options={}){
    const now=number(options.now,Date.now());
    const weights={...(options.weights||{})};
    return (Array.isArray(rows)?rows:[]).map(row=>{
      const vacancy=selectedVacancy(row);
      const input={
        match:vacancy.evaluation?.matchScore??null,
        fit:row.fit??null,
        availability:text(row.availability),
        lastActiveAgeHours:row.lastActive!==null&&row.lastActive!==undefined&&Number.isFinite(Number(row.lastActive))?hours(now,row.lastActive):null,
        intelligenceFreshness:freshness(row.playerRecord?.lastScoutAt,now),
        contactPenalty:row.doNotContact===true||row.companyRecord?.doNotContact===true?100:0,
        followUpDue:followUpDue(row.companyRecord||row,now)
      };
      return{
        userId:text(row.userId),name:text(row.name)||`User ${text(row.userId)}`,
        pipelineStage:text(row.pipelineStage),eligibility:text(row.eligibility),availability:text(row.availability)||'Unknown',fit:row.fit??null,ee:row.ee??null,
        selectedVacancyId:vacancy.selectedVacancyId,selectedVacancyName:vacancy.selectedVacancyName,
        opportunity:CompanyCore.computeOpportunity(input,weights),
        intelligenceFreshness:input.intelligenceFreshness,
        companyRecord:row.companyRecord,playerRecord:row.playerRecord
      };
    }).sort((a,b)=>number(b.opportunity?.score)-number(a.opportunity?.score)||a.name.localeCompare(b.name)||a.userId.localeCompare(b.userId,undefined,{numeric:true}));
  }

  function renderBreakdown(opportunity={}){
    return (opportunity.breakdown||[]).map(item=>item.known===false?`<span>${esc(item.label)}: — (excluded)</span>`:`<span>${esc(item.label)}: ${score(item.value)} × ${score(item.weight)}%${item.label==='Contact penalty'?'':` = ${esc(item.contribution)}`}</span>`).join('<br>');
  }

  function renderOpportunityPage(rows=[]){
    const body=(Array.isArray(rows)?rows:[]).map(row=>`<tr><td><b>${esc(row.name)}</b><div class="ra-muted">${esc(row.userId)} · ${esc(row.pipelineStage)}</div></td><td><b>${score(row.opportunity?.score)}</b></td><td>${esc(row.selectedVacancyName)}</td><td>${esc(row.eligibility||'Unknown')}</td><td>${score(row.fit)}</td><td>${esc(row.intelligenceFreshness)}</td><td><details><summary>Breakdown</summary><div class="ra-note">${renderBreakdown(row.opportunity)}</div><div class="ra-muted">${esc(row.opportunity?.explanation)}</div></details></td></tr>`).join('');
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Company Opportunity Queue</h3><p>Explainable local priority scoring. Viewing or rescoring never changes Company pipeline state.</p></div></div><div class="ra-table-wrap"><table class="ra-table"><thead><tr><th>Player</th><th>Opportunity</th><th>Vacancy</th><th>Eligibility</th><th>Fit</th><th>Freshness</th><th>Why</th></tr></thead><tbody>${body||'<tr><td colspan="7">No Company opportunities.</td></tr>'}</tbody></table></div></section>`;
  }

  function bestVacancyName(row={}){
    const chosen=selectedVacancy(row);
    return chosen.selectedVacancyName;
  }

  function renderComparePage(rows=[],selectedIds=[]){
    const selected=new Set((Array.isArray(selectedIds)?selectedIds:[]).map(text));
    const choices=(Array.isArray(rows)?rows:[]).map(row=>`<label style="display:inline-flex;align-items:center;gap:5px;margin:4px 10px 4px 0"><input type="checkbox" data-company-compare-select="${esc(row.userId)}" ${selected.has(text(row.userId))?'checked':''}> ${esc(row.name)} [${esc(row.userId)}]</label>`).join('');
    const picked=(Array.isArray(rows)?rows:[]).filter(row=>selected.has(text(row.userId))).slice(0,4);
    const cards=picked.map(row=>`<section class="ra-panel" style="min-width:240px;flex:1"><h3>${esc(row.name)}</h3><div class="ra-detail-grid"><span>Player ID<b>${esc(row.userId)}</b></span><span>Stage<b>${esc(row.pipelineStage)}</b></span><span>Eligibility<b>${esc(row.eligibility||'Unknown')}</b></span><span>Availability<b>${esc(row.availability||'Unknown')}</b></span><span>Fit<b>${score(row.fit)}</b></span><span>EE<b>${metric(row.ee)}</b></span><span>Current Company<b>${esc(row.playerRecord?.currentCompany||'—')}</b></span><span>Desired Role<b>${esc(row.desiredRole||'—')}</b></span><span>Expected Salary<b>${money(row.expectedSalary)}</b></span><span>Best Vacancy<b>${esc(bestVacancyName(row))}</b></span></div></section>`).join('');
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Company Compare</h3><p>Select up to four Torn players to compare shared player facts with Company-specific recruitment results.</p></div></div><div>${choices||'<span class="ra-muted">No Company players available.</span>'}</div></section><div style="display:flex;gap:10px;flex-wrap:wrap">${cards||'<section class="ra-panel"><div class="ra-muted">Select players above to compare them.</div></section>'}</div>`;
  }

  return Object.freeze({freshness,selectedVacancy,buildOpportunityRows,renderOpportunityPage,renderComparePage});
});
