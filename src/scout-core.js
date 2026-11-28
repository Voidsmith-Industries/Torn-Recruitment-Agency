(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RA_ScoutCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const METRICS = ['xanax', 'activityHours', 'refills', 'attacks', 'rwHits'];

  const DEFAULT_SCORING = Object.freeze({
    targets: Object.freeze({
      xanax: 60,
      activityHours: 120,
      refills: 25,
      attacks: 200,
      rwHits: 40
    }),
    weights: Object.freeze({
      xanax: 20,
      activityHours: 20,
      refills: 20,
      attacks: 20,
      rwHits: 20
    })
  });

  function finiteNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function nonNegative(value) {
    return Math.max(0, finiteNumber(value, 0));
  }

  function round(value, dp = 2) {
    const p = 10 ** dp;
    return Math.round((finiteNumber(value, 0) + Number.EPSILON) * p) / p;
  }

  function normalizeScoring(input = {}) {
    const sourceTargets = input.targets || {};
    const sourceWeights = input.weights || {};
    const targets = {};
    const rawWeights = {};

    for (const key of METRICS) {
      const target = finiteNumber(sourceTargets[key], DEFAULT_SCORING.targets[key]);
      targets[key] = target > 0 ? target : DEFAULT_SCORING.targets[key];
      rawWeights[key] = nonNegative(sourceWeights[key] ?? DEFAULT_SCORING.weights[key]);
    }

    let total = METRICS.reduce((sum, key) => sum + rawWeights[key], 0);
    if (total <= 0) {
      for (const key of METRICS) rawWeights[key] = DEFAULT_SCORING.weights[key];
      total = 100;
    }

    const weights = {};
    let allocated = 0;
    METRICS.forEach((key, index) => {
      if (index === METRICS.length - 1) {
        weights[key] = round(100 - allocated, 10);
      } else {
        weights[key] = round((rawWeights[key] / total) * 100, 10);
        allocated += weights[key];
      }
    });

    return { targets, weights };
  }

  function metricScore(actual, target, weight) {
    const a = nonNegative(actual);
    const t = finiteNumber(target, 0);
    const w = nonNegative(weight);
    if (t <= 0 || w <= 0) return 0;
    return round(Math.min(a / t, 1) * w, 2);
  }

  function scoreFit(metrics = {}, scoring = DEFAULT_SCORING) {
    const cfg = normalizeScoring(scoring);
    const components = {};
    let score = 0;

    for (const key of METRICS) {
      components[key] = metricScore(metrics[key], cfg.targets[key], cfg.weights[key]);
      score += components[key];
    }

    return {
      score: round(Math.min(100, Math.max(0, score)), 2),
      components,
      scoring: cfg
    };
  }

  function computeTrend(window7 = {}, window30 = {}, scoring = DEFAULT_SCORING) {
    const cfg = normalizeScoring(scoring);
    const components = {};
    let weighted = 0;
    let validWeight = 0;

    for (const key of METRICS) {
      if (!known(window7[key]) || !known(window30[key])) continue;
      const recent = nonNegative(window7[key]) / 7;
      const baseline = nonNegative(window30[key]) / 30;
      if (baseline <= 0) continue;

      const pct = ((recent / baseline) - 1) * 100;
      components[key] = pct;
      weighted += pct * cfg.weights[key];
      validWeight += cfg.weights[key];
    }

    return {
      percent: validWeight > 0 ? round(weighted / validWeight, 2) : null,
      components,
      validWeight: round(validWeight, 10)
    };
  }

  function known(value) {
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  }

  // Torn v2 nested personalstats category paths -> the flat stat names used by `stat=` requests.
  const NESTED_STATS = [
    ['xantaken', 'drugs', 'xanax'], ['timeplayed', 'other', 'activity', 'time'],
    ['activestreak', 'other', 'activity', 'streak', 'current'], ['bestactivestreak', 'other', 'activity', 'streak', 'best'],
    ['refills', 'other', 'refills', 'energy'], ['networth', 'networth', 'total'],
    ['attackswon', 'attacking', 'attacks', 'won'], ['attackslost', 'attacking', 'attacks', 'lost'],
    ['rankedwarhits', 'attacking', 'faction', 'ranked_war_hits'], ['statenhancersused', 'items', 'used', 'stat_enhancers']
  ];

  // Flattens a Torn personalstats payload. v2 `stat=` responses are [{name,value,timestamp}]; category responses are nested.
  // Stats Torn did not return are simply absent (never 0).
  function extractPersonalStats(data) {
    const p = data && (data.personalstats || data.personal_stats || data.personalStats);
    const out = {};
    if (!p || typeof p !== 'object') return out;
    if (Array.isArray(p)) {
      for (const row of p) if (row && row.name && known(row.value)) out[String(row.name)] = Number(row.value);
      return out;
    }
    for (const [name, ...path] of NESTED_STATS) {
      let value = p;
      for (const part of path) value = value && typeof value === 'object' ? value[part] : undefined;
      if (known(value)) out[name] = Number(value);
    }
    for (const [name, value] of Object.entries(p)) if (!(name in out) && (typeof value === 'number' || typeof value === 'string') && known(value)) out[name] = Number(value);
    return out;
  }

  const ZERO = Object.freeze({});

  function statValue(stats, key) {
    if (stats === ZERO) return 0;
    const value = stats && (key === 'timeplayed' && !known(stats.timeplayed) ? stats.useractivity : stats[key]);
    return known(value) ? Number(value) : null;
  }

  function rawDelta(current, past, key) {
    const a = statValue(current, key);
    const b = statValue(past, key);
    if (a === null || b === null) return null;
    return Math.max(0, a - b);
  }

  function sumKnown(a, b) {
    return a === null || b === null ? null : a + b;
  }

  function currentValue(current, key) {
    const value = statValue(current, key);
    return value === null ? null : Math.max(0, value);
  }

  function deltaStats(current = {}, past = {}) {
    const activity = rawDelta(current, past, 'timeplayed');
    return {
      xanax: rawDelta(current, past, 'xantaken'),
      activityHours: activity === null ? null : round(activity / 3600, 4),
      refills: rawDelta(current, past, 'refills'),
      attacks: sumKnown(rawDelta(current, past, 'attackswon'), rawDelta(current, past, 'attackslost')),
      rwHits: rawDelta(current, past, 'rankedwarhits'),
      statEnhancers: rawDelta(current, past, 'statenhancersused'),
      networth: currentValue(current, 'networth'),
      activeStreak: currentValue(current, 'activestreak'),
      bestActiveStreak: currentValue(current, 'bestactivestreak')
    };
  }

  function metricsFromTotals(current = {}) {
    return deltaStats(current, ZERO);
  }

  // True only when every Fit metric is a measured number; unknown inputs never produce a score.
  function metricsComplete(metrics) {
    return !!metrics && METRICS.every((key) => known(metrics[key]));
  }

  function projectWindow(metrics = {}, days, targetDays = 30) {
    const sourceDays = finiteNumber(days, 0);
    const destDays = finiteNumber(targetDays, 30);
    if (sourceDays <= 0 || destDays <= 0) return null;
    const factor = destDays / sourceDays;
    const out = {};

    const scaled = (value) => (known(value) ? round(nonNegative(value) * factor, 4) : null);
    const kept = (value) => (known(value) ? nonNegative(value) : null);
    for (const key of METRICS) out[key] = scaled(metrics[key]);
    out.statEnhancers = scaled(metrics.statEnhancers);
    out.networth = kept(metrics.networth);
    out.activeStreak = kept(metrics.activeStreak);
    out.bestActiveStreak = kept(metrics.bestActiveStreak);
    return out;
  }

  function provisionalConfidence(days) {
    const d = Math.max(0, finiteNumber(days, 0));
    if (d >= 30) return 'Official';
    if (d >= 21) return 'High';
    if (d >= 14) return 'Medium';
    if (d >= 7) return 'Low';
    return 'Very Low';
  }

  function provisionalFit(metrics = {}, days, scoring = DEFAULT_SCORING) {
    const d = Math.max(0, finiteNumber(days, 0));
    const projected = projectWindow(metrics, d, 30);
    if (!projected || d <= 0) {
      return { score: null, components: {}, projected: null, days: d, confidence: provisionalConfidence(d) };
    }
    const fit = scoreFit(projected, scoring);
    return {
      score: fit.score,
      components: fit.components,
      projected,
      days: d,
      confidence: provisionalConfidence(d),
      scoring: fit.scoring
    };
  }

  function parseIds(text, max = 20) {
    const limit = Math.max(1, Math.floor(finiteNumber(max, 20)));
    const seen = new Set();
    const out = [];
    const parts = String(text || '').split(/[^0-9]+/);
    for (const part of parts) {
      const id = Number.parseInt(part, 10);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= limit) break;
    }
    return out;
  }

  function signature(stats = {}) {
    return [
      'xantaken',
      'timeplayed',
      'refills',
      'statenhancersused',
      'attackswon',
      'attackslost',
      'rankedwarhits',
      'networth',
      'activestreak',
      'bestactivestreak'
    ].map((key) => String(statValue(stats, key) ?? '')).join('|');
  }

  return {
    METRICS: METRICS.slice(),
    DEFAULT_SCORING,
    normalizeScoring,
    metricScore,
    scoreFit,
    computeTrend,
    extractPersonalStats,
    deltaStats,
    metricsFromTotals,
    metricsComplete,
    projectWindow,
    provisionalFit,
    provisionalConfidence,
    parseIds,
    signature
  };
});
