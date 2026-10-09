(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RA_MatchCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CRITERIA_KEYS = Object.freeze([
    'man', 'int', 'end', 'ee', 'fit', 'activity30', 'xanax30', 'refills30', 'attacks30', 'rwHits30',
    'company', 'role', 'salary', 'availability'
  ]);

  const AVAILABILITY_VALUES = Object.freeze(['immediate', 'soon', 'flexible', 'not_available']);

  const DEFAULT_CRITERIA = Object.freeze({
    man: { enabled: false, target: 0, weight: 10 },
    int: { enabled: false, target: 0, weight: 10 },
    end: { enabled: false, target: 0, weight: 10 },
    ee: { enabled: true, target: 7, weight: 15 },
    fit: { enabled: true, target: 70, weight: 20 },
    activity30: { enabled: true, target: 120, weight: 20 },
    xanax30: { enabled: false, target: 60, weight: 10 },
    refills30: { enabled: false, target: 25, weight: 10 },
    attacks30: { enabled: false, target: 200, weight: 10 },
    rwHits30: { enabled: false, target: 40, weight: 10 },
    company: { enabled: false, value: '', weight: 15 },
    role: { enabled: false, value: '', weight: 15 },
    salary: { enabled: false, max: 0, weight: 15 },
    availability: { enabled: false, value: '', weight: 10 }
  });

  const CRITERIA_LABELS = Object.freeze({
    man: 'Manual Labor',
    int: 'Intelligence',
    end: 'Endurance',
    ee: 'EE',
    fit: 'Fit',
    activity30: 'Activity 30d',
    xanax30: 'Xanax 30d',
    refills30: 'Refills 30d',
    attacks30: 'Attacks 30d',
    rwHits30: 'RW Hits 30d',
    company: 'Company',
    role: 'Role',
    salary: 'Salary',
    availability: 'Availability'
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function finitePositiveOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function cleanText(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }

  function normalizeRole(value) {
    return cleanText(value).toLowerCase();
  }

  function normalizeCompany(value) {
    return cleanText(value)
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function normalizeAvailability(value) {
    const raw = cleanText(value).toLowerCase().replace(/\s+/g, '_');
    const aliases = {
      now: 'immediate',
      available_now: 'immediate',
      asap: 'immediate',
      later: 'soon',
      negotiable: 'flexible'
    };
    const normalized = aliases[raw] || raw;
    return AVAILABILITY_VALUES.includes(normalized) ? normalized : '';
  }

  function scoreNumeric(actual, target, weight) {
    const a = finitePositiveOrNull(actual);
    const t = finitePositiveOrNull(target);
    const w = finitePositiveOrNull(weight) || 0;
    if (a === null || t === null || t <= 0 || w <= 0) {
      return { known: false, earned: 0, available: 0, ratio: null };
    }
    const ratio = Math.min(a / t, 1);
    return { known: true, earned: ratio * w, available: w, ratio };
  }

  function scoreSalary(expectedSalary, maxBudget, weight) {
    const salary = finitePositiveOrNull(expectedSalary);
    const budget = finitePositiveOrNull(maxBudget);
    const w = finitePositiveOrNull(weight) || 0;
    if (salary === null || budget === null || budget <= 0 || w <= 0) {
      return { known: false, earned: 0, available: 0, ratio: null };
    }
    const ratio = salary <= 0 ? 1 : Math.min(budget / salary, 1);
    return { known: true, earned: ratio * w, available: w, ratio };
  }

  function scoreCategorical(actual, expected, weight, normalizer) {
    const normalize = typeof normalizer === 'function' ? normalizer : normalizeRole;
    const a = normalize(actual);
    const e = normalize(expected);
    const w = finitePositiveOrNull(weight) || 0;
    if (!a || !e || w <= 0) {
      return { known: false, earned: 0, available: 0, ratio: null };
    }
    const ratio = a === e ? 1 : 0;
    return { known: true, earned: ratio * w, available: w, ratio };
  }

  function hasManualValue(source, key) {
    if (!source || !Object.prototype.hasOwnProperty.call(source, key)) return false;
    const value = source[key];
    return value !== null && value !== undefined && value !== '';
  }

  function mergeCandidateValues(input) {
    const manual = input && input.manual && typeof input.manual === 'object' ? input.manual : {};
    const parsed = input && input.parsed && typeof input.parsed === 'object' ? input.parsed : {};
    const pick = (key) => hasManualValue(manual, key) ? manual[key] : parsed[key];
    const salary = finitePositiveOrNull(pick('expectedSalary'));
    return {
      desiredCompany: cleanText(pick('desiredCompany')),
      desiredRole: cleanText(pick('desiredRole')),
      expectedSalary: salary,
      availability: normalizeAvailability(pick('availability')),
      recruiterNote: cleanText(pick('recruiterNote'))
    };
  }

  function normalizeCandidate(input) {
    const source = input && typeof input === 'object' ? input : {};
    const hasManualObject = !!(source.manualFields && typeof source.manualFields === 'object' && !Array.isArray(source.manualFields));
    const manual = hasManualObject ? clone(source.manualFields) : {
      desiredCompany: source.desiredCompany,
      desiredRole: source.desiredRole,
      expectedSalary: source.expectedSalary,
      availability: source.availability
    };
    const parsed = source.parsed && typeof source.parsed === 'object' ? source.parsed : (hasManualObject ? {
      desiredCompany: source.desiredCompany,
      desiredRole: source.desiredRole,
      expectedSalary: source.expectedSalary,
      availability: source.availability
    } : {});
    const merged = mergeCandidateValues({ manual, parsed });
    return {
      userId: cleanText(source.userId || source.id || source.playerId),
      desiredCompany: merged.desiredCompany,
      desiredRole: merged.desiredRole,
      expectedSalary: merged.expectedSalary,
      availability: merged.availability,
      recruiterNote: cleanText(source.recruiterNote || merged.recruiterNote),
      manualFields: {
        desiredCompany: cleanText(manual.desiredCompany),
        desiredRole: cleanText(manual.desiredRole),
        expectedSalary: finitePositiveOrNull(manual.expectedSalary),
        availability: normalizeAvailability(manual.availability)
      },
      createdAt: cleanText(source.createdAt),
      updatedAt: cleanText(source.updatedAt)
    };
  }

  function normalizeCriterion(key, input, disableWhenMissing) {
    const base = clone(DEFAULT_CRITERIA[key]);
    const source = input && typeof input === 'object' ? input : {};
    if (disableWhenMissing && !input) base.enabled = false;
    base.enabled = source.enabled === undefined ? base.enabled : !!source.enabled;
    base.weight = finitePositiveOrNull(source.weight) ?? base.weight;
    if (Object.prototype.hasOwnProperty.call(base, 'target')) {
      base.target = finitePositiveOrNull(source.target) ?? base.target;
    }
    if (Object.prototype.hasOwnProperty.call(base, 'max')) {
      base.max = finitePositiveOrNull(source.max) ?? base.max;
    }
    if (Object.prototype.hasOwnProperty.call(base, 'value')) {
      const rawValue = source.value === undefined ? base.value : source.value;
      if (key === 'availability') base.value = normalizeAvailability(rawValue);
      else base.value = cleanText(rawValue);
    }
    return base;
  }

  const COMPANY_SEARCH_FILTER_KEYS = Object.freeze(['search','minEnd','minMan','minInt','onlineStatus','organization','organizationPresence']);

  function normalizeCompanySearchFilters(input) {
    const source=input&&typeof input==='object'?input:{};
    const out={};
    for(const key of COMPANY_SEARCH_FILTER_KEYS)out[key]=cleanText(source[key]);
    const presence=cleanText(out.organizationPresence).toLowerCase();
    out.organizationPresence=['any','none','has'].includes(presence)?presence:'any';
    const status=cleanText(out.onlineStatus);
    out.onlineStatus=['Online','Idle','Offline'].includes(status)?status:'';
    return out;
  }

  function normalizeProfile(input) {
    const source = input && typeof input === 'object' ? input : {};
    const hasCriteria = !!(source.criteria && typeof source.criteria === 'object');
    const criteriaSource = hasCriteria ? source.criteria : {};
    const criteria = {};
    CRITERIA_KEYS.forEach((key) => {
      criteria[key] = normalizeCriterion(key, criteriaSource[key], hasCriteria);
    });
    const searchSource=source.searchFilters&&typeof source.searchFilters==='object'?source.searchFilters:{};
    return {
      profileId: cleanText(source.profileId) || `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: cleanText(source.name) || 'Smart Match',
      criteria,
      searchFilters:{company:normalizeCompanySearchFilters(searchSource.company)},
      createdAt: cleanText(source.createdAt),
      updatedAt: cleanText(source.updatedAt)
    };
  }

  function createDefaultProfile(name) {
    return normalizeProfile({ name: cleanText(name) || 'Smart Match' });
  }

  function roundOne(value) {
    return Math.round((Number(value) + Number.EPSILON) * 10) / 10;
  }

  function evaluateMatch(input) {
    const source = input && typeof input === 'object' ? input : {};
    const row = source.row && typeof source.row === 'object' ? source.row : {};
    const candidate = source.candidate && typeof source.candidate === 'object' ? source.candidate : {};
    const profile = normalizeProfile(source.profile || {});
    const values = {
      man: row.stats && row.stats.man !== undefined ? row.stats.man : row.man,
      int: row.stats && row.stats.int !== undefined ? row.stats.int : row.int,
      end: row.stats && row.stats.end !== undefined ? row.stats.end : row.end,
      ee: row.ee,
      fit: row.matchInputs && row.matchInputs.fit !== undefined ? row.matchInputs.fit : row.fit,
      activity30: row.matchInputs && row.matchInputs.activity30 !== undefined ? row.matchInputs.activity30 : row.activity30,
      xanax30: row.matchInputs && row.matchInputs.xanax30 !== undefined ? row.matchInputs.xanax30 : row.xanax30,
      refills30: row.matchInputs && row.matchInputs.refills30 !== undefined ? row.matchInputs.refills30 : row.refills30,
      attacks30: row.matchInputs && row.matchInputs.attacks30 !== undefined ? row.matchInputs.attacks30 : row.attacks30,
      rwHits30: row.matchInputs && row.matchInputs.rwHits30 !== undefined ? row.matchInputs.rwHits30 : row.rwHits30,
      company: candidate.desiredCompany || row.preferredCompany,
      role: candidate.desiredRole,
      salary: candidate.expectedSalary,
      availability: candidate.availability
    };

    const breakdown = {};
    let earnedWeight = 0;
    let availableWeight = 0;
    let knownCriteria = 0;
    let enabledCriteria = 0;

    CRITERIA_KEYS.forEach((key) => {
      const criterion = profile.criteria[key];
      if (!criterion || !criterion.enabled) return;
      enabledCriteria += 1;
      let score;
      if (key === 'salary') {
        score = scoreSalary(values[key], criterion.max, criterion.weight);
      } else if (key === 'company') {
        score = scoreCategorical(values[key], criterion.value, criterion.weight, normalizeCompany);
      } else if (key === 'role') {
        score = scoreCategorical(values[key], criterion.value, criterion.weight, normalizeRole);
      } else if (key === 'availability') {
        score = scoreCategorical(values[key], criterion.value, criterion.weight, normalizeAvailability);
      } else {
        score = scoreNumeric(values[key], criterion.target, criterion.weight);
      }
      breakdown[key] = Object.assign({ label: CRITERIA_LABELS[key] }, score);
      if (!score.known) return;
      knownCriteria += 1;
      earnedWeight += score.earned;
      availableWeight += score.available;
    });

    return {
      score: availableWeight > 0 ? roundOne((earnedWeight / availableWeight) * 100) : null,
      earnedWeight: roundOne(earnedWeight),
      availableWeight: roundOne(availableWeight),
      knownCriteria,
      enabledCriteria,
      completeness: enabledCriteria > 0 ? roundOne(knownCriteria / enabledCriteria) : null,
      breakdown
    };
  }

  return Object.freeze({
    CRITERIA_KEYS,
    AVAILABILITY_VALUES,
    createDefaultProfile,
    normalizeProfile,
    normalizeCompanySearchFilters,
    normalizeCandidate,
    normalizeRole,
    normalizeCompany,
    normalizeAvailability,
    scoreNumeric,
    scoreSalary,
    scoreCategorical,
    evaluateMatch,
    mergeCandidateValues
  });
});
