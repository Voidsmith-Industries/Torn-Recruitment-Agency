(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RA_V45Candidates = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PIPELINE_STAGES = Object.freeze(['Not Contacted','Shortlisted','Contacted','Replied','Hired','Rejected']);
  const AVAILABILITY_VALUES = Object.freeze(['Available','Unavailable','Unknown']);

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const out = Number(value);
    return Number.isFinite(out) ? out : null;
  }

  function text(value) { return String(value ?? '').trim(); }

  function normalizeStage(value) {
    const raw = text(value).toLowerCase();
    return PIPELINE_STAGES.find(stage => stage.toLowerCase() === raw) || 'Not Contacted';
  }

  function normalizeAvailability(value) {
    const raw = text(value).toLowerCase();
    if (!raw) return 'Unknown';
    return AVAILABILITY_VALUES.find(item => item.toLowerCase() === raw) || 'Unknown';
  }

  function composeCandidateView(input = {}) {
    const candidate = input.candidate || {};
    const source = input.source || {};
    const result = input.result || {};
    const scout = input.scout || result.scout || {};
    const profile = scout.profile || result.api || result.profile || {};
    const match = input.match || result.matchResult || {};
    const userId = text(candidate.userId || result.userId || result.id || profile.id);
    const name = text(candidate.name || result.name || profile.name) || (userId ? `User ${userId}` : 'Unknown player');
    const desiredCompany = text(candidate.desiredCompany || source.parsed?.desiredCompany || result.preferredCompany || result.company);
    const desiredRole = text(candidate.desiredRole || source.parsed?.desiredRole);
    const wantsTrains = candidate.wantsTrains ?? source.parsed?.wantsTrains ?? false;
    const trainMin = finite(candidate.trainAmountMin ?? source.parsed?.trainAmountMin);
    const trainMax = finite(candidate.trainAmountMax ?? source.parsed?.trainAmountMax);
    const lookingForParts = [];
    if (desiredCompany) lookingForParts.push(desiredCompany);
    if (desiredRole) lookingForParts.push(desiredRole);
    if (wantsTrains) {
      if (trainMin !== null && trainMax !== null) lookingForParts.push(`${trainMin}-${trainMax} trains`);
      else lookingForParts.push('trains');
    }
    return {
      userId,
      name,
      pipelineStage:normalizeStage(candidate.pipelineStage),
      availability:normalizeAvailability(candidate.availability || source.parsed?.availability),
      recruiterNote:text(candidate.recruiterNote),
      expectedSalary:finite(candidate.expectedSalary),
      desiredCompany,
      desiredRole,
      lookingFor:lookingForParts.join(' · ') || 'Unknown',
      latestForumSourceId:text(candidate.latestForumSourceId || source.sourceId),
      sourceType:text(source.sourceType || result.sourceType || candidate.discoverySources?.[0]),
      forumUrl:text(source.postUrl || source.url || source.forumUrl),
      currentCompany:text(result.currentCompany || profile.company?.name || profile.company_name),
      matchScore:finite(match.score ?? result.matchScore),
      fitScore:finite(result.fit ?? scout.currentFit ?? scout.fit ?? scout.originalFit),
      ee:finite(result.ee),
      man:finite(result.stats?.man),
      int:finite(result.stats?.int),
      end:finite(result.stats?.end),
      lastActive:finite(profile.lastActionTs ?? result.lastActionTs),
      localOnly:true
    };
  }






  function tornProfileUrl(userId) {
    const id = text(userId);
    return /^\d+$/.test(id) ? `https://www.torn.com/profiles.php?XID=${id}` : '';
  }


  return Object.freeze({
    PIPELINE_STAGES,
    AVAILABILITY_VALUES,
    composeCandidateView,
    tornProfileUrl
  });
});
