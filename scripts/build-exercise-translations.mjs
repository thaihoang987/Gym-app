import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const db = new Database(path.join(rootDir, 'data', 'gym.sqlite'), { readonly: true });
const outDir = path.join(rootDir, 'data', 'exercise-translations');
const outPath = path.join(outDir, 'vi.json');

const muscleVi = new Map([
  ['abductors', 'cơ dạng hông'],
  ['abs', 'bụng'],
  ['adductors', 'cơ khép đùi'],
  ['back', 'lưng'],
  ['biceps', 'tay trước'],
  ['calves', 'bắp chân'],
  ['cardiovascular system', 'tim mạch'],
  ['delts', 'vai'],
  ['forearms', 'cẳng tay'],
  ['glutes', 'mông'],
  ['hamstrings', 'đùi sau'],
  ['lats', 'xô'],
  ['levator scapulae', 'cơ nâng vai'],
  ['pectorals', 'ngực'],
  ['quads', 'đùi trước'],
  ['serratus anterior', 'cơ răng trước'],
  ['shoulders', 'vai'],
  ['spine', 'cột sống'],
  ['traps', 'cầu vai'],
  ['triceps', 'tay sau'],
  ['upper back', 'lưng trên']
]);

const bodyPartVi = new Map([
  ['back', 'lưng'],
  ['cardio', 'tim mạch'],
  ['chest', 'ngực'],
  ['lower arms', 'cẳng tay'],
  ['lower legs', 'bắp chân'],
  ['neck', 'cổ'],
  ['shoulders', 'vai'],
  ['upper arms', 'tay trên'],
  ['upper legs', 'đùi'],
  ['waist', 'eo bụng']
]);

const equipmentVi = new Map([
  ['assisted', 'máy hỗ trợ'],
  ['band', 'dây kháng lực'],
  ['barbell', 'thanh đòn'],
  ['body weight', 'trọng lượng cơ thể'],
  ['bosu ball', 'bóng Bosu'],
  ['cable', 'cáp'],
  ['dumbbell', 'tạ đơn'],
  ['elliptical machine', 'máy elliptical'],
  ['ez barbell', 'thanh EZ'],
  ['hammer', 'búa tập'],
  ['kettlebell', 'tạ chuông'],
  ['leverage machine', 'máy đòn bẩy'],
  ['medicine ball', 'bóng y học'],
  ['olympic barbell', 'thanh đòn Olympic'],
  ['resistance band', 'dây kháng lực'],
  ['roller', 'con lăn'],
  ['rope', 'dây thừng'],
  ['skierg machine', 'máy SkiErg'],
  ['sled machine', 'máy sled'],
  ['smith machine', 'máy Smith'],
  ['stability ball', 'bóng thăng bằng'],
  ['stationary bike', 'xe đạp tại chỗ'],
  ['stepmill machine', 'máy leo cầu thang'],
  ['tire', 'lốp tập'],
  ['trap bar', 'thanh trap bar'],
  ['upper body ergometer', 'máy quay tay'],
  ['weighted', 'có tạ'],
  ['wheel roller', 'con lăn bụng']
]);

const aliasVi = {
  'bench press': 'đẩy ngực trên ghế',
  'incline bench press': 'đẩy ngực ghế dốc lên',
  'decline bench press': 'đẩy ngực ghế dốc xuống',
  'chest press': 'đẩy ngực',
  'chest fly': 'ép ngực',
  'pec deck fly': 'ép ngực máy pec deck',
  'push up': 'hít đất',
  'pull up': 'kéo xà',
  'chin up': 'kéo xà ngửa tay',
  'lat pulldown': 'kéo xô xuống',
  'pulldown': 'kéo xuống',
  'seated row': 'kéo lưng ngồi',
  'bent over row': 'kéo lưng gập người',
  'upright row': 'kéo đứng lên cằm',
  'deadlift': 'deadlift',
  'romanian deadlift': 'deadlift Romania',
  'stiff leg deadlift': 'deadlift chân thẳng',
  'good morning': 'gập hông good morning',
  'squat': 'squat',
  'front squat': 'squat trước',
  'hack squat': 'hack squat',
  'split squat': 'squat tách chân',
  'lunge': 'chùng chân',
  'walking lunge': 'chùng chân đi bộ',
  'leg press': 'đạp chân',
  'leg extension': 'duỗi đùi trước',
  'leg curl': 'cuốn đùi sau',
  'calf raise': 'nhón bắp chân',
  'hip thrust': 'đẩy hông',
  'glute bridge': 'cầu mông',
  'shoulder press': 'đẩy vai',
  'military press': 'đẩy vai quân đội',
  'overhead press': 'đẩy qua đầu',
  'lateral raise': 'nâng vai ngang',
  'front raise': 'nâng vai trước',
  'rear delt fly': 'ép vai sau',
  'reverse fly': 'ép vai sau',
  'face pull': 'kéo mặt',
  'shrug': 'nhún cầu vai',
  'biceps curl': 'cuốn tay trước',
  'hammer curl': 'cuốn búa',
  'preacher curl': 'cuốn tay ghế preacher',
  'concentration curl': 'cuốn tay tập trung',
  'triceps extension': 'duỗi tay sau',
  'triceps pushdown': 'ấn tay sau xuống',
  'skull crusher': 'duỗi tay sau nằm',
  'kickback': 'đá tay sau',
  'dip': 'nhúng xà',
  'crunch': 'gập bụng',
  'sit up': 'ngồi gập bụng',
  'plank': 'plank',
  'side plank': 'plank nghiêng',
  'russian twist': 'xoay bụng kiểu Nga',
  'leg raise': 'nâng chân',
  'knee raise': 'nâng gối',
  'mountain climber': 'leo núi',
  'burpee': 'burpee',
  'jumping jack': 'nhảy dang tay chân',
  'jump rope': 'nhảy dây',
  'run': 'chạy',
  'stationary bike': 'xe đạp tại chỗ',
  'hands bike': 'đạp xe tay',
  'all fours squad stretch': 'giãn cơ tư thế bốn điểm',
  'one arm against wall': 'một tay chống tường',
  'calf stretch with hands against wall': 'giãn bắp chân hai tay chống tường',
  'calf push stretch with hands against wall': 'đẩy giãn bắp chân hai tay chống tường',
  'dynamic chest stretch': 'giãn ngực động',
  'basic toe touch': 'chạm mũi chân cơ bản',
  'side-to-side toe touch': 'chạm mũi chân hai bên',
  'scissor jumps': 'nhảy cắt kéo',
  'astride jumps': 'nhảy dang chân',
  'star jump': 'nhảy hình sao',
  'archer pull up': 'kéo xà kiểu cung thủ',
  'archer push up': 'hít đất kiểu cung thủ',
  'standing archer': 'đứng kéo kiểu cung thủ',
  'air bike': 'gập bụng đạp xe',
  'battling ropes': 'đánh dây thừng',
  'walking': 'đi bộ',
  'stretch': 'giãn cơ'
};

const tokenVi = new Map([
  ['3/4', 'ba phần tư'],
  ['45', '45 độ'],
  ['90', '90 độ'],
  ['ab', 'bụng'],
  ['abdominal', 'bụng'],
  ['against', 'chống'],
  ['air', 'không khí'],
  ['all', 'bốn'],
  ['apart', 'tách rộng'],
  ['alternate', 'luân phiên'],
  ['alternating', 'luân phiên'],
  ['ankle', 'cổ chân'],
  ['arm', 'tay'],
  ['arms', 'hai tay'],
  ['around', 'vòng quanh'],
  ['assisted', 'có hỗ trợ'],
  ['back', 'lưng'],
  ['backward', 'lùi'],
  ['ball', 'bóng'],
  ['band', 'dây kháng lực'],
  ['balance', 'thăng bằng'],
  ['bar', 'thanh'],
  ['barbell', 'thanh đòn'],
  ['basic', 'cơ bản'],
  ['behind', 'phía sau'],
  ['bench', 'ghế'],
  ['bent', 'gập'],
  ['biceps', 'tay trước'],
  ['bicep', 'tay trước'],
  ['body', 'cơ thể'],
  ['board', 'ván'],
  ['bodyweight', 'trọng lượng cơ thể'],
  ['bosu', 'Bosu'],
  ['bottoms', 'đáy'],
  ['bridge', 'cầu'],
  ['cable', 'cáp'],
  ['calf', 'bắp chân'],
  ['calves', 'bắp chân'],
  ['chest', 'ngực'],
  ['circle', 'xoay vòng'],
  ['circular', 'xoay vòng'],
  ['clasped', 'đan tay'],
  ['close', 'hẹp'],
  ['concentration', 'tập trung'],
  ['cross', 'chéo'],
  ['curl', 'cuốn'],
  ['deadlift', 'deadlift'],
  ['decline', 'dốc xuống'],
  ['deep', 'sâu'],
  ['delt', 'vai'],
  ['deltoid', 'vai'],
  ['dip', 'nhúng xà'],
  ['down', 'xuống'],
  ['drag', 'kéo rê'],
  ['dumbbell', 'tạ đơn'],
  ['elbow', 'khuỷu tay'],
  ['extension', 'duỗi'],
  ['external', 'ngoài'],
  ['ez', 'EZ'],
  ['face', 'mặt'],
  ['female', 'nữ'],
  ['flat', 'phẳng'],
  ['flexion', 'gập'],
  ['floor', 'sàn'],
  ['fly', 'ép'],
  ['forward', 'tiến'],
  ['front', 'trước'],
  ['fours', 'bốn điểm'],
  ['full', 'toàn phần'],
  ['glute', 'mông'],
  ['grip', 'kiểu nắm'],
  ['hack', 'hack'],
  ['hammer', 'búa'],
  ['hamstring', 'đùi sau'],
  ['hand', 'tay'],
  ['hands', 'hai tay'],
  ['hang', 'treo'],
  ['hanging', 'treo người'],
  ['hindu', 'Hindu'],
  ['heel', 'gót chân'],
  ['high', 'cao'],
  ['hip', 'hông'],
  ['incline', 'dốc lên'],
  ['inner', 'trong'],
  ['internal', 'trong'],
  ['jack', 'dang tay chân'],
  ['jump', 'nhảy'],
  ['jumps', 'nhảy'],
  ['kettlebell', 'tạ chuông'],
  ['kick', 'đá'],
  ['kickback', 'đá sau'],
  ['knee', 'gối'],
  ['kneeling', 'quỳ'],
  ['lat', 'xô'],
  ['lateral', 'ngang'],
  ['leg', 'chân'],
  ['lever', 'máy đòn bẩy'],
  ['lift', 'nâng'],
  ['low', 'thấp'],
  ['lower', 'dưới'],
  ['lying', 'nằm'],
  ['machine', 'máy'],
  ['male', 'nam'],
  ['medicine', 'y học'],
  ['middle', 'giữa'],
  ['military', 'quân đội'],
  ['modified', 'biến thể'],
  ['narrow', 'hẹp'],
  ['neck', 'cổ'],
  ['neutral', 'trung lập'],
  ['olympic', 'Olympic'],
  ['one', 'một'],
  ['outer', 'ngoài'],
  ['over', 'qua'],
  ['overhead', 'qua đầu'],
  ['press', 'đẩy'],
  ['preacher', 'preacher'],
  ['prisoner', 'tù nhân'],
  ['pull', 'kéo'],
  ['pulldown', 'kéo xuống'],
  ['push', 'đẩy'],
  ['pushdown', 'ấn xuống'],
  ['raise', 'nâng'],
  ['rear', 'sau'],
  ['reverse', 'ngược'],
  ['roll', 'lăn'],
  ['roller', 'con lăn'],
  ['romanian', 'Romania'],
  ['rope', 'dây thừng'],
  ['ropes', 'dây thừng'],
  ['rotation', 'xoay'],
  ['row', 'kéo lưng'],
  ['russian', 'Nga'],
  ['scissor', 'cắt kéo'],
  ['scapula', 'xương bả vai'],
  ['seated', 'ngồi'],
  ['shoulder', 'vai'],
  ['shrug', 'nhún'],
  ['side', 'bên'],
  ['single', 'một'],
  ['sit', 'ngồi'],
  ['sitted', 'ngồi'],
  ['skater', 'trượt băng'],
  ['skull', 'nằm'],
  ['sled', 'sled'],
  ['smith', 'Smith'],
  ['split', 'tách'],
  ['squat', 'squat'],
  ['squad', 'bốn điểm'],
  ['star', 'hình sao'],
  ['standing', 'đứng'],
  ['step', 'bước'],
  ['stiff', 'thẳng'],
  ['straight', 'thẳng'],
  ['stretch', 'giãn cơ'],
  ['sumo', 'sumo'],
  ['support', 'hỗ trợ'],
  ['supported', 'có tựa'],
  ['thigh', 'đùi'],
  ['to', 'tới'],
  ['toe', 'mũi chân'],
  ['touch', 'chạm'],
  ['trap', 'cầu vai'],
  ['triceps', 'tay sau'],
  ['twist', 'xoay'],
  ['twisted', 'xoay'],
  ['underhand', 'ngửa tay'],
  ['up', 'lên'],
  ['upper', 'trên'],
  ['upright', 'đứng thẳng'],
  ['v', 'chữ V'],
  ['walk', 'đi bộ'],
  ['walking', 'đi bộ'],
  ['wall', 'tường'],
  ['weighted', 'có tạ'],
  ['wheel', 'bánh xe'],
  ['wide', 'rộng'],
  ['with', 'với'],
  ['wrist', 'cổ tay']
]);

const bodyWordVi = new Map([
  ['ankle', 'cổ chân'],
  ['arm', 'tay'],
  ['arms', 'hai tay'],
  ['back', 'lưng'],
  ['biceps', 'tay trước'],
  ['calf', 'bắp chân'],
  ['calves', 'bắp chân'],
  ['chest', 'ngực'],
  ['core', 'cơ bụng'],
  ['elbow', 'khuỷu tay'],
  ['elbows', 'hai khuỷu tay'],
  ['feet', 'hai bàn chân'],
  ['foot', 'bàn chân'],
  ['forearm', 'cẳng tay'],
  ['forearms', 'hai cẳng tay'],
  ['glute', 'mông'],
  ['glutes', 'mông'],
  ['hamstring', 'đùi sau'],
  ['hamstrings', 'đùi sau'],
  ['hand', 'tay'],
  ['hands', 'hai tay'],
  ['heel', 'gót chân'],
  ['heels', 'hai gót chân'],
  ['hip', 'hông'],
  ['hips', 'hông'],
  ['knee', 'gối'],
  ['knees', 'hai gối'],
  ['lat', 'xô'],
  ['lats', 'xô'],
  ['leg', 'chân'],
  ['legs', 'hai chân'],
  ['neck', 'cổ'],
  ['quad', 'đùi trước'],
  ['quads', 'đùi trước'],
  ['shoulder', 'vai'],
  ['shoulders', 'vai'],
  ['torso', 'thân người'],
  ['triceps', 'tay sau'],
  ['wrist', 'cổ tay'],
  ['wrists', 'hai cổ tay']
]);

const quickSearchByVi = {
  'ngực': ['ngực', 'đẩy ngực', 'ép ngực', 'chest', 'bench press', 'pectorals'],
  'lưng': ['lưng', 'xô', 'kéo lưng', 'kéo xô', 'back', 'lat', 'lats', 'row', 'pulldown'],
  'xô': ['xô', 'kéo xô', 'lat', 'lats', 'pulldown', 'pull up'],
  'vai': ['vai', 'đẩy vai', 'nâng vai', 'shoulder', 'delts', 'delt'],
  'tay trước': ['tay trước', 'cuốn tay', 'biceps', 'curl'],
  'tay sau': ['tay sau', 'duỗi tay sau', 'triceps', 'pushdown', 'extension'],
  'cẳng tay': ['cẳng tay', 'cổ tay', 'forearms', 'wrist'],
  'chân': ['chân', 'đùi', 'mông', 'bắp chân', 'leg', 'legs', 'squat', 'lunge'],
  'đùi trước': ['đùi trước', 'quads', 'quadriceps', 'leg extension', 'squat'],
  'đùi sau': ['đùi sau', 'hamstrings', 'leg curl', 'deadlift'],
  'mông': ['mông', 'glute', 'glutes', 'hip thrust', 'bridge'],
  'bắp chân': ['bắp chân', 'calves', 'calf raise'],
  'bụng': ['bụng', 'eo bụng', 'abs', 'abdominal', 'crunch', 'plank'],
  'tim mạch': ['tim mạch', 'cardio', 'chạy', 'đi bộ', 'nhảy dây']
};

const stepPatterns = [
  [/^Lie flat on (?:a |the )?bench/i, 'Nằm ngửa trên ghế'],
  [/^Lie flat on your back/i, 'Nằm ngửa'],
  [/^Lie on/i, 'Nằm trên'],
  [/^Stand with your feet shoulder-width apart/i, 'Đứng hai chân rộng bằng vai'],
  [/^Stand/i, 'Đứng'],
  [/^Sit on (?:a |the )?bench/i, 'Ngồi trên ghế'],
  [/^Sit/i, 'Ngồi'],
  [/^Hold/i, 'Giữ'],
  [/^Grab/i, 'Nắm lấy'],
  [/^Grasp/i, 'Nắm lấy'],
  [/^Place/i, 'Đặt'],
  [/^Position/i, 'Đặt tư thế'],
  [/^Keep your back straight/i, 'Giữ lưng thẳng'],
  [/^Keep your core engaged/i, 'Siết cơ bụng'],
  [/^Engage your core/i, 'Siết cơ bụng'],
  [/^Slowly lower/i, 'Từ từ hạ'],
  [/^Lower/i, 'Hạ'],
  [/^Raise/i, 'Nâng'],
  [/^Lift/i, 'Nâng'],
  [/^Pull/i, 'Kéo'],
  [/^Push/i, 'Đẩy'],
  [/^Press/i, 'Đẩy'],
  [/^Extend/i, 'Duỗi'],
  [/^Bend/i, 'Gập'],
  [/^Return to the starting position/i, 'Trở về vị trí ban đầu'],
  [/^Repeat for the desired number of repetitions/i, 'Lặp lại đủ số lần mong muốn'],
  [/^Repeat/i, 'Lặp lại'],
  [/^Breathe out/i, 'Thở ra'],
  [/^Breathe in/i, 'Hít vào'],
  [/^Pause for a moment/i, 'Dừng lại một nhịp'],
  [/^Squeeze/i, 'Siết'],
  [/^Make sure/i, 'Đảm bảo'],
  [/^Avoid/i, 'Tránh']
];

const instructionWords = [
  ['your feet flat on the ground', 'hai bàn chân đặt phẳng trên sàn'],
  ['your back pressed against the bench', 'lưng áp sát ghế'],
  ['shoulder-width apart', 'rộng bằng vai'],
  ['slightly wider than shoulder-width apart', 'hơi rộng hơn vai'],
  ['overhand grip', 'kiểu nắm sấp'],
  ['underhand grip', 'kiểu nắm ngửa'],
  ['neutral grip', 'kiểu nắm trung lập'],
  ['starting position', 'vị trí ban đầu'],
  ['desired number of repetitions', 'số lần mong muốn'],
  ['full range of motion', 'đủ biên độ chuyển động'],
  ['controlled motion', 'chuyển động có kiểm soát'],
  ['squeeze your', 'siết'],
  ['keep your', 'giữ'],
  ['with your', 'với'],
  ['until your', 'cho đến khi'],
  ['as you', 'khi bạn'],
  ['while keeping', 'đồng thời giữ'],
  ['at the top', 'ở điểm trên cùng'],
  ['at the bottom', 'ở điểm dưới cùng'],
  ['for a moment', 'một nhịp'],
  ['slowly', 'từ từ'],
  ['the dumbbells', 'hai tạ đơn'],
  ['the dumbbell', 'tạ đơn'],
  ['the barbell', 'thanh đòn'],
  ['the cable', 'cáp'],
  ['the band', 'dây kháng lực'],
  ['the handles', 'tay cầm'],
  ['the handle', 'tay cầm'],
  ['the weight', 'mức tạ'],
  ['your arms', 'hai tay'],
  ['your arm', 'tay'],
  ['your legs', 'hai chân'],
  ['your leg', 'chân'],
  ['your knees', 'hai gối'],
  ['your knee', 'gối'],
  ['your elbows', 'hai khuỷu tay'],
  ['your elbow', 'khuỷu tay'],
  ['your chest', 'ngực'],
  ['your shoulders', 'vai'],
  ['your hips', 'hông'],
  ['your core', 'cơ bụng'],
  ['your glutes', 'mông'],
  ['your back', 'lưng'],
  ['your head', 'đầu'],
  ['your neck', 'cổ'],
  ['your torso', 'thân người']
];

function cleanName(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*\(\s*/g, ' (')
    .replace(/\s*\)\s*/g, ')')
    .trim();
}

function titleCaseFirst(text) {
  const value = String(text || '').trim();
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function normalizeKey(text) {
  return String(text || '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function translateTaxonomy(value, dict) {
  const key = normalizeKey(value);
  return dict.get(key) || tokenVi.get(key) || titleCaseFirst(key);
}

function replaceKnownPhrases(text, source) {
  let out = String(text || '');
  for (const [en, vi] of Object.entries(source).sort((a, b) => b[0].length - a[0].length)) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(en)}\\b`, 'gi'), vi);
  }
  return out;
}

function translateName(name) {
  let source = normalizeKey(cleanName(name));
  const parens = [...source.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]);
  source = source.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();

  let out = replaceKnownPhrases(source, aliasVi);
  out = out
    .split(/(\s+|\/)/)
    .map((part) => {
      if (!part.trim() || part === '/') return part;
      return tokenVi.get(part.toLowerCase()) || part;
    })
    .join('')
    .replace(/\bva\b/gi, 'và')
    .replace(/\s+/g, ' ')
    .trim();

  if (parens.length) {
    const viParens = parens.map((item) => translateName(item).toLowerCase()).join(', ');
    out = `${out} (${viParens})`;
  }
  return titleCaseFirst(out);
}

function translateInstruction(step) {
  let out = String(step || '').replace(/\s+/g, ' ').trim();
  if (!out) return '';

  for (const [pattern, replacement] of stepPatterns) {
    out = out.replace(pattern, replacement);
  }
  for (const [en, vi] of instructionWords.sort((a, b) => b[0].length - a[0].length)) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(en)}\\b`, 'gi'), vi);
  }
  out = replaceKnownPhrases(out, aliasVi);
  out = out
    .replace(/\b(an?|the)\b/gi, '')
    .replace(/\byour\b/gi, 'của bạn')
    .replace(/\bwith\b/gi, 'với')
    .replace(/\band\b/gi, 'và')
    .replace(/\bwhile\b/gi, 'trong khi')
    .replace(/\bat\b/gi, 'ở')
    .replace(/\bin\b/gi, 'trong')
    .replace(/\bto\b/gi, 'tới')
    .replace(/\bfrom\b/gi, 'từ')
    .replace(/\bthen\b/gi, 'sau đó')
    .replace(/\buntil\b/gi, 'cho đến khi')
    .replace(/\bdown\b/gi, 'xuống')
    .replace(/\bup\b/gi, 'lên')
    .replace(/\bforward\b/gi, 'về trước')
    .replace(/\bbackward\b/gi, 'về sau');

  for (const [en, vi] of [...tokenVi.entries()].sort((a, b) => b[0].length - a[0].length)) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(en)}\\b`, 'gi'), vi);
  }
  return titleCaseFirst(out.replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').trim());
}

function movementKind(name) {
  const text = normalizeKey(name);
  if (/(bench press|chest press|shoulder press|military press|overhead press|press\b|push up)/.test(text)) return 'press';
  if (/(row|pulldown|pull up|chin up|face pull|pull\b)/.test(text)) return 'pull';
  if (/(squat|leg press|lunge|step up|split squat|hack squat)/.test(text)) return 'squat';
  if (/(deadlift|good morning|hip thrust|glute bridge|pull through)/.test(text)) return 'hinge';
  if (/(curl|preacher|hammer)/.test(text)) return 'curl';
  if (/(triceps|pushdown|kickback|skull crusher|extension)/.test(text)) return 'triceps';
  if (/(raise|shrug|fly|reverse fly|lateral)/.test(text)) return 'raise';
  if (/(crunch|sit up|plank|twist|leg raise|knee raise|mountain climber)/.test(text)) return 'core';
  if (/(run|walk|bike|jump|burpee|cardio|elliptical|skierg|stepmill)/.test(text)) return 'cardio';
  if (/(stretch|mobility|rotation)/.test(text)) return 'stretch';
  return 'general';
}

function stanceFromName(name) {
  const text = normalizeKey(name);
  if (text.includes('lying')) return 'Nằm đúng tư thế, giữ lưng và cổ ổn định trước khi bắt đầu.';
  if (text.includes('seated')) return 'Ngồi chắc trên ghế, đặt chân vững và giữ thân người ổn định.';
  if (text.includes('kneeling')) return 'Quỳ chắc trên sàn, siết cơ bụng để giữ thăng bằng.';
  if (text.includes('standing')) return 'Đứng hai chân vững, siết cơ bụng và giữ lưng thẳng.';
  if (text.includes('hanging')) return 'Treo người chắc trên xà, giữ vai ổn định và kiểm soát thân người.';
  return 'Vào tư thế chắc chắn, giữ thân người ổn định và chuẩn bị dụng cụ đúng vị trí.';
}

function equipmentCue(equipmentText) {
  if (!equipmentText || equipmentText === 'trọng lượng cơ thể') {
    return 'Dùng trọng lượng cơ thể, không lấy đà quá mạnh.';
  }
  return `Giữ ${equipmentText} chắc tay, chọn mức tải vừa sức và kiểm soát đường đi của động tác.`;
}

function targetCue(targetVi) {
  if (!targetVi) return 'Tập trung siết nhóm cơ chính trong suốt chuyển động.';
  return `Tập trung cảm nhận ${targetVi}, không để nhóm cơ phụ kéo mất lực chính.`;
}

function buildInstructionSteps(row, nameVi, targetVi, equipmentText) {
  const prep = stanceFromName(row.name);
  const tool = equipmentCue(equipmentText);
  const target = targetCue(targetVi);
  const finish = 'Lặp lại đủ số lần, thở đều và dừng lại nếu mất kỹ thuật.';

  switch (movementKind(row.name)) {
    case 'press':
      return [
        prep,
        tool,
        `Đẩy lên hoặc đẩy ra theo hướng của bài ${nameVi.toLowerCase()}, giữ cổ tay thẳng và khuỷu tay đi theo đường tự nhiên.`,
        `Hạ có kiểm soát về vị trí ban đầu, giữ căng ${targetVi || 'nhóm cơ chính'}.`,
        finish
      ];
    case 'pull':
      return [
        prep,
        tool,
        `Kéo về phía thân người, chủ động kéo bằng ${targetVi || 'lưng'} thay vì giật bằng tay.`,
        'Giữ vai hạ xuống, siết bả vai một nhịp rồi trả về chậm.',
        finish
      ];
    case 'squat':
      return [
        'Đứng hai chân vững, mũi chân hơi mở và siết cơ bụng.',
        tool,
        'Hạ người xuống có kiểm soát, giữ gối đi cùng hướng mũi chân và lưng trung lập.',
        `Đạp mạnh qua bàn chân để đứng lên, tập trung vào ${targetVi || 'chân và mông'}.`,
        finish
      ];
    case 'hinge':
      return [
        'Đứng chắc, siết cơ bụng và giữ lưng trung lập.',
        tool,
        'Gập hông ra sau, để thân người nghiêng xuống trong khi lưng vẫn thẳng.',
        `Đẩy hông về trước để trở lại tư thế đầu, siết ${targetVi || 'mông và đùi sau'} ở cuối động tác.`,
        finish
      ];
    case 'curl':
      return [
        prep,
        tool,
        'Giữ khuỷu tay ổn định gần thân người, cuốn tạ lên bằng tay trước.',
        'Hạ tạ chậm, không vung người và không thả rơi tạ.',
        finish
      ];
    case 'triceps':
      return [
        prep,
        tool,
        'Cố định khuỷu tay, duỗi tay để siết tay sau ở cuối chuyển động.',
        'Trả tay về chậm đến khi tay sau được kéo giãn vừa đủ.',
        finish
      ];
    case 'raise':
      return [
        prep,
        tool,
        `Nâng theo đúng hướng của bài ${nameVi.toLowerCase()}, giữ vai ổn định và không nhún người lấy đà.`,
        'Hạ xuống chậm, giữ kiểm soát ở cả chiều lên và chiều xuống.',
        finish
      ];
    case 'core':
      return [
        'Vào tư thế chắc chắn, siết bụng và giữ lưng dưới ổn định.',
        'Thực hiện chuyển động bằng cơ bụng, không kéo cổ hoặc dùng đà quá mạnh.',
        'Giữ nhịp thở đều, kiểm soát thân người ở điểm khó nhất.',
        finish
      ];
    case 'cardio':
      return [
        'Khởi động nhẹ trước khi tăng tốc.',
        'Giữ nhịp thở đều, thân người ổn định và chuyển động mượt.',
        'Tăng hoặc giảm tốc độ theo mục tiêu buổi tập.',
        'Kết thúc bằng vài phút thả lỏng để nhịp tim hạ dần.'
      ];
    case 'stretch':
      return [
        'Vào tư thế giãn cơ thoải mái, không ép quá ngưỡng đau.',
        'Giữ chuyển động chậm và thở đều.',
        `Tập trung kéo giãn ${targetVi || 'nhóm cơ mục tiêu'} trong thời gian yêu cầu.`,
        'Thoát tư thế từ từ để tránh căng cơ đột ngột.'
      ];
    default:
      return [
        prep,
        tool,
        target,
        'Thực hiện động tác chậm, kiểm soát cả chiều đi và chiều về.',
        finish
      ];
  }
}

function uniqueList(items) {
  return [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))];
}

function quickSearchTerms(row, nameVi, targetVi, bodyPartText, equipmentText, secondaryVi) {
  const haystack = [
    row.name,
    nameVi,
    row.target,
    targetVi,
    row.body_part,
    bodyPartText,
    row.equipment,
    equipmentText,
    row.muscle_group,
    ...secondaryVi
  ].join(' ').toLowerCase();

  const terms = [nameVi, targetVi, bodyPartText, equipmentText, ...secondaryVi];
  for (const [label, aliases] of Object.entries(quickSearchByVi)) {
    if (aliases.some((alias) => haystack.includes(alias.toLowerCase()))) {
      terms.push(label, ...aliases);
    }
  }
  return uniqueList(terms);
}

const rows = db.prepare(`
  SELECT id, name, body_part, equipment, target, muscle_group, secondary_muscles_json,
         instructions_en, instruction_steps_json
  FROM exercises
  WHERE COALESCE(is_hidden, 0) = 0
  ORDER BY name
`).all();

const translations = {};
for (const row of rows) {
  let steps = [];
  let secondary = [];
  try {
    steps = JSON.parse(row.instruction_steps_json || '[]');
  } catch {
    steps = [];
  }
  try {
    secondary = JSON.parse(row.secondary_muscles_json || '[]');
  } catch {
    secondary = [];
  }
  if (!steps.length && row.instructions_en) {
    steps = String(row.instructions_en).split(/\n+/).map((item) => item.trim()).filter(Boolean);
  }

  const nameVi = translateName(row.name);
  const targetVi = translateTaxonomy(row.target, muscleVi);
  const bodyPartText = translateTaxonomy(row.body_part, bodyPartVi);
  const equipmentText = translateTaxonomy(row.equipment, equipmentVi);
  const secondaryVi = uniqueList(secondary.map((item) => translateTaxonomy(item, muscleVi)));
  const stepsVi = buildInstructionSteps(row, nameVi, targetVi, equipmentText);

  translations[row.id] = {
    id: row.id,
    sourceName: row.name,
    nameVi,
    bodyPartVi: bodyPartText,
    equipmentVi: equipmentText,
    targetVi,
    muscleGroupVi: translateTaxonomy(row.muscle_group || row.target, muscleVi),
    secondaryMusclesVi: secondaryVi,
    instructionsVi: stepsVi.join('\n'),
    stepsVi,
    searchVi: uniqueList([nameVi, targetVi, bodyPartText, equipmentText, ...secondaryVi]).join(' '),
    quickSearchVi: quickSearchTerms(row, nameVi, targetVi, bodyPartText, equipmentText, secondaryVi)
  };
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify({
  language: 'vi-VN',
  source: 'manual-gym-vietnamese-rules-from-local-exercises-db',
  note: 'Bộ dịch nội bộ theo thuật ngữ gym, không gọi dịch máy bên ngoài.',
  generatedAt: new Date().toISOString(),
  count: Object.keys(translations).length,
  translations
}, null, 2)}\n`, 'utf8');

console.log(`Wrote ${Object.keys(translations).length} exercise translations to ${outPath}`);
