(function(root,factory){
  let FactionCore=root&&root.RA_V47FactionCore;
  if(!FactionCore&&typeof module==='object'&&module.exports)FactionCore=require('./v47-faction-core');
  const api=factory(FactionCore);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V47FactionUI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(FactionCore){
  'use strict';
  if(!FactionCore)throw new Error('FactionCore is required.');

  const FACTION_STAGES=FactionCore.FACTION_STAGES;
  const CRITERION_FIELDS=Object.freeze(['level','ee','fit','activity30','xanax30','refills30','attacks30','rwHits30','networth']);
  const CRITERION_OPERATORS=Object.freeze(['gte','gt','lte','lt','between','equals']);
  const PROFILE_STATES=FactionCore.PROFILE_STATES;

  const text=value=>String(value??'').trim();
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

  function normalizeStage(value){const raw=text(value).toLowerCase();return FACTION_STAGES.find(stage=>stage.toLowerCase()===raw)||'Prospect';}

  function buildCandidateRows(factionRecords=[],playerRecords=[],options={}){
    const players=new Map((Array.isArray(playerRecords)?playerRecords:[]).map(player=>[text(player?.userId),player]));
    const baseline=FactionCore.normalizeBaseline(options.baseline||{});
    const profiles=(Array.isArray(options.profiles)?options.profiles:[]).map(FactionCore.normalizeSpecialistProfile);
    const rows=[];
    for(const record of Array.isArray(factionRecords)?factionRecords:[]){
      if(!record||text(record.domain).toLowerCase()==='company')continue;
      const userId=text(record.userId);if(!userId)continue;
      const player=players.get(userId)||{userId};
      const waivers=Array.isArray(record.waivers)?record.waivers:[];
      const baselineEvaluation=FactionCore.evaluateCriteria(baseline.criteria,player,waivers,{context:'baseline'});
      const profileEvaluations=profiles.map(profile=>FactionCore.evaluateSpecialistProfile(profile,player,waivers));
      const suggestion=FactionCore.suggestSpecialistProfile(profiles,profileEvaluations,record.pinnedSpecialistProfileId||'');
      const evaluationMap=new Map(profileEvaluations.map(evaluation=>[text(evaluation.profileId),evaluation]));
      rows.push({
        userId,
        name:text(player.name)||`User ${userId}`,
        level:player.level??null,
        age:player.age??player.ageDays??null,
        ee:player.ee??null,
        fit:player.fit??null,
        recruitmentFit:player.recruitmentFit??null,
        drugUse:player.drugUse??player.drugUseLabel??null,
        activeStreak:player.activestreak??player.activeStreak??null,
        fitType:text(player.fitType),
        activity30:player.activity30??null,
        xanax30:player.xanax30??null,
        refills30:player.refills30??null,
        attacks30:player.attacks30??null,
        rwHits30:player.rwHits30??null,
        networth:player.networth??null,
        lastActive:player.lastActive??null,
        onlineStatus:text(player.onlineStatus),
        pipelineStage:normalizeStage(record.pipelineStage),
        availability:text(record.availability)||'Unknown',
        baselineEligibility:baselineEvaluation.eligibility,
        baselineScore:baselineEvaluation.score,
        hardFailed:baselineEvaluation.hardFailed===true,
        baselineEvaluation,
        pinnedSpecialistProfileId:text(record.pinnedSpecialistProfileId),
        specialistProfileId:text(record.specialistProfileId),
        suggestedProfileId:text(suggestion.suggestedProfileId),
        bestProfileChanged:suggestion.bestChanged===true,
        profileEvaluations,
        profileOptions:profiles.map(profile=>({
          profileId:profile.profileId,
          name:profile.name||profile.profileId,
          status:profile.status,
          matchScore:evaluationMap.get(profile.profileId)?.matchScore??null,
          eligible:evaluationMap.get(profile.profileId)?.eligible===true
        })),
        doNotContact:record.doNotContact===true,
        doNotContactReason:text(record.doNotContactReason),
        followUps:Array.isArray(record.followUps)?record.followUps.map(item=>({...item})):[],
        campaigns:Array.isArray(record.campaigns)?[...record.campaigns]:[],
        outcomes:Array.isArray(record.outcomes)?record.outcomes.map(item=>({...item})):[],
        waivers:Array.isArray(record.waivers)?record.waivers.map(item=>({...item})):[],
        tags:Array.isArray(record.tags)?[...record.tags]:[],
        archived:record.archived===true,
        stageChangedAt:record.stageChangedAt??record.updatedAt??null,
        newlyDiscoveredAt:record.newlyDiscoveredAt??null,
        newlyEligibleAt:record.newlyEligibleAt??null,
        createdAt:record.createdAt??null,
        updatedAt:record.updatedAt??null,
        factionRecord:record,
        player
      });
    }
    return rows.sort((a,b)=>a.name.localeCompare(b.name)||a.userId.localeCompare(b.userId,undefined,{numeric:true}));
  }







  function relativeLastActive(value,now=Date.now(),onlineStatus=''){const ts=Number(value);if(!Number.isFinite(ts)||ts<=0)return text(onlineStatus)||'Unknown';const seconds=Math.max(0,Math.floor((now-ts)/1000));if(seconds<60)return 'just now';if(seconds<3600)return `${Math.floor(seconds/60)}m ago`;if(seconds<86400)return `${Math.floor(seconds/3600)}h ago`;return `${Math.floor(seconds/86400)}d ago`;}
  function stat(value){if(value===null||value===undefined||text(value)==='')return '—';const n=Number(value);return Number.isFinite(n)?n.toLocaleString():'—';}
  function lastOnlineHtml(row={}){const ts=Number(row.lastActive);if(Number.isFinite(ts)&&ts>0)return esc(relativeLastActive(row.lastActive,Date.now(),row.onlineStatus));const status=text(row.onlineStatus);if(status.toLowerCase()==='online')return '<span class="ra-online-live">Online</span>';if(status.toLowerCase()==='idle')return '<span class="ra-online-idle">Idle</span>';if(status.toLowerCase()==='offline')return '<span class="ra-online-offline">Offline</span>';return 'Unknown';}
  function sortHeader(key,label,sort={}){const active=text(sort.key)===key;const marker=active?(sort.direction==='desc'?' ▼':' ▲'):'';return `<button type="button" class="ra-sort-button${active?' active':''}" data-faction-sort="${key}" aria-pressed="${active?'true':'false'}">${esc(label)}${marker}</button>`;}
  function recruitmentFitCell(row={}){if(row.recruitmentFit===null||row.recruitmentFit===undefined||text(row.recruitmentFit)==='')return '<span class="ra-muted">—</span>';const value=Number(row.recruitmentFit);if(!Number.isFinite(value))return '<span class="ra-muted">—</span>';const confidence=text(row.recruitmentConfidence)||'Low';return `<span title="Recruitment Fit · ${esc(confidence)} confidence"><b>${value.toFixed(1)}</b><small class="ra-muted"> ${esc(confidence)}</small></span>`;}
  function provenanceCell(row={}){const p=row.prospectProvenance||{};const source=Array.isArray(p.sources)&&p.sources.length?p.sources[0]:'Unknown';const state=text(row.prospectState)||text(p.state)||'Known Candidate';return `<span title="${esc(state)}"><b>${esc(source)}</b><small class="ra-muted"> · ${esc(state)}</small></span>`;}
  function contactedLabel(row={}){if(Array.isArray(row.outcomes)&&row.outcomes.length)return 'Contacted';const stage=text(row.pipelineStage).toLowerCase();return ['contacted','replied','evaluating','invite ready','joined'].includes(stage)?'Contacted':'Not yet';}
  function renderCandidates(rows=[],options={}){
    const filters=options.filters||{},sort=options.sort||{key:'player',direction:'asc'},layout=options.layout==='compact'?'compact':'expanded';const total=Number.isFinite(Number(options.total))?Number(options.total):(Array.isArray(rows)?rows:[]).length;
    const profiles=(Array.isArray(options.profiles)?options.profiles:[]).map(FactionCore.normalizeSpecialistProfile);
    const activeProfileId=text(options.activeProfileId);
    const pagination=options.pagination||{page:0,pageCount:1,start:0,end:(Array.isArray(rows)?rows:[]).length};const filteredTotal=Number.isFinite(Number(options.filteredTotal))?Number(options.filteredTotal):(Array.isArray(rows)?rows:[]).length;
    const rangeText=filteredTotal?`${Number(pagination.start||0)+1}-${Number(pagination.end||0)}`:'0';
    const pager=`<div class="ra-actions"><button type="button" class="ra-btn" data-results-page="prev" ${Number(pagination.page||0)<=0?'disabled':''}>Previous</button><span class="ra-muted">${rangeText} of ${filteredTotal}</span><button type="button" class="ra-btn" data-results-page="next" ${Number(pagination.page||0)>=Number(pagination.pageCount||1)-1?'disabled':''}>Next</button></div>`;
    const profileOptions=`<option value="" ${activeProfileId?'':'selected'}>No profile</option>`+profiles.map(profile=>`<option value="${esc(profile.profileId)}" ${profile.profileId===activeProfileId?'selected':''}>${esc(profile.name||profile.profileId)}${profile.status==='Active'?'':' · '+esc(profile.status)}</option>`).join('');
    const playerCell=row=>`<a class="ra-link" href="#" data-player-card="${esc(row.userId)}" data-player-domain="faction">${esc(row.name)}</a><small class="ra-muted"> ${esc(row.userId)}</small>`;
    const messageCell=row=>row.doNotContact?`<button type="button" class="ra-btn ra-danger" data-faction-recruit-override="${esc(row.userId)}">Override &amp; Message</button>`:`<button type="button" class="ra-btn ra-primary" data-faction-recruit="${esc(row.userId)}">Message</button>`;
    const battle=row=>{const attackKnown=row.attacks30!==null&&row.attacks30!==undefined&&text(row.attacks30)!==''&&Number.isFinite(Number(row.attacks30));const rwKnown=row.rwHits30!==null&&row.rwHits30!==undefined&&text(row.rwHits30)!==''&&Number.isFinite(Number(row.rwHits30));if(!attackKnown&&!rwKnown)return '—';return `${attackKnown?Number(row.attacks30).toLocaleString():'—'} / ${rwKnown?Number(row.rwHits30).toLocaleString():'—'}`;};
    const expandedBody=(Array.isArray(rows)?rows:[]).map(row=>`<tr><td>${playerCell(row)}</td><td>${stat(row.level)}</td><td>${stat(row.age)}</td><td>${stat(row.end)}</td><td>${stat(row.man)}</td><td>${stat(row.int)}</td><td>${stat(row.networth)}</td><td>${esc(text(row.drugUse)||'—')}</td><td>${stat(row.activity30)}</td><td>${battle(row)}</td><td>${stat(row.activeStreak)}</td><td>${stat(row.xanax30)}</td><td>${esc(row.currentOrganizationLabel||'Unknown')}</td><td>${lastOnlineHtml(row)}</td><td>${recruitmentFitCell(row)}</td><td>${provenanceCell(row)}</td><td>${esc(contactedLabel(row))}</td><td>${messageCell(row)}</td></tr>`).join('');
    const compactBody=(Array.isArray(rows)?rows:[]).map(row=>`<tr><td>${playerCell(row)}</td><td>${stat(row.end)}</td><td>${stat(row.man)}</td><td>${stat(row.int)}</td><td>${lastOnlineHtml(row)}</td><td>${recruitmentFitCell(row)}</td><td>${messageCell(row)}</td></tr>`).join('');
    const resultsTable=layout==='compact'
      ? `<table class="ra-table ra-core-results ra-results-compact"><thead><tr><th>${sortHeader('player','Player',sort)}</th><th>${sortHeader('end','END',sort)}</th><th>${sortHeader('man','MAN',sort)}</th><th>${sortHeader('int','INT',sort)}</th><th>${sortHeader('lastActive','Last Online',sort)}</th><th>Recruit Fit</th><th>Message</th></tr></thead><tbody>${compactBody||'<tr><td colspan="7">No matching Faction candidates.</td></tr>'}</tbody></table>`
      : `<table class="ra-table ra-core-results ra-results-expanded"><thead><tr><th>${sortHeader('player','Player',sort)}</th><th>${sortHeader('level','Level',sort)}</th><th>${sortHeader('age','Age',sort)}</th><th>${sortHeader('end','END',sort)}</th><th>${sortHeader('man','MAN',sort)}</th><th>${sortHeader('int','INT',sort)}</th><th>${sortHeader('networth','Net Worth',sort)}</th><th>Drug Use</th><th>${sortHeader('activity30','30d Active',sort)}</th><th>Battle / RW</th><th>${sortHeader('activeStreak','Streak',sort)}</th><th>${sortHeader('xanax30','Xanax 30d',sort)}</th><th>Faction</th><th>${sortHeader('lastActive','Last Online',sort)}</th><th>${sortHeader('recruitmentFit','Recruit Fit',sort)}</th><th>Source</th><th>Contacted</th><th>Message</th></tr></thead><tbody>${expandedBody||'<tr><td colspan="18">No matching Faction candidates.</td></tr>'}</tbody></table>`;
    return `<section class="ra-panel ra-search-panel"><div class="ra-panel-head"><div><h3>Search</h3><p>Find players, narrow the list with filters, then message the ones you want.</p></div><div class="ra-actions"><select id="ra-faction-results-profile" class="ra-btn" aria-label="Faction recruitment profile">${profileOptions}</select><button type="button" class="ra-btn" id="ra-faction-profile-apply">Apply Profile</button><button type="button" class="ra-btn" id="ra-faction-profile-clear" ${activeProfileId?'':'hidden'}>Clear Profile</button><button type="button" class="ra-btn" id="ra-faction-profile-save-search" ${activeProfileId?'':'hidden'}>Save Search</button></div></div><div class="ra-formgrid ra-core-search-grid"><div class="ra-field"><label>Name / ID</label><input id="ra-faction-filter-search" value="${esc(filters.search||'')}" placeholder="Player name or ID"></div><div class="ra-field"><label>Status</label><select id="ra-faction-filter-status"><option value="">Any</option><option value="Online" ${text(filters.onlineStatus).toLowerCase()==='online'?'selected':''}>Online</option><option value="Idle" ${text(filters.onlineStatus).toLowerCase()==='idle'?'selected':''}>Idle</option><option value="Offline" ${text(filters.onlineStatus).toLowerCase()==='offline'?'selected':''}>Offline</option></select></div><div class="ra-field"><label>Current Faction</label><input id="ra-faction-filter-organization" value="${esc(filters.organization||'')}" placeholder="Faction name or ID"></div><div class="ra-field"><label>Faction Presence</label><select id="ra-faction-filter-organization-presence"><option value="any" ${!filters.organizationPresence||filters.organizationPresence==='any'?'selected':''}>Any</option><option value="none" ${filters.organizationPresence==='none'?'selected':''}>None</option><option value="has" ${filters.organizationPresence==='has'?'selected':''}>Has Faction</option></select></div><div class="ra-field"><label>END ≥</label><input id="ra-faction-filter-end" value="${esc(filters.minEnd||'')}" placeholder="e.g. 100k"></div><div class="ra-field"><label>MAN ≥</label><input id="ra-faction-filter-man" value="${esc(filters.minMan||'')}" placeholder="e.g. 50k"></div><div class="ra-field"><label>INT ≥</label><input id="ra-faction-filter-int" value="${esc(filters.minInt||'')}" placeholder="e.g. 50k"></div></div><div class="ra-actions"><button type="button" class="ra-btn ra-primary" id="ra-faction-search-apply">Search</button><button type="button" class="ra-btn" id="ra-faction-search-clear">Clear</button></div></section><section class="ra-panel ra-results-panel"><div class="ra-panel-head"><div><h3>Results</h3><p>${filteredTotal} matching of ${total} Faction candidate(s).</p></div><div class="ra-actions"><button type="button" class="ra-btn ${layout==='expanded'?'ra-primary':''}" data-results-layout="expanded">Expanded</button><button type="button" class="ra-btn ${layout==='compact'?'ra-primary':''}" data-results-layout="compact">Compact</button></div></div><div class="ra-table-wrap">${resultsTable}</div><div class="ra-panel-foot">${pager}</div></section>`;
  }

  function renderCriterionRow(raw={},scope='baseline'){
    const req={id:text(raw.id),label:text(raw.label),field:text(raw.field)||'level',operator:text(raw.operator)||'gte',kind:text(raw.kind)==='Hard'?'Hard':'Preferred',value:raw.value??'',weight:Number.isFinite(Number(raw.weight))?Number(raw.weight):1};
    return `<div class="ra-formgrid" data-faction-criterion-row data-faction-criterion-id="${esc(req.id)}" data-faction-criterion-scope="${esc(scope)}" style="grid-template-columns:1.2fr 1fr .8fr .8fr 1fr .7fr auto;align-items:end;margin:6px 0"><div class="ra-field"><label>Label</label><input data-faction-criterion-field="label" value="${esc(req.label)}"></div><div class="ra-field"><label>Field</label><select data-faction-criterion-field="field">${CRITERION_FIELDS.map(field=>`<option value="${field}" ${field===req.field?'selected':''}>${field}</option>`).join('')}</select></div><div class="ra-field"><label>Operator</label><select data-faction-criterion-field="operator">${CRITERION_OPERATORS.map(op=>`<option value="${op}" ${op===req.operator?'selected':''}>${op}</option>`).join('')}</select></div><div class="ra-field"><label>Type</label><select data-faction-criterion-field="kind"><option value="Hard" ${req.kind==='Hard'?'selected':''}>Hard</option><option value="Preferred" ${req.kind==='Preferred'?'selected':''}>Preferred</option></select></div><div class="ra-field"><label>Value</label><input data-faction-criterion-field="value" value="${esc(req.value)}"></div><div class="ra-field"><label>Weight</label><input data-faction-criterion-field="weight" type="number" min="0" step="0.1" value="${esc(req.weight)}"></div><button type="button" class="ra-btn ra-danger" data-faction-remove-criterion="${esc(scope)}">×</button></div>`;
  }



  function renderProfileEditor({config={},profiles=[],open=false}={}){
    const baseline=FactionCore.normalizeBaseline(config.baseline||{});
    const list=(Array.isArray(profiles)?profiles:[]).map(FactionCore.normalizeSpecialistProfile);
    const cards=list.map(profile=>`<section class="ra-panel" data-faction-profile-card="${esc(profile.profileId)}"><div class="ra-formgrid"><div class="ra-field"><label>Name</label><input data-faction-profile-field="name" value="${esc(profile.name)}"></div><div class="ra-field"><label>Status</label><select data-faction-profile-field="status">${PROFILE_STATES.map(state=>`<option value="${state}" ${state===profile.status?'selected':''}>${state}</option>`).join('')}</select></div><div class="ra-field" style="grid-column:1/-1"><label>Notes</label><textarea data-faction-profile-field="notes">${esc(profile.notes)}</textarea></div></div><div data-faction-profile-criteria>${profile.criteria.map(req=>renderCriterionRow(req,`profile:${profile.profileId}`)).join('')}</div><div class="ra-actions"><button type="button" class="ra-btn" data-faction-profile-add-criterion="${esc(profile.profileId)}">Add criterion</button><button type="button" class="ra-btn ra-primary" data-faction-profile-save="${esc(profile.profileId)}">Save Profile</button><button type="button" class="ra-btn ra-danger" data-faction-profile-delete="${esc(profile.profileId)}">Delete</button></div></section>`).join('');
    return `<details class="ra-panel" id="ra-faction-profile-editor" ${open?'open':''}><summary><b>Requirements &amp; Specialist Profiles</b> <span class="ra-muted">${list.length} profile(s)</span></summary><h4>Faction Baseline</h4><p class="ra-muted">Hard requirements gate eligibility; Preferred requirements only affect score.</p><div id="ra-faction-baseline-criteria">${baseline.criteria.map(req=>renderCriterionRow(req,'baseline')).join('')}</div><div class="ra-actions"><button type="button" class="ra-btn" id="ra-faction-baseline-add">Add requirement</button><button type="button" class="ra-btn ra-primary" id="ra-faction-baseline-save">Save Baseline</button></div><h4>Specialist Profiles</h4>${cards||'<p class="ra-muted">No specialist profiles yet.</p>'}<div class="ra-actions"><button type="button" class="ra-btn ra-primary" id="ra-faction-profile-new">Create Specialist Profile</button></div></details>`;
  }

  return Object.freeze({
    FACTION_STAGES,
    PROFILE_STATES,
    CRITERION_FIELDS,
    CRITERION_OPERATORS,
    buildCandidateRows,
    renderCandidates,
    renderCriterionRow,
    renderProfileEditor
  });
});
