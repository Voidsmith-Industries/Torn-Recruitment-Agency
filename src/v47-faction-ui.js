(function(root,factory){
  let FactionCore=root&&root.RA_V47FactionCore,Shared=root&&root.RA_V46RecruitmentShared;
  if(typeof module==='object'&&module.exports){FactionCore=FactionCore||require('./v47-faction-core');Shared=Shared||require('./v46-recruitment-shared');}
  const api=factory(FactionCore,Shared);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.RA_V47FactionUI=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(FactionCore,Shared){
  'use strict';
  if(!FactionCore||!Shared)throw new Error('FactionCore is required.');

  const FACTION_STAGES=FactionCore.FACTION_STAGES;
  const {CRITERION_FIELDS,CRITERION_OPERATORS,text,esc}=Shared;
  const PROFILE_STATES=FactionCore.PROFILE_STATES;

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







  const COLUMNS=['player','level','age','end','man','int','networth','drug','activity30','battle','activeStreak','xanax30','org','lastActive','recruitmentFit','source','contacted','message'];
  function renderCandidates(rows=[],options={}){
    const profiles=(Array.isArray(options.profiles)?options.profiles:[]).map(FactionCore.normalizeSpecialistProfile);
    const activeProfileId=text(options.activeProfileId);
    const profileOptions=`<option value="" ${activeProfileId?'':'selected'}>No profile</option>`+profiles.map(profile=>`<option value="${esc(profile.profileId)}" ${profile.profileId===activeProfileId?'selected':''}>${esc(profile.name||profile.profileId)}${profile.status==='Active'?'':' · '+esc(profile.status)}</option>`).join('');
    const messageCell=row=>row.doNotContact?`<button type="button" class="ra-btn ra-danger" data-faction-recruit-override="${esc(row.userId)}">Override &amp; Message</button>`:`<button type="button" class="ra-btn ra-primary" data-faction-recruit="${esc(row.userId)}">Message</button>`;
    const headActions=`<div class="ra-actions"><select id="ra-faction-results-profile" class="ra-btn" aria-label="Faction recruitment profile">${profileOptions}</select><button type="button" class="ra-btn" id="ra-faction-profile-apply">Apply Profile</button><button type="button" class="ra-btn" id="ra-faction-profile-clear" ${activeProfileId?'':'hidden'}>Clear Profile</button><button type="button" class="ra-btn" id="ra-faction-profile-save-search" ${activeProfileId?'':'hidden'}>Save Search</button></div>`;
    return Shared.renderResults(rows,options,{domain:'faction',label:'Faction',orgHeader:'Faction',orgPlaceholder:'Faction name or ID',columns:COLUMNS,contactedStages:['contacted','replied','evaluating','invite ready','joined'],messageCell,headActions});
  }

  function renderCriterionRow(raw={},scope='baseline'){return Shared.renderCriterionRow(raw,scope,'faction-','level');}

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
