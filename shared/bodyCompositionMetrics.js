// Single source of truth for body composition metrics (Xiaomi Mi Body Composition Scale report),
// shared by server/index.js (OCR field mapping + API) and src/main.jsx (charts + detail popup).
// `valueField`/`gradeField` are the body_composition_logs columns holding this metric's data.
export const BODY_COMPOSITION_METRIC_DEFS = [
  { key: 'weight', labelKey: 'bodycomp_weight', unit: 'kg', valueField: 'weight_kg', gradeField: 'weight_grade' },
  { key: 'bmi', labelKey: 'bodycomp_bmi', unit: '', valueField: 'bmi', gradeField: 'bmi_grade' },
  { key: 'body_fat', labelKey: 'bodycomp_body_fat', unit: '%', valueField: 'body_fat_percent', gradeField: 'body_fat_grade' },
  { key: 'muscle_mass', labelKey: 'bodycomp_muscle_mass', unit: 'kg', valueField: 'muscle_mass_kg', gradeField: 'muscle_mass_grade' },
  { key: 'muscle_percent', labelKey: 'bodycomp_muscle_percent', unit: '%', valueField: 'muscle_percent', gradeField: 'muscle_percent_grade' },
  { key: 'body_water_percent', labelKey: 'bodycomp_body_water_percent', unit: '%', valueField: 'body_water_percent', gradeField: 'body_water_percent_grade' },
  { key: 'protein_percent', labelKey: 'bodycomp_protein_percent', unit: '%', valueField: 'protein_percent', gradeField: 'protein_percent_grade' },
  { key: 'bone_mineral_percent', labelKey: 'bodycomp_bone_mineral_percent', unit: '%', valueField: 'bone_mineral_percent', gradeField: 'bone_mineral_percent_grade' },
  { key: 'skeletal_muscle', labelKey: 'bodycomp_skeletal_muscle', unit: 'kg', valueField: 'skeletal_muscle_kg', gradeField: 'skeletal_muscle_grade' },
  { key: 'visceral_fat', labelKey: 'bodycomp_visceral_fat', unit: '', valueField: 'visceral_fat_rating', gradeField: 'visceral_fat_grade' },
  { key: 'bmr', labelKey: 'bodycomp_bmr', unit: 'kcal', valueField: 'bmr_kcal', gradeField: 'bmr_grade' },
  { key: 'waist_hip', labelKey: 'bodycomp_waist_hip', unit: '', valueField: 'waist_hip_ratio', gradeField: 'waist_hip_grade' },
  { key: 'heart_rate', labelKey: 'bodycomp_heart_rate', unit: 'bpm', valueField: 'heart_rate_bpm', gradeField: 'heart_rate_grade' },
  { key: 'body_age', labelKey: 'bodycomp_body_age', unit: '', valueField: 'body_age', gradeField: null },
  { key: 'fat_free_weight', labelKey: 'bodycomp_fat_free_weight', unit: 'kg', valueField: 'fat_free_weight_kg', gradeField: null },
  { key: 'body_water_mass', labelKey: 'bodycomp_body_water_mass', unit: 'kg', valueField: 'body_water_mass_kg', gradeField: null },
  { key: 'fat_mass', labelKey: 'bodycomp_fat_mass', unit: 'kg', valueField: 'fat_mass_kg', gradeField: null },
  { key: 'bone_mineral_mass', labelKey: 'bodycomp_bone_mineral_mass', unit: 'kg', valueField: 'bone_mineral_mass_kg', gradeField: null },
  { key: 'protein_mass', labelKey: 'bodycomp_protein_mass', unit: 'kg', valueField: 'protein_mass_kg', gradeField: null }
];

export const BODY_COMPOSITION_METRIC_KEYS = new Set(BODY_COMPOSITION_METRIC_DEFS.map((def) => def.key));

export function bodyCompositionMetricDef(key) {
  return BODY_COMPOSITION_METRIC_DEFS.find((def) => def.key === key) || null;
}

// Maps a grade label text (as OCR'd from the scale report, e.g. "Standard", "Under", "Very high")
// to a semantic color tier — the report uses different wording per metric ("Standard" vs "Normal"
// vs "Fit" vs "Good" all mean the healthy middle band) but the same 4-tier color scheme throughout.
export function gradeColorTier(grade) {
  const value = String(grade || '').toLowerCase();
  if (!value) return null;
  if (value.includes('under')) return 'under';
  if (value.includes('dangerous') || value.includes('very high')) return 'danger';
  if (value.includes('high') || value.includes('over')) return 'warning';
  if (value.includes('standard') || value.includes('normal') || value.includes('fit') || value.includes('good')) return 'good';
  return null;
}

export const GRADE_TIER_COLORS = {
  under: '#3b82f6',
  good: '#22c55e',
  warning: '#eab308',
  danger: '#f97316'
};
