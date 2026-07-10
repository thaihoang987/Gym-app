import tesseract from 'node-tesseract-ocr';

// Xiaomi Mi Body Composition Scale screenshots use a comma as the decimal separator
// ("64,2", "-2,6") because the phone's locale is Vietnamese — parseFloat alone would
// truncate at the comma, so normalize to a dot first.
function parseLocaleNumber(text) {
  if (text === undefined || text === null) return null;
  const cleaned = String(text).replace(/,/g, '.').replace(/[^\d.+-]/g, '');
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

// Grabs the first number (with optional unit) that appears after `label` in the OCR'd text,
// searching within the next `window` characters so it binds to the right value even when
// OCR merges multiple report cards onto adjacent lines.
function numberAfterLabel(text, label, { window = 60, signed = false } = {}) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}[^0-9+-]{0,10}([+-]?[0-9]+[.,]?[0-9]*)`, 'i');
  const idx = text.search(new RegExp(escaped, 'i'));
  if (idx === -1) return null;
  const slice = text.slice(idx, idx + window);
  const match = slice.match(pattern);
  if (!match) return null;
  const value = parseLocaleNumber(match[1]);
  return signed ? value : (value === null ? null : Math.abs(value));
}

function gradeAfterLabel(text, label, grades, { window = 80 } = {}) {
  const idx = text.search(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  if (idx === -1) return null;
  const slice = text.slice(idx, idx + window);
  for (const grade of grades) {
    if (new RegExp(`\\b${grade}\\b`, 'i').test(slice)) return grade;
  }
  return null;
}

const GRADE_WORDS = ['Standard', 'Under', 'Over', 'High', 'Normal', 'Good', 'Fit', 'Very high', 'Dangerous'];

// Field extraction rules: each entry maps a body_composition_logs column to the label text
// that precedes its value in the Xiaomi report, run against the full OCR'd page text.
// This label-anchored regex approach tolerates OCR noise/line-merging better than fixed
// pixel-region cropping, since it doesn't depend on exact coordinates staying calibrated.
const FIELD_RULES = [
  { field: 'weight_kg', label: 'Standard' /* weight sits right above this on the report */, custom: (text) => numberAfterLabel(text, 'kg', { window: 20 }) },
  { field: 'body_score', label: 'Body score', extractor: (text) => numberAfterLabel(text, 'points', { window: 20 }) },
  { field: 'bmi', label: 'BMI', extractor: (text) => numberAfterLabel(text, 'BMI') },
  { field: 'bmi_grade', label: 'BMI', gradeExtractor: (text) => gradeAfterLabel(text, 'BMI', GRADE_WORDS) },
  { field: 'body_fat_percent', label: 'Body fat percentage', extractor: (text) => numberAfterLabel(text, 'Body fat percentage') },
  { field: 'body_fat_grade', label: 'Body fat percentage', gradeExtractor: (text) => gradeAfterLabel(text, 'Body fat percentage', GRADE_WORDS) },
  { field: 'body_water_mass_kg', label: 'Body water mass', extractor: (text) => numberAfterLabel(text, 'Body water mass') },
  { field: 'fat_mass_kg', label: 'Fat mass', extractor: (text) => numberAfterLabel(text, 'Fat mass') },
  { field: 'bone_mineral_mass_kg', label: 'Bone mineral mass', extractor: (text) => numberAfterLabel(text, 'Bone mineral mass') },
  { field: 'protein_mass_kg', label: 'Protein mass', extractor: (text) => numberAfterLabel(text, 'Protein mass') },
  { field: 'muscle_mass_kg', label: 'Muscle mass', extractor: (text) => numberAfterLabel(text, 'Muscle mass') },
  { field: 'muscle_mass_grade', label: 'Muscle mass', gradeExtractor: (text) => gradeAfterLabel(text, 'Muscle mass', GRADE_WORDS) },
  { field: 'muscle_percent', label: 'Muscle percentage', extractor: (text) => numberAfterLabel(text, 'Muscle percentage') },
  { field: 'muscle_percent_grade', label: 'Muscle percentage', gradeExtractor: (text) => gradeAfterLabel(text, 'Muscle percentage', GRADE_WORDS) },
  { field: 'body_water_percent', label: 'Body water', extractor: (text) => numberAfterLabel(text, 'Body water') },
  { field: 'body_water_percent_grade', label: 'Body water', gradeExtractor: (text) => gradeAfterLabel(text, 'Body water', GRADE_WORDS) },
  { field: 'protein_percent', label: 'Protein percentage', extractor: (text) => numberAfterLabel(text, 'Protein percentage') },
  { field: 'protein_percent_grade', label: 'Protein percentage', gradeExtractor: (text) => gradeAfterLabel(text, 'Protein percentage', GRADE_WORDS) },
  { field: 'bone_mineral_percent', label: 'Bone mineral percentage', extractor: (text) => numberAfterLabel(text, 'Bone mineral percentage') },
  { field: 'bone_mineral_percent_grade', label: 'Bone mineral percentage', gradeExtractor: (text) => gradeAfterLabel(text, 'Bone mineral percentage', GRADE_WORDS) },
  { field: 'skeletal_muscle_kg', label: 'Skeletal muscle mass', extractor: (text) => numberAfterLabel(text, 'Skeletal muscle mass') },
  { field: 'skeletal_muscle_grade', label: 'Skeletal muscle mass', gradeExtractor: (text) => gradeAfterLabel(text, 'Skeletal muscle mass', GRADE_WORDS) },
  { field: 'visceral_fat_rating', label: 'Visceral fat rating', extractor: (text) => numberAfterLabel(text, 'Visceral fat rating') },
  { field: 'visceral_fat_grade', label: 'Visceral fat rating', gradeExtractor: (text) => gradeAfterLabel(text, 'Visceral fat rating', GRADE_WORDS) },
  { field: 'bmr_kcal', label: 'Basal metabolic rate', extractor: (text) => numberAfterLabel(text, 'Basal metabolic rate') },
  { field: 'bmr_grade', label: 'Basal metabolic rate', gradeExtractor: (text) => gradeAfterLabel(text, 'Basal metabolic rate', GRADE_WORDS) },
  { field: 'waist_hip_ratio', label: 'waist-to-hip ratio', extractor: (text) => numberAfterLabel(text, 'waist-to-hip ratio') },
  { field: 'waist_hip_grade', label: 'waist-to-hip ratio', gradeExtractor: (text) => gradeAfterLabel(text, 'waist-to-hip ratio', GRADE_WORDS) },
  { field: 'body_age', label: 'Body age', extractor: (text) => numberAfterLabel(text, 'years old') },
  { field: 'fat_free_weight_kg', label: 'Fat-free body weight', extractor: (text) => numberAfterLabel(text, 'Fat-free body weight') },
  { field: 'heart_rate_bpm', label: 'Heart rate', extractor: (text) => numberAfterLabel(text, 'Heart rate') },
  { field: 'heart_rate_grade', label: 'Heart rate', gradeExtractor: (text) => gradeAfterLabel(text, 'Heart rate', GRADE_WORDS) },
  { field: 'standard_weight_kg', label: 'Standard weight', extractor: (text) => numberAfterLabel(text, 'Standard weight') },
  { field: 'weight_control_kg', label: 'Weight control', extractor: (text) => numberAfterLabel(text, 'Weight control', { signed: true }) },
  { field: 'fat_control_kg', label: 'Fat control', extractor: (text) => numberAfterLabel(text, 'Fat control', { signed: true }) }
];

const BODY_TYPE_ZONES = ['Athletic', 'Overweight', 'Obese', 'Muscular', 'Fit', 'Slim & muscular', 'Slim', 'Invisibly obese', 'Lean', 'Underweight'];

export async function ocrBodyCompositionImage(imagePath) {
  const text = await tesseract.recognize(imagePath, { lang: 'eng', oem: 1, psm: 3 });
  const result = {};
  for (const rule of FIELD_RULES) {
    if (rule.gradeExtractor) {
      result[rule.field] = rule.gradeExtractor(text);
    } else if (rule.extractor) {
      result[rule.field] = rule.extractor(text);
    } else if (rule.custom) {
      result[rule.field] = rule.custom(text);
    }
  }
  // Weight itself is the large number at the top of the report, printed with no nearby label
  // text in the same OCR line — pull the first standalone decimal number instead.
  const weightMatch = text.match(/(\d{2,3}[.,]\d)\s*kg/i);
  result.weight_kg = weightMatch ? parseLocaleNumber(weightMatch[1]) : null;
  const weightGradeMatch = text.match(/(Standard|Under|Over|High)\s*\|/i);
  result.weight_grade = weightGradeMatch ? weightGradeMatch[1] : null;
  result.body_type_zone = BODY_TYPE_ZONES.find((zone) => new RegExp(`\\b${zone.replace(/[&]/g, '\\&')}\\b`, 'i').test(text)) || null;
  result.muscle_control_text = /keep weight/i.test(text) ? 'keep weight' : null;
  return { fields: result, rawText: text };
}
