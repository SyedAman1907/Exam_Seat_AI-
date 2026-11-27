const FacultyMapping = require('../models/FacultyMapping');
const Student = require('../models/Student');
const StudentEnrollment = require('../models/StudentEnrollment');
const Subject = require('../models/Subject');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const StudentClassificationService = require('./studentClassificationService');

const VALID_SECTIONS = new Set(['A1', 'A2', 'A3', 'A4', 'A5', 'A6']);
const BULK_CHUNK_SIZE = 500;

async function runBulkWriteChunked(Model, ops, session = null) {
  if (!Array.isArray(ops) || ops.length === 0) return;
  const baseOpts = session ? { ordered: false, session } : { ordered: false };
  for (let i = 0; i < ops.length; i += BULK_CHUNK_SIZE) {
    const slice = ops.slice(i, i + BULK_CHUNK_SIZE);
    await Model.bulkWrite(slice, baseOpts);
  }
}

function validateAndPrepareMappingItem(rawMapping, idx = 0, defaultSourceFileName = 'Uploaded Nominal PDF') {
  const rNum = idx + 1;
  const cleanFaculty = String(rawMapping?.facultyName || '').trim();
  const cleanFacultyIdCode = String(rawMapping?.facultyIdCode || rawMapping?.facultyCode || '').trim().toUpperCase();
  const cleanSubName = String(rawMapping?.subjectName || '').trim();
  const cleanSubCode = String(rawMapping?.subjectCode || '').trim().toUpperCase();
  const cleanSection = String(rawMapping?.section || '').trim().toUpperCase();
  const cleanGroup =
    rawMapping?.group ||
    (['A1', 'A2', 'A3'].includes(cleanSection)
      ? 'Group A'
      : ['A4', 'A5', 'A6'].includes(cleanSection)
        ? 'Group B'
        : 'Group A');
  const cleanAcadYear = rawMapping?.academicYear || '2026-2027';
  const cleanYear = rawMapping?.year || 'III Year';
  const cleanSemester = rawMapping?.semester || 'I Semester';
  const cleanDepartment = String(rawMapping?.department || 'Computer Science and Engineering').trim();
  const mStudents = Array.isArray(rawMapping?.students) ? rawMapping.students : [];
  const errors = [];

  if (!cleanFaculty) {
    errors.push(`Roster #${rNum} (${cleanSubName || 'Unknown'}): Faculty name is missing.`);
  }
  if (!cleanSubName) {
    errors.push(`Roster #${rNum} (Sec ${cleanSection || 'Unknown'}): Subject name is missing.`);
  }
  if (!cleanSubCode) {
    errors.push(`Roster #${rNum} (${cleanSubName || 'Unknown'}): Subject code is missing.`);
  }
  if (!VALID_SECTIONS.has(cleanSection)) {
    errors.push(
      `Roster #${rNum} (${cleanSubName || 'Unknown'}): Invalid section '${cleanSection}'. Expected A1, A2, A3, A4, A5, or A6.`
    );
  }
  if (mStudents.length === 0) {
    errors.push(`Roster #${rNum} (${cleanSubName || 'Unknown'} - Sec ${cleanSection || '?'}): No student records found.`);
  }

  // Deduplicate students ONLY within this subject-section mapping
  const studentMap = new Map();
  for (const s of mStudents) {
    const reg = String(s?.registrationNumber || s?.rollNumber || '').trim().toUpperCase();
    const name = String(s?.name || s?.studentName || '').trim();
    if (reg && name && !studentMap.has(reg)) {
      const classification = StudentClassificationService.classifyStudent(reg);
      studentMap.set(reg, {
        registrationNumber: reg,
        name,
        group: s.group || classification.group || cleanGroup,
        year: s.year || classification.year || cleanYear,
        a1: s.a1 || '',
        a2: s.a2 || '',
        a3: s.a3 || '',
        a4: s.a4 || '',
        a5: s.a5 || '',
        a6: s.a6 || '',
      });
    }
  }

  const deduplicatedStudents = Array.from(studentMap.values()).sort((a, b) =>
    a.registrationNumber.localeCompare(b.registrationNumber)
  );

  if (mStudents.length > 0 && deduplicatedStudents.length === 0) {
    errors.push(
      `Roster #${rNum} (${cleanSubName || 'Unknown'} - Sec ${cleanSection || '?'}): Zero valid students with registration numbers found.`
    );
  }

  return {
    errors,
    prepared: {
      index: idx,
      cleanFaculty,
      cleanFacultyIdCode,
      cleanSubName,
      cleanSubCode,
      cleanSection,
      cleanGroup,
      cleanAcadYear,
      cleanYear,
      cleanSemester,
      cleanDepartment,
      deduplicatedStudents,
      sourceFileName: defaultSourceFileName || rawMapping?.sourceFileName || 'Uploaded Nominal PDF',
    },
  };
}

function buildMappingKey(subjectCode, section, group) {
  return `${String(subjectCode).toUpperCase()}__${String(section).toUpperCase()}__${group || 'DEFAULT'}`;
}

async function prefetchContextForMappings(preparedList, session = null) {
  if (!preparedList.length) {
    return { existingByKey: new Map(), facultyUserByName: new Map(), subjectCodeSet: new Set() };
  }

  const pairClauses = [];
  const seenPairs = new Set();
  for (const vm of preparedList) {
    const pairKey = `${vm.cleanSubCode}__${vm.cleanSection}`;
    if (!seenPairs.has(pairKey)) {
      seenPairs.add(pairKey);
      pairClauses.push({ subjectCode: vm.cleanSubCode, section: vm.cleanSection, isCurrent: true });
    }
  }

  const existingQuery = FacultyMapping.find(
    pairClauses.length === 1 ? pairClauses[0] : { $or: pairClauses }
  );
  if (session) existingQuery.session(session);

  const facultyQuery = User.find({ role: 'faculty' }).select('_id name facultyId').lean();
  const subjectCodes = Array.from(new Set(preparedList.map((vm) => vm.cleanSubCode)));
  const subjectQuery = Subject.find({ subjectCode: { $in: subjectCodes } })
    .select('_id subjectCode academicYear semester')
    .lean();

  const [existingDocs, facultyUsers, existingSubjects] = await Promise.all([
    existingQuery,
    facultyQuery,
    subjectQuery,
  ]);

  const existingByKey = new Map();
  for (const doc of existingDocs) {
    const exactKey = buildMappingKey(doc.subjectCode, doc.section, doc.group || 'Group A');
    if (!existingByKey.has(exactKey)) {
      existingByKey.set(exactKey, doc);
    }
    const baseKey = `${doc.subjectCode}__${doc.section}`;
    if (!existingByKey.has(baseKey)) {
      existingByKey.set(baseKey, doc);
    }
  }

  const facultyUserByName = new Map();
  for (const u of facultyUsers) {
    if (u.name) {
      facultyUserByName.set(u.name.trim().toLowerCase(), u._id);
    }
    if (u.facultyId) {
      facultyUserByName.set(`id:${String(u.facultyId).trim().toUpperCase()}`, u._id);
    }
  }

  const subjectCodeSet = new Set(
    existingSubjects.map(
      (s) => `${String(s.subjectCode || '').toUpperCase()}__${s.academicYear || ''}__${s.semester || ''}`
    )
  );

  return { existingByKey, facultyUserByName, subjectCodeSet };
}

function buildStudentAndEnrollmentBulkOps(vm, studentOpMap, enrollmentBulkOps) {
  const {
    cleanFaculty,
    cleanSubName,
    cleanSubCode,
    cleanSection,
    cleanAcadYear,
    cleanYear,
    cleanSemester,
    deduplicatedStudents,
  } = vm;

  for (const st of deduplicatedStudents) {
    // Deduplicate master Student upserts across multiple subject rosters in the same batch
    studentOpMap.set(st.registrationNumber, {
      updateOne: {
        filter: { registrationNumber: st.registrationNumber, examId: { $exists: false } },
        update: {
          $setOnInsert: {
            registrationNumber: st.registrationNumber,
            status: 'active',
          },
          $set: {
            name: st.name,
            department: 'Computer Science and Engineering',
            year: cleanYear,
            semester: cleanSemester,
            section: cleanSection,
            group: st.group,
            academicYear: cleanAcadYear,
          },
        },
        upsert: true,
      },
    });

    enrollmentBulkOps.push({
      updateOne: {
        filter: {
          rollNumber: st.registrationNumber,
          subjectName: cleanSubName,
          academicYear: cleanAcadYear,
        },
        update: {
          $set: {
            rollNumber: st.registrationNumber,
            studentName: st.name,
            facultyName: cleanFaculty,
            section: cleanSection,
            subjectName: cleanSubName,
            subjectCode: cleanSubCode,
            group: st.group,
            academicYear: cleanAcadYear,
            department: 'Computer Science and Engineering',
            year: cleanYear,
            semester: cleanSemester,
            a1: st.a1 || '',
            a2: st.a2 || '',
            a3: st.a3 || '',
            a4: st.a4 || '',
            a5: st.a5 || '',
            a6: st.a6 || '',
          },
        },
        upsert: true,
      },
    });
  }
}

async function persistPreparedMapping(vm, opts = {}) {
  const {
    replaceExisting = true,
    user = null,
    session = null,
    existingByKey = null,
    facultyUserByName = null,
    subjectCodeSet = null,
    deferBulkSync = false,
    studentOpMap = null,
    enrollmentBulkOps = null,
    auditLogsOut = null,
  } = opts;

  const {
    cleanFaculty,
    cleanFacultyIdCode = '',
    cleanSubName,
    cleanSubCode,
    cleanSection,
    cleanGroup,
    cleanAcadYear,
    cleanYear,
    cleanSemester,
    cleanDepartment = 'Computer Science and Engineering',
    deduplicatedStudents,
    sourceFileName,
  } = vm;

  // Ensure Subject master record exists (compound keyed by subjectCode + academicYear + semester)
  const subKey = `${cleanSubCode}__${cleanAcadYear}__${cleanSemester}`;
  if (subjectCodeSet && !subjectCodeSet.has(subKey)) {
    try {
      await Subject.updateOne(
        { subjectCode: cleanSubCode, academicYear: cleanAcadYear, semester: cleanSemester },
        {
          $setOnInsert: {
            subjectName: cleanSubName,
            subjectCode: cleanSubCode,
            abbreviation: cleanSubCode.substring(0, 6),
            department: cleanDepartment,
            year: cleanYear,
            semester: cleanSemester,
            academicYear: cleanAcadYear,
            group: cleanGroup,
            sections: [cleanSection],
            isActive: true,
          },
        },
        session ? { upsert: true, session } : { upsert: true }
      );
      subjectCodeSet.add(subKey);
    } catch {}
  }

  let existing = null;
  if (existingByKey) {
    existing =
      existingByKey.get(buildMappingKey(cleanSubCode, cleanSection, cleanGroup)) ||
      existingByKey.get(`${cleanSubCode}__${cleanSection}`) ||
      null;
    // Match legacy null/empty group rule accurately
    if (existing && existing.group && existing.group !== cleanGroup) {
      existing = null;
    }
  } else {
    const q = FacultyMapping.findOne({
      subjectCode: cleanSubCode,
      section: cleanSection,
      isCurrent: true,
      $or: [
        { group: cleanGroup },
        { group: { $exists: false } },
        { group: null },
        { group: '' },
      ],
    });
    existing = session ? await q.session(session) : await q;
  }

  if (existing) {
    const isSameFaculty = existing.facultyName === cleanFaculty;
    const isSameCount = (existing.students || []).length === deduplicatedStudents.length;
    let isSameStudents = false;

    if (isSameFaculty && isSameCount) {
      const existingRegs = new Set((existing.students || []).map((s) => s.registrationNumber));
      isSameStudents = deduplicatedStudents.every((s) => existingRegs.has(s.registrationNumber));
    }

    if (isSameStudents) {
      // Idempotently reuse identical active mapping while ensuring Student/Enrollment sync still runs if requested
      if (!deferBulkSync) {
        const localStudentOps = new Map();
        const localEnrollOps = [];
        buildStudentAndEnrollmentBulkOps(vm, localStudentOps, localEnrollOps);
        await Promise.all([
          runBulkWriteChunked(Student, Array.from(localStudentOps.values()), session),
          runBulkWriteChunked(StudentEnrollment, localEnrollOps, session),
        ]);
      } else if (studentOpMap && enrollmentBulkOps) {
        buildStudentAndEnrollmentBulkOps(vm, studentOpMap, enrollmentBulkOps);
      }

      return {
        savedSummary: {
          id: existing._id,
          mappingId: existing._id,
          facultyName: existing.facultyName,
          subjectName: existing.subjectName,
          subjectCode: existing.subjectCode,
          section: existing.section,
          group: existing.group || cleanGroup,
          studentCount: existing.studentCount,
          version: existing.version || 1,
          status: 'ALREADY_ACTIVE',
        },
        reused: true,
      };
    }

    if (!replaceExisting && !isSameFaculty) {
      const conflictErr = new Error(
        `Mapping conflict: ${cleanSubCode} Section ${cleanSection} is currently assigned to ${existing.facultyName} (v${existing.version}). Enable 'Update/Replace existing mapping versions' to overwrite.`
      );
      conflictErr.statusCode = 409;
      throw conflictErr;
    }

    existing.isCurrent = false;
    if (session) {
      await existing.save({ session });
    } else {
      await existing.save();
    }
  }

  const nextVersion = existing ? (existing.version || 1) + 1 : 1;

  let facultyUserId = facultyUserByName
    ? (cleanFacultyIdCode ? facultyUserByName.get(`id:${cleanFacultyIdCode}`) : null) ||
      facultyUserByName.get(cleanFaculty.toLowerCase()) ||
      null
    : null;
  if (!facultyUserId && !facultyUserByName) {
    try {
      const facultyUser = await User.findOne({
        role: 'faculty',
        $or: [
          ...(cleanFacultyIdCode ? [{ facultyId: cleanFacultyIdCode }] : []),
          { name: { $regex: new RegExp(`^${cleanFaculty.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } },
        ],
      })
        .select('_id')
        .lean();
      if (facultyUser) facultyUserId = facultyUser._id;
    } catch {}
  }

  const newMapping = new FacultyMapping({
    facultyId: facultyUserId || undefined,
    facultyIdCode: cleanFacultyIdCode,
    facultyName: cleanFaculty,
    subjectName: cleanSubName,
    subjectCode: cleanSubCode,
    section: cleanSection,
    group: cleanGroup,
    academicYear: cleanAcadYear,
    department: cleanDepartment,
    year: cleanYear,
    semester: cleanSemester,
    version: nextVersion,
    isCurrent: true,
    status: 'ACTIVE',
    students: deduplicatedStudents,
    studentCount: deduplicatedStudents.length,
    sourceFileName,
    mappedBy: user ? user._id : undefined,
  });

  if (session) {
    await newMapping.save({ session });
  } else {
    await newMapping.save();
  }

  if (existingByKey) {
    existingByKey.set(buildMappingKey(cleanSubCode, cleanSection, cleanGroup), newMapping);
    existingByKey.set(`${cleanSubCode}__${cleanSection}`, newMapping);
  }

  if (deferBulkSync && studentOpMap && enrollmentBulkOps) {
    buildStudentAndEnrollmentBulkOps(vm, studentOpMap, enrollmentBulkOps);
  } else {
    const localStudentOps = new Map();
    const localEnrollOps = [];
    buildStudentAndEnrollmentBulkOps(vm, localStudentOps, localEnrollOps);
    await Promise.all([
      runBulkWriteChunked(Student, Array.from(localStudentOps.values()), session),
      runBulkWriteChunked(StudentEnrollment, localEnrollOps, session),
    ]);
  }

  const auditEntry = {
    action: 'FACULTY_MAPPING_BATCH_CONFIRMED',
    performedBy: user ? user._id : undefined,
    performedByName: user ? user.name : 'Administrator',
    details: {
      mappingId: newMapping._id,
      subjectCode: cleanSubCode,
      subjectName: cleanSubName,
      facultyName: cleanFaculty,
      section: cleanSection,
      group: cleanGroup,
      studentCount: deduplicatedStudents.length,
      version: nextVersion,
    },
  };

  if (auditLogsOut) {
    auditLogsOut.push(auditEntry);
  } else {
    try {
      await AuditLog.create(auditEntry);
    } catch {}
  }

  return {
    savedSummary: {
      id: newMapping._id,
      mappingId: newMapping._id,
      facultyName: newMapping.facultyName,
      subjectName: newMapping.subjectName,
      subjectCode: newMapping.subjectCode,
      section: newMapping.section,
      group: newMapping.group,
      studentCount: newMapping.studentCount,
      version: newMapping.version,
      status: 'SAVED',
    },
    mappingDoc: newMapping,
    reused: false,
  };
}

module.exports = {
  runBulkWriteChunked,
  validateAndPrepareMappingItem,
  prefetchContextForMappings,
  persistPreparedMapping,
};
