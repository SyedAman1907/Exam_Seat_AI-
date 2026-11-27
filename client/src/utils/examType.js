export const EXAM_TYPE_OPTIONS = [
  { value: 'UNIT 1', label: 'UNIT 1' },
  { value: 'UNIT 2', label: 'UNIT 2' },
  { value: 'UNIT 3', label: 'UNIT 3' },
  { value: 'UNIT 4', label: 'UNIT 4' },
  { value: 'UNIT 5', label: 'UNIT 5' },
  { value: 'MID-TERM 1', label: 'MID-TERM 1' },
  { value: 'MID-TERM 2', label: 'MID-TERM 2' },
  { value: 'SEMESTER END EXAMINATION', label: 'SEMESTER END EXAMINATION' },
  { value: 'OTHER', label: 'OTHER' },
];

const EXAM_TYPE_SET = new Set(EXAM_TYPE_OPTIONS.map((opt) => opt.value));

export function inferExamTypeFromTitle(examName = '') {
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

export function normalizeExamType(rawType, fallbackExamName = '') {
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
  if (/^UNIT([1-5])$/.test(compact)) return `UNIT ${compact.slice(-1)}`;
  if (/^MID(?:TERM)?1$/.test(compact)) return 'MID-TERM 1';
  if (/^MID(?:TERM)?2$/.test(compact)) return 'MID-TERM 2';
  if (compact === 'MIDTERM') return 'MID-TERM 1';
  if (compact === 'SEMESTEREND' || compact === 'SEMESTERENDEXAMINATION' || compact === 'ENDSEM') {
    return 'SEMESTER END EXAMINATION';
  }
  return 'OTHER';
}

export function resolveExamType(examOrType) {
  if (!examOrType) return 'MID-TERM 1';
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
  if (normType === 'SEMESTER END EXAMINATION') {
    return `${cleanYear} ${cleanSem} Semester End Examination`;
  }
  if (normType === 'OTHER') {
    return `${cleanYear} ${cleanSem} Examination`;
  }
  return `${cleanYear} ${cleanSem} ${normType} Examination`;
}
