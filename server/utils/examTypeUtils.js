const EXAM_TYPES = [
  'UNIT 1',
  'UNIT 2',
  'UNIT 3',
  'UNIT 4',
  'UNIT 5',
  'MID-TERM 1',
  'MID-TERM 2',
  'SEMESTER END EXAMINATION',
  'OTHER',
];

const EXAM_TYPE_SET = new Set(EXAM_TYPES);

function inferExamTypeFromTitle(examName = '') {
  const upper = String(examName || '').toUpperCase();
  if (!upper) return 'OTHER';
  for (let i = 1; i <= 5; i += 1) {
    if (new RegExp(`\\bUNIT[-\\s]*${i}\\b`).test(upper)) {
      return `UNIT ${i}`;
    }
  }
  if (/\bMID[-\s]*(TERM)?[-\s]*2\b|\bII\s*MID\b|\b2ND\s*MID\b/.test(upper)) {
    return 'MID-TERM 2';
  }
  if (/\bMID[-\s]*(TERM)?[-\s]*1\b|\bMID[-\s]*TERM\b|\bI\s*MID\b|\b1ST\s*MID\b/.test(upper)) {
    return 'MID-TERM 1';
  }
  if (/\bSEMESTER\s*END\b|\bEND\s*SEMESTER\b|\bEXTERNAL\b|\bREGULAR\s+EXAM/.test(upper)) {
    return 'SEMESTER END EXAMINATION';
  }
  return 'OTHER';
}

function normalizeExamType(rawType, fallbackExamName = '') {
  const cleaned = String(rawType || '')
    .trim()
    .toUpperCase()
    .replace(/[_]+/g, ' ')
    .replace(/\s{2,}/g, ' ');

  if (!cleaned) {
    return inferExamTypeFromTitle(fallbackExamName);
  }
  if (EXAM_TYPE_SET.has(cleaned)) {
    return cleaned;
  }

  const compact = cleaned.replace(/[-\s]+/g, '');
  if (/^UNIT([1-5])$/.test(compact)) {
    return `UNIT ${compact.slice(-1)}`;
  }
  if (/^MID(?:TERM)?1$/.test(compact)) return 'MID-TERM 1';
  if (/^MID(?:TERM)?2$/.test(compact)) return 'MID-TERM 2';
  if (compact === 'MIDTERM') return 'MID-TERM 1';
  if (compact === 'SEMESTEREND' || compact === 'SEMESTERENDEXAMINATION' || compact === 'ENDSEM') {
    return 'SEMESTER END EXAMINATION';
  }
  if (compact === 'OTHER') return 'OTHER';

  return 'OTHER';
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
  EXAM_TYPES,
  EXAM_TYPE_SET,
  inferExamTypeFromTitle,
  normalizeExamType,
  resolveExamType,
};
