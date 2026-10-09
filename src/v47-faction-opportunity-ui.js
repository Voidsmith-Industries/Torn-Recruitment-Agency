(function(root,factory){
  let FactionCore=root&&root.RA_V47FactionCore;
  if(!FactionCore&&typeof module==='object'&&module.exports)FactionCore=require('./v47-faction-core');
  const api=factory(FactionCore);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V47FactionOpportunityUI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(FactionCore){
  'use strict';
  if(!FactionCore)throw new Error('FactionCore is required.');

  const text=value=>String(value??'').trim();
  const number=(value,fallback=0)=>{const n=Number(value);return Number.isFinite(n)?n:fallback;};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const hours=(now,at)=>Math.max(0,(number(now)-number(at,0))/3600000);
  const metric=value=>value===null||value===undefined||text(value)===''?'—':(Number.isFinite(Number(value))?Number(value).toLocaleString():'—');
  const score=value=>value===null||value===undefined||text(value)===''?'—':(Number.isFinite(Number(value))?Math.round(Number(value)):'—');

  function freshness(lastScoutAt,now){
    if(!Number.isFinite(Number(lastScoutAt))||Number(lastScoutAt)<=0)return 'Unknown';
    const age=hours(now,lastScoutAt);
    if(age<=24)return 'Fresh';
    if(age<=72)return 'Aging';
    if(age<=168)return 'Stale';
    return 'Very stale';
  }

  function followUpDue(record={},now=Date.now()){
    return (Array.isArray(record.followUps)?record.followUps:[]).some(item=>{
      if(['completed','cancelled'].includes(text(item.state).toLowerCase()))return false;
      const due=Number(item.dueAt);
      return Number.isFinite(due)&&due<=Number(now);
    });
  }

  function profileName(row,profileId){
    const option=(Array.isArray(row?.profileOptions)?row.profileOptions:[]).find(item=>text(item.profileId)===text(profileId));
    return text(option?.name)||text(profileId);
  }

  function selectedMatch(row={}){
    const evaluations=Array.isArray(row.profileEvaluations)?row.profileEvaluations:[];
    const pinnedId=text(row.pinnedSpecialistProfileId);
    const pinned=pinnedId?evaluations.find(item=>text(item.profileId)===pinnedId&&item?.eligible===true):null;
    if(pinned){
      return {
        selectedMatchSource:'Pinned specialist',
        selectedProfileId:pinnedId,
        selectedProfileName:profileName(row,pinnedId),
        selectedMatchScore:pinned.matchScore??null,
        evaluation:pinned
      };
    }

    const suggestedId=text(row.suggestedProfileId);
    const suggested=suggestedId?evaluations.find(item=>text(item.profileId)===suggestedId&&item?.eligible===true):null;
    if(suggested){
      return {
        selectedMatchSource:'Suggested specialist',
        selectedProfileId:suggestedId,
        selectedProfileName:profileName(row,suggestedId),
        selectedMatchScore:suggested.matchScore??null,
        evaluation:suggested
      };
    }

    const best=[...evaluations]
      .filter(item=>item?.eligible===true)
      .sort((a,b)=>number(b.matchScore)-number(a.matchScore)||text(a.profileId).localeCompare(text(b.profileId)))[0]||null;
    if(best){
      const profileId=text(best.profileId);
      return {
        selectedMatchSource:'Suggested specialist',
        selectedProfileId:profileId,
        selectedProfileName:profileName(row,profileId),
        selectedMatchScore:best.matchScore??null,
        evaluation:best
      };
    }

    return {
      selectedMatchSource:'Faction Baseline',
      selectedProfileId:'',
      selectedProfileName:'',
      selectedMatchScore:row.baselineScore??null,
      evaluation:null
    };
  }

  function buildOpportunityRows(rows=[],options={}){
    const now=number(options.now,Date.now());
    const weights={...(options.weights||{})};
    return (Array.isArray(rows)?rows:[]).map(row=>{
      const chosen=selectedMatch(row);
      const factionRecord=row.factionRecord||{};
      const player=row.player||{};
      const input={
        match:chosen.selectedMatchScore,
        fit:row.fit??null,
        availability:text(row.availability),
        lastActiveAgeHours:row.lastActive!==null&&row.lastActive!==undefined&&Number.isFinite(Number(row.lastActive))?hours(now,row.lastActive):null,
        intelligenceFreshness:freshness(player.lastScoutAt,now),
        contactPenalty:row.doNotContact===true||factionRecord.doNotContact===true?100:0,
        followUpDue:followUpDue(factionRecord,now)
      };
      return {
        userId:text(row.userId),
        name:text(row.name)||`User ${text(row.userId)}`,
        pipelineStage:text(row.pipelineStage),
        baselineEligibility:text(row.baselineEligibility)||'Unknown',
        baselineScore:row.baselineScore??null,
        availability:text(row.availability)||'Unknown',
        fit:row.fit??null,
        ee:row.ee??null,
        level:row.level??null,
        selectedMatchSource:chosen.selectedMatchSource,
        selectedProfileId:chosen.selectedProfileId,
        selectedProfileName:chosen.selectedProfileName,
        selectedMatchScore:chosen.selectedMatchScore,
        opportunity:FactionCore.computeOpportunity(input,weights),
        intelligenceFreshness:input.intelligenceFreshness,
        doNotContact:row.doNotContact===true||factionRecord.doNotContact===true,
        pinnedSpecialistProfileId:text(row.pinnedSpecialistProfileId),
        suggestedProfileId:text(row.suggestedProfileId),
        profileEvaluations:Array.isArray(row.profileEvaluations)?row.profileEvaluations.map(item=>({...item})):[],
        profileOptions:Array.isArray(row.profileOptions)?row.profileOptions.map(item=>({...item})):[],
        factionRecord,
        player
      };
    }).sort((a,b)=>number(b.opportunity?.score)-number(a.opportunity?.score)||a.name.localeCompare(b.name)||a.userId.localeCompare(b.userId,undefined,{numeric:true}));
  }

  function renderBreakdown(opportunity={}){
    return (opportunity.breakdown||[]).map(item=>item.known===false?`<span>${esc(item.label)}: — (excluded)</span>`:`<span>${esc(item.label)}: ${score(item.value)} × ${score(item.weight)}%${item.label==='Contact penalty'?'':` = ${esc(item.contribution)}`}</span>`).join('<br>');
  }

  function renderOpportunityPage(rows=[]){
    const body=(Array.isArray(rows)?rows:[]).map(row=>`<tr><td><b>${esc(row.name)}</b><div class="ra-muted">${esc(row.userId)} · ${esc(row.pipelineStage)}</div></td><td><b>${score(row.opportunity?.score)}</b></td><td>${esc(row.selectedMatchSource)}${row.selectedProfileName?`<div class="ra-muted">${esc(row.selectedProfileName)} · Match ${score(row.selectedMatchScore)}%</div>`:`<div class="ra-muted">Baseline ${score(row.selectedMatchScore)}%</div>`}</td><td>${esc(row.baselineEligibility)}</td><td>${score(row.fit)}</td><td>${esc(row.intelligenceFreshness)}</td><td><details><summary>Breakdown</summary><div class="ra-note">${renderBreakdown(row.opportunity)}</div><div class="ra-muted">${esc(row.opportunity?.explanation)}</div></details></td></tr>`).join('');
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Faction Opportunity Queue</h3><p>Explainable local priority scoring. Specialist Match ranks work; it never changes Faction Baseline eligibility or pipeline stage.</p></div></div><div class="ra-table-wrap"><table class="ra-table"><thead><tr><th>Player</th><th>Opportunity</th><th>Match Source</th><th>Faction Baseline</th><th>Fit</th><th>Freshness</th><th>Why</th></tr></thead><tbody>${body||'<tr><td colspan="7">No Faction opportunities.</td></tr>'}</tbody></table></div></section>`;
  }

  function buildCompareRows(rows=[],selectedIds=[]){
    const ids=[];
    for(const value of Array.isArray(selectedIds)?selectedIds:[]){
      const id=text(value);
      if(id&&!ids.includes(id))ids.push(id);
      if(ids.length>=4)break;
    }
    const byId=new Map((Array.isArray(rows)?rows:[]).map(row=>[text(row.userId),row]));
    return ids.map(id=>byId.get(id)).filter(Boolean).map(row=>({
      userId:text(row.userId),
      name:text(row.name)||`User ${text(row.userId)}`,
      pipelineStage:text(row.pipelineStage),
      baselineEligibility:text(row.baselineEligibility)||'Unknown',
      baselineScore:row.baselineScore??null,
      availability:text(row.availability)||'Unknown',
      fit:row.fit??null,
      ee:row.ee??null,
      level:row.level??null,
      activity30:row.activity30??null,
      xanax30:row.xanax30??null,
      refills30:row.refills30??null,
      attacks30:row.attacks30??null,
      rwHits30:row.rwHits30??null,
      networth:row.networth??null,
      lastActive:row.lastActive??null,
      doNotContact:row.doNotContact===true||row.factionRecord?.doNotContact===true,
      pinnedSpecialistProfileId:text(row.pinnedSpecialistProfileId),
      suggestedProfileId:text(row.suggestedProfileId),
      profileEvaluations:Array.isArray(row.profileEvaluations)?row.profileEvaluations.map(item=>({...item})):[],
      profileOptions:Array.isArray(row.profileOptions)?row.profileOptions.map(item=>({...item})):[]
    }));
  }

  function displayProfile(row={}){
    const chosen=selectedMatch(row);
    if(chosen.selectedProfileName)return `${chosen.selectedProfileName} (${score(chosen.selectedMatchScore)}%)`;
    return `Faction Baseline (${score(chosen.selectedMatchScore)}%)`;
  }

  function renderComparePage(rows=[],selectedIds=[]){
    const selected=new Set(buildCompareRows(rows,selectedIds).map(row=>row.userId));
    const choices=(Array.isArray(rows)?rows:[]).map(row=>`<label style="display:inline-flex;align-items:center;gap:5px;margin:4px 10px 4px 0"><input type="checkbox" data-faction-compare-select="${esc(row.userId)}" ${selected.has(text(row.userId))?'checked':''}> ${esc(row.name)} [${esc(row.userId)}]</label>`).join('');
    const picked=buildCompareRows(rows,selectedIds);
    const sourceById=new Map((Array.isArray(rows)?rows:[]).map(row=>[text(row.userId),row]));
    const cards=picked.map(row=>{
      const source=sourceById.get(row.userId)||row;
      return `<section class="ra-panel" style="min-width:240px;flex:1"><h3>${esc(row.name)}</h3><div class="ra-detail-grid"><span>Player ID<b>${esc(row.userId)}</b></span><span>Stage<b>${esc(row.pipelineStage)}</b></span><span>Faction Baseline<b>${esc(row.baselineEligibility)} · ${score(row.baselineScore)}%</b></span><span>Availability<b>${esc(row.availability)}</b></span><span>Fit<b>${score(row.fit)}</b></span><span>EE<b>${metric(row.ee)}</b></span><span>Level<b>${metric(row.level)}</b></span><span>Activity 30d<b>${metric(row.activity30)}</b></span><span>RW Hits 30d<b>${metric(row.rwHits30)}</b></span><span>Attacks 30d<b>${metric(row.attacks30)}</b></span><span>Specialist Profile<b>${esc(displayProfile(source))}</b></span><span>Do Not Contact<b>${row.doNotContact?'Yes':'No'}</b></span></div></section>`;
    }).join('');
    return `<section class="ra-panel"><div class="ra-panel-head"><div><h3>Faction Compare</h3><p>Select up to four Torn players to compare shared facts with Faction-specific recruitment results.</p></div></div><div>${choices||'<span class="ra-muted">No Faction players available.</span>'}</div></section><div style="display:flex;gap:10px;flex-wrap:wrap">${cards||'<section class="ra-panel"><div class="ra-muted">Select players above to compare them.</div></section>'}</div>`;
  }

  return Object.freeze({
    freshness,
    followUpDue,
    selectedMatch,
    buildOpportunityRows,
    renderOpportunityPage,
    buildCompareRows,
    renderComparePage
  });
});
