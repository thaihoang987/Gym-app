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

function escapeRegex(label) {
  return label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Every extraction below runs through a single forward-moving cursor over the OCR'd text,
// processing fields in the same top-to-bottom order they appear on the report. Each call
// only searches from where the previous field's match ended, so a metric can never grab a
// number or grade word that actually belongs to an earlier metric — the classic failure mode
// when searching the whole page text with a fixed lookback/lookahead window per field.
class Cursor {
  constructor(text) {
    this.text = text;
    this.pos = 0;
  }

  // Finds `label` at or after the cursor, then captures the value+label span so number/grade
  // extraction only looks inside it — the value sits directly above/before the label
  // ("22.7 ↓0.3\nBMI"), optionally followed on the same line by a delta then the grade word.
  // `hasGrade: false` must be set for metrics the report shows with no grade badge at all
  // (composition-mass items, body age, fat-free weight) — otherwise the lookahead window
  // matches the NEXT metric's grade word instead and the cursor jumps past that metric
  // entirely, shifting every field extracted after it by one position.
  metric(label, { window = 60, hasGrade = true } = {}) {
    const idx = this.text.slice(this.pos).search(new RegExp(escapeRegex(label), 'i'));
    if (idx === -1) return { value: null, grade: null };
    const labelStart = this.pos + idx;
    const beforeStart = this.pos;
    const before = this.text.slice(beforeStart, labelStart);
    this.pos = labelStart + label.length;

    // The value is the FIRST number in `before` (closest to the previous field, furthest from
    // this label) — a delta figure, if present, comes after it and closer to the label.
    const numberMatches = [...before.matchAll(/([+-]?[0-9]+[.,][0-9]+|[+-]?[0-9]+)/g)];
    const value = numberMatches.length ? parseLocaleNumber(numberMatches[0][1]) : null;

    if (!hasGrade) return { value, grade: null };
    const after = this.text.slice(labelStart, labelStart + label.length + window);
    const gradeMatch = after.match(new RegExp(`\\b(${GRADE_WORDS.join('|')})\\b`, 'i'));
    const grade = gradeMatch ? gradeMatch[1] : null;
    if (gradeMatch) this.pos = labelStart + gradeMatch.index + gradeMatch[0].length;
    return { value, grade };
  }

  advanceTo(label) {
    const idx = this.text.slice(this.pos).search(new RegExp(escapeRegex(label), 'i'));
    if (idx !== -1) this.pos = this.pos + idx + label.length;
  }
}

// Longer/more specific grade words must be checked before short ones that are their
// substring ("Very high" before "High") to avoid a short match masking the real word.
const GRADE_WORDS = ['Very high', 'Dangerous', 'Standard', 'Under', 'Over', 'High', 'Normal', 'Good', 'Fit'];

// The "Weight suggestions" section uses an inline "Label: Value" layout instead of the
// stacked value-then-label layout used everywhere else on the report.
function numberAfterLabel(text, label, { window = 20, signed = false } = {}) {
  const idx = text.search(new RegExp(escapeRegex(label), 'i'));
  if (idx === -1) return null;
  const slice = text.slice(idx, idx + label.length + window);
  const match = slice.match(/([+-]?[0-9]+[.,][0-9]+|[+-]?[0-9]+)/);
  if (!match) return null;
  const value = parseLocaleNumber(match[1]);
  return signed ? value : (value === null ? null : Math.abs(value));
}

const BODY_TYPE_ZONES = ['Athletic', 'Overweight', 'Obese', 'Muscular', 'Fit', 'Slim & muscular', 'Slim', 'Invisibly obese', 'Lean', 'Underweight'];

export function parseBodyCompositionText(text) {
  const result = {};
  const cursor = new Cursor(text);

  // Weight is the large standalone number at the very top of the report, before "Body score".
  const bodyScoreIdx = text.search(/Body score/i);
  const headerSlice = bodyScoreIdx === -1 ? text.slice(0, 120) : text.slice(0, bodyScoreIdx);
  const weightMatches = [...headerSlice.matchAll(/([0-9]{2,3}[.,][0-9])/g)];
  result.weight_kg = weightMatches.length ? parseLocaleNumber(weightMatches[weightMatches.length - 1][1]) : null;
  const weightGradeMatch = headerSlice.match(/\b(Standard|Under|Over|High)\b/i);
  result.weight_grade = weightGradeMatch ? weightGradeMatch[1] : null;
  cursor.advanceTo('Body score');

  ({ value: result.body_score } = cursor.metric('points', { window: 5 }));
  ({ value: result.bmi, grade: result.bmi_grade } = cursor.metric('BMI'));
  ({ value: result.body_fat_percent, grade: result.body_fat_grade } = cursor.metric('Body fat percentage'));

  cursor.advanceTo('Body composition');
  ({ value: result.body_water_mass_kg } = cursor.metric('Body water mass', { hasGrade: false }));
  ({ value: result.fat_mass_kg } = cursor.metric('Fat mass', { hasGrade: false }));
  ({ value: result.bone_mineral_mass_kg } = cursor.metric('Bone mineral mass', { hasGrade: false }));
  ({ value: result.protein_mass_kg } = cursor.metric('Protein mass', { hasGrade: false }));

  ({ value: result.muscle_mass_kg, grade: result.muscle_mass_grade } = cursor.metric('Muscle mass'));
  ({ value: result.muscle_percent, grade: result.muscle_percent_grade } = cursor.metric('Muscle percentage'));
  ({ value: result.body_water_percent, grade: result.body_water_percent_grade } = cursor.metric('Body water', { window: 25 }));
  ({ value: result.protein_percent, grade: result.protein_percent_grade } = cursor.metric('Protein percentage'));
  ({ value: result.bone_mineral_percent, grade: result.bone_mineral_percent_grade } = cursor.metric('Bone mineral percentage'));
  ({ value: result.skeletal_muscle_kg, grade: result.skeletal_muscle_grade } = cursor.metric('Skeletal muscle mass'));
  ({ value: result.visceral_fat_rating, grade: result.visceral_fat_grade } = cursor.metric('Visceral fat rating'));
  ({ value: result.bmr_kcal, grade: result.bmr_grade } = cursor.metric('Basal metabolic rate'));
  ({ value: result.waist_hip_ratio, grade: result.waist_hip_grade } = cursor.metric('waist-to-hip ratio'));
  ({ value: result.body_age } = cursor.metric('years old', { window: 5, hasGrade: false }));
  ({ value: result.fat_free_weight_kg } = cursor.metric('Fat-free body weight', { hasGrade: false }));
  ({ value: result.heart_rate_bpm, grade: result.heart_rate_grade } = cursor.metric('Heart rate', { window: 25 }));

  const bodyTypeIdx = Math.max(0, text.slice(cursor.pos).search(/Body type/i)) + cursor.pos;
  result.body_type_zone = BODY_TYPE_ZONES.find((zone) => new RegExp(`\\b${zone.replace(/[&]/g, '\\&')}\\b`, 'i').test(text.slice(bodyTypeIdx))) || null;

  // Weight suggestions section — inline "Label: Value" layout, opposite direction from above.
  result.standard_weight_kg = numberAfterLabel(text, 'Standard weight');
  result.weight_control_kg = numberAfterLabel(text, 'Weight control', { signed: true });
  result.fat_control_kg = numberAfterLabel(text, 'Fat control', { signed: true });
  result.muscle_control_text = /keep weight/i.test(text) ? 'keep weight' : null;

  return result;
}

export async function ocrBodyCompositionImage(imagePath) {
  const text = await tesseract.recognize(imagePath, { lang: 'eng', oem: 1, psm: 3 });
  return { fields: parseBodyCompositionText(text), rawText: text };
}
