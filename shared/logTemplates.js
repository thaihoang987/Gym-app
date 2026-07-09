// Single source of truth for workout log templates, shared by server/index.js and src/main.jsx.
// `primaryChain` lists, in priority order, which PR "kind" represents this template's headline
// metric — used both to pick the historical PR badge (server) and to score a live set against it (client).
// `defaults` must list ONLY keys that have a real primary input control (see templatePrimaryColumns
// in src/main.jsx) — anything else is secondary/optional data the user opts into via "Add metric",
// never a template default. Listing a key here that has no primary input creates a chip the user
// can't remove and can't fill in, which blurs the primary/secondary boundary the app is built on.
export const TEMPLATE_DEFS = {
  strength: { labelKey: 'template_strength', defaults: [], hasWeight: true, hasReps: true, primaryChain: ['oneRm', 'weight', 'volume'] },
  bodyweight: { labelKey: 'template_bodyweight', defaults: [], hasWeight: false, hasReps: true, primaryChain: ['reps'] },
  timed: { labelKey: 'template_timed', defaults: ['duration_seconds'], hasWeight: false, hasReps: false, primaryChain: ['duration'] },
  distance: { labelKey: 'template_distance', defaults: ['distance', 'duration_seconds'], hasWeight: false, hasReps: false, primaryChain: ['distance', 'pace'] },
  carry: { labelKey: 'template_carry', defaults: ['distance'], hasWeight: true, hasReps: false, primaryChain: ['weight', 'distance'] },
  mobility: { labelKey: 'template_mobility', defaults: ['duration_seconds', 'side'], hasWeight: false, hasReps: false, primaryChain: ['duration'] },
  custom: { labelKey: 'template_custom', defaults: [], hasWeight: true, hasReps: true, primaryChain: ['oneRm', 'weight', 'volume'] },
  // Running tracks two separate PRs: longest distance ever (primaryChain, shown as the header badge)
  // and best pace at the same distance (see distanceBucket + paceByDistance in buildPrStats), which is
  // scored per-set rather than as a single global "primary" value. Pace itself is derived/optional,
  // not a primary input, so it's not listed in defaults (add it via "Add metric" if wanted standalone).
  running: { labelKey: 'template_running', defaults: ['distance', 'duration_seconds'], hasWeight: false, hasReps: false, primaryChain: ['distance'] },
  stairclimber: { labelKey: 'template_stairclimber', defaults: ['duration_seconds', 'steps'], hasWeight: false, hasReps: false, primaryChain: ['duration', 'metrics:floors'] },
  cycling: { labelKey: 'template_cycling', defaults: ['distance', 'duration_seconds'], hasWeight: false, hasReps: false, primaryChain: ['distance', 'pace'] },
  elliptical: { labelKey: 'template_elliptical', defaults: ['duration_seconds', 'distance'], hasWeight: false, hasReps: false, primaryChain: ['duration', 'distance'] },
  rowing: { labelKey: 'template_rowing', defaults: ['distance', 'duration_seconds'], hasWeight: false, hasReps: false, primaryChain: ['distance', 'pace'] }
};

export const TEMPLATE_IDS = Object.keys(TEMPLATE_DEFS);
export const LOG_TEMPLATES = new Set(TEMPLATE_IDS);

export function normalizeLogTemplate(value, fallback = 'strength') {
  const template = String(value || fallback || 'strength').toLowerCase();
  return TEMPLATE_DEFS[template] ? template : 'strength';
}

export function templateHasWeight(template) {
  return Boolean(TEMPLATE_DEFS[normalizeLogTemplate(template)].hasWeight);
}

export function templateHasReps(template) {
  return Boolean(TEMPLATE_DEFS[normalizeLogTemplate(template)].hasReps);
}

export function templateDefaultMetrics(template) {
  return TEMPLATE_DEFS[normalizeLogTemplate(template)].defaults || [];
}

export function templatePrimaryChain(template) {
  return TEMPLATE_DEFS[normalizeLogTemplate(template)].primaryChain || ['oneRm', 'weight', 'volume'];
}

// Buckets a distance (km) to the nearest 0.25 so runs of near-identical length (e.g. 5.02km vs 4.98km)
// are compared against each other for a pace PR, without requiring the exact same distance every time.
export function distanceBucket(distance) {
  const value = Number(distance || 0);
  if (!(value > 0)) return null;
  return Number((Math.round(value / 0.25) * 0.25).toFixed(2));
}
