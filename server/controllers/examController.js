const mongoose = require('mongoose');
const Exam = require('../models/Exam');
const Student = require('../models/Student');
const Classroom = require('../models/Classroom');
const Allocation = require('../models/Allocation');
const AuditLog = require('../models/AuditLog');
const StudentEnrollment = require('../models/StudentEnrollment');
const FacultyMapping = require('../models/FacultyMapping');
const StudentClassificationService = require('../services/studentClassificationService');
const SeatingService = require('../services/seatingService');
const ReportService = require('../services/reportService');
const schedulerService = require('../services/schedulerService');
const classroomMappingService = require('../services/classroomMappingService');
const portalCache = require('../services/portalCache');
const {
  isFacultyMappingOwner,
  filterMappingsForUser,
  isExamCreator,
  canFacultyViewExam,
  canUserManageExam,
  normalizePersonName,
} = require('../utils/facultyAuthUtils');
const {
  parseKolkataDateTime,
  parseExamDateRange,
  formatTime12h,
  formatExamTimeRange,
  normalizeSessionCode,
  isSameSessionPolarity,
  formatSessionLabel,
  getPublicationTime,
  normalizeDateStr,
  getTodayKolkataDate,
  getEffectiveNow,
} = require('../utils/dateTimeUtils');
const { normalizeExamType, resolveExamType } = require('../utils/examTypeUtils');

async function runWithOptionalTransaction(workFn) {
  let session = null;
  try {
    session = await mongoose.startSession();
    let result;
    await session.withTransaction(async () => {
      result = await workFn(session);
    });
    return result;
  } catch (txErr) {
    const msg = String(txErr?.message || '');
    if (
      msg.includes('Transaction numbers are only allowed') ||
      msg.includes('replica set') ||
      msg.includes('does not support transactions')
    ) {
      return await workFn(null);
    }
    throw txErr;
  } finally {
    if (session) {
      try {
        await session.endSession();
      } catch (e) {}
    }
  }
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function attachExamPermissions(obj, user) {
  if (!obj) return obj;
  if (obj.startTime) obj.startTime = formatTime12h(obj.startTime, obj.startTime);
  if (obj.endTime) obj.endTime = formatTime12h(obj.endTime, obj.endTime);
  obj.examType = resolveExamType(obj);
  obj.formattedTimeRange = formatExamTimeRange(obj);
  obj.sessionLabel = formatSessionLabel(obj.session, obj.startTime);
  if (!user) return obj;

  const isOwner = isExamCreator(user, obj);
  const canManage = canUserManageExam(user, obj);
  const isPublishedOrLocked =
    ['PUBLISHED', 'ONGOING', 'LOCKED'].includes(obj.status) || obj.visibilityStatus === 'PUBLISHED';
  const isTerminal = ['COMPLETED', 'CANCELLED'].includes(obj.status) || obj.approvalStatus === 'CANCELLED';
  const isEditableState =
    ['DRAFT', 'PENDING_REVIEW', 'REJECTED'].includes(obj.approvalStatus) &&
    !isPublishedOrLocked &&
    !isTerminal;

  obj.isOwner = isOwner;
  obj.canEdit = canManage && (user.role === 'admin' ? !isPublishedOrLocked && !isTerminal : isEditableState);
  obj.canControlledEdit = user.role === 'admin' && isPublishedOrLocked && !isTerminal;
  obj.canDelete = canManage && (user.role === 'admin' ? obj.status !== 'ONGOING' : isEditableState);
  obj.canRequestCancel =
    canManage &&
    user.role === 'faculty' &&
    (obj.approvalStatus === 'APPROVED' || obj.status === 'PUBLISHED' || obj.status === 'ONGOING') &&
    !isTerminal;
  obj.permissions = {
    canEdit: obj.canEdit,
    canControlledEdit: obj.canControlledEdit,
    canDelete: obj.canDelete,
    canRequestCancel: obj.canRequestCancel,
  };
  return obj;
}

// @desc    Get all exams with optional status / date filters and publication stats
// @route   GET /api/exams
// @access  Private
exports.getExams = async (req, res) => {
  try {
    const { filter, academicYear, department, year, semester, section, status, scope, examType } = req.query;
    const effectiveNow = getEffectiveNow(req);
    const normFilter = (filter || 'all').toLowerCase();

    // Synchronize lifecycle transitions for time-sensitive filters or explicit test timestamp checks
    const timeSensitiveFilters = ['all', 'upcoming', 'today', 'published', 'ongoing', 'completed'];
    if (timeSensitiveFilters.includes(normFilter) || Boolean(req.headers['x-test-timestamp'])) {
      await schedulerService.completeOverdueExams(req.headers['x-test-timestamp'] ? effectiveNow : null);
    }

    const query = { isDeleted: { $ne: true } };
    const andClauses = [];

    if (academicYear && academicYear !== 'ALL') query.academicYear = academicYear;
    if (department && department !== 'ALL') query.department = department;
    if (year && year !== 'ALL') query.year = year;
    if (semester && semester !== 'ALL') query.semester = semester;
    if (section && section !== 'ALL') query.section = section.toUpperCase();
    if (status && status !== 'ALL') query.status = status;
    if (examType && examType !== 'ALL') query.examType = normalizeExamType(examType);

    // Faculty isolation: if logged in as faculty, show only their created or assigned examinations
    if (req.user && req.user.role === 'faculty') {
      if (scope === 'mine') {
        andClauses.push({ createdBy: req.user._id });
      } else {
        const facOr = [{ createdBy: req.user._id }, { facultyId: req.user._id }];
        if (req.user.name) {
          const nameRegex = new RegExp(escapeRegExp(req.user.name.trim()), 'i');
          facOr.push({ facultyName: { $regex: nameRegex } });
          facOr.push({ 'sectionAllocations.facultyName': { $regex: nameRegex } });
        }
        andClauses.push({ $or: facOr });
      }
    }

    const { iso: todayIso } = getTodayKolkataDate(effectiveNow);
    const now = effectiveNow;

    if (normFilter === 'pending') {
      query.approvalStatus = 'PENDING_REVIEW';
      query.status = { $nin: ['COMPLETED', 'CANCELLED'] };
    } else if (normFilter === 'draft') {
      andClauses.push({ $or: [{ approvalStatus: 'DRAFT' }, { status: 'DRAFT' }] });
      query.status = { $nin: ['COMPLETED', 'CANCELLED'] };
      query.approvalStatus = { $ne: 'CANCELLED' };
    } else if (normFilter === 'approved') {
      query.approvalStatus = 'APPROVED';
      query.status = { $nin: ['COMPLETED', 'CANCELLED'] };
    } else if (normFilter === 'published') {
      query.status = { $nin: ['COMPLETED', 'CANCELLED'] };
      query.approvalStatus = { $ne: 'CANCELLED' };
      andClauses.push({
        $or: [
          { visibilityStatus: 'PUBLISHED' },
          { status: { $in: ['PUBLISHED', 'ONGOING'] } },
        ],
      });
    } else if (normFilter === 'ongoing') {
      query.status = { $nin: ['COMPLETED', 'CANCELLED'] };
      query.approvalStatus = { $ne: 'CANCELLED' };
    } else if (normFilter === 'cancelled') {
      andClauses.push({
        $or: [
          { approvalStatus: 'CANCELLED' },
          { status: 'CANCELLED' },
        ],
      });
    } else if (normFilter === 'rejected') {
      query.approvalStatus = 'REJECTED';
    } else if (normFilter === 'completed') {
      query.status = 'COMPLETED';
      query.approvalStatus = { $ne: 'CANCELLED' };
    } else if (normFilter === 'today' || normFilter === 'upcoming') {
      query.status = { $nin: ['COMPLETED', 'CANCELLED'] };
      query.approvalStatus = { $nin: ['CANCELLED', 'REJECTED'] };
    } else if (normFilter === 'scheduled') {
      query.status = { $in: ['SCHEDULED', 'GENERATED', 'ALLOCATED', 'VERIFIED', 'LOCKED'] };
      query.approvalStatus = { $ne: 'CANCELLED' };
    } else if (normFilter === 'failed') {
      query.status = 'FAILED';
    }

    if (andClauses.length > 0) {
      query.$and = andClauses;
    }

    const rawExams = await Exam.find(query)
      .select('-rosterSnapshot -sectionAllocations.rosterSnapshot')
      .populate('createdBy', 'name email role')
      .populate('classroomId', 'name roomNumber totalCapacity availableCapacity block floor')
      .populate('currentAllocationId', 'version status publishedAt totalOccupiedSeats')
      .sort({ createdAt: -1 })
      .lean();

    // Date & time accurate post-filtering in Asia/Kolkata (handles YYYY-MM-DD, DD/MM/YYYY, midnight, missing timestamps)
    const resolveDates = (ex) => {
      const normDate = normalizeDateStr(ex.examDate);
      let startDT = null;
      let endDT = null;
      if (normDate && ex.startTime) {
        try { startDT = parseKolkataDateTime(normDate, ex.startTime); } catch (e) {}
      }
      if (!startDT && ex.startDateTime) startDT = new Date(ex.startDateTime);

      if (normDate && ex.endTime) {
        try { endDT = parseKolkataDateTime(normDate, ex.endTime); } catch (e) {}
      }
      if (!endDT && ex.endDateTime) endDT = new Date(ex.endDateTime);
      return { normDate, startDT, endDT };
    };

    const filteredByRoleAndDate = rawExams.filter((ex) => {
      if (req.user?.role === 'faculty' && !canFacultyViewExam(req.user, ex)) {
        return false;
      }

      if (normFilter === 'today') {
        const { normDate } = resolveDates(ex);
        return normDate === todayIso;
      }

      if (normFilter === 'upcoming') {
        const { normDate, endDT } = resolveDates(ex);
        if (!normDate) return true;
        if (normDate > todayIso) return true;
        if (normDate === todayIso) {
          return !endDT || endDT > now;
        }
        return false;
      }

      if (normFilter === 'ongoing') {
        if (ex.status === 'ONGOING') return true;
        const { startDT, endDT } = resolveDates(ex);
        return (
          (ex.status === 'PUBLISHED' || ex.visibilityStatus === 'PUBLISHED') &&
          Boolean(startDT && endDT && now >= startDT && now < endDT)
        );
      }

      return true;
    });

    // Enhance exams with countdown, publication timing, and role-based permissions
    const enhanced = filteredByRoleAndDate.map((ex) => {
      const obj = typeof ex.toObject === 'function' ? ex.toObject() : { ...ex };
      if (obj.publicationTime) {
        const pubTime = new Date(obj.publicationTime);
        const diffSeconds = Math.floor((pubTime.getTime() - now.getTime()) / 1000);
        obj.publicationCountdownSeconds = Math.max(0, diffSeconds);
        obj.isPublicationDue = diffSeconds <= 0;
      }
      return attachExamPermissions(obj, req.user);
    });

    // Optional backward-compatible pagination when page or limit query params are provided
    const hasPagination = req.query.page !== undefined || req.query.limit !== undefined;
    const total = enhanced.length;
    let responseRows = enhanced;
    let paginationMeta = null;

    if (hasPagination) {
      const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limitNum = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 25));
      const totalPages = Math.max(1, Math.ceil(total / limitNum));
      const safePage = Math.min(pageNum, totalPages);
      const startIdx = (safePage - 1) * limitNum;
      responseRows = enhanced.slice(startIdx, startIdx + limitNum);
      paginationMeta = {
        total,
        page: safePage,
        limit: limitNum,
        totalPages,
      };
    }

    const pendingBaseQuery = {
      isDeleted: { $ne: true },
      approvalStatus: 'PENDING_REVIEW',
      status: { $nin: ['COMPLETED', 'CANCELLED'] },
      ...(andClauses.length > 0 ? { $and: andClauses } : {}),
    };
    const pendingReviewCount = await Exam.countDocuments(pendingBaseQuery);

    res.status(200).json({
      success: true,
      count: responseRows.length,
      total,
      counts: {
        pendingReview: pendingReviewCount,
      },
      ...(paginationMeta && {
        page: paginationMeta.page,
        limit: paginationMeta.limit,
        totalPages: paginationMeta.totalPages,
        pagination: paginationMeta,
      }),
      todayDate: todayIso,
      data: responseRows,
    });
  } catch (error) {
    console.error('[Get Exams Error]:', error);
    res.status(500).json({ success: false, message: error?.message || 'Failed to retrieve examinations.' });
  }
};

// @desc    Get live student count preview before exam confirmation
// @route   GET /api/exams/roster-preview
// @access  Private
exports.getRosterPreview = async (req, res) => {
  try {
    const { subjectName, section, group } = req.query;
    const targetSection = (section || 'A1').trim().toUpperCase();

    let enrollQuery = { section: targetSection };
    if (subjectName && subjectName.trim()) {
      enrollQuery.subjectName = { $regex: new RegExp(`^${escapeRegExp(subjectName.trim())}$`, 'i') };
    }

    let enrolledCount = await StudentEnrollment.countDocuments(enrollQuery);

    // If zero by subject, check section-level enrollments
    if (enrolledCount === 0) {
      enrolledCount = await StudentEnrollment.countDocuments({ section: targetSection });
    }

    // If still zero, check Student collection
    if (enrolledCount === 0) {
      enrolledCount = await Student.countDocuments({ section: targetSection });
    }

    res.status(200).json({
      success: true,
      section: targetSection,
      subjectName: subjectName || '',
      studentCount: enrolledCount,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Get single exam by ID
// @route   GET /api/exams/:id
// @access  Private
exports.getExamById = async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id)
      .populate('classroomId')
      .populate('sectionAllocations.classroomId', 'name roomNumber block floor totalCapacity')
      .populate('createdBy', 'name email role')
      .populate('approvedBy', 'name email role')
      .populate('currentAllocationId');

    if (!exam || exam.isDeleted) {
      return res.status(404).json({ success: false, message: 'Examination not found.' });
    }

    if (req.user && req.user.role === 'faculty' && !canFacultyViewExam(req.user, exam)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view examinations assigned to or created by you.',
      });
    }

    const studentCount = await Student.countDocuments({ examId: exam._id });
    const now = new Date();
    const obj = attachExamPermissions(exam.toObject(), req.user);

    if (obj.publicationTime) {
      const pubTime = new Date(obj.publicationTime);
      const diffSeconds = Math.floor((pubTime.getTime() - now.getTime()) / 1000);
      obj.publicationCountdownSeconds = Math.max(0, diffSeconds);
      obj.isPublicationDue = diffSeconds <= 0;
    }

    res.status(200).json({
      success: true,
      data: {
        ...obj,
        studentCount: studentCount || exam.studentCount || 0,
      },
    });
  } catch (error) {
    console.error('[Get Exam By Id Error]:', error);
    res.status(500).json({ success: false, message: error?.message || 'Failed to retrieve examination details.' });
  }
};

// @desc    Create new examination with AUTOMATIC SEATING ALLOCATION GENERATION
// @route   POST /api/exams
// @access  Private
exports.createExam = async (req, res) => {
  try {
    const {
      examName,
      examType,
      academicYear,
      department,
      year,
      semester,
      section,
      subjectName,
      subjectCode,
      examDate,
      startTime,
      endTime,
      session,
      group,
      facultyName,
      classroomId,
      timetableId,
      regPattern,
      regPatternDescription,
    } = req.body;

    const examGroup = group || 'Group A';
    const targetSection = (section || 'A1').trim().toUpperCase();

    // 1. Mandatory Fields Validation
    if (!examName || !subjectName || !subjectCode || !examDate || !classroomId) {
      return res.status(400).json({
        success: false,
        message: 'Please fill in all mandatory examination details.',
      });
    }

    // 2. Parse Date & Times in Asia/Kolkata (+05:30)
    const normalizedReqSess = session ? normalizeSessionCode(session, 'AM') : null;
    const isAfternoonDefault = normalizedReqSess === 'PM' || normalizedReqSess === 'AN';
    const rawStart = startTime || (isAfternoonDefault ? '02:00 PM' : '09:00 AM');
    const rawEnd = endTime || (isAfternoonDefault ? '05:00 PM' : '12:00 PM');
    const examSession = normalizedReqSess || (String(rawStart).toUpperCase().includes('PM') ? 'PM' : 'AM');
    let range;
    try {
      range = parseExamDateRange(examDate, rawStart, rawEnd, null, {
        allowOvernight: Boolean(req.body.allowOvernight),
        session: examSession,
      });
    } catch (timeErr) {
      return res.status(400).json({ success: false, message: timeErr.message });
    }
    const normDate = range.examDate;
    const startStr = range.startTime;
    const endStr = range.endTime;
    const startDateTime = range.startDateTime;
    const endDateTime = range.endDateTime;

    const publicationTime = getPublicationTime(startDateTime);

    // 3. Classroom Validation & Scheduling Conflict Check (strict interval overlap)
    const classroom = await Classroom.findById(classroomId);
    if (!classroom) {
      return res.status(400).json({
        success: false,
        message: 'Selected classroom does not exist.',
      });
    }

    const classroomConflict = await classroomMappingService.checkClassroomConflict(
      classroomId,
      normDate,
      startDateTime,
      endDateTime,
      examSession,
      null
    );

    if (classroomConflict) {
      const meta = classroomConflict.conflictMeta || {};
      return res.status(409).json({
        success: false,
        message:
          meta.message ||
          `${classroom.name} is already booked by "${classroomConflict.examName}" on ${normDate} from ${formatTime12h(classroomConflict.startTime)} to ${formatTime12h(classroomConflict.endTime)}.`,
        conflictDetails: meta,
      });
    }

    // 4. Duplicate Exam Check (Scoped to active exams with same subjectCode, examDate, session, section, group, and academic year)
    const examAcademicYear = academicYear || '2026-2027';
    const examYear = year || 'III Year';
    const existingExam = await Exam.findOne({
      subjectCode: subjectCode.trim().toUpperCase(),
      examDate: normDate,
      session: examSession,
      academicYear: examAcademicYear,
      year: examYear,
      section: targetSection,
      group: examGroup,
      isDeleted: { $ne: true },
      isActive: true,
      status: { $nin: ['CANCELLED', 'FAILED'] },
      approvalStatus: { $ne: 'CANCELLED' },
    });

    if (existingExam) {
      return res.status(409).json({
        success: false,
        message: `An examination with these details already exists: ${subjectCode} (${existingExam.examName}) is scheduled on ${normDate} (${examSession}) for Section ${targetSection} [${examGroup}] - ${examYear}.`,
      });
    }

    // 5. Query Permanently Mapped Students for Subject & Section
    let mapping = await FacultyMapping.findOne({
      subjectCode: subjectCode.trim().toUpperCase(),
      section: targetSection,
      isCurrent: true,
    });

    if (!mapping && subjectName) {
      mapping = await FacultyMapping.findOne({
        subjectName: { $regex: new RegExp(`^${escapeRegExp(subjectName.trim())}$`, 'i') },
        section: targetSection,
        isCurrent: true,
      });
    }

    let enrolledStudents = [];
    let mappingId = null;
    let mappingVersion = 1;

    if (mapping && mapping.students && mapping.students.length > 0) {
      mappingId = mapping._id;
      mappingVersion = mapping.version;

      let sourceStudents = mapping.students;
      // Filter strictly by examination group (Group A or Group B) to prevent cross-contamination
      if (examGroup && examGroup !== 'ALL') {
        sourceStudents = sourceStudents.filter((s) => {
          const sGroup = s.group || StudentClassificationService.classifyStudent(s.registrationNumber).group;
          return sGroup === examGroup;
        });
      }

      enrolledStudents = sourceStudents.map((s) => {
        const classification = StudentClassificationService.classifyStudent(s.registrationNumber);
        return {
          rollNumber: s.registrationNumber,
          studentName: s.name,
          department: mapping.department || department,
          year: s.year || classification.year || mapping.year || examYear,
          semester: mapping.semester || semester,
          section: targetSection,
          subjectName: mapping.subjectName || subjectName.trim(),
          group: s.group || classification.group || examGroup,
          facultyName: mapping.facultyName || facultyName,
          a1: s.a1 || '',
          a2: s.a2 || '',
          a3: s.a3 || '',
          a4: s.a4 || '',
          a5: s.a5 || '',
          a6: s.a6 || '',
        };
      });
    } else {
      // Fallback: Query from StudentEnrollment
      let dbEnroll = await StudentEnrollment.find({
        subjectName: { $regex: new RegExp(`^${subjectName.trim()}$`, 'i') },
        section: targetSection,
      }).sort({ rollNumber: 1 });

      if (!dbEnroll || dbEnroll.length === 0) {
        dbEnroll = await StudentEnrollment.find({ section: targetSection }).sort({ rollNumber: 1 });
      }

      if (dbEnroll && dbEnroll.length > 0) {
        enrolledStudents = dbEnroll.map((en) => ({
          rollNumber: en.rollNumber,
          studentName: en.studentName,
          department: en.department || department,
          year: en.year || year,
          semester: en.semester || semester,
          section: en.section || targetSection,
          subjectName: en.subjectName || subjectName.trim(),
          group: en.group || examGroup,
          facultyName: en.facultyName || facultyName,
          a1: en.a1 || '',
          a2: en.a2 || '',
          a3: en.a3 || '',
          a4: en.a4 || '',
          a5: en.a5 || '',
          a6: en.a6 || '',
        }));
      } else {
        // Fallback: Check Student master collection for this section
        const baseStudents = await Student.find({ section: targetSection }).sort({ registrationNumber: 1 });
        if (baseStudents && baseStudents.length > 0) {
          enrolledStudents = baseStudents.map((s) => ({
            rollNumber: s.registrationNumber,
            studentName: s.name,
            department: s.department || department,
            year: s.year || year,
            semester: s.semester || semester,
            section: s.section || targetSection,
            subjectName: subjectName.trim(),
            group: s.group || examGroup,
            facultyName: s.facultyName || facultyName,
            a1: s.a1 || '',
            a2: s.a2 || '',
            a3: s.a3 || '',
            a4: s.a4 || '',
            a5: s.a5 || '',
            a6: s.a6 || '',
          }));
        }
      }
    }

    // REQUIREMENT 4: NEVER GENERATE AN ALLOCATION WITH ZERO STUDENTS
    if (!enrolledStudents || enrolledStudents.length === 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot create examination: 0 registered students found for Subject "${subjectName}" and Section "${targetSection}". Please assign students on the Faculty & Student Assignment page before creating an examination.`,
      });
    }

    // Capacity Check
    if (enrolledStudents.length > classroom.totalCapacity) {
      return res.status(400).json({
        success: false,
        message: `Classroom capacity exceeded: ${classroom.name} has ${classroom.totalCapacity} seats, but Section ${targetSection} has ${enrolledStudents.length} registered students.`,
      });
    }

    // 6. Create Exam Document (Requirement 4 & 7: PENDING_REVIEW approval status)
    const now = new Date();

    const exam = new Exam({
      examName: examName.trim(),
      examType: normalizeExamType(examType, examName),
      academicYear: academicYear || '2026-2027',
      department: department || 'Computer Science and Engineering',
      year: year || 'IV Year',
      semester: semester || 'I Semester',
      section: targetSection,
      group: examGroup,
      facultyName: (mapping && mapping.facultyName) || facultyName || '',
      subjectName: (mapping && mapping.subjectName) || subjectName.trim(),
      subjectCode: (mapping && mapping.subjectCode) || subjectCode.trim().toUpperCase(),
      examDate: normDate,
      startTime: startStr,
      endTime: endStr,
      startTime24: range.startTime24,
      endTime24: range.endTime24,
      allowOvernight: range.isOvernight,
      startDateTime,
      endDateTime,
      publicationTime,
      session: examSession,
      classroomId,
      timetableId: timetableId || undefined,
      regPattern: regPattern || '^[0-9]{5}[A-Z0-9]{5}$',
      regPatternDescription: regPatternDescription || '10-character alphanumeric registration number',
      // Statuses separation (Requirement 7)
      approvalStatus: 'PENDING_REVIEW', // Ready for Admin Review
      visibilityStatus: 'NOT_SCHEDULED', // Hidden until Admin publishes
      allocationStatus: 'GENERATED',
      status: 'SCHEDULED', // Legacy compatibility
      studentCount: enrolledStudents.length,
      mappingId: mappingId || undefined,
      mappingVersion,
      rosterSnapshot: enrolledStudents.map((en) => ({
        registrationNumber: en.rollNumber,
        name: en.studentName,
        group: en.group || examGroup,
        a1: en.a1 || '',
        a2: en.a2 || '',
        a3: en.a3 || '',
        a4: en.a4 || '',
        a5: en.a5 || '',
        a6: en.a6 || '',
      })),
      createdBy: req.user._id,
      facultyId: req.user?._id || mapping?.facultyId,
      isDeleted: false,
      isActive: true,
    });

    // 7 & 8. Atomically persist Exam, Students, and initial Seating Allocation
    const studentDocs = enrolledStudents.map((en) => ({
      examId: exam._id,
      registrationNumber: en.rollNumber,
      name: en.studentName,
      department: en.department || exam.department,
      year: en.year || exam.year,
      semester: en.semester || exam.semester,
      section: en.section || exam.section,
      subject: exam.subjectName,
      group: en.group || examGroup,
      facultyName: en.facultyName || exam.facultyName,
      a1: en.a1 || '',
      a2: en.a2 || '',
      a3: en.a3 || '',
      a4: en.a4 || '',
      a5: en.a5 || '',
      a6: en.a6 || '',
      status: 'active',
    }));

    const allocationResult = SeatingService.generateAllocation(
      studentDocs.slice().sort((a, b) => a.registrationNumber.localeCompare(b.registrationNumber)),
      classroom,
      { group: examGroup }
    );

    const allocation = new Allocation({
      examId: exam._id,
      group: examGroup,
      classroomId: classroom._id,
      version: 1,
      students: allocationResult.students,
      setDistribution: allocationResult.setDistribution,
      totalAvailableSeats: allocationResult.totalAvailableSeats,
      totalOccupiedSeats: allocationResult.totalOccupiedSeats,
      validationStatus: allocationResult.validationStatus,
      randomSeed: allocationResult.randomSeed,
      status: 'GENERATED',
      isCurrent: true,
      createdBy: req.user._id,
    });

    exam.currentAllocationId = allocation._id;

    await runWithOptionalTransaction(async (txSession) => {
      const opts = txSession ? { session: txSession } : undefined;
      await exam.save(opts);
      await Student.insertMany(studentDocs, opts);
      await allocation.save(opts);
    });

    // 9. AUTOMATIC ATTENDANCE & SIGNATURE SHEET GENERATION VERIFICATION (Requirement 4 & 10)
    try {
      await ReportService.generateAttendancePDF(exam, allocation, classroom);
    } catch (pdfErr) {
      console.warn('[CreateExam] Attendance PDF test generation note:', pdfErr.message);
    }

    await AuditLog.create({
      action: 'EXAM_CREATED',
      performedBy: req.user._id,
      performedByName: req.user.name,
      examId: exam._id,
      details: {
        examName: exam.examName,
        subjectCode: exam.subjectCode,
        section: exam.section,
        studentCount: exam.studentCount,
        startTime: exam.startTime,
        endTime: exam.endTime,
        publicationTime: exam.publicationTime,
        approvalStatus: exam.approvalStatus,
        visibilityStatus: exam.visibilityStatus,
        autoAllocationStatus: allocation.status,
      },
      ipAddress: req.ip,
    });

    portalCache.invalidatePortalCache(exam._id);

    res.status(201).json({
      success: true,
      message: `Examination created and seating allocation automatically generated (${exam.studentCount} students). Marked as READY FOR ADMIN REVIEW.`,
      data: exam,
      allocation,
    });
  } catch (error) {
    console.error('[Create Exam Error]', error);
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'An examination with these details already exists. A duplicate active examination for this subject, date, session, section, and group is prevented.',
      });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Faculty Retry / Manual Force Trigger for Allocation or Publication
// @route   POST /api/exams/:id/retry
// @access  Private
exports.retryExam = async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Examination not found.' });
    }

    const classroom = await Classroom.findById(exam.classroomId);
    if (!classroom) {
      return res.status(400).json({ success: false, message: 'Classroom not found.' });
    }

    let students = await Student.find({ examId: exam._id, status: 'active' }).sort({
      registrationNumber: 1,
    });

    // If no students attached, re-query from enrollments
    if (!students || students.length === 0) {
      let enrolled = await StudentEnrollment.find({ section: exam.section });
      if (!enrolled || enrolled.length === 0) {
        enrolled = await Student.find({ section: exam.section });
      }

      if (!enrolled || enrolled.length === 0) {
        return res.status(400).json({
          success: false,
          message: `Cannot retry: No students found for Section ${exam.section}.`,
        });
      }

      const studentDocs = enrolled.map((en) => ({
        examId: exam._id,
        registrationNumber: en.rollNumber || en.registrationNumber,
        name: en.studentName || en.name,
        department: en.department || exam.department,
        year: en.year || exam.year,
        semester: en.semester || exam.semester,
        section: en.section || exam.section,
        subject: exam.subjectName,
        group: exam.group || 'Group A',
        facultyName: en.facultyName || exam.facultyName,
        status: 'active',
      }));
      await Student.insertMany(studentDocs);
      students = await Student.find({ examId: exam._id, status: 'active' });
    }

    const lastAlloc = await Allocation.findOne({ examId: exam._id }).sort({ version: -1 });
    const newVersion = lastAlloc ? lastAlloc.version + 1 : 1;

    const allocationResult = SeatingService.generateAllocation(students, classroom, {
      group: exam.group || 'Group A',
    });

    await Allocation.updateMany({ examId: exam._id }, { isCurrent: false });

    const now = new Date();
    const isDue = exam.publicationTime ? now >= new Date(exam.publicationTime) : false;

    const newAlloc = new Allocation({
      examId: exam._id,
      group: exam.group || 'Group A',
      classroomId: classroom._id,
      version: newVersion,
      students: allocationResult.students,
      setDistribution: allocationResult.setDistribution,
      totalAvailableSeats: allocationResult.totalAvailableSeats,
      totalOccupiedSeats: allocationResult.totalOccupiedSeats,
      validationStatus: allocationResult.validationStatus,
      randomSeed: allocationResult.randomSeed,
      status: isDue ? 'PUBLISHED' : 'SCHEDULED',
      isCurrent: true,
      publishedAt: isDue ? now : undefined,
      createdBy: req.user._id,
    });

    await newAlloc.save();

    exam.currentAllocationId = newAlloc._id;
    exam.studentCount = students.length;
    exam.status = isDue ? 'PUBLISHED' : 'SCHEDULED';
    exam.publicationStatus = isDue ? 'PUBLISHED' : 'PENDING';
    exam.lastError = '';
    await exam.save();

    res.status(200).json({
      success: true,
      message: `Allocation retry succeeded (Version ${newVersion}, ${students.length} students).`,
      data: exam,
      allocation: newAlloc,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * Shared helper to resolve permanent mappings and build section-wise seating allocations
 * with classroom conflict detection and capacity validation.
 */
async function buildSectionAllocationsFromMappings({
  matchedMappings,
  normCode,
  normDate,
  startStr,
  endStr,
  startDateTime,
  endDateTime,
  examSession,
  userId,
  excludeExamId = null,
  classroomOverrides = {},
}) {
  // Batch load active classrooms once instead of querying per section (eliminates N+1 queries)
  const allActiveRooms = await Classroom.find({ isActive: true }).lean();
  const roomById = new Map(allActiveRooms.map((r) => [r._id.toString(), r]));
  const roomByNumber = new Map(allActiveRooms.map((r) => [String(r.roomNumber).trim(), r]));

  const requiredRooms = ['3010', '3020', '3030', '3040', '3050', '3060'];
  const missingRooms = requiredRooms.filter((num) => !roomByNumber.has(num));
  if (missingRooms.length > 0) {
    throw new Error(
      `Required ET BLOCK classrooms are missing or inactive: ${missingRooms.map((r) => `ET BLOCK ${r}`).join(', ')}`
    );
  }

  const sectionAllocations = [];
  const allAllocatedStudents = [];
  const allocationDocsToCreate = [];
  const globalStudentRegSet = new Set();

  // First pass: resolve all section classrooms & validate capacities + collect room IDs for a single batched conflict query
  const resolvedSectionsPlan = [];
  const roomIdsToCheck = [];

  for (let mIdx = 0; mIdx < matchedMappings.length; mIdx++) {
    const mapping = matchedMappings[mIdx];
    const sectionStudents = mapping.students || [];
    if (sectionStudents.length === 0) continue;

    let assignedClassroom = null;
    const overrideRoomId = classroomOverrides && classroomOverrides[mapping.section];
    if (overrideRoomId) {
      assignedClassroom = roomById.get(overrideRoomId.toString()) || null;
      if (!assignedClassroom) {
        const roomErr = new Error(`Selected override classroom for Section ${mapping.section} was not found or is inactive.`);
        roomErr.statusCode = 400;
        throw roomErr;
      }
    } else {
      const defRoomNum = classroomMappingService.getRoomNumberForSection(mapping.section);
      assignedClassroom = defRoomNum ? roomByNumber.get(defRoomNum) : null;
      if (!assignedClassroom) {
        throw new Error(`Assigned classroom for Section ${mapping.section} does not exist or is inactive in the database.`);
      }
    }

    classroomMappingService.validateCapacity(assignedClassroom, sectionStudents.length, mapping.section);
    roomIdsToCheck.push(assignedClassroom._id);
    resolvedSectionsPlan.push({ mapping, sectionStudents, assignedClassroom });
  }

  // Single batched classroom conflict check across ALL selected rooms
  const batchConflicts = await classroomMappingService.checkClassroomsConflictsBatch(
    roomIdsToCheck,
    normDate,
    startDateTime,
    endDateTime,
    examSession,
    excludeExamId
  );

  for (const plan of resolvedSectionsPlan) {
    const { mapping, sectionStudents, assignedClassroom } = plan;
    const inferredGroup =
      mapping.group || (['A1', 'A2', 'A3'].includes(mapping.section) ? 'Group A' : 'Group B');

    const roomConflict = batchConflicts.get(assignedClassroom._id.toString()) || null;
    if (roomConflict) {
      const meta = roomConflict.conflictMeta || {};
      const conflictErr = new Error(
        meta.message ||
          `${assignedClassroom.name} (Section ${mapping.section}) is already booked by "${roomConflict.examName}" on ${normDate} from ${formatTime12h(roomConflict.startTime)} to ${formatTime12h(roomConflict.endTime)}.`
      );
      conflictErr.statusCode = 409;
      conflictErr.conflictDetails = meta;
      throw conflictErr;
    }

    for (const st of sectionStudents) {
      const regNo = (st.registrationNumber || '').toUpperCase().trim();
      if (regNo && globalStudentRegSet.has(regNo)) {
        const dupErr = new Error(
          `Duplicate student detected: Candidate "${regNo}" is mapped to multiple sections within this examination session.`
        );
        dupErr.statusCode = 409;
        throw dupErr;
      }
    }

    const studentsForSeating = sectionStudents.map((s, sIdx) => {
      const regNo = (s.registrationNumber || '').toUpperCase().trim();
      return {
        _id: s._id,
        registrationNumber: regNo,
        name: s.studentName || s.name || `Student ${sIdx + 1}`,
        section: mapping.section,
        group: inferredGroup,
      };
    });

    const seatingResult = SeatingService.generateAllocation(studentsForSeating, assignedClassroom, {
      group: inferredGroup,
      seed: `EXAM-${normCode}-${mapping.section}-${Date.now()}`,
    });

    const studentSnapshots = seatingResult.students.map((st, i) => {
      const regNo = st.registrationNumber;
      globalStudentRegSet.add(regNo);
      return {
        sNo: i + 1,
        registrationNumber: regNo,
        name: st.name,
        group: inferredGroup,
        section: mapping.section,
        seatId: st.seatId,
        questionPaperSet: st.questionPaperSet || 'A',
        rowNumber: st.rowNumber,
        benchNumber: st.benchNumber,
        seatNumber: st.seatNumber,
      };
    });

    sectionAllocations.push({
      mappingId: mapping._id,
      facultyId: mapping.facultyId || userId,
      facultyName: mapping.facultyName,
      group: inferredGroup,
      section: mapping.section,
      studentCount: studentSnapshots.length,
      mappingVersion: mapping.version || 1,
      classroomId: assignedClassroom._id,
      classroomName: assignedClassroom.name,
      roomNumber: assignedClassroom.roomNumber,
      rosterSnapshot: studentSnapshots,
      attendancePdfUrl: `/api/reports/__PARENT_EXAM_ID__/section-attendance-pdf/${mapping.section}`,
      allocationStatus: 'GENERATED',
    });

    studentSnapshots.forEach((s) => {
      allAllocatedStudents.push({
        ...s,
        classroomName: assignedClassroom.name,
        classroomId: assignedClassroom._id,
        facultyName: mapping.facultyName,
      });
    });

    allocationDocsToCreate.push({
      group: inferredGroup,
      section: mapping.section,
      classroomId: assignedClassroom._id,
      classroomName: assignedClassroom.name,
      students: seatingResult.students,
      setDistribution: seatingResult.setDistribution,
      totalAvailableSeats: seatingResult.totalAvailableSeats,
      totalOccupiedSeats: seatingResult.totalOccupiedSeats,
      validationStatus: seatingResult.validationStatus,
      randomSeed: seatingResult.randomSeed,
    });
  }

  return {
    sectionAllocations,
    allAllocatedStudents,
    allocationDocsToCreate,
    globalStudentRegSet,
  };
}

// @desc    Update examination (standard edit + Admin controlled correction workflow for published/locked exams)
// @route   PUT /api/exams/:id
// @access  Private
exports.updateExam = async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam || exam.isDeleted) {
      return res.status(404).json({ success: false, message: 'Examination not found.' });
    }

    // 1. Permission Check
    if (!canUserManageExam(req.user, exam)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You are only authorized to edit examinations you created.',
      });
    }

    // 2. Terminal State Lock Check (COMPLETED / CANCELLED are strictly immutable)
    if (['COMPLETED', 'CANCELLED'].includes(exam.status) || exam.approvalStatus === 'CANCELLED') {
      return res.status(400).json({
        success: false,
        message: 'Completed or cancelled examinations cannot be modified. Historical records remain preserved.',
      });
    }

    const isPublishedOrLocked =
      ['LOCKED', 'PUBLISHED', 'ONGOING'].includes(exam.status) || exam.visibilityStatus === 'PUBLISHED';

    if (isPublishedOrLocked && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Published or locked examinations can only be adjusted via the Administrator controlled correction workflow.',
      });
    }

    if (req.user.role === 'faculty' && exam.approvalStatus === 'APPROVED') {
      return res.status(403).json({
        success: false,
        message: 'Approved examinations cannot be edited directly by faculty. Please submit a cancellation request to Admin.',
      });
    }

    const {
      examName,
      examType,
      academicYear,
      department,
      year,
      semester,
      subjectName,
      subjectCode,
      examDate,
      startTime,
      endTime,
      session,
      group,
      selectedSections,
      selectedMappingIds,
      classroomOverrides,
      confirmControlledCorrection,
      correctionReason,
      reallocateSeating,
      saveAsDraft,
      submitForReview,
      classroomId,
      regPattern,
      regPatternDescription,
    } = req.body;

    if (isPublishedOrLocked) {
      if (confirmControlledCorrection !== true || !String(correctionReason || '').trim()) {
        return res.status(400).json({
          success: false,
          code: 'CONTROLLED_CORRECTION_REQUIRED',
          message:
            'Modifying a published/locked examination requires explicit Administrator confirmation and a formal correction reason.',
        });
      }
    }

    const previousSnapshot = {
      examName: exam.examName,
      academicYear: exam.academicYear,
      semester: exam.semester,
      subjectName: exam.subjectName,
      subjectCode: exam.subjectCode,
      examDate: exam.examDate,
      session: exam.session,
      startTime: exam.startTime,
      endTime: exam.endTime,
      group: exam.group,
      section: exam.section,
    };

    const prevDate = normalizeDateStr(exam.examDate);
    const prevStart = exam.startTime ? formatTime12h(exam.startTime, exam.startTime) : '';
    const prevEnd = exam.endTime ? formatTime12h(exam.endTime, exam.endTime) : '';
    const prevSession = exam.session;
    const prevSubCode = exam.subjectCode;
    const prevGroup = exam.group;

    // Apply validated scalar fields
    if (examName !== undefined) {
      if (!String(examName).trim()) {
        return res.status(400).json({ success: false, message: 'Examination title cannot be empty.' });
      }
      exam.examName = String(examName).trim();
    }
    if (examType !== undefined) {
      exam.examType = normalizeExamType(examType, exam.examName);
    }
    if (academicYear !== undefined) exam.academicYear = academicYear;
    if (department !== undefined) exam.department = department;
    if (year !== undefined) exam.year = year;
    if (semester !== undefined) exam.semester = semester;
    if (classroomId !== undefined) exam.classroomId = classroomId;
    if (regPattern !== undefined) exam.regPattern = regPattern;
    if (regPatternDescription !== undefined) exam.regPatternDescription = regPatternDescription;

    const rawNextDate = examDate !== undefined ? examDate : exam.examDate;
    const nextSession = session !== undefined ? normalizeSessionCode(session, exam.session || 'AM') : exam.session;
    const rawNextStart = startTime !== undefined ? startTime : exam.startTime;
    const rawNextEnd = endTime !== undefined ? endTime : exam.endTime;
    const nextSubName = subjectName !== undefined ? String(subjectName).trim() : exam.subjectName;
    const nextSubCode = subjectCode !== undefined ? String(subjectCode).trim().toUpperCase() : exam.subjectCode;

    let range;
    try {
      range = parseExamDateRange(rawNextDate, rawNextStart, rawNextEnd, null, {
        allowOvernight:
          req.body.allowOvernight !== undefined
            ? Boolean(req.body.allowOvernight)
            : Boolean(exam.allowOvernight),
        session: nextSession,
      });
    } catch (timeErr) {
      return res.status(400).json({ success: false, message: timeErr.message });
    }

    const nextDate = range.examDate;
    const nextStart = range.startTime;
    const nextEnd = range.endTime;
    const nextStartDT = range.startDateTime;
    const nextEndDT = range.endDateTime;

    exam.examDate = nextDate;
    exam.session = nextSession;
    exam.startTime = nextStart;
    exam.endTime = nextEnd;
    exam.startTime24 = range.startTime24;
    exam.endTime24 = range.endTime24;
    exam.allowOvernight = range.isOvernight;
    exam.startDateTime = nextStartDT;
    exam.endDateTime = nextEndDT;
    exam.publicationTime = getPublicationTime(nextStartDT);
    exam.subjectName = nextSubName;
    exam.subjectCode = nextSubCode;

    let nextGroup = exam.group;
    if (group !== undefined) {
      if (group === 'ALL') nextGroup = 'ALL';
      else if (String(group).toUpperCase().includes('B')) nextGroup = 'Group B';
      else nextGroup = 'Group A';
      exam.group = nextGroup;
    }

    const scheduleChanged =
      prevDate !== nextDate ||
      prevStart !== nextStart ||
      prevEnd !== nextEnd ||
      prevSession !== nextSession;

    const overridesProvided =
      classroomOverrides && typeof classroomOverrides === 'object' && Object.keys(classroomOverrides).length > 0;

    const prevSectionsArr = (exam.sectionAllocations || []).map((sa) => sa.section).sort();
    const nextSectionsArr = Array.isArray(selectedSections)
      ? selectedSections.map((s) => String(s).trim().toUpperCase()).sort()
      : null;
    const sectionsActuallyChanged =
      Boolean(nextSectionsArr) && nextSectionsArr.join(',') !== prevSectionsArr.join(',');

    const mappingInputsChanged =
      prevSubCode !== nextSubCode ||
      prevGroup !== nextGroup ||
      sectionsActuallyChanged ||
      (Array.isArray(selectedMappingIds) && !isPublishedOrLocked) ||
      (overridesProvided && !isPublishedOrLocked);

    // Check duplicate active schedule excluding current exam and checking actual time interval overlap
    const dupCandidates = await Exam.find({
      _id: { $ne: exam._id },
      subjectCode: nextSubCode,
      examDate: nextDate,
      group: nextGroup,
      isParentExam: exam.isParentExam,
      ...(exam.isParentExam ? {} : { section: exam.section }),
      isDeleted: { $ne: true },
      isActive: true,
      status: { $nin: ['CANCELLED', 'FAILED', 'COMPLETED'] },
      approvalStatus: { $nin: ['CANCELLED', 'REJECTED'] },
    }).lean();

    const targetSectionSet = new Set(
      (nextSectionsArr && nextSectionsArr.length > 0 ? nextSectionsArr : prevSectionsArr).map((s) =>
        String(s).trim().toUpperCase()
      )
    );

    const dupExam = dupCandidates.find((d) => {
      const dInterval = classroomMappingService.resolveExamInterval(d);
      const timeOverlaps = !dInterval
        ? isSameSessionPolarity(d.session, nextSession)
        : nextStartDT < dInterval.endDateTime && nextEndDT > dInterval.startDateTime;
      if (!timeOverlaps) return false;
      if (targetSectionSet.size === 0) return true;
      const dSections =
        Array.isArray(d.sectionAllocations) && d.sectionAllocations.length > 0
          ? d.sectionAllocations.map((sa) => String(sa.section || '').trim().toUpperCase())
          : String(d.section || '')
              .split(',')
              .map((s) => s.trim().toUpperCase())
              .filter(Boolean);
      if (dSections.length === 0) return true;
      return dSections.some((s) => targetSectionSet.has(s));
    });

    if (dupExam) {
      return res.status(409).json({
        success: false,
        message: `Schedule conflict: Another examination "${dupExam.examName}" (${dupExam.subjectCode}) is already scheduled on ${nextDate} (${formatTime12h(dupExam.startTime)} – ${formatTime12h(dupExam.endTime)}) for ${nextGroup}.`,
        conflictDetails: {
          existingExamId: dupExam._id,
          existingExamTitle: dupExam.examName || dupExam.subjectName,
          subjectCode: dupExam.subjectCode,
          section: dupExam.section,
          examDate: dupExam.examDate,
          startTime: formatTime12h(dupExam.startTime),
          endTime: formatTime12h(dupExam.endTime),
        },
      });
    }

    let reallocated = false;

    // Preserve published/locked seating arrangements unless Admin explicitly opts into reallocation
    const shouldReallocateMappings =
      (exam.isParentExam || Array.isArray(selectedSections) || Array.isArray(selectedMappingIds) || overridesProvided) &&
      mappingInputsChanged &&
      (!isPublishedOrLocked || reallocateSeating === true);

    if (shouldReallocateMappings) {
      const andConditions = [
        { isCurrent: true },
        {
          $or: [
            { subjectCode: nextSubCode },
            { subjectName: { $regex: new RegExp(`^${escapeRegExp(nextSubName)}$`, 'i') } },
          ],
        },
      ];

      if (nextGroup === 'Group A') {
        andConditions.push({
          $or: [{ group: { $in: ['Group A', 'A'] } }, { section: { $in: ['A1', 'A2', 'A3'] } }],
        });
      } else if (nextGroup === 'Group B') {
        andConditions.push({
          $or: [{ group: { $in: ['Group B', 'B'] } }, { section: { $in: ['A4', 'A5', 'A6'] } }],
        });
      }

      if (Array.isArray(selectedMappingIds) && selectedMappingIds.length > 0) {
        andConditions.push({ _id: { $in: selectedMappingIds } });
      }
      if (Array.isArray(selectedSections) && selectedSections.length > 0) {
        andConditions.push({ section: { $in: selectedSections.map((s) => String(s).trim().toUpperCase()) } });
      }

      const candidateMappings = await FacultyMapping.find({ $and: andConditions }).sort({ section: 1 });

      if (req.user.role === 'faculty') {
        const unauthorized = candidateMappings.some((m) => !isFacultyMappingOwner(req.user, m));
        if (unauthorized) {
          return res.status(403).json({
            success: false,
            message: 'Access denied. You cannot assign sections belonging to another faculty member.',
          });
        }
      }

      const matchedMappings = filterMappingsForUser(req.user, candidateMappings);
      if (!matchedMappings || matchedMappings.length === 0) {
        return res.status(400).json({
          success: false,
          message: `No assigned permanent mappings found for ${nextSubName} (${nextSubCode}) matching the selected group/sections.`,
        });
      }

      const built = await buildSectionAllocationsFromMappings({
        matchedMappings,
        normCode: nextSubCode,
        normDate: nextDate,
        startStr: nextStart,
        endStr: nextEnd,
        startDateTime: nextStartDT,
        endDateTime: nextEndDT,
        examSession: nextSession,
        userId: req.user._id,
        excludeExamId: exam._id,
        classroomOverrides: classroomOverrides || {},
      });

      if (built.sectionAllocations.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No students found in selected section mappings.',
        });
      }

      built.sectionAllocations.forEach((sa) => {
        sa.attendancePdfUrl = `/api/reports/${exam._id}/section-attendance-pdf/${sa.section}`;
      });

      exam.sectionAllocations = built.sectionAllocations;
      exam.section = built.sectionAllocations.map((sa) => sa.section).join(', ');
      exam.facultyName = built.sectionAllocations.map((sa) => `${sa.section}: ${sa.facultyName}`).join(' | ');
      exam.classroomId = built.sectionAllocations[0]?.classroomId;
      exam.studentCount = built.globalStudentRegSet.size;
      exam.isParentExam = true;
      exam.markModified('sectionAllocations');

      const maxAlloc = await Allocation.findOne({ examId: exam._id }).sort({ version: -1 });
      const nextVersion = maxAlloc ? maxAlloc.version + 1 : 1;

      const combinedSetDist = { A: 0, B: 0, C: 0, total: 0 };
      let totalAvailableSeats = 0;
      const allStudentsForAllocationDoc = [];

      for (const allocData of built.allocationDocsToCreate) {
        if (allocData.setDistribution) {
          combinedSetDist.A += allocData.setDistribution.A || 0;
          combinedSetDist.B += allocData.setDistribution.B || 0;
          combinedSetDist.C += allocData.setDistribution.C || 0;
          combinedSetDist.total += allocData.setDistribution.total || 0;
        }
        totalAvailableSeats += allocData.totalAvailableSeats || 0;
        (allocData.students || []).forEach((st) => {
          allStudentsForAllocationDoc.push({
            ...st,
            classroomId: allocData.classroomId,
            classroomName: allocData.classroomName,
            section: allocData.section,
          });
        });
      }

      const newMasterAllocation = new Allocation({
        examId: exam._id,
        group: nextGroup,
        classroomId: exam.classroomId,
        version: nextVersion,
        students: allStudentsForAllocationDoc,
        setDistribution: combinedSetDist,
        totalAvailableSeats,
        totalOccupiedSeats: allStudentsForAllocationDoc.length,
        sectionSummaries: built.sectionAllocations.map((sa) => ({
          section: sa.section,
          facultyName: sa.facultyName,
          studentCount: sa.studentCount,
          classroomsUsed: [sa.classroomName],
          status: isPublishedOrLocked ? 'PUBLISHED' : 'GENERATED',
        })),
        classroomSummaries: built.allocationDocsToCreate.map((ad) => ({
          classroomId: ad.classroomId,
          classroomName: ad.classroomName,
          roomNumber: classroomMappingService.getRoomNumberForSection(ad.section) || '',
          section: ad.section,
          allocatedStudents: ad.students?.length || 0,
          capacity: ad.totalAvailableSeats || 72,
          availableSeats: (ad.totalAvailableSeats || 72) - (ad.students?.length || 0),
        })),
        validationStatus: {
          isValid: true,
          hasAdjacentCollisions: false,
          violations: [],
          message: 'Reallocated after examination edit.',
          validatedAt: new Date(),
        },
        randomSeed: `MASTER-EDIT-${exam._id}-V${nextVersion}-${Date.now()}`,
        status: isPublishedOrLocked ? 'PUBLISHED' : 'GENERATED',
        isCurrent: true,
        createdBy: req.user._id,
      });

      exam.currentAllocationId = newMasterAllocation._id;
      exam.allocationStatus = 'GENERATED';

      const studentDocs = built.allAllocatedStudents.map((st) => ({
        examId: exam._id,
        registrationNumber: st.registrationNumber,
        name: st.name,
        department: exam.department,
        year: exam.year,
        semester: exam.semester,
        section: st.section,
        subject: exam.subjectName,
        group: st.group,
        facultyName: st.facultyName,
        status: 'active',
        questionPaperSet: st.questionPaperSet,
      }));

      if (!isPublishedOrLocked) {
        if (submitForReview === true) {
          exam.approvalStatus = 'PENDING_REVIEW';
          exam.status = 'SCHEDULED';
        } else if (saveAsDraft === true) {
          exam.approvalStatus = 'DRAFT';
          exam.status = 'DRAFT';
        }
      }
      exam.updatedAt = new Date();

      await runWithOptionalTransaction(async (txSession) => {
        const opts = txSession ? { session: txSession } : undefined;
        await Allocation.updateMany(
          { examId: exam._id, isCurrent: true },
          { $set: { isCurrent: false, status: 'CANCELLED' } },
          opts
        );
        await Student.deleteMany({ examId: exam._id }, opts);
        await newMasterAllocation.save(opts);
        if (studentDocs.length > 0) {
          await Student.insertMany(studentDocs, opts);
        }
        await exam.save(opts);
      });

      reallocated = true;
    } else {
      // No mapping/roster regeneration: validate classroom intervals cleanly excluding exam._id
      if (overridesProvided) {
        for (const sa of exam.sectionAllocations || []) {
          const ovRoomId = classroomOverrides[sa.section];
          if (ovRoomId) {
            const roomDoc = await Classroom.findOne({ _id: ovRoomId, isActive: { $ne: false } });
            if (!roomDoc) {
              return res.status(400).json({
                success: false,
                message: `Selected classroom for Section ${sa.section} does not exist or is inactive.`,
              });
            }
            classroomMappingService.validateCapacity(roomDoc, sa.studentCount || 0, sa.section);
            sa.classroomId = roomDoc._id;
            sa.classroomName = roomDoc.name;
            sa.roomNumber = roomDoc.roomNumber;
          }
        }
        exam.classroomId = exam.sectionAllocations?.[0]?.classroomId || exam.classroomId;
        exam.markModified('sectionAllocations');
      }

      if (scheduleChanged || overridesProvided) {
        const roomIdsToCheck = new Set();
        if (exam.classroomId) roomIdsToCheck.add(exam.classroomId.toString());
        (exam.sectionAllocations || []).forEach((sa) => {
          if (sa.classroomId) roomIdsToCheck.add(sa.classroomId.toString());
        });

        for (const rId of roomIdsToCheck) {
          const conflict = await classroomMappingService.checkClassroomConflict(
            rId,
            nextDate,
            nextStartDT,
            nextEndDT,
            nextSession,
            exam._id
          );
          if (conflict) {
            const meta = conflict.conflictMeta || {};
            return res.status(409).json({
              success: false,
              message:
                meta.message ||
                `Classroom conflict on ${meta.examDate || nextDate} (${meta.startTime || formatTime12h(conflict.startTime)} – ${meta.endTime || formatTime12h(conflict.endTime)}) with examination "${conflict.examName}".`,
              conflictDetails: meta,
            });
          }
        }
      }

      if (!isPublishedOrLocked) {
        if (submitForReview === true) {
          exam.approvalStatus = 'PENDING_REVIEW';
          exam.status = 'SCHEDULED';
        } else if (saveAsDraft === true) {
          exam.approvalStatus = 'DRAFT';
          exam.status = 'DRAFT';
        }
      }

      exam.updatedAt = new Date();
      await runWithOptionalTransaction(async (txSession) => {
        const opts = txSession ? { session: txSession } : undefined;
        await exam.save(opts);
      });
    }

    await AuditLog.create({
      action: isPublishedOrLocked ? 'EXAM_CONTROLLED_CORRECTION' : 'EXAM_UPDATED',
      performedBy: req.user._id,
      performedByName: req.user.name,
      examId: exam._id,
      details: {
        examName: exam.examName,
        examDate: exam.examDate,
        startTime: exam.startTime,
        endTime: exam.endTime,
        session: exam.session,
        section: exam.section,
        prevSections: prevSectionsArr.join(','),
        reallocated,
        controlledCorrection: isPublishedOrLocked,
        correctionReason: isPublishedOrLocked ? String(correctionReason || '').trim() : '',
        previousSnapshot,
      },
    });

    portalCache.invalidatePortalCache(exam._id);

    res.status(200).json({
      success: true,
      message: isPublishedOrLocked
        ? 'Published examination updated via controlled Admin audit correction (existing seating preserved).'
        : reallocated
        ? 'Examination updated and seating allocations regenerated safely.'
        : 'Examination updated successfully.',
      reallocated,
      data: attachExamPermissions(exam.toObject(), req.user),
    });
  } catch (error) {
    console.error('[Update Exam Error]:', error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
      ...(error.conflictDetails && { conflictDetails: error.conflictDetails }),
    });
  }
};

// @desc    Delete examination safely (atomic soft-archive + cleanup exam-scoped allocations/students without touching master data)
// @route   DELETE /api/exams/:id
// @access  Private
exports.deleteExam = async (req, res) => {
  try {
    const examId = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({ success: false, message: 'Invalid examination ID format.' });
    }

    const exam = await Exam.findById(examId);
    if (!exam || exam.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Examination not found or has already been deleted.',
      });
    }

    // Ownership / Permission Enforcement
    if (!canUserManageExam(req.user, exam)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You cannot delete another faculty member’s examination.',
      });
    }

    const isAdminUser = req.user?.role === 'admin';
    if (exam.status === 'ONGOING') {
      return res.status(400).json({
        success: false,
        message: 'An ongoing live examination cannot be deleted while candidates are active. Cancel or wait until completion.',
      });
    }

    if (
      !isAdminUser &&
      (exam.status === 'LOCKED' ||
        exam.status === 'PUBLISHED' ||
        exam.status === 'COMPLETED' ||
        exam.visibilityStatus === 'PUBLISHED')
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Completed, Published, or Locked examinations cannot be deleted directly. Please submit a cancellation request to Admin.',
      });
    }

    if (req.user?.role === 'faculty' && exam.approvalStatus === 'APPROVED') {
      return res.status(403).json({
        success: false,
        message:
          'Approved examinations cannot be deleted directly by faculty. Please submit a cancellation request to the Administrator.',
      });
    }

    const updatedSectionAllocations = Array.isArray(exam.sectionAllocations)
      ? exam.sectionAllocations.map((sa) => ({
          ...(sa.toObject ? sa.toObject() : sa),
          allocationStatus: 'CANCELLED',
        }))
      : [];

    let archivedExam = null;
    await runWithOptionalTransaction(async (txSession) => {
      const opts = txSession ? { session: txSession } : undefined;
      // Safely remove exam-specific Allocation & Student snapshots without ever altering master students or mappings
      await Allocation.deleteMany({ examId: exam._id }, opts);
      await Student.deleteMany({ examId: exam._id }, opts);
      archivedExam = await Exam.findOneAndUpdate(
        { _id: exam._id, isDeleted: { $ne: true } },
        {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
            isActive: false,
            status: 'CANCELLED',
            approvalStatus: 'CANCELLED',
            visibilityStatus: 'CANCELLED',
            allocationStatus: 'CANCELLED',
            sectionAllocations: updatedSectionAllocations,
          },
        },
        { new: true, ...(opts || {}) }
      );
    });

    if (!archivedExam) {
      return res.status(404).json({
        success: false,
        message: 'Examination has already been deleted.',
      });
    }

    void AuditLog.create({
      action: 'EXAM_DELETED',
      performedBy: req.user._id,
      performedByName: req.user.name,
      examId: exam._id,
      details: {
        examName: exam.examName,
        subjectCode: exam.subjectCode,
        examDate: exam.examDate,
        session: exam.session,
        deletedByRole: req.user.role,
      },
    }).catch((auditErr) => console.warn('[AuditLog] Async exam delete log warning:', auditErr?.message));

    portalCache.invalidatePortalCache(exam._id);

    res.status(200).json({
      success: true,
      deletedExamId: String(exam._id),
      message: 'Examination deleted. Exam seating allocations removed, permanent mappings & master students preserved, and classroom bookings released.',
    });
  } catch (error) {
    console.error('[Delete Exam Error]:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Unable to delete examination right now. Please try again.',
    });
  }
};

// @desc    Faculty request cancellation/withdrawal for an already Approved or Published examination
// @route   POST /api/exams/:id/request-cancel
// @access  Private
exports.requestCancelExam = async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam || exam.isDeleted) {
      return res.status(404).json({ success: false, message: 'Examination not found.' });
    }

    if (!canUserManageExam(req.user, exam)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only request cancellation for your own examinations.',
      });
    }

    if (exam.status === 'COMPLETED' || exam.status === 'CANCELLED' || exam.approvalStatus === 'CANCELLED') {
      return res.status(400).json({
        success: false,
        message: 'Completed or already cancelled examinations cannot be requested for cancellation.',
      });
    }

    const reason = (req.body.reason || '').trim();
    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a formal reason for requesting cancellation.',
      });
    }

    exam.cancellationRequested = true;
    exam.cancellationRequestReason = reason;
    exam.cancellationRequestedBy = req.user._id;
    exam.cancellationRequestedByName = req.user.name || 'Faculty Member';
    exam.cancellationRequestedAt = new Date();
    await exam.save();

    await AuditLog.create({
      action: 'EXAM_CANCEL_REQUESTED',
      performedBy: req.user._id,
      performedByName: req.user.name,
      examId: exam._id,
      details: {
        examName: exam.examName,
        subjectCode: exam.subjectCode,
        reason,
      },
    });

    res.status(200).json({
      success: true,
      message: 'Cancellation request submitted to Administrator for review.',
      data: attachExamPermissions(exam.toObject(), req.user),
    });
  } catch (error) {
    console.error('[Request Cancel Exam Error]:', error);
    res.status(500).json({ success: false, message: error?.message || 'Failed to submit cancellation request.' });
  }
};

// @desc    Admin manual approval (marks exam APPROVED & schedules T-20 release without forcing immediate publish)
// @route   POST /api/exams/:id/approve
// @access  Private (Admin Only)
exports.approveExam = async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN_APPROVE',
        message: 'Only an administrator can approve examinations.',
      });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_EXAM_ID',
        message: 'Invalid examination ID.',
      });
    }

    const exam = await Exam.findById(req.params.id);
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Examination not found.' });
    }
    if (exam.approvalStatus === 'CANCELLED' || exam.status === 'CANCELLED') {
      return res.status(400).json({ success: false, code: 'EXAM_CANCELLED', message: 'Cannot approve a cancelled examination.' });
    }
    if (exam.status === 'COMPLETED') {
      return res.status(400).json({ success: false, code: 'EXAM_COMPLETED', message: 'Cannot approve a completed examination.' });
    }
    if (exam.approvalStatus === 'APPROVED') {
      return res.status(200).json({
        success: true,
        alreadyApproved: true,
        message: 'Examination is already approved.',
        data: exam,
      });
    }

    const now = new Date();
    const publicationTime = exam.publicationTime || new Date((exam.startDateTime || now).getTime() - 20 * 60 * 1000);
    exam.approvalStatus = 'APPROVED';
    exam.approvedBy = req.user._id;
    exam.approvedByName = req.user.name;
    exam.approvedAt = now;
    exam.publicationTime = publicationTime;
    if (!['PUBLISHED', 'ONGOING'].includes(exam.status)) {
      exam.visibilityStatus = 'SCHEDULED';
      exam.status = 'SCHEDULED';
    }
    await exam.save();

    if (exam.currentAllocationId) {
      await Allocation.findByIdAndUpdate(exam.currentAllocationId, {
        $set: { status: exam.status === 'PUBLISHED' ? 'PUBLISHED' : 'SCHEDULED' },
      });
    }

    await AuditLog.create({
      action: 'EXAM_APPROVED',
      performedBy: req.user._id,
      performedByName: req.user.name,
      examId: exam._id,
      details: {
        examName: exam.examName,
        subjectCode: exam.subjectCode,
        publicationTime,
      },
    });

    portalCache.invalidatePortalCache(exam._id);
    return res.status(200).json({
      success: true,
      message: 'Examination approved cleanly. Ready for scheduled or manual publication.',
      data: exam,
    });
  } catch (error) {
    console.error('[Approve Exam Error]:', error);
    return res.status(500).json({ success: false, message: error?.message || 'Failed to approve examination.' });
  }
};

// @desc    Admin manual review & publish examination (Requirements 5 & 6)
// @route   POST /api/exams/:id/publish
// @access  Private (Admin Only)
exports.publishExam = async (req, res) => {
  try {
    // 1. Authorize: Only administrator can publish
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN_PUBLISH',
        message: 'Only an administrator can approve and publish examinations. Faculty cannot publish.',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_EXAM_ID',
        message: 'Invalid examination ID. Please select a valid examination before publishing.',
      });
    }

    const exam = await Exam.findById(req.params.id);
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Examination not found.' });
    }

    if (exam.approvalStatus === 'CANCELLED' || exam.status === 'CANCELLED') {
      return res.status(400).json({
        success: false,
        code: 'EXAM_CANCELLED',
        message: 'Cannot publish a cancelled examination.',
      });
    }

    if (exam.status === 'COMPLETED') {
      return res.status(400).json({
        success: false,
        code: 'EXAM_COMPLETED',
        message: 'Cannot publish a completed examination. Historical examination records are preserved.',
      });
    }

    if (exam.visibilityStatus === 'PUBLISHED' || exam.status === 'PUBLISHED' || exam.status === 'ONGOING') {
      return res.status(409).json({
        success: false,
        code: 'ALREADY_PUBLISHED',
        message: 'This examination is already published to students and cannot be published repeatedly.',
      });
    }

    if (exam.status === 'DRAFT' || exam.approvalStatus === 'DRAFT') {
      return res.status(400).json({
        success: false,
        code: 'EXAM_DRAFT',
        message: 'Draft examinations must be submitted for review before publication.',
      });
    }

    if (exam.approvalStatus === 'REJECTED') {
      return res.status(400).json({
        success: false,
        code: 'EXAM_REJECTED',
        message: 'Rejected examinations cannot be published. Please revise and resubmit for review.',
      });
    }

    if (req.body?.requirePriorApproval === true && exam.approvalStatus !== 'APPROVED') {
      return res.status(400).json({
        success: false,
        code: 'REQUIRES_ADMIN_APPROVAL',
        message: 'Pending examinations must be approved by an Admin before publication.',
      });
    }

    // 2. Pre-publication Validations (Requirement 5)
    // a. Examination details complete
    if (!exam.examName || !exam.subjectName || !exam.subjectCode || !exam.examDate || !exam.startTime || !exam.endTime || !exam.classroomId) {
      return res.status(400).json({
        success: false,
        message: 'Publication failed: Examination details are incomplete.',
      });
    }

    // b. Student roster valid
    if (!exam.studentCount || exam.studentCount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Publication failed: Student roster is invalid or contains 0 candidates.',
      });
    }

    // c. Seating allocation exists
    if (!exam.currentAllocationId) {
      return res.status(400).json({
        success: false,
        message: 'Publication failed: Seating allocation has not been generated for this examination.',
      });
    }

    const allocation = await Allocation.findById(exam.currentAllocationId);
    if (!allocation || !allocation.students || allocation.students.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Publication failed: Seating allocation contains zero assigned students.',
      });
    }

    // d. Every student has exactly one unique seat per classroom
    const assignedSeats = new Set();
    const assignedRegs = new Set();
    for (const st of allocation.students) {
      const roomKey = st.classroomId ? st.classroomId.toString() : (st.classroomName || st.section || 'room');
      const seatKey = `${roomKey}-${st.seatId}`;
      if (assignedSeats.has(seatKey)) {
        return res.status(400).json({
          success: false,
          message: `Publication failed: Duplicate seat collision detected on seat ${st.seatId}.`,
        });
      }
      if (assignedRegs.has(st.registrationNumber)) {
        return res.status(400).json({
          success: false,
          message: `Publication failed: Candidate ${st.registrationNumber} is assigned to multiple seats.`,
        });
      }
      assignedSeats.add(seatKey);
      assignedRegs.add(st.registrationNumber);
    }

    // e. Classroom capacity check
    const classroom = await Classroom.findById(exam.classroomId);
    if (!classroom && !exam.isParentExam) {
      return res.status(400).json({ success: false, message: 'Publication failed: Classroom record not found.' });
    }
    if (!exam.isParentExam && classroom && exam.studentCount > classroom.totalCapacity) {
      return res.status(400).json({
        success: false,
        message: `Publication failed: Classroom capacity exceeded (${exam.studentCount} students > ${classroom.totalCapacity} capacity).`,
      });
    }

    // f. Verify Attendance PDF generation works
    try {
      await ReportService.generateAttendancePDF(exam, allocation, classroom);
    } catch (pdfErr) {
      return res.status(400).json({
        success: false,
        message: `Publication failed: Attendance PDF generation error: ${pdfErr.message}`,
      });
    }

    // 3. Compute publication time: exactly 20 minutes before start time (Asia/Kolkata)
    const publicationTime = exam.publicationTime || new Date(exam.startDateTime.getTime() - 20 * 60 * 1000);
    const now = new Date();

    if (exam.endDateTime && now >= exam.endDateTime) {
      return res.status(400).json({
        success: false,
        message: 'Publication failed: Examination has already concluded.',
      });
    }

    if (exam.startDateTime && now >= exam.startDateTime) {
      return res.status(400).json({
        success: false,
        message: 'Examination has already started. Immediate automatic student exposure requires an explicit administrative review decision.',
      });
    }

    // Separate Approval and Visibility States (Requirement 5, 6, 7)
    exam.approvalStatus = 'APPROVED';
    exam.approvedBy = req.user._id;
    exam.approvedByName = req.user.name;
    exam.approvedAt = now;
    exam.publicationTime = publicationTime;

    const isImmediatePublish = now >= publicationTime;

    if (isImmediatePublish) {
      exam.visibilityStatus = 'PUBLISHED';
      exam.publishedAt = now;
      exam.status = 'PUBLISHED';
      allocation.status = 'PUBLISHED';
      allocation.publishedAt = now;
    } else {
      exam.visibilityStatus = 'SCHEDULED';
      exam.status = 'SCHEDULED';
      allocation.status = 'SCHEDULED';
    }

    await exam.save();
    await allocation.save();

    await AuditLog.create({
      action: 'EXAM_APPROVED',
      performedBy: req.user._id,
      performedByName: req.user.name,
      examId: exam._id,
      allocationVersion: allocation.version,
      details: {
        examName: exam.examName,
        subjectCode: exam.subjectCode,
        section: exam.section,
        studentCount: exam.studentCount,
        publicationTime,
        visibilityStatus: exam.visibilityStatus,
        isImmediatePublish,
      },
    });

    if (isImmediatePublish) {
      await AuditLog.create({
        action: 'EXAM_PUBLISHED',
        performedBy: req.user._id,
        performedByName: req.user.name,
        examId: exam._id,
        allocationVersion: allocation.version,
        details: {
          examName: exam.examName,
          publishedAt: now,
        },
      });
    }

    portalCache.invalidatePortalCache(exam._id);

    res.status(200).json({
      success: true,
      message: isImmediatePublish
        ? 'Examination approved and published immediately to Student Portal.'
        : `Examination approved by Admin. Student seating will automatically become visible at ${publicationTime.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })} (exactly 20 minutes before examination start).`,
      data: exam,
      allocation,
    });
  } catch (error) {
    console.error('[Publish Exam Error]:', error);
    res.status(500).json({ success: false, message: error?.message || 'Failed to approve and publish examination.' });
  }
};

// @desc    Admin reject pending examination
// @route   POST /api/exams/:id/reject
// @access  Private (Admin Only)
exports.rejectExam = async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only an administrator can reject examinations.' });
    }
    const { reason } = req.body;
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ success: false, message: 'Examination not found.' });

    if (exam.status === 'COMPLETED') {
      return res.status(400).json({
        success: false,
        message: 'Completed examinations cannot be cancelled. Their historical records and attendance reports must remain preserved.',
      });
    }

    exam.approvalStatus = 'REJECTED';
    exam.rejectionReason = reason || 'Rejected by Administrator during review.';
    await exam.save();

    await AuditLog.create({
      action: 'EXAM_REJECTED',
      performedBy: req.user._id,
      performedByName: req.user.name,
      examId: exam._id,
      details: { reason: exam.rejectionReason },
    });

    portalCache.invalidatePortalCache(exam._id);

    res.status(200).json({ success: true, message: 'Examination has been rejected.', data: exam });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Admin cancel examination
// @route   POST /api/exams/:id/cancel
// @desc    Cancel an examination (Admin Only)
// @route   POST /api/exams/:id/cancel
// @access  Private (Admin Only)
exports.cancelExam = async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only an administrator can cancel examinations.' });
    }
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ success: false, message: 'Examination not found.' });

    if (exam.status === 'COMPLETED') {
      return res.status(400).json({
        success: false,
        message: 'Completed examinations cannot be cancelled. Their historical records and attendance reports must remain preserved.',
      });
    }

    const reason = (req.body.reason || req.body.cancellationReason || '').trim();
    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'A formal cancellation reason is required to cancel this examination.',
      });
    }

    if (Array.isArray(exam.sectionAllocations) && exam.sectionAllocations.length > 0) {
      exam.sectionAllocations.forEach((sa) => {
        sa.allocationStatus = 'CANCELLED';
      });
      exam.markModified('sectionAllocations');
    }

    exam.approvalStatus = 'CANCELLED';
    exam.visibilityStatus = 'CANCELLED';
    exam.status = 'CANCELLED';
    exam.isActive = false;
    exam.cancellationReason = reason;
    exam.cancelledBy = req.user._id;
    exam.cancelledByName = req.user.name || 'Administrator';
    exam.cancelledAt = new Date();

    // Update exam & release classroom reservations while preserving historical seating & roster snapshots
    await runWithOptionalTransaction(async (txSession) => {
      const opts = txSession ? { session: txSession } : undefined;
      await exam.save(opts);
      await Allocation.updateMany(
        { examId: exam._id },
        { $set: { status: 'CANCELLED' } },
        opts
      );
      await Allocation.updateMany(
        { examId: exam._id, 'sectionSummaries.0': { $exists: true } },
        { $set: { 'sectionSummaries.$[].status': 'CANCELLED' } },
        opts
      );
    });

    // Write audit log
    await AuditLog.create({
      action: 'EXAM_CANCELLED',
      performedBy: req.user._id,
      performedByName: req.user.name || 'Administrator',
      details: {
        examId: exam._id,
        examName: exam.examName,
        subjectCode: exam.subjectCode,
        examDate: exam.examDate,
        cancellationReason: reason,
        cancelledAt: exam.cancelledAt,
      },
      ipAddress: req.ip,
    });

    portalCache.invalidatePortalCache(exam._id);

    res.status(200).json({
      success: true,
      message: `Examination "${exam.examName}" (${exam.subjectCode}) has been formally cancelled. Classroom reservations have been released.`,
      data: exam,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * =========================================================================
 * CENTRALIZED EXAMINATION CREATION BY EXAM INCHARGE
 * =========================================================================
 */

// @desc    Automatically resolve all permanent faculty-student mappings for a subject & year
// @route   GET /api/exams/resolve-mappings
// @access  Private (Admin, Exam Incharge)
exports.resolveCentralizedMappings = async (req, res) => {
  try {
    const { subjectName, subjectCode, academicYear, year, semester, group } = req.query;

    if (!subjectName && !subjectCode) {
      return res.status(400).json({
        success: false,
        message: 'Please provide Subject Name or Subject Code to resolve mappings.',
      });
    }

    const andConditions = [{ isCurrent: true }];

    if (academicYear && academicYear !== 'ALL') {
      andConditions.push({ academicYear: String(academicYear).trim() });
    }
    if (year && year !== 'ALL') {
      andConditions.push({ year: String(year).trim() });
    }
    if (semester && semester !== 'ALL') {
      andConditions.push({ semester: String(semester).trim() });
    }

    if (subjectCode && subjectCode.trim()) {
      andConditions.push({ subjectCode: subjectCode.trim().toUpperCase() });
    } else if (subjectName && subjectName.trim()) {
      andConditions.push({ subjectName: { $regex: new RegExp(`^${escapeRegExp(subjectName.trim())}$`, 'i') } });
    }

    if (group && group !== 'ALL') {
      const isGroupA = group.toUpperCase().includes('A');
      const isGroupB = group.toUpperCase().includes('B');
      if (isGroupA) {
        andConditions.push({
          $or: [
            { group: { $in: ['Group A', 'A'] } },
            { section: { $in: ['A1', 'A2', 'A3'] } },
          ],
        });
      } else if (isGroupB) {
        andConditions.push({
          $or: [
            { group: { $in: ['Group B', 'B'] } },
            { section: { $in: ['A4', 'A5', 'A6'] } },
          ],
        });
      } else {
        andConditions.push({ group });
      }
    }

    // Retrieve all active mappings
    let mappings = await FacultyMapping.find({ $and: andConditions }).sort({ section: 1, group: 1 });

    // Fallback: If code query returned empty, try subjectName
    if (mappings.length === 0 && subjectName && subjectName.trim()) {
      const fbConditions = [
        { isCurrent: true },
        { subjectName: { $regex: new RegExp(subjectName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') } },
      ];
      if (group && group !== 'ALL') {
        const isGroupA = group.toUpperCase().includes('A');
        const isGroupB = group.toUpperCase().includes('B');
        if (isGroupA) {
          fbConditions.push({
            $or: [
              { group: { $in: ['Group A', 'A'] } },
              { section: { $in: ['A1', 'A2', 'A3'] } },
            ],
          });
        } else if (isGroupB) {
          fbConditions.push({
            $or: [
              { group: { $in: ['Group B', 'B'] } },
              { section: { $in: ['A4', 'A5', 'A6'] } },
            ],
          });
        } else {
          fbConditions.push({ group });
        }
      }
      mappings = await FacultyMapping.find({ $and: fbConditions }).sort({ section: 1, group: 1 });
    }

    // Fallback: If name query returned empty and subjectCode is provided, try code
    if (mappings.length === 0 && subjectCode && subjectCode.trim()) {
      const fbCodeConditions = [
        { isCurrent: true },
        { subjectCode: subjectCode.trim().toUpperCase(), }
      ];
      if (group && group !== 'ALL') {
        const isGroupA = group.toUpperCase().includes('A');
        const isGroupB = group.toUpperCase().includes('B');
        if (isGroupA) {
          fbCodeConditions.push({
            $or: [
              { group: { $in: ['Group A', 'A'] } },
              { section: { $in: ['A1', 'A2', 'A3'] } },
            ],
          });
        } else if (isGroupB) {
          fbCodeConditions.push({
            $or: [
              { group: { $in: ['Group B', 'B'] } },
              { section: { $in: ['A4', 'A5', 'A6'] } },
            ],
          });
        } else {
          fbCodeConditions.push({ group });
        }
      }
      mappings = await FacultyMapping.find({ $and: fbCodeConditions }).sort({ section: 1, group: 1 });
    }

    // Strict isolation: normal faculty only see their own assigned section mappings
    mappings = filterMappingsForUser(req.user, mappings);

    if (!mappings || mappings.length === 0) {
      return res.status(200).json({
        success: false,
        count: 0,
        mappings: [],
        summary: {
          totalMappings: 0,
          totalEnrollments: 0,
          uniqueStudents: 0,
          sectionsDetected: [],
          facultiesDetected: [],
          groupsDetected: [],
          hasDuplicates: false,
          duplicateList: [],
        },
        message: req.user?.role === 'faculty'
          ? `No assigned permanent mappings found for your faculty account (${req.user.name}) in "${subjectName || subjectCode}".`
          : `No active permanent faculty-student mappings found for "${subjectName || subjectCode}". Please configure mappings on the Faculty & Student Assignment page.`,
      });
    }

    // Deduplication & metrics aggregation
    const uniqueStudentsSet = new Set();
    const studentOccurrences = new Map(); // regNo -> array of { section, facultyName }
    const sectionsSet = new Set();
    const facultiesSet = new Set();
    const groupsSet = new Set();
    let totalEnrollments = 0;

    const formattedMappings = mappings.map((m, idx) => {
      const inferredGroup = m.group || (['A1', 'A2', 'A3'].includes(m.section) ? 'Group A' : ['A4', 'A5', 'A6'].includes(m.section) ? 'Group B' : 'Group A');

      const studentList = (m.students || []).map((s, sIdx) => {
        const regNo = (s.registrationNumber || '').toUpperCase().trim();
        const sName = s.studentName || s.name || 'Student';

        if (regNo) {
          uniqueStudentsSet.add(regNo);
          if (!studentOccurrences.has(regNo)) {
            studentOccurrences.set(regNo, []);
          }
          studentOccurrences.get(regNo).push({
            section: m.section,
            group: inferredGroup,
            facultyName: m.facultyName,
          });
        }

        return {
          sNo: s.sNo || sIdx + 1,
          registrationNumber: regNo,
          name: sName,
          section: m.section,
          group: inferredGroup,
        };
      });

      const count = studentList.length || m.studentCount || 0;
      totalEnrollments += count;
      sectionsSet.add(m.section);
      facultiesSet.add(m.facultyName);
      groupsSet.add(inferredGroup);

      const assignedRoomNumber = classroomMappingService.getRoomNumberForSection(m.section) || '3010';
      const assignedClassroomName = `ET BLOCK ${assignedRoomNumber}`;

      return {
        id: m._id,
        mappingId: m._id,
        facultyName: m.facultyName,
        subjectName: m.subjectName,
        subjectCode: m.subjectCode,
        section: m.section,
        group: inferredGroup,
        assignedRoomNumber,
        assignedClassroomName,
        studentCount: count,
        version: m.version || 1,
        academicYear: m.academicYear || academicYear || '2026-2027',
        semester: m.semester || semester || 'I Semester',
        students: studentList,
      };
    });

    // Check for duplicate students in conflicting sections
    const duplicateList = [];
    studentOccurrences.forEach((locations, regNo) => {
      if (locations.length > 1) {
        duplicateList.push({
          registrationNumber: regNo,
          occurrences: locations,
        });
      }
    });

    const detectedSubject = formattedMappings[0]?.subjectName || subjectName || '';
    const detectedCode = formattedMappings[0]?.subjectCode || subjectCode || '';

    res.status(200).json({
      success: true,
      count: formattedMappings.length,
      subjectName: detectedSubject,
      subjectCode: detectedCode,
      mappings: formattedMappings,
      summary: {
        totalMappings: formattedMappings.length,
        totalEnrollments,
        uniqueStudents: uniqueStudentsSet.size,
        sectionsDetected: Array.from(sectionsSet).sort(),
        facultiesDetected: Array.from(facultiesSet).sort(),
        groupsDetected: Array.from(groupsSet).sort(),
        hasDuplicates: duplicateList.length > 0,
        duplicateList,
      },
      message: `Found ${formattedMappings.length} matching section mappings (${totalEnrollments} enrollments across ${uniqueStudentsSet.size} unique students).`,
    });
  } catch (error) {
    console.error('[Resolve Centralized Mappings Error]:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Check real-time classroom interval availability before creating or editing an exam
// @route   GET/POST /api/exams/check-availability
// @access  Private
exports.checkClassroomAvailability = async (req, res) => {
  try {
    const src = req.method === 'GET' ? req.query : req.body || {};
    const {
      examDate,
      startTime,
      endTime,
      session = 'FN',
      group = 'Group A',
      excludeExamId = null,
    } = src;

    if (!examDate || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: 'examDate, startTime, and endTime are required to check classroom availability.',
      });
    }

    let range;
    try {
      range = parseExamDateRange(examDate, startTime, endTime, null, {
        allowOvernight: src.allowOvernight === true || src.allowOvernight === 'true',
        session: session || null,
      });
    } catch (timeErr) {
      return res.status(400).json({
        success: false,
        message: timeErr.message,
      });
    }

    let selectedSections = src.selectedSections;
    if (typeof selectedSections === 'string') {
      selectedSections = selectedSections.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    }
    let classroomOverrides = src.classroomOverrides || {};
    if (typeof classroomOverrides === 'string') {
      try {
        classroomOverrides = JSON.parse(classroomOverrides);
      } catch {
        classroomOverrides = {};
      }
    }

    let targetSections = Array.isArray(selectedSections) && selectedSections.length > 0
      ? selectedSections.map((s) => String(s).trim().toUpperCase())
      : group === 'ALL'
      ? ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']
      : String(group).toUpperCase().includes('B')
      ? ['A4', 'A5', 'A6']
      : ['A1', 'A2', 'A3'];

    // Batch load active classrooms once and run a single conflict query across all target rooms
    const activeRooms = await Classroom.find({ isActive: { $ne: false } })
      .select('_id name roomNumber')
      .lean();
    const roomById = new Map(activeRooms.map((r) => [r._id.toString(), r]));
    const roomByNum = new Map(activeRooms.map((r) => [String(r.roomNumber).trim(), r]));

    const sectionRoomPairs = [];
    const roomIdsToCheck = [];
    for (const sec of targetSections) {
      const ovId = classroomOverrides[sec];
      let roomDoc = null;
      if (ovId) {
        roomDoc = roomById.get(ovId.toString()) || null;
      } else {
        const defNum = classroomMappingService.getRoomNumberForSection(sec);
        roomDoc = defNum ? roomByNum.get(defNum) || null : null;
      }
      if (roomDoc) {
        sectionRoomPairs.push({ sec, roomDoc });
        roomIdsToCheck.push(roomDoc._id);
      }
    }

    const batchConflicts = await classroomMappingService.checkClassroomsConflictsBatch(
      roomIdsToCheck,
      range.examDate,
      range.startDateTime,
      range.endDateTime,
      session,
      excludeExamId || null
    );

    const conflicts = [];
    const seenRooms = new Set();

    for (const { sec, roomDoc } of sectionRoomPairs) {
      const conflict = batchConflicts.get(roomDoc._id.toString()) || null;
      if (conflict && !seenRooms.has(`${roomDoc._id}_${sec}`)) {
        seenRooms.add(`${roomDoc._id}_${sec}`);
        const meta = conflict.conflictMeta || {};
        conflicts.push({
          section: sec,
          classroomId: roomDoc._id,
          roomNumber: roomDoc.roomNumber || meta.roomNumber,
          classroomName: roomDoc.name || meta.classroomName,
          existingExamId: conflict._id,
          existingExamTitle: conflict.examName || conflict.subjectName,
          existingDate: meta.examDate || range.examDate,
          existingStartTime: meta.startTime || formatTime12h(conflict.startTime),
          existingEndTime: meta.endTime || formatTime12h(conflict.endTime),
          existingSession: conflict.session || 'FN',
          message:
            meta.message ||
            `${roomDoc.name} (Section ${sec}) is already booked by "${conflict.examName}" on ${range.examDate} from ${formatTime12h(conflict.startTime)} to ${formatTime12h(conflict.endTime)}.`,
        });
      }
    }

    res.status(200).json({
      success: true,
      available: conflicts.length === 0,
      timeRange: range,
      conflicts,
    });
  } catch (error) {
    console.error('[Check Availability Error]:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create Centralized / Multi-Section Examination with Section-Wise Seating & Attendance Generation
// @route   POST /api/exams/create-centralized
// @access  Private (Admin, Exam Incharge, Faculty scoped to own mappings)
exports.createCentralizedExam = async (req, res) => {
  try {
    const {
      examName,
      examType,
      academicYear,
      department,
      year,
      semester,
      group,
      subjectName,
      subjectCode,
      examDate,
      startTime,
      endTime,
      session,
      selectedMappingIds,
      selectedSections,
      classroomOverrides,
      saveAsDraft,
    } = req.body;

    // 1. Mandatory Fields Validation
    if (!examName || !subjectName || !subjectCode || !examDate) {
      return res.status(400).json({
        success: false,
        message: 'Please provide Examination Title, Subject Name, Subject Code, and Exam Date.',
      });
    }

    // 2. Parse Date & Times in Asia/Kolkata (+05:30) with canonical 12-hour storage & overnight support
    const normalizedReqSess = session ? normalizeSessionCode(session, 'AM') : null;
    const isAfternoonDefault = normalizedReqSess === 'PM' || normalizedReqSess === 'AN';
    const rawStart = startTime || (isAfternoonDefault ? '02:00 PM' : '09:00 AM');
    const rawEnd = endTime || (isAfternoonDefault ? '05:00 PM' : '12:00 PM');
    const examSession = normalizedReqSess || (String(rawStart).toUpperCase().includes('PM') ? 'PM' : 'AM');

    let range;
    try {
      range = parseExamDateRange(examDate, rawStart, rawEnd, null, {
        allowOvernight: Boolean(req.body.allowOvernight),
        session: examSession,
      });
    } catch (timeErr) {
      return res.status(400).json({
        success: false,
        message: timeErr.message,
      });
    }

    const normDate = range.examDate;
    const startStr = range.startTime;
    const endStr = range.endTime;
    const startDateTime = range.startDateTime;
    const endDateTime = range.endDateTime;

    const publicationTime = getPublicationTime(startDateTime);
    const normCode = subjectCode.trim().toUpperCase();
    const examYear = year || 'III Year';
    const examSemester = semester || 'I Semester';
    const examAcademicYear = academicYear || '2026-2027';
    let examGroup = 'Group A';
    if (group === 'ALL') {
      examGroup = 'ALL';
    } else if (group && String(group).toUpperCase().includes('B')) {
      examGroup = 'Group B';
    } else if (group && String(group).toUpperCase().includes('A')) {
      examGroup = 'Group A';
    }

    // 3. Duplicate Parent Examination Check (overlapping time interval for same Subject + Date + Group)
    const duplicateCandidates = await Exam.find({
      subjectCode: normCode,
      examDate: normDate,
      group: examGroup,
      isParentExam: true,
      isDeleted: { $ne: true },
      isActive: true,
      status: { $nin: ['CANCELLED', 'FAILED', 'COMPLETED'] },
      approvalStatus: { $nin: ['CANCELLED', 'REJECTED'] },
    }).lean();

    const requestedSectionSet = new Set(
      Array.isArray(selectedSections)
        ? selectedSections.map((s) => String(s).trim().toUpperCase()).filter(Boolean)
        : []
    );

    const existingParent = duplicateCandidates.find((d) => {
      const interval = classroomMappingService.resolveExamInterval(d);
      const timeOverlaps = !interval
        ? isSameSessionPolarity(d.session, examSession)
        : startDateTime < interval.endDateTime && endDateTime > interval.startDateTime;
      if (!timeOverlaps) return false;
      if (requestedSectionSet.size === 0) return true;
      const dSections =
        Array.isArray(d.sectionAllocations) && d.sectionAllocations.length > 0
          ? d.sectionAllocations.map((sa) => String(sa.section || '').trim().toUpperCase())
          : String(d.section || '')
              .split(',')
              .map((s) => s.trim().toUpperCase())
              .filter(Boolean);
      if (dSections.length === 0) return true;
      return dSections.some((s) => requestedSectionSet.has(s));
    });

    if (existingParent) {
      return res.status(409).json({
        success: false,
        message: `An examination already exists for ${normCode} on ${normDate} (${formatTime12h(existingParent.startTime)} – ${formatTime12h(existingParent.endTime)}) for ${examGroup}: "${existingParent.examName}".`,
        conflictDetails: {
          existingExamId: existingParent._id,
          existingExamTitle: existingParent.examName || existingParent.subjectName,
          subjectCode: existingParent.subjectCode,
          section: existingParent.section,
          examDate: existingParent.examDate,
          startTime: formatTime12h(existingParent.startTime),
          endTime: formatTime12h(existingParent.endTime),
        },
      });
    }

    // 4. Query Matching Permanent Mappings for the selected Group / Sections
    const andConditions = [
      { isCurrent: true },
      {
        $or: [
          { subjectCode: normCode },
          { subjectName: { $regex: new RegExp(`^${escapeRegExp(subjectName.trim())}$`, 'i') } },
        ],
      },
    ];

    if (examGroup === 'Group A') {
      andConditions.push({
        $or: [
          { group: { $in: ['Group A', 'A'] } },
          { section: { $in: ['A1', 'A2', 'A3'] } },
        ],
      });
    } else if (examGroup === 'Group B') {
      andConditions.push({
        $or: [
          { group: { $in: ['Group B', 'B'] } },
          { section: { $in: ['A4', 'A5', 'A6'] } },
        ],
      });
    }

    if (Array.isArray(selectedMappingIds) && selectedMappingIds.length > 0) {
      andConditions.push({ _id: { $in: selectedMappingIds } });
    }
    if (Array.isArray(selectedSections) && selectedSections.length > 0) {
      andConditions.push({ section: { $in: selectedSections.map((s) => String(s).trim().toUpperCase()) } });
    }

    const candidateMappings = await FacultyMapping.find({ $and: andConditions }).sort({ section: 1, group: 1 });

    // Security Check: Never allow faculty to use another faculty member's mappings or sections
    if (req.user && req.user.role === 'faculty') {
      const unauthorized = candidateMappings.some((m) => !isFacultyMappingOwner(req.user, m));
      if (unauthorized) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only schedule examinations for your own assigned sections and subjects.',
        });
      }
    }

    const matchedMappings = filterMappingsForUser(req.user, candidateMappings);

    if (!matchedMappings || matchedMappings.length === 0) {
      return res.status(400).json({
        success: false,
        message: req.user?.role === 'faculty'
          ? `No assigned permanent mappings found for your account in ${normCode} (${subjectName}) for the selected group/sections.`
          : `No active permanent mappings found for ${normCode} (${subjectName}) in ${examGroup}. Please ensure student rosters are assigned under Faculty & Student Assignment.`,
      });
    }

    // Refine examGroup if 'ALL' was requested and matched sections belong cleanly to one group
    if (examGroup === 'ALL') {
      const secs = matchedMappings.map((m) => m.section);
      const hasA = secs.some((s) => ['A1', 'A2', 'A3'].includes(s));
      const hasB = secs.some((s) => ['A4', 'A5', 'A6'].includes(s));
      if (hasA && !hasB) examGroup = 'Group A';
      else if (hasB && !hasA) examGroup = 'Group B';
    }

    // 5 & 6. Perform Section-Wise Seating Allocation using shared helper
    const {
      sectionAllocations,
      allAllocatedStudents,
      allocationDocsToCreate,
      globalStudentRegSet,
    } = await buildSectionAllocationsFromMappings({
      matchedMappings,
      normCode,
      normDate,
      startStr,
      endStr,
      startDateTime,
      endDateTime,
      examSession,
      userId: req.user._id,
      classroomOverrides: classroomOverrides || {},
    });

    if (sectionAllocations.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No students were found in any matching section mappings to allocate seats.',
      });
    }

    // 8. Create Parent Examination Document (deriving faculty creator strictly from req.user)
    const allSectionsStr = sectionAllocations.map((sa) => sa.section).join(', ');
    const allFacultiesStr = sectionAllocations.map((sa) => `${sa.section}: ${sa.facultyName}`).join(' | ');
    const isDraft = saveAsDraft === true;

    const parentExam = new Exam({
      examName: examName.trim(),
      examType: normalizeExamType(examType, examName),
      academicYear: examAcademicYear,
      department: department || 'Computer Science and Engineering',
      year: examYear,
      semester: examSemester,
      section: allSectionsStr,
      group: examGroup,
      facultyName: allFacultiesStr,
      facultyId: req.user._id,
      subjectName: matchedMappings[0].subjectName || subjectName.trim(),
      subjectCode: normCode,
      examDate: normDate,
      startTime: startStr,
      endTime: endStr,
      startTime24: range.startTime24,
      endTime24: range.endTime24,
      allowOvernight: range.isOvernight,
      startDateTime,
      endDateTime,
      publicationTime,
      session: examSession,
      isParentExam: true,
      classroomId: sectionAllocations[0]?.classroomId, // Primary room reference
      sectionAllocations,
      studentCount: globalStudentRegSet.size,
      // Statuses
      approvalStatus: isDraft ? 'DRAFT' : 'PENDING_REVIEW',
      visibilityStatus: 'NOT_SCHEDULED',
      allocationStatus: 'GENERATED',
      status: isDraft ? 'DRAFT' : 'SCHEDULED',
      createdBy: req.user._id,
      createdByRole: req.user.role || 'exam_incharge',
      isDeleted: false,
      isActive: true,
    });

    parentExam.sectionAllocations.forEach((sa) => {
      sa.attendancePdfUrl = `/api/reports/${parentExam._id}/section-attendance-pdf/${sa.section}`;
    });

    // 10. Persist Master Allocation Document for Parent Exam
    const combinedSetDist = { A: 0, B: 0, C: 0, total: 0 };
    let totalAvailableSeats = 0;
    const allStudentsForAllocationDoc = [];

    for (const allocData of allocationDocsToCreate) {
      if (allocData.setDistribution) {
        combinedSetDist.A += allocData.setDistribution.A || 0;
        combinedSetDist.B += allocData.setDistribution.B || 0;
        combinedSetDist.C += allocData.setDistribution.C || 0;
        combinedSetDist.total += allocData.setDistribution.total || 0;
      }
      totalAvailableSeats += allocData.totalAvailableSeats || 0;
      (allocData.students || []).forEach((st) => {
        allStudentsForAllocationDoc.push({
          ...st,
          classroomId: allocData.classroomId,
          classroomName: allocData.classroomName,
          section: allocData.section,
        });
      });
    }

    const sectionSummaries = sectionAllocations.map((sa) => ({
      section: sa.section,
      facultyName: sa.facultyName,
      studentCount: sa.studentCount,
      classroomsUsed: [sa.classroomName],
      status: sa.allocationStatus || 'GENERATED',
    }));

    const classroomSummaries = allocationDocsToCreate.map((ad) => {
      const roomNum = classroomMappingService.getRoomNumberForSection(ad.section) || '';
      const cap = ad.totalAvailableSeats || 72;
      return {
        classroomId: ad.classroomId,
        classroomName: ad.classroomName,
        roomNumber: roomNum,
        section: ad.section,
        allocatedStudents: ad.students?.length || 0,
        capacity: cap,
        availableSeats: cap - (ad.students?.length || 0),
      };
    });

    const masterAllocation = new Allocation({
      examId: parentExam._id,
      group: examGroup,
      classroomId: sectionAllocations[0]?.classroomId,
      version: 1,
      students: allStudentsForAllocationDoc,
      setDistribution: combinedSetDist,
      totalAvailableSeats,
      totalOccupiedSeats: allStudentsForAllocationDoc.length,
      sectionSummaries,
      classroomSummaries,
      validationStatus: {
        isValid: true,
        hasAdjacentCollisions: false,
        violations: [],
        message: 'All section seating allocations successfully verified.',
        validatedAt: new Date(),
      },
      randomSeed: `MASTER-${parentExam._id}-${Date.now()}`,
      status: isDraft ? 'DRAFT' : 'GENERATED',
      isCurrent: true,
      createdBy: req.user._id,
    });

    parentExam.currentAllocationId = masterAllocation._id;

    // 11. Populate Exam-Scoped Student Records
    const studentDocs = allAllocatedStudents.map((st) => ({
      examId: parentExam._id,
      registrationNumber: st.registrationNumber,
      name: st.name,
      department: parentExam.department,
      year: parentExam.year,
      semester: parentExam.semester,
      section: st.section,
      subject: parentExam.subjectName,
      group: st.group,
      facultyName: st.facultyName,
      status: 'active',
      questionPaperSet: st.questionPaperSet,
    }));

    // Persist parentExam, masterAllocation, and exam-scoped students atomically inside a transaction
    await runWithOptionalTransaction(async (txSession) => {
      const opts = txSession ? { session: txSession } : undefined;
      await parentExam.save(opts);
      await masterAllocation.save(opts);
      if (studentDocs.length > 0) {
        await Student.insertMany(studentDocs, { ...(opts || {}), ordered: false });
      }
    });

    // Non-blocking audit log write (preserves audit trail without delaying HTTP 201)
    void AuditLog.create({
      action: 'EXAM_CREATED',
      performedBy: req.user._id,
      performedByName: req.user.name || 'Faculty',
      examId: parentExam._id,
      details: {
        examName: parentExam.examName,
        subjectCode: parentExam.subjectCode,
        subjectName: parentExam.subjectName,
        isParentExam: true,
        isDraft,
        sectionsCount: sectionAllocations.length,
        sections: sectionAllocations.map((s) => s.section),
        uniqueStudents: globalStudentRegSet.size,
        totalEnrollments: allAllocatedStudents.length,
      },
    }).catch((auditErr) => console.warn('[AuditLog] Async exam log warning:', auditErr?.message));

    portalCache.invalidatePortalCache(parentExam._id);

    res.status(201).json({
      success: true,
      message: isDraft
        ? `Examination draft "${parentExam.examName}" saved (${sectionAllocations.length} sections, ${globalStudentRegSet.size} students).`
        : `Examination "${parentExam.examName}" created successfully with ${sectionAllocations.length} section allocations (${globalStudentRegSet.size} unique students). Submitted for Admin review.`,
      totalStudents: globalStudentRegSet.size,
      data: attachExamPermissions(parentExam.toObject(), req.user),
    });
  } catch (error) {
    console.error('[Create Centralized Exam Error]:', error);
    res.status(error?.statusCode || 500).json({
      success: false,
      message: error?.message || 'Failed to create centralized examination.',
      ...(error?.conflictDetails && { conflictDetails: error.conflictDetails }),
    });
  }
};
