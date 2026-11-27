const UNIT_EXAM_TYPES = ['UNIT 1', 'UNIT 2', 'UNIT 3', 'UNIT 4', 'UNIT 5'];
const EXAM_TYPES = [...UNIT_EXAM_TYPES];

const EXAM_TYPE_SET = new Set(EXAM_TYPES);

function isValidUnitExamType(rawType) {
  const cleaned = String(rawType || '')
    .trim()
    .toUpperCase()
    .replace(/[_]+/g, ' ')
    .replace(/\s{2,}/g, ' ');
  if (!cleaned) return false;
  if (EXAM_TYPE_SET.has(cleaned)) return true;
  const compact = cleaned.replace(/[-\s]+/g, '');
  return /^UNIT([1-5])$/.test(compact);
}

function inferExamTypeFromTitle(examName = '') {
  const upper = String(examName || '').toUpperCase();
  if (!upper) return 'UNIT 1';
  for (let i = 1; i <= 5; i += 1) {
    if (new RegExp(`\\bUNIT[-\\s]*${i}\\b`).test(upper)) {
      return `UNIT ${i}`;
    }
  }
  return 'UNIT 1';
}

function normalizeExamType(rawType, fallbackExamName = '') {
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
  if (/^UNIT([1-5])$/.test(compact)) {
    return `UNIT ${compact.slice(-1)}`;
  }

  return fallbackExamName ? inferExamTypeFromTitle(fallbackExamName) : 'UNIT 1';
}

function resolveExamType(examOrType, fallbackTitle = '') {
  if (examOrType && typeof examOrType === 'object') {
    if (examOrType.examType && EXAM_TYPE_SET.has(String(examOrType.examType).trim().toUpperCase())) {
      return String(examOrType.examType).trim().toUpperCase();
    }
    return inferExamTypeFromTitle(examOrType.examName || fallbackTitle);
  }
  return normalizeExamType(examOrType, fallbackTitle);
}

module.exports = {
  UNIT_EXAM_TYPES,
  EXAM_TYPES,
  EXAM_TYPE_SET,
  isValidUnitExamType,
  inferExamTypeFromTitle,
  normalizeExamType,
  resolveExamType,
};
