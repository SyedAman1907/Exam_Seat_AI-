const Student = require('../models/Student');
const StudentEnrollment = require('../models/StudentEnrollment');
const Exam = require('../models/Exam');
const Classroom = require('../models/Classroom');
const FacultyMapping = require('../models/FacultyMapping');
const AuditLog = require('../models/AuditLog');
const ImportService = require('../services/importService');
const PdfExtractorService = require('../services/pdfExtractorService');
const fs = require('fs');

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// @desc    Multi-file PDF / Excel / CSV Student Data Extraction & Validation Preview
// @route   POST /api/students/multi-pdf-preview
// @access  Private
exports.multiPdfPreview = async (req, res) => {
  const uploadedFiles = req.files || (req.file ? [req.file] : []);

  if (!uploadedFiles || uploadedFiles.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'No files uploaded. Please upload one or more student PDF, Excel, or CSV documents.',
    });
  }

  try {
    const { subjectName, facultyName, section, academicYear, group } = req.body;
    const extractionResult = await PdfExtractorService.extractFromMultipleFiles(uploadedFiles, {
      subjectName,
      facultyName,
      section,
      academicYear,
      group,
    });

    // Cleanup temp files
    uploadedFiles.forEach((f) => {
      try {
        if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
      } catch (e) {}
    });

    res.status(200).json({
      success: true,
      data: extractionResult,
    });
  } catch (error) {
    // Cleanup files on error
    uploadedFiles.forEach((f) => {
      try {
        if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
      } catch (e) {}
    });

    res.status(400).json({
      success: false,
      message: `PDF student extraction error: ${error.message}`,
    });
  }
};

// @desc    Confirm and Import Extracted Multi-PDF Student Records into Database
// @route   POST /api/students/multi-pdf-confirm
// @access  Private
exports.multiPdfConfirm = async (req, res) => {
  try {
    const { records, examId } = req.body;

    if (!records || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No student records provided to import.',
      });
    }

    const studentBulkOps = [];
    const enrollmentBulkOps = [];
    const normalizedRecords = [];

    for (const r of records) {
      const rollNumber = (r.rollNumber || '').trim().toUpperCase();
      const studentName = (r.studentName || '').trim();

      if (!rollNumber || !studentName) continue;

      const group = r.group === 'Group B' || r.group === 'B' ? 'Group B' : 'Group A';
      const section = (r.section || 'A').trim().toUpperCase();
      const subjectName = (r.subjectName || 'General Examination').trim();
      const facultyName = (r.facultyName || 'CSE Faculty').trim();
      const academicYear = r.academicYear || '2026-2027';
      const a1 = r.a1 ? String(r.a1).trim() : '';
      const a2 = r.a2 ? String(r.a2).trim() : '';
      const a3 = r.a3 ? String(r.a3).trim() : '';
      const a4 = r.a4 ? String(r.a4).trim() : '';
      const a5 = r.a5 ? String(r.a5).trim() : '';
      const a6 = r.a6 ? String(r.a6).trim() : '';
      const fdhNumber = r.fdhNumber ? r.fdhNumber.trim() : '';

      normalizedRecords.push({
        rollNumber,
        studentName,
        facultyName,
        section,
        subjectName,
        group,
        academicYear,
        a1,
        a2,
        a3,
        a4,
        a5,
        a6,
        fdhNumber,
      });

      // 1. Batched Upsert Master Student Identity (scoped cleanly away from examId copies)
      studentBulkOps.push({
        updateOne: {
          filter: { registrationNumber: rollNumber, examId: { $exists: false } },
          update: {
            $setOnInsert: { registrationNumber: rollNumber },
            $set: {
              name: studentName,
              department: r.department || 'Computer Science and Engineering',
              year: r.year || 'IV Year',
              semester: r.semester || 'I Semester',
              section,
              academicYear,
              defaultGroup: group,
              group,
              fdhNumber,
              facultyName,
              subject: subjectName,
              a1,
              a2,
              a3,
              a4,
              a5,
              a6,
              verifiedByFaculty: true,
              status: 'active',
            },
          },
          upsert: true,
        },
      });

      // 2. Batched Upsert Subject-wise Enrollment Record
      enrollmentBulkOps.push({
        updateOne: {
          filter: {
            rollNumber,
            subjectName,
            academicYear,
          },
          update: {
            $set: {
              studentName,
              facultyName,
              section,
              group,
              a1,
              a2,
              a3,
              a4,
              a5,
              a6,
              fdhNumber,
              sourceFileName: r.sourceFileName || 'Faculty PDF Upload',
              verifiedByFaculty: true,
              needsVerification: Boolean(r.hasMissingOptional),
            },
          },
          upsert: true,
        },
      });
    }

    await Promise.all([
      studentBulkOps.length > 0
        ? Student.bulkWrite(studentBulkOps, { ordered: false })
        : Promise.resolve(),
      enrollmentBulkOps.length > 0
        ? StudentEnrollment.bulkWrite(enrollmentBulkOps, { ordered: false })
        : Promise.resolve(),
    ]);

    const savedEnrollments = normalizedRecords;

    // If an examId is specified, also link active students to this Exam
    if (examId) {
      const exam = await Exam.findById(examId);
      if (exam) {
        // Find students belonging to this exam's group and section
        const matchingStudents = await Student.find({
          section: exam.section,
          ...(exam.group && exam.group !== 'ALL' ? { group: exam.group } : {}),
        });

        if (matchingStudents.length > 0) {
          // Clear old students for this exam and reassign
          await Student.deleteMany({ examId: exam._id });
          const examStudentDocs = matchingStudents.map((st) => ({
            examId: exam._id,
            registrationNumber: st.registrationNumber,
            name: st.name,
            department: exam.department,
            year: exam.year,
            semester: exam.semester,
            section: exam.section,
            subject: exam.subjectName,
            group: st.group || exam.group || 'Group A',
            facultyName: st.facultyName,
            fdhNumber: st.fdhNumber,
            a1: st.a1,
            a2: st.a2,
            a3: st.a3,
            a4: st.a4,
            a5: st.a5,
            a6: st.a6,
            status: 'active',
          }));
          await Student.insertMany(examStudentDocs);
          exam.studentCount = examStudentDocs.length;
          exam.status = 'STUDENTS_IMPORTED';
          await exam.save();
        }
      }
    }

    // Audit Log
    if (req.user) {
      await AuditLog.create({
        action: 'REAL_STUDENTS_IMPORTED',
        performedBy: req.user._id,
        performedByName: req.user.name,
        details: {
          importedCount: savedEnrollments.length,
          examId: examId || null,
        },
        ipAddress: req.ip,
      });
    }

    res.status(200).json({
      success: true,
      message: `Successfully confirmed and imported ${savedEnrollments.length} student records into structured database.`,
      count: savedEnrollments.length,
      data: savedEnrollments,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get Distinct Filter Dropdowns for Student Database (Lightweight)
// @route   GET /api/students/filters
// @access  Private
exports.getStudentFilterOptions = async (req, res) => {
  try {
    const [subjects, sections, faculty] = await Promise.all([
      StudentEnrollment.distinct('subjectName'),
      StudentEnrollment.distinct('section'),
      StudentEnrollment.distinct('facultyName'),
    ]);

    res.status(200).json({
      success: true,
      filtersAvailable: {
        subjects: subjects.filter(Boolean).sort(),
        sections: sections.filter(Boolean).sort(),
        faculty: faculty.filter(Boolean).sort(),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get Paginated Structured Student Database Records with Aggregation Summary
// @route   GET /api/students/database
// @access  Private
exports.getStudentDatabase = async (req, res) => {
  const startNs = process.hrtime.bigint();
  try {
    const {
      subject,
      section,
      faculty,
      group,
      search,
      academicYear,
      page = 1,
      limit = 50,
      includeMeta = 'true',
    } = req.query;

    const filter = {};

    if (subject && subject !== 'all') {
      filter.subjectName = { $regex: new RegExp(`^${escapeRegex(subject.trim())}$`, 'i') };
    }
    if (section && section !== 'all') {
      filter.section = section.trim().toUpperCase();
    }
    if (faculty && faculty !== 'all') {
      filter.facultyName = { $regex: new RegExp(escapeRegex(faculty.trim()), 'i') };
    }
    if (group && group !== 'all') {
      filter.group = group.trim();
    }
    if (academicYear && academicYear !== 'all') {
      filter.academicYear = academicYear.trim();
    }
    if (search && search.trim()) {
      const q = escapeRegex(search.trim());
      filter.$or = [
        { rollNumber: { $regex: q, $options: 'i' } },
        { studentName: { $regex: q, $options: 'i' } },
        { fdhNumber: { $regex: q, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const coreQueries = Promise.all([
      StudentEnrollment.countDocuments(filter),
      StudentEnrollment.find(filter)
        .select(
          'rollNumber studentName facultyName section subjectName subjectCode group academicYear a1 a2 a3 a4 a5 a6 fdhNumber verifiedByFaculty'
        )
        .sort({ section: 1, group: 1, rollNumber: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      StudentEnrollment.aggregate([
        { $match: filter },
        { $group: { _id: '$group', count: { $sum: 1 } } },
      ]),
    ]);

    const metaQueries =
      includeMeta === 'false'
        ? Promise.resolve(null)
        : Promise.all([
            StudentEnrollment.distinct('subjectName'),
            StudentEnrollment.distinct('section'),
            StudentEnrollment.distinct('facultyName'),
            Student.aggregate([
              { $match: { examId: { $exists: false } } },
              { $group: { _id: '$group', count: { $sum: 1 } } },
            ]),
            StudentEnrollment.aggregate([
              { $group: { _id: '$section', count: { $sum: 1 } } },
            ]),
            FacultyMapping.countDocuments({ isCurrent: true }),
            Classroom.find({ isActive: { $ne: false } })
              .select('roomNumber name totalCapacity')
              .sort({ roomNumber: 1 })
              .lean(),
          ]);

    const [[totalRecords, enrollments, groupAgg], metaResult] = await Promise.all([
      coreQueries,
      metaQueries,
    ]);

    let groupACount = 0;
    let groupBCount = 0;
    groupAgg.forEach((g) => {
      if (g._id === 'Group A' || g._id === 'A') groupACount += g.count;
      else if (g._id === 'Group B' || g._id === 'B') groupBCount += g.count;
    });

    const totalPages = Math.max(1, Math.ceil(totalRecords / limitNum));

    let filtersAvailable;
    let masterStats;
    let classroomSummary;
    let sectionCounts;

    if (metaResult) {
      const [
        distinctSubjects,
        distinctSections,
        distinctFaculty,
        masterGroupAgg,
        sectionAgg,
        totalMappings,
        activeRooms,
      ] = metaResult;

      let masterTotal = 0;
      let masterGroupA = 0;
      let masterGroupB = 0;
      masterGroupAgg.forEach((g) => {
        masterTotal += g.count;
        if (g._id === 'Group A' || g._id === 'A') masterGroupA += g.count;
        else if (g._id === 'Group B' || g._id === 'B') masterGroupB += g.count;
      });

      sectionCounts = {};
      sectionAgg.forEach((s) => {
        if (s._id) sectionCounts[s._id] = s.count;
      });

      const roomNumbers = activeRooms.map((r) => r.roomNumber).filter(Boolean);
      const rangeLabel =
        roomNumbers.length > 0
          ? roomNumbers.length === 1
            ? `Room ${roomNumbers[0]}`
            : `Rooms ${roomNumbers[0]} to ${roomNumbers[roomNumbers.length - 1]}`
          : 'No active classrooms';

      filtersAvailable = {
        subjects: distinctSubjects.filter(Boolean).sort(),
        sections: distinctSections.filter(Boolean).sort(),
        faculty: distinctFaculty.filter(Boolean).sort(),
      };
      masterStats = {
        total: masterTotal,
        groupA: masterGroupA,
        groupB: masterGroupB,
        totalMappings,
      };
      classroomSummary = {
        activeCount: activeRooms.length,
        roomNumbers,
        rangeLabel,
      };
    }

    if (process.env.NODE_ENV !== 'production' || process.env.PERF_LOGS === 'true') {
      const ms = (Number(process.hrtime.bigint() - startNs) / 1e6).toFixed(1);
      console.log(
        `[Perf] GET /api/students/database -> page=${pageNum}/${totalPages} rows=${enrollments.length}/${totalRecords} in ${ms}ms`
      );
    }

    res.status(200).json({
      success: true,
      count: totalRecords,
      groupACount,
      groupBCount,
      ...(masterStats && { masterStats }),
      ...(classroomSummary && { classroomSummary }),
      ...(sectionCounts && { sectionCounts }),
      ...(filtersAvailable && { filtersAvailable }),
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalRecords,
        totalPages,
      },
      data: enrollments,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Upload single student roster file (legacy endpoint preserved)
// @route   POST /api/students/import-preview
// @access  Private
exports.importPreview = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. Please upload a PDF, XLSX, XLS, or CSV file.',
      });
    }

    const { examId } = req.body;
    let regPattern = '^[0-9]{5}[A-Z0-9]{5}$';

    if (examId) {
      const exam = await Exam.findById(examId);
      if (exam && exam.regPattern) {
        regPattern = exam.regPattern;
      }
    }

    const parseResult = await ImportService.parseFile(req.file, { regPattern });

    // Clean up temp file
    try {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (e) {}

    res.status(200).json({
      success: true,
      data: parseResult,
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {}
    }

    res.status(400).json({
      success: false,
      message: `Extraction failed: ${error.message}`,
    });
  }
};

// @desc    Confirm and commit validated student records to database
// @route   POST /api/students/confirm
// @access  Private
exports.confirmStudents = async (req, res) => {
  try {
    const { examId, students, replaceExisting } = req.body;

    if (!examId) {
      return res.status(400).json({ success: false, message: 'Exam ID is required.' });
    }

    const exam = await Exam.findById(examId);
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Examination not found.' });
    }

    if (exam.status === 'LOCKED' || exam.status === 'PUBLISHED') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update students for a locked or published examination.',
      });
    }

    if (!students || !Array.isArray(students) || students.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No student records provided to confirm.',
      });
    }

    // Clear old students for this exam if required
    if (replaceExisting !== false) {
      await Student.deleteMany({ examId: exam._id });
    }

    const documentsToInsert = students.map((s) => ({
      examId: exam._id,
      registrationNumber: (s.registrationNumber || s.rollNumber).trim().toUpperCase(),
      name: (s.name || s.studentName).trim(),
      department: s.department || exam.department,
      year: s.year || exam.year,
      semester: s.semester || exam.semester,
      section: s.section || exam.section,
      group: s.group || exam.group || 'Group A',
      facultyName: s.facultyName || exam.facultyName || '',
      fdhNumber: s.fdhNumber || '',
      a1: s.a1 || '',
      a2: s.a2 || '',
      a3: s.a3 || '',
      a4: s.a4 || '',
      a5: s.a5 || '',
      a6: s.a6 || '',
      status: 'active',
    }));

    const inserted = await Student.insertMany(documentsToInsert, { ordered: true });

    exam.studentCount = inserted.length;
    exam.status = 'STUDENTS_IMPORTED';
    exam.updatedAt = new Date();
    await exam.save();

    await AuditLog.create({
      action: 'STUDENTS_IMPORTED',
      performedBy: req.user._id,
      performedByName: req.user.name,
      examId: exam._id,
      details: { count: inserted.length },
      ipAddress: req.ip,
    });

    res.status(200).json({
      success: true,
      message: `Successfully imported and confirmed ${inserted.length} students.`,
      count: inserted.length,
      data: inserted,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get all students for an exam
// @route   GET /api/exams/:id/students
// @access  Private
exports.getStudentsByExam = async (req, res) => {
  try {
    const students = await Student.find({ examId: req.params.id }).sort({ registrationNumber: 1 });
    res.status(200).json({
      success: true,
      count: students.length,
      data: students,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update single student record
// @route   PUT /api/students/:id
// @access  Private
exports.updateStudent = async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const { registrationNumber, name, status, group, fdhNumber, a1, a2, a3, a4, a5, a6 } = req.body;
    if (registrationNumber) student.registrationNumber = registrationNumber.trim().toUpperCase();
    if (name) student.name = name.trim();
    if (status) student.status = status;
    if (group) student.group = group;
    if (fdhNumber !== undefined) student.fdhNumber = fdhNumber;
    if (a1 !== undefined) student.a1 = a1;
    if (a2 !== undefined) student.a2 = a2;
    if (a3 !== undefined) student.a3 = a3;
    if (a4 !== undefined) student.a4 = a4;
    if (a5 !== undefined) student.a5 = a5;
    if (a6 !== undefined) student.a6 = a6;

    await student.save();

    // Also update in StudentEnrollment if exists
    await StudentEnrollment.updateMany(
      { rollNumber: student.registrationNumber },
      {
        $set: {
          studentName: student.name,
          group: student.group,
          fdhNumber: student.fdhNumber,
          a1: student.a1,
          a2: student.a2,
          a3: student.a3,
          a4: student.a4,
          a5: student.a5,
          a6: student.a6,
        },
      }
    );

    res.status(200).json({ success: true, data: student });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete single student
// @route   DELETE /api/students/:id
// @access  Private
exports.deleteStudent = async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const regNo = student.registrationNumber;
    const examId = student.examId;
    await Student.findByIdAndDelete(req.params.id);
    await StudentEnrollment.deleteMany({ rollNumber: regNo });

    if (examId) {
      const count = await Student.countDocuments({ examId });
      await Exam.findByIdAndUpdate(examId, { studentCount: count });
    }

    res.status(200).json({ success: true, message: 'Student deleted successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Clear all student records (Reset to clean slate)
// @route   DELETE /api/students/clear-all
// @access  Private (Admin Only)
exports.clearAllStudents = async (req, res) => {
  try {
    await Student.deleteMany({});
    await StudentEnrollment.deleteMany({});
    await Exam.updateMany({}, { studentCount: 0, status: 'DRAFT' });

    res.status(200).json({
      success: true,
      message: 'All student records cleared. Clean real-data state restored.',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get all students with search, filters, and pagination
// @route   GET /api/students
// @access  Private
exports.getStudents = async (req, res) => {
  try {
    const {
      search,
      section,
      group,
      academicYear,
      department,
      year,
      semester,
      examId,
      includeExamCopies,
      page = 1,
      limit = 50,
    } = req.query;
    const filter = {};

    if (examId) {
      filter.examId = examId;
    } else if (includeExamCopies !== 'true') {
      filter.examId = { $exists: false };
    }

    if (section && section !== 'ALL') filter.section = section.trim().toUpperCase();
    if (group && group !== 'ALL') filter.group = group.trim();
    if (academicYear && academicYear !== 'ALL') filter.academicYear = academicYear.trim();
    if (department && department !== 'ALL') filter.department = department.trim();
    if (year && year !== 'ALL') filter.year = year.trim();
    if (semester && semester !== 'ALL') filter.semester = semester.trim();

    if (search && search.trim()) {
      const q = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { registrationNumber: { $regex: new RegExp(q, 'i') } },
        { name: { $regex: new RegExp(q, 'i') } },
        { section: { $regex: new RegExp(q, 'i') } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [total, students] = await Promise.all([
      Student.countDocuments(filter),
      Student.find(filter)
        .select('registrationNumber name department year semester section academicYear subject facultyName group fdhNumber a1 a2 a3 a4 a5 a6 verifiedByFaculty status')
        .sort({ section: 1, registrationNumber: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
    ]);

    const totalPages = Math.ceil(total / limitNum) || 1;
    res.status(200).json({
      success: true,
      data: students,
      total,
      page: pageNum,
      totalPages,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalRecords: total,
        totalPages,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get single student by ID
// @route   GET /api/students/:id
// @access  Private
exports.getStudentById = async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }
    res.status(200).json({ success: true, data: student });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create new student record with validation and duplicate prevention
// @route   POST /api/students
// @access  Private
exports.createStudent = async (req, res) => {
  try {
    const { registrationNumber, name, section, group, department, year, semester, academicYear, fdhNumber } = req.body;

    if (!registrationNumber || !registrationNumber.trim()) {
      return res.status(400).json({ success: false, message: 'Registration number is required.' });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Student name is required.' });
    }

    const regNo = registrationNumber.trim().toUpperCase();
    const cleanSection = (section || 'A').trim().toUpperCase();
    const cleanAcademicYear = (academicYear || '2026-2027').trim();

    // Check duplicate
    const existing = await Student.findOne({
      registrationNumber: regNo,
      academicYear: cleanAcademicYear,
      section: cleanSection,
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Student with registration number ${regNo} already exists in Section ${cleanSection} (${cleanAcademicYear}).`,
      });
    }

    const student = await Student.create({
      registrationNumber: regNo,
      name: name.trim(),
      section: cleanSection,
      group: group || 'Group A',
      department: department || 'Computer Science and Engineering',
      year: year || 'IV Year',
      semester: semester || 'I Semester',
      academicYear: cleanAcademicYear,
      fdhNumber: fdhNumber ? fdhNumber.trim() : '',
    });

    res.status(201).json({
      success: true,
      message: 'Student record created successfully.',
      data: student,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
