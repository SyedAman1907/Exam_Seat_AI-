/**
 * Canonical Faculty Identity & Ownership Verification Helpers
 * Derives identity strictly from the authenticated req.user object.
 */

function normalizePersonName(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(/\b(dr|mr|mrs|ms|miss|prof|shri|smt)\.?\s*/gi, '')
    .replace(/[^a-z0-9]/g, '');
}

function isFacultyMappingOwner(user, mapping) {
  if (!user || !mapping) return false;
  if (user.role === 'admin') {
    return true;
  }
  if (user.role !== 'faculty') {
    return false;
  }
  if (mapping.facultyId && user._id && mapping.facultyId.toString() === user._id.toString()) {
    return true;
  }
  if (user.facultyId && mapping.facultyIdCode && String(user.facultyId).toUpperCase().trim() === String(mapping.facultyIdCode).toUpperCase().trim()) {
    return true;
  }
  const userNorm = normalizePersonName(user.name);
  const facNorm = normalizePersonName(mapping.facultyName);
  return Boolean(userNorm && facNorm && userNorm === facNorm);
}

function filterMappingsForUser(user, mappings = []) {
  if (!user || user.role !== 'faculty') return mappings;
  return mappings.filter((m) => isFacultyMappingOwner(user, m));
}

function isExamCreator(user, exam) {
  if (!user || !exam || !user._id || !exam.createdBy) return false;
  const creatorId = exam.createdBy._id ? exam.createdBy._id.toString() : exam.createdBy.toString();
  return creatorId === user._id.toString();
}

function canFacultyViewExam(user, exam) {
  if (!user || !exam) return false;
  if (user.role !== 'faculty') return true;
  if (isExamCreator(user, exam)) return true;
  if (exam.facultyId && exam.facultyId.toString() === user._id.toString()) return true;
  const userNorm = normalizePersonName(user.name);
  if (userNorm && normalizePersonName(exam.facultyName) === userNorm) return true;
  if (Array.isArray(exam.sectionAllocations)) {
    return exam.sectionAllocations.some((sa) => isFacultyMappingOwner(user, sa));
  }
  return false;
}

function canUserManageExam(user, exam) {
  if (!user || !exam) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'faculty' && isExamCreator(user, exam)) return true;
  return false;
}

module.exports = {
  normalizePersonName,
  isFacultyMappingOwner,
  filterMappingsForUser,
  isExamCreator,
  canFacultyViewExam,
  canUserManageExam,
};
