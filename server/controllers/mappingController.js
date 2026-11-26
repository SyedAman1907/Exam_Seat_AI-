const mongoose = require('mongoose');
const FacultyMapping = require('../models/FacultyMapping');
const Student = require('../models/Student');
const StudentEnrollment = require('../models/StudentEnrollment');
const Subject = require('../models/Subject');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const PdfExtractorService = require('../services/pdfExtractorService');
const StudentClassificationService = require('../services/studentClassificationService');
const { isFacultyMappingOwner, filterMappingsForUser } = require('../utils/facultyAuthUtils');
const fs = require('fs');

/**
 * @desc    Upload student PDF and generate mapping preview
 *          Intelligently supports multi-page nominal lists containing multiple subject-wise rosters
 * @route   POST /api/mappings/upload-preview
 * @access  Private (Admin)
 */
exports.previewMappingPdf = async (req, res) => {
  const uploadedFiles = req.file ? [req.file] : (req.files || []);

  if (!uploadedFiles || uploadedFiles.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Please upload a student roster PDF file.',
    });
  }

  const file = uploadedFiles[0];

  try {
    // 1. Attempt multi-subject intelligent extraction
    let multiResult = null;
    try {
      multiResult = await PdfExtractorService.extractMultiSubjectRosters(
        file.path,
        file.originalname,
        req.body
      );
    } catch (multiErr) {
      console.warn('[Multi-Roster Parser Note, attempting standard extractor]:', multiErr.message);
    }

    // 2. If multi-roster extraction detected subject blocks (e.g. 27 distinct subject-wise nominal lists)
    if (multiResult && multiResult.mappings && multiResult.mappings.length > 0) {
      // Cleanup uploaded temp files
      uploadedFiles.forEach((f) => {
        try {
          if (f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path);
        } catch (e) {}
      });

      return res.status(200).json({
        success: true,
        isMultiRoster: multiResult.isMultiRoster,
        summary: multiResult.summary,
        mappings: multiResult.mappings,
        // Flat students array for backwards compatibility
        students: multiResult.mappings.flatMap((m) => m.students),
      });
    }

    // 3. Fallback to standard single-roster extractor
    const { facultyName, subjectName, subjectCode, section, academicYear, group } = req.body;
    const targetSection = (section || 'A1').trim().toUpperCase();

    const extractionResult = await PdfExtractorService.extractFromMultipleFiles(uploadedFiles, {
      facultyName: facultyName || '',
      subjectName: subjectName || '',
      subjectCode: subjectCode || '',
      section: targetSection,
      academicYear: academicYear || '2026-2027',
      group: group || 'Group A',
    });

    // Cleanup temp files
    uploadedFiles.forEach((f) => {
      try {
        if (f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path);
      } catch (e) {}
    });

    const students = (extractionResult.records || []).map((r, idx) => {
      const classification = StudentClassificationService.classifyStudent(r.rollNumber);
      return {
        sNo: r.serialNumber || idx + 1,
        registrationNumber: r.rollNumber,
        studentName: r.studentName,
        section: r.section || targetSection,
        subjectName: r.subjectName || subjectName,
        facultyName: r.facultyName || facultyName,
        group: r.group || classification.group || 'Group A',
        year: r.year || classification.year || 'III Year',
      };
    });

    res.status(200).json({
      success: true,
      isMultiRoster: false,
      students,
      mappings: [
        {
          id: 'mapping-1',
          mappingIndex: 1,
          subjectName: subjectName || extractionResult.meta?.subject || 'General Subject',
          subjectCode: subjectCode || '',
          facultyName: facultyName || extractionResult.meta?.faculty || 'Faculty Member',
          section: targetSection,
          group: group || 'Group A',
          academicYear: academicYear || '2026-2027',
          studentCount: students.length,
          students,
          isValid: students.length > 0,
          errors: [],
          warnings: [],
        },
      ],
      summary: {
        totalPages: 1,
        totalMappings: 1,
        totalStudentEnrollments: students.length,
        totalUniqueStudents: new Set(students.map((s) => s.registrationNumber)).size,
        totalDuplicatesWithinMappings: 0,
        sectionsDetected: [targetSection],
        facultyDetected: [facultyName || 'Faculty Member'],
        subjectsDetected: [subjectName || 'General Subject'],
      },
    });
  } catch (error) {
    uploadedFiles.forEach((f) => {
      try {
        if (f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path);
      } catch (e) {}
    });

    console.error('[PDF Mapping Preview Extraction Error]:', error);

    res.status(400).json({
      success: false,
      message: `Failed to extract students from PDF: ${error.message}`,
    });
  }
};

/**
 * @desc    Confirm and permanently save faculty-subject-section student mapping
 * @route   POST /api/mappings/confirm
 * @access  Private (Admin)
 */
exports.confirmMapping = async (req, res) => {
  try {
    const {
      facultyName,
      subjectName,
      subjectCode,
      section,
      academicYear,
      department,
      year,
      semester,
      students,
      sourceFileName,
      replaceExisting,
    } = req.body;

    // Validate required fields
    if (!facultyName || !facultyName.trim()) {
      return res.status(400).json({ success: false, message: 'Faculty name is required.' });
    }
    if (!subjectName || !subjectName.trim()) {
      return res.status(400).json({ success: false, message: 'Subject name is required.' });
    }
    if (!subjectCode || !subjectCode.trim()) {
      return res.status(400).json({ success: false, message: 'Subject code is required.' });
    }
    if (!section || !['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].includes(section.trim().toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: 'Valid Section (A1, A2, A3, A4, A5, A6) is required.',
      });
    }
    if (!students || !Array.isArray(students) || students.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No student records provided. Please upload a valid student PDF.',
      });
    }

    const cleanFaculty = facultyName.trim();
    const cleanSubName = subjectName.trim();
    const cleanSubCode = subjectCode.trim().toUpperCase();
    const cleanSection = section.trim().toUpperCase();
    const cleanAcadYear = academicYear || '2026-2027';
    const cleanDept = department || 'Computer Science and Engineering';

    // Validate and deduplicate students by registrationNumber
    const studentMap = new Map();
    for (const s of students) {
      const reg = (s.registrationNumber || s.rollNumber || '').trim().toUpperCase();
      const name = (s.name || s.studentName || '').trim();
      if (reg && name && !studentMap.has(reg)) {
        const classification = StudentClassificationService.classifyStudent(reg);
        const assignedGroup = s.group || classification.group || 'Group A';
        const assignedYear = s.year || classification.year || year || 'III Year';
        studentMap.set(reg, {
          registrationNumber: reg,
          name,
          group: assignedGroup,
          year: assignedYear,
          academicYear: cleanAcadYear,
          section: cleanSection,
          a1: s.a1 || '',
          a2: s.a2 || '',
          a3: s.a3 || '',
          a4: s.a4 || '',
          a5: s.a5 || '',
          a6: s.a6 || '',
        });
      }
    }

    const cleanStudentList = Array.from(studentMap.values()).sort((a, b) =>
      a.registrationNumber.localeCompare(b.registrationNumber)
    );

    if (cleanStudentList.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Zero valid student records found after parsing. Each record must have a registration number and name.',
      });
    }

    // Check if mapping already exists for (subjectCode, section)
    const existing = await FacultyMapping.findOne({
      subjectCode: cleanSubCode,
      section: cleanSection,
      isCurrent: true,
    });

    let newVersion = 1;
    if (existing) {
      if (!replaceExisting && existing.facultyName === cleanFaculty) {
        // If not explicitly replacing and exact same mapping exists, return existing
        return res.status(200).json({
          success: true,
          message: `Mapping for ${cleanSubCode} Section ${cleanSection} (${cleanFaculty}) already permanently exists with ${existing.studentCount} students.`,
          data: existing,
          alreadyExists: true,
        });
      }

      // Mark old mapping as not current (preserves historical examinations and version history!)
      existing.isCurrent = false;
      await existing.save();
      newVersion = (existing.version || 1) + 1;
    }

    // Create new permanent FacultyMapping
    const newMapping = new FacultyMapping({
      facultyName: cleanFaculty,
      subjectName: cleanSubName,
      subjectCode: cleanSubCode,
      section: cleanSection,
      academicYear: cleanAcadYear,
      department: cleanDept,
      year: year || 'IV Year',
      semester: semester || 'I Semester',
      version: newVersion,
      isCurrent: true,
      students: cleanStudentList,
      studentCount: cleanStudentList.length,
      sourceFileName: sourceFileName || '',
      mappedBy: req.user ? req.user._id : undefined,
    });

    await newMapping.save();

    // Synchronize to StudentEnrollment and Student collections
    for (const st of cleanStudentList) {
      await Student.findOneAndUpdate(
        { registrationNumber: st.registrationNumber },
        {
          $set: {
            name: st.name,
            department: cleanDept,
            year: year || 'IV Year',
            semester: semester || 'I Semester',
            section: cleanSection,
            academicYear: cleanAcadYear,
            defaultGroup: st.group,
            group: st.group,
            facultyName: cleanFaculty,
            a1: st.a1,
            a2: st.a2,
            a3: st.a3,
            a4: st.a4,
            a5: st.a5,
            a6: st.a6,
          },
        },
        { upsert: true, new: true }
      );

      await StudentEnrollment.findOneAndUpdate(
        {
          rollNumber: st.registrationNumber,
          subjectName: cleanSubName,
          academicYear: cleanAcadYear,
        },
        {
          $set: {
            studentName: st.name,
            facultyName: cleanFaculty,
            section: cleanSection,
            subjectCode: cleanSubCode,
            group: st.group,
            department: cleanDept,
            year: year || 'IV Year',
            semester: semester || 'I Semester',
            a1: st.a1,
            a2: st.a2,
            a3: st.a3,
            a4: st.a4,
            a5: st.a5,
            a6: st.a6,
          },
        },
        { upsert: true, new: true }
      );
    }

    // Write Audit Log
    await AuditLog.create({
      action: newVersion > 1 ? 'MAPPING_UPDATED' : 'MAPPING_CREATED',
      performedBy: req.user ? req.user._id : undefined,
      performedByName: req.user ? req.user.name : 'Administrator',
      details: {
        facultyName: cleanFaculty,
        subjectName: cleanSubName,
        subjectCode: cleanSubCode,
        section: cleanSection,
        studentCount: cleanStudentList.length,
        version: newVersion,
        replacedPrevious: Boolean(existing),
      },
    });

    res.status(201).json({
      success: true,
      message: `Successfully confirmed and permanently mapped ${cleanStudentList.length} students to ${cleanFaculty} for ${cleanSubName} (${cleanSubCode}) Section ${cleanSection} (v${newVersion}).`,
      data: newMapping,
    });
  } catch (error) {
    console.error('[Confirm Mapping Error]', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Confirm multiple subject-wise faculty mappings in batch
 *          Creates individual FacultyMapping records for each subject-faculty-section roster
 *          Upserts master students and independent subject enrollments without global duplicate rejection
 * @route   POST /api/mappings/confirm-batch
 * @access  Private (Admin)
 */
exports.confirmBatchMappings = async (req, res) => {
  const { mappings, sourceFileName, replaceExisting = true } = req.body;

  if (!mappings || !Array.isArray(mappings) || mappings.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'No mappings provided to confirm.',
    });
  }

  // 1. Independent Pre-Validation of every mapping in the batch
  const validationErrors = [];
  const validatedMappings = [];

  for (let idx = 0; idx < mappings.length; idx++) {
    const m = mappings[idx];
    const rNum = idx + 1;
    const cleanFaculty = (m.facultyName || '').trim();
    const cleanSubName = (m.subjectName || '').trim();
    const cleanSubCode = (m.subjectCode || '').trim().toUpperCase();
    const cleanSection = (m.section || '').trim().toUpperCase();
    const cleanGroup = m.group || (['A1', 'A2', 'A3'].includes(cleanSection) ? 'Group A' : ['A4', 'A5', 'A6'].includes(cleanSection) ? 'Group B' : 'Group A');
    const cleanAcadYear = m.academicYear || '2026-2027';
    const cleanYear = m.year || 'III Year';
    const cleanSemester = m.semester || 'I Semester';
    const mStudents = m.students || [];

    if (!cleanFaculty) {
      validationErrors.push(`Roster #${rNum} (${cleanSubName || 'Unknown'}): Faculty name is missing.`);
    }
    if (!cleanSubName) {
      validationErrors.push(`Roster #${rNum} (Sec ${cleanSection || 'Unknown'}): Subject name is missing.`);
    }
    if (!cleanSubCode) {
      validationErrors.push(`Roster #${rNum} (${cleanSubName}): Subject code is missing.`);
    }
    if (!['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].includes(cleanSection)) {
      validationErrors.push(`Roster #${rNum} (${cleanSubName}): Invalid section '${cleanSection}'. Expected A1, A2, A3, A4, A5, or A6.`);
    }
    if (!Array.isArray(mStudents) || mStudents.length === 0) {
      validationErrors.push(`Roster #${rNum} (${cleanSubName} - Sec ${cleanSection}): No student records found.`);
    }

    // Deduplicate students ONLY within this individual mapping
    const studentMap = new Map();
    for (const s of mStudents) {
      const reg = (s.registrationNumber || s.rollNumber || '').trim().toUpperCase();
      const name = (s.name || s.studentName || '').trim();
      if (reg && name && !studentMap.has(reg)) {
        const classification = StudentClassificationService.classifyStudent(reg);
        studentMap.set(reg, {
          registrationNumber: reg,
          name,
          group: s.group || classification.group || cleanGroup,
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

    if (deduplicatedStudents.length === 0) {
      validationErrors.push(`Roster #${rNum} (${cleanSubName} - Sec ${cleanSection}): Zero valid students with registration numbers found.`);
    }

    validatedMappings.push({
      cleanFaculty,
      cleanSubName,
      cleanSubCode,
      cleanSection,
      cleanGroup,
      cleanAcadYear,
      cleanYear,
      cleanSemester,
      deduplicatedStudents,
      sourceFileName: sourceFileName || m.sourceFileName || 'Uploaded Nominal PDF',
    });
  }

  if (validationErrors.length > 0) {
    return res.status(400).json({
      success: false,
      message: `Batch validation failed: ${validationErrors.length} issue(s) detected. No mappings were saved.`,
      errors: validationErrors,
    });
  }

  // 2. Transaction Safety (where supported by MongoDB replica set / mongos)
  let session = null;
  let hasActiveTransaction = false;

  try {
    const isReplSet = mongoose.connection.db
      ? Boolean((await mongoose.connection.db.command({ hello: 1 })).setName)
      : false;

    if (isReplSet) {
      session = await mongoose.startSession();
      session.startTransaction();
      hasActiveTransaction = true;
    }
  } catch (txErr) {
    session = null;
    hasActiveTransaction = false;
  }

  try {
    const savedMappings = [];
    const uniqueStudentsSet = new Set();
    let totalEnrollments = 0;
    let reusedCount = 0;

    for (const vm of validatedMappings) {
      const {
        cleanFaculty,
        cleanSubName,
        cleanSubCode,
        cleanSection,
        cleanGroup,
        cleanAcadYear,
        cleanYear,
        cleanSemester,
        deduplicatedStudents,
        sourceFileName: mSourceFile,
      } = vm;

      totalEnrollments += deduplicatedStudents.length;

      // Find existing active mapping for (subjectCode, section, group)
      const existingQuery = {
        subjectCode: cleanSubCode,
        section: cleanSection,
        isCurrent: true,
        $or: [
          { group: cleanGroup },
          { group: { $exists: false } },
          { group: null },
          { group: '' },
        ],
      };

      const existing = session
        ? await FacultyMapping.findOne(existingQuery).session(session)
        : await FacultyMapping.findOne(existingQuery);

      // Check if exact same mapping is already active (repeated confirmation safety)
      if (existing) {
        const isSameFaculty = existing.facultyName === cleanFaculty;
        const isSameCount = (existing.students || []).length === deduplicatedStudents.length;

        let isSameStudents = false;
        if (isSameFaculty && isSameCount) {
          const existingRegs = new Set((existing.students || []).map((s) => s.registrationNumber));
          isSameStudents = deduplicatedStudents.every((s) => existingRegs.has(s.registrationNumber));
        }

        if (isSameStudents) {
          // Exactly identical mapping already exists and is active!
          // Avoid creating duplicate rows on repeated clicks
          savedMappings.push({
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
          });
          reusedCount++;

          // Still ensure unique students are counted
          for (const st of deduplicatedStudents) {
            uniqueStudentsSet.add(st.registrationNumber);
          }
          continue;
        }

        // Mapping exists but has different data or faculty
        if (!replaceExisting && !isSameFaculty) {
          // Explicit protection: Do not silently overwrite genuine existing mappings without replaceExisting flag
          if (hasActiveTransaction && session) {
            await session.abortTransaction();
          }
          return res.status(409).json({
            success: false,
            message: `Mapping conflict: ${cleanSubCode} Section ${cleanSection} is currently assigned to ${existing.facultyName} (v${existing.version}). Enable 'Update/Replace existing mapping versions' to overwrite.`,
          });
        }

        // Archive existing mapping (preserve version history)
        existing.isCurrent = false;
        if (session) {
          await existing.save({ session });
        } else {
          await existing.save();
        }
      }

      const nextVersion = existing ? (existing.version || 1) + 1 : 1;

      // Lookup faculty User ID if registered
      let facultyUserId = null;
      try {
        const facultyUser = await User.findOne({
          name: { $regex: new RegExp(`^${cleanFaculty.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
          role: 'faculty',
        });
        if (facultyUser) facultyUserId = facultyUser._id;
      } catch (uErr) {}

      // Create new permanent FacultyMapping record
      const newMapping = new FacultyMapping({
        facultyId: facultyUserId || (req.user ? req.user._id : undefined),
        facultyName: cleanFaculty,
        subjectName: cleanSubName,
        subjectCode: cleanSubCode,
        section: cleanSection,
        group: cleanGroup,
        academicYear: cleanAcadYear,
        department: 'Computer Science and Engineering',
        year: cleanYear,
        semester: cleanSemester,
        version: nextVersion,
        isCurrent: true,
        students: deduplicatedStudents,
        studentCount: deduplicatedStudents.length,
        sourceFileName: mSourceFile,
        mappedBy: req.user ? req.user._id : undefined,
      });

      if (session) {
        await newMapping.save({ session });
      } else {
        await newMapping.save();
      }

      savedMappings.push({
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
      });

      // Synchronize Master Student & Multi-Subject StudentEnrollment records via bulkWrite
      const studentBulkOps = [];
      const enrollmentBulkOps = [];

      for (const st of deduplicatedStudents) {
        uniqueStudentsSet.add(st.registrationNumber);

        studentBulkOps.push({
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

      const bulkOpts = session ? { ordered: false, session } : { ordered: false };
      if (studentBulkOps.length > 0) {
        await Student.bulkWrite(studentBulkOps, bulkOpts);
      }
      if (enrollmentBulkOps.length > 0) {
        await StudentEnrollment.bulkWrite(enrollmentBulkOps, bulkOpts);
      }

      // Write Audit Log
      try {
        await AuditLog.create({
          action: 'FACULTY_MAPPING_BATCH_CONFIRMED',
          performedBy: req.user ? req.user._id : undefined,
          performedByName: req.user ? req.user.name : 'Administrator',
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
        });
      } catch (aErr) {}
    }

    if (hasActiveTransaction && session) {
      await session.commitTransaction();
    }

    res.status(200).json({
      success: true,
      message: `Successfully confirmed ${savedMappings.length} mappings (${totalEnrollments} enrollments across ${uniqueStudentsSet.size} unique students).`,
      count: savedMappings.length,
      totalEnrollments,
      uniqueStudents: uniqueStudentsSet.size,
      reusedCount,
      mappings: savedMappings,
    });
  } catch (err) {
    if (hasActiveTransaction && session) {
      try {
        await session.abortTransaction();
      } catch (abErr) {}
    }
    console.error('[Confirm Batch Mappings Error]:', err);
    res.status(500).json({
      success: false,
      message: `Failed to confirm batch mappings: ${err.message}`,
    });
  } finally {
    if (session) {
      try {
        session.endSession();
      } catch (e) {}
    }
  }
};

/**
 * @desc    Get portal mappings grouped by Academic Year -> Semester -> Subject -> Subject Code -> Sections
 * @route   GET /api/mappings/portal-groups
 * @access  Private
 */
exports.getPortalGroups = async (req, res) => {
  try {
    const { academicYear, semester, faculty, subject, section, search, scope } = req.query;
    const filter = { isCurrent: true };

    if (academicYear && academicYear !== 'ALL') {
      filter.academicYear = academicYear;
    }
    if (semester && semester !== 'ALL') {
      filter.semester = semester;
    }

    // Role-based access control and faculty filtering
    // Never trust a faculty filter/scope supplied by the frontend when logged in as normal faculty
    const isNormalFaculty = req.user && req.user.role === 'faculty';
    if (!isNormalFaculty && faculty && faculty !== 'ALL') {
      filter.facultyName = { $regex: new RegExp(faculty.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') };
    }

    if (subject && subject !== 'ALL') {
      filter.subjectName = { $regex: new RegExp(`^${subject.trim()}$`, 'i') };
    }
    if (section && section !== 'ALL') {
      filter.section = section.trim().toUpperCase();
    }
    if (search && search.trim()) {
      const s = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { subjectName: { $regex: new RegExp(s, 'i') } },
        { subjectCode: { $regex: new RegExp(s, 'i') } },
        { facultyName: { $regex: new RegExp(s, 'i') } },
      ];
    }

    const [rawMappings, allCurrentRaw] = await Promise.all([
      FacultyMapping.find(filter)
        .select('facultyId facultyName subjectName subjectCode section group academicYear department year semester studentCount')
        .sort({ subjectName: 1, section: 1 })
        .lean(),
      FacultyMapping.find({ isCurrent: true })
        .select('facultyId academicYear semester facultyName')
        .lean(),
    ]);

    // Strict isolation: faculty see ONLY their own assigned mappings (never other faculty members' mappings)
    const mappings = filterMappingsForUser(req.user, rawMappings);

    // Grouping by Subject Identity & Subject Code
    const subjectMap = new Map();
    let totalEnrollmentSum = 0;

    mappings.forEach((m) => {
      totalEnrollmentSum += m.studentCount || 0;
      const key = `${(m.subjectCode || '').trim().toUpperCase()}___${(m.subjectName || '').trim()}`;
      if (!subjectMap.has(key)) {
        subjectMap.set(key, {
          subjectName: m.subjectName,
          subjectCode: m.subjectCode,
          academicYear: m.academicYear || '2026-2027',
          year: m.year || 'III Year',
          semester: m.semester || 'I Semester',
          department: m.department || 'Computer Science and Engineering',
          sections: [],
          totalStudents: 0,
        });
      }
      const entry = subjectMap.get(key);
      entry.sections.push({
        mappingId: m._id,
        section: m.section,
        group: m.group || (['A1', 'A2', 'A3'].includes(m.section) ? 'Group A' : 'Group B'),
        facultyName: m.facultyName,
        studentCount: m.studentCount,
        academicYear: m.academicYear,
        year: m.year,
        semester: m.semester,
      });
      entry.totalStudents += m.studentCount || 0;
    });

    // Sort sections naturally A1..A6
    subjectMap.forEach((val) => {
      val.sections.sort((a, b) => a.section.localeCompare(b.section));
    });

    const subjects = Array.from(subjectMap.values());

    // Group hierarchy: Academic Year -> Semester -> Subjects
    const hierarchyMap = new Map();
    subjects.forEach((sub) => {
      const ay = sub.academicYear || '2026-2027';
      const sem = sub.semester || 'I Semester';
      if (!hierarchyMap.has(ay)) {
        hierarchyMap.set(ay, new Map());
      }
      const semMap = hierarchyMap.get(ay);
      if (!semMap.has(sem)) {
        semMap.set(sem, []);
      }
      semMap.get(sem).push(sub);
    });

    const hierarchy = [];
    hierarchyMap.forEach((semMap, ay) => {
      const semestersList = [];
      semMap.forEach((subList, sem) => {
        semestersList.push({
          semester: sem,
          subjects: subList,
        });
      });
      hierarchy.push({
        academicYear: ay,
        semesters: semestersList,
      });
    });

    // Distinct filter options scoped to user role (already loaded in parallel above)
    const allCurrent = filterMappingsForUser(req.user, allCurrentRaw);
    const distinctAcademicYears = Array.from(new Set(allCurrent.map((m) => m.academicYear).filter(Boolean))).sort();
    const distinctSemesters = Array.from(new Set(allCurrent.map((m) => m.semester).filter(Boolean))).sort();
    const distinctFaculties = Array.from(new Set(allCurrent.map((m) => m.facultyName).filter(Boolean))).sort();

    res.status(200).json({
      success: true,
      stats: {
        totalSubjects: subjects.length,
        totalSections: mappings.length,
        totalEnrollments: totalEnrollmentSum,
      },
      filters: {
        academicYears: distinctAcademicYears,
        semesters: distinctSemesters,
        faculties: distinctFaculties,
      },
      subjects,
      hierarchy,
      rawCount: mappings.length,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Get all mappings with optional filtering
 * @route   GET /api/mappings
 * @access  Private
 */
exports.getMappings = async (req, res) => {
  try {
    const { faculty, subject, section, currentOnly, academicYear, semester } = req.query;
    const filter = {};

    if (currentOnly !== 'false') {
      filter.isCurrent = true;
    }
    if (academicYear && academicYear !== 'ALL') {
      filter.academicYear = academicYear;
    }
    if (semester && semester !== 'ALL') {
      filter.semester = semester;
    }
    if (req.user && req.user.role !== 'faculty' && faculty && faculty !== 'all' && faculty !== 'ALL') {
      filter.facultyName = { $regex: new RegExp(faculty.trim(), 'i') };
    }
    if (subject && subject !== 'all' && subject !== 'ALL') {
      filter.subjectName = { $regex: new RegExp(`^${subject.trim()}$`, 'i') };
    }
    if (section && section !== 'all' && section !== 'ALL') {
      filter.section = section.trim().toUpperCase();
    }

    const rawMappings = await FacultyMapping.find(filter)
      .select('facultyId facultyName subjectName subjectCode section group academicYear department year semester version isCurrent studentCount sourceFileName createdAt updatedAt')
      .sort({ facultyName: 1, subjectName: 1, section: 1 })
      .lean();

    const mappings = filterMappingsForUser(req.user, rawMappings);

    res.status(200).json({
      success: true,
      count: mappings.length,
      data: mappings,
      mappings,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Get active mappings for examination creation dropdowns
 * @route   GET /api/mappings/active-options
 * @access  Private
 */
exports.getActiveMappingOptions = async (req, res) => {
  try {
    const { facultyName } = req.query;
    const filter = { isCurrent: true };

    if (req.user && req.user.role !== 'faculty' && facultyName && facultyName.trim() && facultyName !== 'all') {
      filter.facultyName = { $regex: new RegExp(`^${facultyName.trim()}$`, 'i') };
    }

    const rawMappings = await FacultyMapping.find(filter)
      .select('facultyId facultyName subjectName subjectCode section group studentCount')
      .sort({ subjectName: 1, section: 1 })
      .lean();

    const mappings = filterMappingsForUser(req.user, rawMappings);

    // Group subjects and sections
    const subjectMap = new Map();
    mappings.forEach((m) => {
      const key = `${m.subjectCode}___${m.subjectName}___${m.group || 'ALL'}`;
      if (!subjectMap.has(key)) {
        subjectMap.set(key, {
          subjectCode: m.subjectCode,
          subjectName: m.subjectName,
          facultyName: m.facultyName,
          group: m.group || 'Group A',
          sections: [],
        });
      }
      subjectMap.get(key).sections.push({
        section: m.section,
        group: m.group || 'Group A',
        studentCount: m.studentCount,
        mappingId: m._id,
        facultyName: m.facultyName,
      });
    });

    const faculties = Array.from(new Set(mappings.map((m) => m.facultyName))).sort();
    const subjects = Array.from(subjectMap.values());

    res.status(200).json({
      success: true,
      faculties,
      subjects,
      rawMappings: mappings,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Get single mapping with full student list
 * @route   GET /api/mappings/:id
 * @access  Private
 */
exports.getMappingById = async (req, res) => {
  try {
    const mapping = await FacultyMapping.findById(req.params.id);
    if (!mapping) {
      return res.status(404).json({ success: false, message: 'Mapping not found.' });
    }

    // Role-based access control: normal faculty can only view their own assigned section rosters
    if (req.user && req.user.role === 'faculty') {
      if (!isFacultyMappingOwner(req.user, mapping)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You are only authorized to view student rosters for your own assigned sections.',
        });
      }
    }

    res.status(200).json({
      success: true,
      data: mapping,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Retrieve students permanently mapped to subject & section
 * @route   GET /api/mappings/lookup-students
 * @access  Private
 */
exports.lookupMappedStudents = async (req, res) => {
  try {
    const { subjectCode, subjectName, section, facultyName } = req.query;

    if (!section) {
      return res.status(400).json({ success: false, message: 'Section is required.' });
    }

    const targetSection = section.trim().toUpperCase();
    const filter = { section: targetSection, isCurrent: true };

    if (subjectCode && subjectCode.trim()) {
      filter.subjectCode = subjectCode.trim().toUpperCase();
    } else if (subjectName && subjectName.trim()) {
      filter.subjectName = { $regex: new RegExp(`^${subjectName.trim()}$`, 'i') };
    }

    if (req.user && req.user.role !== 'faculty' && facultyName && facultyName.trim() && facultyName !== 'all') {
      filter.facultyName = { $regex: new RegExp(facultyName.trim(), 'i') };
    }

    if (req.query.group && req.query.group !== 'ALL') {
      filter.group = req.query.group.trim();
    }

    let mapping = await FacultyMapping.findOne(filter).sort({ version: -1 });

    // Fallback: If not found with group filter, try without group filter
    if (!mapping && filter.group) {
      delete filter.group;
      mapping = await FacultyMapping.findOne(filter).sort({ version: -1 });
    }

    // Fallback 2: If not found by subjectCode + section, search by section only IF no subject specified
    if (!mapping && !subjectCode && !subjectName) {
      mapping = await FacultyMapping.findOne({ section: targetSection, isCurrent: true }).sort({ version: -1 });
    }

    if (mapping) {
      if (req.user && req.user.role === 'faculty' && !isFacultyMappingOwner(req.user, mapping)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You are only authorized to view students in your own assigned mappings.',
        });
      }
      let filteredStudents = mapping.students || [];
      if (req.query.group && req.query.group !== 'ALL') {
        const targetGroup = req.query.group.trim();
        filteredStudents = filteredStudents.filter(
          (s) => (s.group || StudentClassificationService.classifyStudent(s.registrationNumber).group) === targetGroup
        );
      }
      return res.status(200).json({
        success: true,
        source: 'FacultyMapping',
        mappingId: mapping._id,
        version: mapping.version,
        facultyName: mapping.facultyName,
        subjectName: mapping.subjectName,
        subjectCode: mapping.subjectCode,
        section: mapping.section,
        group: req.query.group || 'ALL',
        studentCount: filteredStudents.length,
        count: filteredStudents.length,
        students: filteredStudents,
      });
    }

    // Fallback 2: Check StudentEnrollment
    let enrollQuery = { section: targetSection };
    if (subjectName && subjectName.trim()) {
      enrollQuery.subjectName = { $regex: new RegExp(`^${subjectName.trim()}$`, 'i') };
    }
    let enrollments = await StudentEnrollment.find(enrollQuery).sort({ rollNumber: 1 });
    if (!enrollments || enrollments.length === 0) {
      enrollments = await StudentEnrollment.find({ section: targetSection }).sort({ rollNumber: 1 });
    }

    if (enrollments && enrollments.length > 0) {
      const students = enrollments.map((en) => ({
        registrationNumber: en.rollNumber,
        name: en.studentName,
        group: en.group || 'Group A',
        a1: en.a1 || '',
        a2: en.a2 || '',
        a3: en.a3 || '',
        a4: en.a4 || '',
        a5: en.a5 || '',
        a6: en.a6 || '',
      }));

      return res.status(200).json({
        success: true,
        source: 'StudentEnrollment',
        mappingId: null,
        version: 1,
        facultyName: enrollments[0].facultyName || facultyName || 'CSE Faculty',
        subjectName: enrollments[0].subjectName || subjectName || '',
        subjectCode: enrollments[0].subjectCode || subjectCode || '',
        section: targetSection,
        studentCount: students.length,
        students,
      });
    }

    res.status(200).json({
      success: true,
      source: 'None',
      studentCount: 0,
      students: [],
      message: `No mapped students found for Section ${targetSection}. Please upload a student roster on the Faculty & Student Assignment page.`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Deactivate / Delete mapping
 * @route   DELETE /api/mappings/:id
 * @access  Private (Admin)
 */
exports.deleteMapping = async (req, res) => {
  try {
    const mapping = await FacultyMapping.findById(req.params.id);
    if (!mapping) {
      return res.status(404).json({ success: false, message: 'Mapping not found.' });
    }

    mapping.isCurrent = false;
    await mapping.save();

    res.status(200).json({
      success: true,
      message: `Mapping for ${mapping.subjectCode} Section ${mapping.section} has been deactivated.`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Direct Create Mapping (CRUD Operation)
 * @route   POST /api/mappings
 * @access  Private (Admin / Exam Incharge)
 */
exports.createMapping = async (req, res) => {
  try {
    const {
      facultyName,
      facultyId,
      subjectName,
      subjectCode,
      section,
      group,
      academicYear = '2026-2027',
      department = 'Computer Science and Engineering',
      year = 'III Year',
      semester = 'I Semester',
      students = [],
      replaceExisting = true,
      sourceFileName = 'Manual Entry',
    } = req.body;

    if (!facultyName || !facultyName.trim()) {
      return res.status(400).json({ success: false, message: 'Faculty Name is required.' });
    }
    if (!subjectName || !subjectName.trim()) {
      return res.status(400).json({ success: false, message: 'Subject Name is required.' });
    }
    if (!subjectCode || !subjectCode.trim()) {
      return res.status(400).json({ success: false, message: 'Subject Code is required.' });
    }
    const cleanSection = (section || '').trim().toUpperCase();
    if (!['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].includes(cleanSection)) {
      return res.status(400).json({
        success: false,
        message: 'Valid Section (A1, A2, A3, A4, A5, A6) is required.',
      });
    }

    const cleanSubCode = subjectCode.trim().toUpperCase();
    const cleanSubName = subjectName.trim();
    const cleanFaculty = facultyName.trim();
    const cleanGroup = group || (['A1', 'A2', 'A3'].includes(cleanSection) ? 'Group A' : 'Group B');

    // Verify / ensure Subject exists in Subject master collection
    let subjectDoc = await Subject.findOne({ subjectCode: cleanSubCode });
    if (!subjectDoc) {
      subjectDoc = await Subject.create({
        subjectName: cleanSubName,
        subjectCode: cleanSubCode,
        abbreviation: cleanSubCode.substring(0, 4),
        department,
        year,
        semester,
        academicYear,
        isActive: true,
      });
    }

    // Verify Faculty User ID if not provided
    let verifiedFacultyId = facultyId;
    if (!verifiedFacultyId) {
      const facUser = await User.findOne({
        name: { $regex: new RegExp(`^${cleanFaculty.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      });
      if (facUser) verifiedFacultyId = facUser._id;
    }

    // Deduplicate and validate students by registrationNumber
    const studentMap = new Map();
    for (const s of students) {
      const reg = (s.registrationNumber || s.rollNumber || '').trim().toUpperCase();
      const name = (s.name || s.studentName || '').trim();
      if (reg && name && !studentMap.has(reg)) {
        const classification = StudentClassificationService.classifyStudent(reg);
        studentMap.set(reg, {
          registrationNumber: reg,
          name,
          group: s.group || classification.group || cleanGroup,
          a1: s.a1 || '',
          a2: s.a2 || '',
          a3: s.a3 || '',
          a4: s.a4 || '',
          a5: s.a5 || '',
          a6: s.a6 || '',
        });
      }
    }

    const cleanStudents = Array.from(studentMap.values()).sort((a, b) =>
      a.registrationNumber.localeCompare(b.registrationNumber)
    );

    // Check existing active mapping
    const existing = await FacultyMapping.findOne({
      subjectCode: cleanSubCode,
      section: cleanSection,
      isCurrent: true,
      $or: [{ group: cleanGroup }, { group: { $exists: false } }, { group: null }, { group: '' }],
    });

    let newVersion = 1;
    if (existing) {
      if (!replaceExisting && existing.facultyName === cleanFaculty) {
        return res.status(200).json({
          success: true,
          message: `Mapping already exists for ${cleanSubCode} Section ${cleanSection} (${cleanFaculty}).`,
          data: existing,
        });
      }
      existing.isCurrent = false;
      await existing.save();
      newVersion = (existing.version || 1) + 1;
    }

    const newMapping = new FacultyMapping({
      facultyId: verifiedFacultyId || req.user?._id,
      facultyName: cleanFaculty,
      subjectName: cleanSubName,
      subjectCode: cleanSubCode,
      section: cleanSection,
      group: cleanGroup,
      academicYear,
      department,
      year,
      semester,
      version: newVersion,
      isCurrent: true,
      status: 'ACTIVE',
      students: cleanStudents,
      studentCount: cleanStudents.length,
      sourceFileName,
      mappedBy: req.user?._id,
    });

    await newMapping.save();

    // Synchronize to Master Student & StudentEnrollment via bulkWrite
    if (cleanStudents.length > 0) {
      const studentOps = [];
      const enrollOps = [];
      for (const st of cleanStudents) {
        studentOps.push({
          updateOne: {
            filter: { registrationNumber: st.registrationNumber, examId: { $exists: false } },
            update: {
              $setOnInsert: { registrationNumber: st.registrationNumber, status: 'active' },
              $set: {
                name: st.name,
                department,
                year,
                semester,
                section: cleanSection,
                group: st.group,
                academicYear,
              },
            },
            upsert: true,
          },
        });
        enrollOps.push({
          updateOne: {
            filter: {
              rollNumber: st.registrationNumber,
              subjectName: cleanSubName,
              academicYear,
            },
            update: {
              $set: {
                studentName: st.name,
                facultyName: cleanFaculty,
                section: cleanSection,
                subjectCode: cleanSubCode,
                group: st.group,
                academicYear,
                department,
                year,
                semester,
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
      await Promise.all([
        Student.bulkWrite(studentOps, { ordered: false }),
        StudentEnrollment.bulkWrite(enrollOps, { ordered: false }),
      ]);
    }

    await AuditLog.create({
      action: newVersion > 1 ? 'MAPPING_UPDATED' : 'MAPPING_CREATED',
      performedBy: req.user?._id,
      performedByName: req.user?.name || 'Administrator',
      details: {
        mappingId: newMapping._id,
        facultyName: cleanFaculty,
        subjectName: cleanSubName,
        subjectCode: cleanSubCode,
        section: cleanSection,
        group: cleanGroup,
        studentCount: cleanStudents.length,
        version: newVersion,
      },
      ipAddress: req.ip,
    });

    res.status(201).json({
      success: true,
      message: `Mapping successfully saved into MongoDB Atlas (${cleanStudents.length} students assigned).`,
      data: newMapping,
    });
  } catch (error) {
    console.error('[Create Mapping Error]:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * @desc    Direct Update Mapping by ID (CRUD Operation)
 * @route   PUT /api/mappings/:id
 * @access  Private (Admin / Exam Incharge)
 */
exports.updateMappingById = async (req, res) => {
  try {
    const mapping = await FacultyMapping.findById(req.params.id);
    if (!mapping) {
      return res.status(404).json({ success: false, message: 'Mapping not found.' });
    }

    const {
      facultyName,
      facultyId,
      subjectName,
      subjectCode,
      section,
      group,
      academicYear,
      department,
      year,
      semester,
      students,
      status,
    } = req.body;

    if (facultyName) mapping.facultyName = facultyName.trim();
    if (facultyId) mapping.facultyId = facultyId;
    if (subjectName) mapping.subjectName = subjectName.trim();
    if (subjectCode) mapping.subjectCode = subjectCode.trim().toUpperCase();
    if (section) {
      const cleanSec = section.trim().toUpperCase();
      if (['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].includes(cleanSec)) {
        mapping.section = cleanSec;
      }
    }
    if (group) mapping.group = group;
    if (academicYear) mapping.academicYear = academicYear.trim();
    if (department) mapping.department = department.trim();
    if (year) mapping.year = year.trim();
    if (semester) mapping.semester = semester.trim();
    if (status) mapping.status = status;

    if (students && Array.isArray(students)) {
      const studentMap = new Map();
      for (const s of students) {
        const reg = (s.registrationNumber || s.rollNumber || '').trim().toUpperCase();
        const name = (s.name || s.studentName || '').trim();
        if (reg && name && !studentMap.has(reg)) {
          const classification = StudentClassificationService.classifyStudent(reg);
          studentMap.set(reg, {
            registrationNumber: reg,
            name,
            group: s.group || classification.group || mapping.group,
            a1: s.a1 || '',
            a2: s.a2 || '',
            a3: s.a3 || '',
            a4: s.a4 || '',
            a5: s.a5 || '',
            a6: s.a6 || '',
          });
        }
      }
      mapping.students = Array.from(studentMap.values()).sort((a, b) =>
        a.registrationNumber.localeCompare(b.registrationNumber)
      );
      mapping.studentCount = mapping.students.length;
    }

    mapping.version = (mapping.version || 1) + 1;
    await mapping.save();

    await AuditLog.create({
      action: 'MAPPING_UPDATED',
      performedBy: req.user?._id,
      performedByName: req.user?.name || 'Administrator',
      details: {
        mappingId: mapping._id,
        facultyName: mapping.facultyName,
        subjectCode: mapping.subjectCode,
        section: mapping.section,
        version: mapping.version,
      },
      ipAddress: req.ip,
    });

    res.status(200).json({
      success: true,
      message: `Mapping updated successfully (v${mapping.version}).`,
      data: mapping,
    });
  } catch (error) {
    console.error('[Update Mapping Error]:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
