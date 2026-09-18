(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RA_ForumCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PIPELINE_STAGES = Object.freeze([
    'Not Contacted',
    'Shortlisted',
    'Contacted',
    'Replied',
    'Hired',
    'Rejected'
  ]);

  const AVAILABILITY_VALUES = Object.freeze(['Available', 'Unavailable', 'Unknown']);
  const SOURCE_TYPES = Object.freeze(['JOB SEEKER', 'TRAIN BUYER', 'COMPANY FORUM', 'FACTION FORUM', 'MANUAL']);
  const APPROVED_PLACEHOLDERS = Object.freeze([
    'name', 'player_id', 'looking_for', 'company_name', 'current_company', 'match_score', 'fit_score'
  ]);

  const COMPANY_ALIASES = Object.freeze([
    ['adult novelties', 'Adult Novelties'], ['adult novelty', 'Adult Novelties'], ['an', 'Adult Novelties'],
    ['amusement park', 'Amusement Park'], ['candle shop', 'Candle Shop'], ['car dealership', 'Car Dealership'],
    ['clothing store', 'Clothing Store'], ['cruise line', 'Cruise Line'], ['cyber cafe', 'Cyber Cafe'],
    ['detective agency', 'Detective Agency'], ['farm', 'Farm'], ['firework stand', 'Firework Stand'],
    ['fitness center', 'Fitness Center'], ['flower shop', 'Flower Shop'], ['furniture store', 'Furniture Store'],
    ['game shop', 'Game Shop'], ['gas station', 'Gas Station'], ['gents strip club', 'Gents Strip Club'],
    ['grocery store', 'Grocery Store'], ['gun shop', 'Gun Shop'], ['hair salon', 'Hair Salon'],
    ['ladies strip club', 'Ladies Strip Club'], ['law firm', 'Law Firm'], ['lingerie store', 'Lingerie Store'],
    ['logistics management', 'Logistics Management'], ['meat warehouse', 'Meat Warehouse'], ['mechanic shop', 'Mechanic Shop'],
    ['mining corporation', 'Mining Corporation'], ['music store', 'Music Store'], ['nightclub', 'Nightclub'],
    ['oil rig', 'Oil Rig'], ['private security firm', 'Private Security Firm'], ['property broker', 'Property Broker'],
    ['pub', 'Pub'], ['restaurant', 'Restaurant'], ['software corporation', 'Software Corporation'],
    ['sweet shop', 'Sweet Shop'], ['television network', 'Television Network'], ['theater', 'Theater'],
    ['toy shop', 'Toy Shop'], ['travel agency', 'Travel Agency'], ['wedding chapel', 'Wedding Chapel'], ['zoo', 'Zoo']
  ]);

  function text(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeStage(value) {
    const raw = text(value).toLowerCase();
    const found = PIPELINE_STAGES.find(stage => stage.toLowerCase() === raw);
    return found || 'Not Contacted';
  }

  function parseCompactStatNumber(value) {
    const raw = String(value == null ? '' : value).trim().replace(/,/g, '').replace(/\s+/g, '');
    const match = raw.match(/^([0-9]+(?:\.[0-9]+)?)([kmb])?$/i);
    if (!match) return null;
    const multiplier = {k:1e3,m:1e6,b:1e9}[String(match[2] || '').toLowerCase()] || 1;
    const out = Number(match[1]) * multiplier;
    return Number.isFinite(out) ? Math.round(out) : null;
  }

  function normalizeWorkStats(input = {}) {
    const man = finite(input.man);
    const int = finite(input.int);
    const end = finite(input.end);
    return {man,int,end,total:man !== null && int !== null && end !== null ? man + int + end : null};
  }

  function parseWorkStats(value) {
    const raw = String(value == null ? '' : value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const number = '([0-9]+(?:[,.][0-9]+)*(?:\\s*[kKmMbB])?)';
    const read = (fullPattern, abbreviation) => {
      const patterns = [
        new RegExp('\\b(?:' + fullPattern + ')\\b\\s*(?:[:=\\-]\\s*|\\s+)' + number, 'i'),
        new RegExp('\\b' + abbreviation + '\\b\\s*[:=\\-]\\s*' + number, 'i'),
        new RegExp('\\b' + abbreviation + '\\b\\s+' + '([0-9]+(?:[,.][0-9]+)*\\s*[kKmMbB])', 'i'),
        new RegExp('\\b' + abbreviation.toUpperCase() + '\\b\\s+' + number)
      ];
      for (const pattern of patterns) {
        const match = raw.match(pattern);
        if (match) return parseCompactStatNumber(match[1]);
      }
      return null;
    };
    return normalizeWorkStats({
      man:read('manual\\s+labou?r','man'),
      int:read('intelligence','int'),
      end:read('endurance','end')
    });
  }

  function normalizeAvailability(value) {
    const raw = text(value).toLowerCase().replace(/[_-]+/g, ' ');
    if (!raw) return 'Unknown';
    if (/^(available|immediate|immediately|now|asap|ready|yes)$/.test(raw) || /available\s+(now|immediately|today)/.test(raw)) return 'Available';
    if (/^(unavailable|not available|no|none)$/.test(raw) || /not\s+available/.test(raw)) return 'Unavailable';
    return 'Unknown';
  }

  function normalizeSource(input) {
    const source = input && typeof input === 'object' ? input : {};
    const sourceTypeRaw = text(source.sourceType).toUpperCase();
    const sourceType = SOURCE_TYPES.includes(sourceTypeRaw) ? sourceTypeRaw : 'COMPANY FORUM';
    const parsed = source.parsed && typeof source.parsed === 'object' ? source.parsed : {};
    const postedAt = finite(source.postedAt);
    const userId = finite(source.userId || source.playerId || source.id);
    const threadId = text(source.threadId);
    const postId = text(source.postId);
    return {
      sourceId: text(source.sourceId) || sourceIdFor({ sourceType, threadId, postId, userId }),
      userId: userId == null ? null : Math.trunc(userId),
      sourceType,
      threadId,
      postId,
      postedAt: postedAt == null ? null : postedAt,
      postUrl: text(source.postUrl || source.url || source.forumUrl),
      authorName: text(source.authorName || source.name),
      text: String(source.text ?? source.body ?? ''),
      parsed: {
        desiredCompany: text(parsed.desiredCompany),
        desiredCompanyStars: finite(parsed.desiredCompanyStars),
        desiredRole: text(parsed.desiredRole),
        wantsTrains: parsed.wantsTrains === true,
        trainAmountMin: finite(parsed.trainAmountMin),
        trainAmountMax: finite(parsed.trainAmountMax),
        primaryWorkStat: text(parsed.primaryWorkStat).toUpperCase(),
        availability: normalizeAvailability(parsed.availability),
        workStats: normalizeWorkStats(parsed.workStats)
      },
      importedAt: text(source.importedAt) || new Date().toISOString()
    };
  }

  function sourceIdFor(input) {
    const source = input && typeof input === 'object' ? input : {};
    const sourceType = text(source.sourceType).toUpperCase() || 'SOURCE';
    const threadId = text(source.threadId) || 'thread';
    const postId = text(source.postId) || 'post';
    const userId = text(source.userId || source.playerId || source.id) || 'user';
    return `${sourceType}:${threadId}:${postId}:${userId}`;
  }

  function findCompany(lower) {
    for (const [alias, label] of COMPANY_ALIASES) {
      if (alias.length <= 2) {
        const re = new RegExp(`(?:^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`, 'i');
        if (re.test(lower)) return label;
      } else if (lower.includes(alias)) {
        return label;
      }
    }
    return '';
  }

  function parseTrainRange(lower) {
    const range = lower.match(/\b(\d{1,4})\s*(?:-|to|–|—)\s*(\d{1,4})\s+trains?\b/i);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      return { min: Math.min(a, b), max: Math.max(a, b) };
    }
    const single = lower.match(/\b(?:buy(?:ing)?|purchase|looking\s+to\s+buy|want(?:ing)?|need(?:ing)?)\s+(?:around\s+|about\s+|up\s+to\s+)?(\d{1,4})\s+trains?\b/i)
      || lower.match(/\b(\d{1,4})\s+trains?\b/i);
    if (single) {
      const n = Number(single[1]);
      return { min: n, max: n };
    }
    return { min: null, max: null };
  }

  function parseForumIntent(value) {
    const raw = text(value);
    const lower = raw.toLowerCase();
    const desiredCompany = findCompany(lower);
    let desiredCompanyStars = null;
    const stars = lower.match(/\b(\d{1,2})\s*(?:\*|star(?:s)?)\s*(?=[a-z])/i)
      || lower.match(/\b(\d{1,2})\s*(?:\*|star(?:s)?)\b/i);
    if (stars) desiredCompanyStars = Math.max(0, Math.min(10, Number(stars[1])));

    const trainIntent = /\b(?:buying|buy\s+trains?|looking\s+to\s+buy|want(?:ing)?\s+to\s+buy|need(?:ing)?\s+trains?|train\s+buyer)\b/i.test(lower);
    const range = trainIntent ? parseTrainRange(lower) : { min: null, max: null };

    let primaryWorkStat = '';
    if (/\b(?:intelligence|int)\s+(?:preferred|primary|main|focus)/i.test(lower) || /\b(?:primary|main)\s+(?:stat\s+)?(?:is\s+)?(?:intelligence|int)\b/i.test(lower)) primaryWorkStat = 'INT';
    else if (/\b(?:manual\s+labor|man)\s+(?:preferred|primary|main|focus)/i.test(lower) || /\b(?:primary|main)\s+(?:stat\s+)?(?:is\s+)?(?:manual\s+labor|man)\b/i.test(lower)) primaryWorkStat = 'MAN';
    else if (/\b(?:endurance|end)\s+(?:preferred|primary|main|focus)/i.test(lower) || /\b(?:primary|main)\s+(?:stat\s+)?(?:is\s+)?(?:endurance|end)\b/i.test(lower)) primaryWorkStat = 'END';

    let availability = 'Unknown';
    if (/\b(?:available\s+(?:now|immediately|today)|can\s+start\s+(?:now|immediately|today)|ready\s+now|asap)\b/i.test(lower)) availability = 'Available';
    else if (/\b(?:not\s+available|unavailable|cannot\s+start|can't\s+start)\b/i.test(lower)) availability = 'Unavailable';

    let desiredRole = '';
    const role = raw.match(/\b(?:role|position)\s*[:=-]\s*([^,.;\n]+)/i);
    if (role) desiredRole = text(role[1]);

    return {
      desiredCompany,
      desiredCompanyStars,
      desiredRole,
      wantsTrains: trainIntent,
      trainAmountMin: range.min,
      trainAmountMax: range.max,
      primaryWorkStat,
      availability
    };
  }

  function hasManual(candidate, key) {
    const manual = candidate && candidate.manualFields && typeof candidate.manualFields === 'object' ? candidate.manualFields : {};
    if (!Object.prototype.hasOwnProperty.call(manual, key)) return false;
    const value = manual[key];
    return value !== null && value !== undefined && value !== '';
  }

  function mergeCandidateFromSource(candidateInput, sourceInput) {
    const candidate = candidateInput && typeof candidateInput === 'object' ? { ...candidateInput } : {};
    const source = normalizeSource(sourceInput || {});
    const parsed = source.parsed || {};
    const discoverySources = Array.isArray(candidate.discoverySources) ? [...candidate.discoverySources] : [];
    if (source.sourceType && !discoverySources.includes(source.sourceType)) discoverySources.push(source.sourceType);

    const out = {
      ...candidate,
      userId: candidate.userId || source.userId,
      pipelineStage: normalizeStage(candidate.pipelineStage),
      recruiterNote: text(candidate.recruiterNote),
      expectedSalary: finite(candidate.expectedSalary),
      latestForumSourceId: source.sourceId || candidate.latestForumSourceId || '',
      discoverySources,
      createdAt: text(candidate.createdAt) || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (!hasManual(candidate, 'desiredCompany') && !text(out.desiredCompany) && parsed.desiredCompany) out.desiredCompany = parsed.desiredCompany;
    if (!hasManual(candidate, 'desiredRole') && !text(out.desiredRole) && parsed.desiredRole) out.desiredRole = parsed.desiredRole;
    if (!hasManual(candidate, 'availability')) {
      const current = normalizeAvailability(out.availability);
      if (current === 'Unknown' && parsed.availability && parsed.availability !== 'Unknown') out.availability = parsed.availability;
      else out.availability = current;
    }

    const parsedStats = normalizeWorkStats(parsed.workStats);
    const existingStats = candidate.stats && typeof candidate.stats === 'object' ? {...candidate.stats} : {};
    const mergedStats = {...existingStats};
    for (const key of ['man','int','end']) if (finite(mergedStats[key]) === null && parsedStats[key] !== null) mergedStats[key] = parsedStats[key];
    const known = ['man','int','end'].map(key => finite(mergedStats[key]));
    if (known.every(value => value !== null)) mergedStats.total = known.reduce((sum,value) => sum + value,0);
    else if (finite(existingStats.total) === null) delete mergedStats.total;
    if (Object.keys(mergedStats).length) out.stats = mergedStats;

    out.forumParsed = {
      ...(candidate.forumParsed && typeof candidate.forumParsed === 'object' ? candidate.forumParsed : {}),
      desiredCompany: parsed.desiredCompany || '',
      desiredCompanyStars: parsed.desiredCompanyStars,
      desiredRole: parsed.desiredRole || '',
      wantsTrains: parsed.wantsTrains === true,
      trainAmountMin: parsed.trainAmountMin,
      trainAmountMax: parsed.trainAmountMax,
      primaryWorkStat: parsed.primaryWorkStat || '',
      availability: parsed.availability || 'Unknown',
      workStats: parsedStats
    };
    return out;
  }

  function sanitizeContinuation(value) {
    if (!value) return '';
    try {
      const url = new URL(String(value), 'https://api.torn.com');
      if (url.protocol !== 'https:' || url.hostname !== 'api.torn.com') return '';
      if (!url.pathname.startsWith('/v2/')) return '';
      url.searchParams.delete('key');
      url.searchParams.delete('comment');
      url.hash = '';
      const query = url.searchParams.toString();
      return `${url.origin}${url.pathname}${query ? `?${query}` : ''}`;
    } catch {
      return '';
    }
  }

  function substituteMessage(template, values) {
    const source = values && typeof values === 'object' ? values : {};
    let output = String(template == null ? '' : template);
    for (const key of APPROVED_PLACEHOLDERS) {
      const replacement = source[key] == null ? '' : String(source[key]);
      output = output.replace(new RegExp(`\\{${key}\\}`, 'g'), replacement);
    }
    output = output.replace(/\{[a-z0-9_]+\}/gi, '');
    output = output.replace(/[ \t]+([,.;:!?])/g, '$1');
    output = output.replace(/\(\s*\)/g, '');
    output = output.replace(/[ \t]{2,}/g, ' ');
    output = output.replace(/\n[ \t]+/g, '\n');
    output = output.replace(/\n{3,}/g, '\n\n');
    return output.trim();
  }

  return Object.freeze({
    PIPELINE_STAGES,
    AVAILABILITY_VALUES,
    SOURCE_TYPES,
    APPROVED_PLACEHOLDERS,
    normalizeSource,
    sourceIdFor,
    normalizeStage,
    normalizeAvailability,
    parseForumIntent,
    parseWorkStats,
    mergeCandidateFromSource,
    sanitizeContinuation,
    substituteMessage
  });
});
