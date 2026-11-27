export const EXAM_TYPE_OPTIONS = [
  { value: 'UNIT 1', label: 'UNIT 1' },
  { value: 'UNIT 2', label: 'UNIT 2' },
  { value: 'UNIT 3', label: 'UNIT 3' },
  { value: 'UNIT 4', label: 'UNIT 4' },
  { value: 'UNIT 5', label: 'UNIT 5' },
];

const EXAM_TYPE_SET = new Set(EXAM_TYPE_OPTIONS.map((opt) => opt.value));

export function isValidUnitExamType(rawType) {
  const cleaned = String(rawType || '')
    .trim()
    .toUpperCase()
    .replace(/[_]+/g, ' ')
    .replace(/\s{2,}/g, ' ');
  if (!cleaned) return false;
  if (EXAM_TYPE_SET.has(cleaned)) return true;
  return /^UNIT([1-5])$/.test(cleaned.replace(/[-\s]+/g, ''));
}

export function inferExamTypeFromTitle(examName = '') {
  const upper = String(examName || '').toUpperCase();
  if (!upper) return 'UNIT 1';
  for (let i = 1; i <= 5; i += 1) {
    if (new RegExp(`\\bUNIT[-\\s]*${i}\\b`).test(upper)) {
      return `UNIT ${i}`;
    }
  }
  return 'UNIT 1';
}

export function normalizeExamType(rawType, fallbackExamName = '') {
  const cleaned = String(rawType || '')
    .trim()
    .toUpperCase()
    .replace(/[_]+/g, ' ')
    .replace(/\s{2,}/g, ' ');
  if (!cleaned) {
    return fallbackExamName ? inferExamTypeFromTitle(fallbackExamName) : 'UNIT 1';
  }
  if (EXAM_TYPE_SET.has(cleaned)) {
    return cleaned;
  }
  const compact = cleaned.replace(/[-\s]+/g, '');
  if (/^UNIT([1-5])$/.test(compact)) return `UNIT ${compact.slice(-1)}`;
  return fallbackExamName ? inferExamTypeFromTitle(fallbackExamName) : 'UNIT 1';
}

export function resolveExamType(examOrType) {
  if (!examOrType) return 'UNIT 1';
  if (typeof examOrType === 'object') {
    if (examOrType.examType && EXAM_TYPE_SET.has(String(examOrType.examType).trim().toUpperCase())) {
      return String(examOrType.examType).trim().toUpperCase();
    }
    return inferExamTypeFromTitle(examOrType.examName || '');
  }
  return normalizeExamType(examOrType);
}

export function buildDefaultExamTitle({ year = 'III Year', semester = 'I Semester', examType = 'UNIT 1' } = {}) {
  const cleanYear = String(year || 'III Year').trim();
  const cleanSem = String(semester || 'I Semester').trim();
  const normType = resolveExamType(examType);
  return `${cleanYear} ${cleanSem} ${normType} Examination`;
}
