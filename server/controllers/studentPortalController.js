const mongoose = require('mongoose');
const Exam = require('../models/Exam');
const Allocation = require('../models/Allocation');
const Classroom = require('../models/Classroom');
const Student = require('../models/Student');
const StudentEnrollment = require('../models/StudentEnrollment');
const publicationScheduler = require('../scheduler');
const classroomMappingService = require('../services/classroomMappingService');
const portalCache = require('../services/portalCache');
const { isDbConnectivityError } = require('../config/db');
const {
  normalizeDateStr,
  addDaysToIsoDate,
  parseKolkataDateTime,
  parseExamDateRange,
  formatTime12h,
  formatExamTimeRange,
  formatSessionLabel,
  getStudentAccessTime,
  getSeatingWindowCloseTime,
  hasSeatingWindowClosed,
  getEffectiveNow,
  getTodayKolkataDate,
  isExamConcluded,
  formatIsoDateKolkata,
} = require('../utils/dateTimeUtils');
const { resolveExamType } = require('../utils/examTypeUtils');

/**
 * Authoritatively resolves an examination's Asia/Kolkata timestamps from stored examDate + startTime/endTime.
 * Implements the seating visibility rule:
 *   studentAccessTime = startDateTime - 20 minutes
 *   windowCloseTime   = min(startDateTime + 10 minutes, endDateTime)
 * Window stays open for [studentAccessTime, windowCloseTime).
 */
function resolveExamWindow(ex, effectiveNow) {
  let startDateTime = null;
  let endDateTime = null;

  if (ex.examDate && ex.startTime && ex.endTime) {
    try {
      const storedOvernight =
        Boolean(ex.allowOvernight) ||
        Boolean(
          ex.startDateTime &&
          ex.endDateTime &&
          new Date(ex.endDateTime).getTime() > new Date(ex.startDateTime).getTime() &&
          formatIsoDateKolkata(new Date(ex.endDateTime)) > normalizeDateStr(ex.examDate)
        );
      const range = parseExamDateRange(ex.examDate, ex.startTime, ex.endTime, null, {
        allowOvernight: storedOvernight,
      });
      startDateTime = range.startDateTime;
      endDateTime = range.endDateTime;
    } catch (e) {
      console.warn('[StudentPortal] Could not parse stored examDate/startTime/endTime:', e.message);
    }
  }

  if (!startDateTime && ex.examDate && ex.startTime) {
    try {
      startDateTime = parseKolkataDateTime(ex.examDate, ex.startTime);
    } catch (e) { }
  }
  if (!startDateTime && ex.startDateTime) {
    const parsed = new Date(ex.startDateTime);
    if (!isNaN(parsed.getTime())) startDateTime = parsed;
  }

  if (!endDateTime && ex.examDate && ex.endTime) {
    try {
      endDateTime = parseKolkataDateTime(ex.examDate, ex.endTime);
    } catch (e) { }
  }
  if (!endDateTime && ex.endDateTime) {
    const parsed = new Date(ex.endDateTime);
    if (!isNaN(parsed.getTime())) endDateTime = parsed;
  }

  if (!startDateTime || !endDateTime || isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
    return {
      startDateTime: null,
      endDateTime: null,
      studentAccessTime: null,
      accessTimeFormatted: '',
      accessDate: '',
      windowCloseTime: null,
      isInvalidSchedule: true,
      isCompleted: false,
      isPending: true,
      isClosed: false,
      isOpen: false,
    };
  }

  const storedPub = ex.publicationTime ? new Date(ex.publicationTime) : null;
  const studentAccessTime =
    storedPub && !isNaN(storedPub.getTime())
      ? storedPub
      : getStudentAccessTime(startDateTime);
  const accessTimeFormatted = ex.publicationTimeStr
    ? formatTime12h(ex.publicationTimeStr)
    : formatTime12h(studentAccessTime);
  const accessDate = formatIsoDateKolkata(studentAccessTime);
  const windowCloseTime = getSeatingWindowCloseTime(startDateTime, endDateTime);

  const isCompleted =
    ex.status === 'COMPLETED' || (endDateTime ? isExamConcluded(endDateTime, effectiveNow) : false);
  const isClosed = isCompleted || hasSeatingWindowClosed(windowCloseTime, effectiveNow);
  const isPending = !isClosed && effectiveNow < studentAccessTime;
  const isOpen = !isClosed && !isPending;

  return {
    startDateTime,
    endDateTime,
    studentAccessTime,
    accessTimeFormatted,
    accessDate,
    windowCloseTime,
    isInvalidSchedule: false,
    isCompleted,
    isPending,
    isClosed,
    isOpen,
  };
}

// @desc    Get list of examinations scheduled for TODAY (or opening tonight before midnight) in Asia/Kolkata
// @route   GET /api/student/active-exams
// @access  Public
exports.getActiveExams = async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database service is temporarily unavailable while connecting to MongoDB Atlas. Please retry shortly.',
      });
    }

    // Enforce strict student-level ownership when authenticated as a Student
    if (req.user?.role === 'student') {
      const authReg = String(req.user.registrationNumber || '').trim().toUpperCase();
      if (!authReg || authReg !== regNo) {
        return res.status(403).json({
          success: false,
          code: 'FORBIDDEN_STUDENT_SCOPE',
          message: 'Access denied. You can only view your own seating arrangement.',
        });
      }
    }

    const effectiveNow = getEffectiveNow(req);
    const bypassCache = Boolean(req.headers['x-test-timestamp'] || req.query.date);

    // Synchronize overdue transitions synchronously under simulated test clock; otherwise check lean docs first
    if (req.headers['x-test-timestamp']) {
      await publicationScheduler.completeOverdueExams(effectiveNow);
    }

    const { iso, dmy } = getTodayKolkataDate(req.query.date || effectiveNow);
    const tomorrowIso = addDaysToIsoDate(iso, 1);
    const [ty, tm, td] = tomorrowIso.split('-');
    const tomorrowDmy = `${td}/${tm}/${ty}`;

    // Query today's published, approved, non-cancelled/non-completed exams (cached 5s per IST day)
    const candidateExams = await portalCache.getScheduleCandidates(
      `active:${iso}`,
      () =>
        Exam.find({
          isDeleted: { $ne: true },
          approvalStatus: 'APPROVED',
          status: { $in: ['APPROVED', 'PUBLISHED', 'ONGOING', 'SCHEDULED'] },
          visibilityStatus: { $nin: ['NOT_SCHEDULED', 'EXPIRED'] },
          examDate: { $in: [iso, dmy, tomorrowIso, tomorrowDmy] },
        })
          .select(
            'examName examType subjectName subjectCode examDate startTime endTime startDateTime endDateTime publicationTime publicationTimeStr allowOvernight session department section sections group academicYear studentCount approvalStatus visibilityStatus status sectionAllocations.section sectionAllocations.group sectionAllocations.rosterSnapshot'
          )
          .sort({ startDateTime: 1, startTime: 1, session: 1, section: 1 })
          .lean(),
      bypassCache
    );

    // When authenticated as a student, strictly scope examinations to those where this
    // student is allocated (by unique examination ID + student roster mapping). Never
    // return the day's first/ambiguous examination to a different student.
    if (req.user?.role === 'student') {
      const studentRegNo = String(req.user.registrationNumber || '').trim().toUpperCase();
      if (!studentRegNo) {
        return res.status(403).json({
          success: false,
          code: 'FORBIDDEN_STUDENT_SCOPE',
          message: 'Access denied. Student registration number not found in session.',
        });
      }

      const [studentAllocs, directRosterExams] = await Promise.all([
        Allocation.find({
          isCurrent: true,
          status: { $ne: 'DRAFT' },
          'students.registrationNumber': studentRegNo,
        })
          .select('examId')
          .lean(),
        Exam.find({
          isDeleted: { $ne: true },
          'sectionAllocations.rosterSnapshot.registrationNumber': studentRegNo,
        })
          .select('_id')
          .lean(),
      ]);

      const allocatedExamIds = new Set();
      for (const a of studentAllocs || []) {
        if (a.examId) allocatedExamIds.add(String(a.examId));
      }
      for (const e of directRosterExams || []) {
        allocatedExamIds.add(String(e._id));
      }

      if (allocatedExamIds.size > 0) {
        candidateExams = candidateExams.filter((ex) => allocatedExamIds.has(String(ex._id)));
      } else {
        candidateExams = [];
      }
    }

    // Keep today's exams, plus tomorrow's early-morning exams ONLY if their 20-min early access opens today in IST
    const todayExams = candidateExams.filter((ex) => {
      const normExDate = normalizeDateStr(ex.examDate);
      if (normExDate === iso) return true;
      const win = resolveExamWindow(ex, effectiveNow);
      return !win.isInvalidSchedule && win.accessDate === iso;
    });

    if (!todayExams || todayExams.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        todayDate: iso,
        todayDisplayDate: dmy,
        serverNow: effectiveNow.toISOString(),
        message: 'No examinations scheduled for today.',
        data: [],
      });
    }

    // 3. Evaluate [start - 20m, start + 10m) seating access window for each examination
    let hasOpenWindow = false;
    let hasPendingWindow = false;
    let allWindowsClosed = true;

    const enrichedExams = todayExams.map((ex) => {
      const {
        startDateTime,
        endDateTime,
        studentAccessTime,
        accessTimeFormatted,
        accessDate,
        windowCloseTime,
        isInvalidSchedule,
        isCompleted,
        isClosed,
        isPending,
      } = resolveExamWindow(ex, effectiveNow);

      let windowState = 'PENDING';
      let notice = accessTimeFormatted
        ? `Your seating arrangement will be available at ${accessTimeFormatted}.`
        : 'Examination schedule is unavailable. Please contact the Administrator.';

      if (isInvalidSchedule) {
        windowState = 'INVALID';
        notice = 'Examination schedule is missing or invalid. Please contact the Administrator.';
      } else if (isCompleted) {
        windowState = 'COMPLETED';
        notice = 'Examination has concluded.';
      } else if (isClosed) {
        windowState = 'CLOSED';
        notice = 'Seating visibility window has closed (ended 10 minutes after examination start).';
      } else if (isPending) {
        windowState = 'PENDING';
        hasPendingWindow = true;
        allWindowsClosed = false;
      } else {
        windowState = 'OPEN';
        notice = `Seating arrangement is open (published at ${accessTimeFormatted} IST).`;
        hasOpenWindow = true;
        allWindowsClosed = false;
      }

      const rawObj = { ...ex };
      rawObj.examType = resolveExamType(rawObj);
      try {
        rawObj.startTime = formatTime12h(rawObj.startTime || startDateTime);
      } catch {
        rawObj.startTime = rawObj.startTime || '';
      }
      try {
        rawObj.endTime = formatTime12h(rawObj.endTime || endDateTime);
      } catch {
        rawObj.endTime = rawObj.endTime || '';
      }

      let formattedTimeRange = '';
      try {
        formattedTimeRange = formatExamTimeRange(rawObj);
      } catch {
        formattedTimeRange = `${rawObj.startTime} – ${rawObj.endTime}`.trim();
      }

      return {
        ...rawObj,
        formattedTimeRange,
        startDateTime,
        endDateTime,
        studentAccessTime,
        accessTimeFormatted,
        accessDate,
        windowCloseTime,
        windowState,
        notice,
      };
    });

    let overallMessage = '';
    if (hasOpenWindow) {
      overallMessage = 'Seating access is currently open for today’s examination.';
    } else if (hasPendingWindow) {
      overallMessage = 'Your examination seating information will become available 20 minutes before the examination starts.';
    } else if (allWindowsClosed) {
      overallMessage = 'Seating visibility windows for today’s examinations have closed.';
    }

    // Trigger non-blocking background sweep if any active exam just reached endDateTime during normal traffic
    if (!req.headers['x-test-timestamp'] && allWindowsClosed && enrichedExams.some((e) => e.status !== 'COMPLETED')) {
      void publicationScheduler.completeOverdueExams();
    }

    // Filter out completed and closed-window examinations so expired seating is hidden
    const activeList = enrichedExams.filter((e) => e.windowState !== 'COMPLETED' && e.windowState !== 'CLOSED');

    res.status(200).json({
      success: true,
      count: activeList.length,
      totalTodayCount: enrichedExams.length,
      todayDate: iso,
      todayDisplayDate: dmy,
      serverNow: effectiveNow.toISOString(),
      message: activeList.length === 0 ? 'Seating visibility windows for today’s examinations have closed.' : overallMessage,
      data: activeList,
    });
  } catch (error) {
    if (isDbConnectivityError(error) || mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database service is temporarily unavailable while reconnecting to MongoDB Atlas. Please retry shortly.',
      });
    }
    console.error('[StudentPortal getActiveExams Error]', error.message);
    res.status(500).json({
      success: false,
      code: 'SERVER_ERROR',
      message: 'Unable to fetch today’s examination schedule. Please retry shortly.',
    });
  }
};

// @desc    Lookup student seating assignment with strict 20-minute early access window enforcement
// @route   POST /api/student/lookup
// @access  Public (Rate Limited)
exports.lookupSeat = async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database service is temporarily unavailable while connecting to MongoDB Atlas. Please retry shortly.',
      });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { registrationNumber, examId, date } = body;

    // 1. Fail-fast input & format validation before querying MongoDB
    if (!registrationNumber || typeof registrationNumber !== 'string' || !registrationNumber.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid Student Registration Number.',
      });
    }

    const regNo = registrationNumber.trim().toUpperCase();

    // Validate registration number format (10-character college roll number; allow 8-12 alphanumeric)
    if (!/^[A-Z0-9]{8,12}$/i.test(regNo)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid registration number format. Please enter a valid 10-character candidate roll number.',
      });
    }

    // Enforce strict student-level ownership when authenticated as a Student
    if (req.user?.role === 'student') {
      const authReg = String(req.user.registrationNumber || '').trim().toUpperCase();
      if (!authReg || authReg !== regNo) {
        return res.status(403).json({
          success: false,
          code: 'FORBIDDEN_STUDENT_SCOPE',
          message: 'Access denied. You can only view your own seating arrangement.',
        });
      }
    }

    const effectiveNow = getEffectiveNow(req);
    const hasTestClock = Boolean(req.headers['x-test-timestamp']);
    const bypassCache = hasTestClock || Boolean(date);
    if (hasTestClock) {
      await publicationScheduler.completeOverdueExams(effectiveNow);
    }

    const { iso, dmy } = getTodayKolkataDate(date || effectiveNow);
    const tomorrowIso = addDaysToIsoDate(iso, 1);
    const [ty, tm, td] = tomorrowIso.split('-');
    const tomorrowDmy = `${td}/${tm}/${ty}`;

    // 2. Query matching examinations (cached 5s for burst lookups; bypassed under test clock/date)
    const examQuery = {
      isDeleted: { $ne: true },
      approvalStatus: { $nin: ['CANCELLED', 'REJECTED', 'DRAFT'] },
      status: { $nin: ['CANCELLED', 'FAILED', 'DRAFT'] },
      examDate: { $in: [iso, dmy, tomorrowIso, tomorrowDmy] },
    };

    if (examId) {
      examQuery._id = examId;
    }

    const baseExamFields =
      'examName examType subjectName subjectCode examDate startTime endTime startDateTime endDateTime publicationTime publicationTimeStr allowOvernight session department section group academicYear facultyName status approvalStatus visibilityStatus sectionAllocations.section sectionAllocations.group sectionAllocations.roomNumber sectionAllocations.classroomName sectionAllocations.facultyName';

    const cacheKey = examId ? `lookup:${iso}:${examId}` : `lookup:${iso}:all`;
    const candidateExams = await portalCache.getScheduleCandidates(
      cacheKey,
      () => Exam.find(examQuery).select(baseExamFields).lean(),
      bypassCache
    );
    const preloadedAllocation = null;

    const todayExams = candidateExams.filter((ex) => {
      if (examId && ex._id.toString() === examId.toString()) return true;
      if (normalizeDateStr(ex.examDate) === iso) return true;
      const win = resolveExamWindow(ex, effectiveNow);
      return !win.isInvalidSchedule && win.accessDate === iso;
    });

    if (!todayExams || todayExams.length === 0) {
      const [studentExists, hasEnrollment] = await Promise.all([
        Student.exists({ registrationNumber: regNo }),
        StudentEnrollment.exists({ rollNumber: regNo }),
      ]);
      if (!studentExists && !hasEnrollment) {
        return res.status(404).json({
          success: false,
          message: `Candidate with Registration Number "${regNo}" was not found in permanent student records. Please check your roll number or contact the Exam Cell.`,
        });
      }
      return res.status(404).json({
        success: false,
        message: 'No examinations scheduled for today.',
      });
    }

    // 3. Identify target examination for this student (prioritizing APPROVED OPEN -> PENDING -> COMPLETED)
    const windowRank = (ex) => {
      if (ex.approvalStatus !== 'APPROVED') return 3;
      const win = resolveExamWindow(ex, effectiveNow);
      if (win.isOpen) return 0;
      if (win.isPending) return 1;
      return 2; // completed / invalid
    };

    let targetExam = null;
    let preMatchedAlloc = preloadedAllocation || null;
    let cachedSeatIndex = null;

    const loadCachedSeatIndex = (id) =>
      portalCache.getExamSeatIndex(
        id,
        async () => {
          const allocDoc = await Allocation.findOne({
            examId: id,
            isCurrent: true,
            status: { $ne: 'DRAFT' },
          })
            .select('section group status students')
            .lean();

          if (!allocDoc || !Array.isArray(allocDoc.students)) {
            return null;
          }
          const byRegNo = new Map();
          for (const st of allocDoc.students) {
            const key = String(st.registrationNumber || '').trim().toUpperCase();
            if (key) {
              byRegNo.set(key, st);
            }
          }
          return {
            section: allocDoc.section,
            group: allocDoc.group,
            status: allocDoc.status,
            byRegNo,
          };
        },
        bypassCache
      );

    if (examId) {
      targetExam = todayExams.find((e) => e._id.toString() === examId.toString());
    } else if (todayExams.length === 1) {
      targetExam = todayExams[0];
    } else {
      const seatIndices = await Promise.all(
        todayExams.map(async (ex) => ({
          exam: ex,
          index: await loadCachedSeatIndex(ex._id),
        }))
      );
      const enrolledMatches = seatIndices.filter((entry) => entry.index?.byRegNo?.has(regNo));
      const candidatePool =
        enrolledMatches.length > 0 ? enrolledMatches.map((entry) => entry.exam) : todayExams;
      candidatePool.sort((a, b) => windowRank(a) - windowRank(b));
      targetExam = candidatePool[0];
      const matchedEntry = seatIndices.find((entry) => String(entry.exam._id) === String(targetExam?._id));
      cachedSeatIndex = matchedEntry?.index || null;
    }

    if (!targetExam) {
      return res.status(404).json({
        success: false,
        message: 'No matching examination found for today.',
      });
    }

    // Reject unpublished / unapproved examinations cleanly before exposing any seat data
    if (
      targetExam.approvalStatus !== 'APPROVED' ||
      (targetExam.visibilityStatus === 'NOT_SCHEDULED' && targetExam.status !== 'PUBLISHED' && targetExam.status !== 'ONGOING')
    ) {
      return res.status(403).json({
        success: false,
        isNotPublished: true,
        serverNow: effectiveNow.toISOString(),
        message: 'Seating information for this examination has not been published yet. Please check back after Exam Cell approval.',
      });
    }

    // 4. Compute [start - 20m, start + 10m) seating access window in Asia/Kolkata timezone
    const {
      startDateTime,
      endDateTime,
      studentAccessTime,
      accessTimeFormatted,
      accessDate,
      windowCloseTime,
      isInvalidSchedule,
      isCompleted,
      isClosed,
      isPending,
    } = resolveExamWindow(targetExam, effectiveNow);

    // RULE 0: Missing or malformed schedule must never leak seat access
    if (isInvalidSchedule) {
      return res.status(400).json({
        success: false,
        isInvalidSchedule: true,
        serverNow: effectiveNow.toISOString(),
        message: 'Examination schedule is missing or invalid. Please contact the Exam Cell.',
      });
    }

    // RULE 1: Window Closed (>= start + 10 minutes) or Examination Concluded -> Hidden
    if (isClosed || isCompleted) {
      if (!hasTestClock && isCompleted && targetExam.status !== 'COMPLETED') {
        void publicationScheduler.completeOverdueExams();
      }
      return res.status(403).json({
        success: false,
        isWindowClosed: true,
        isCompleted,
        serverNow: effectiveNow.toISOString(),
        message: 'Seating information is no longer available. The examination seating access window has closed.',
      });
    }

    // RULE 2: Before configured Student Portal Publication Time -> Strictly Locked
    if (isPending) {
      return res.status(403).json({
        success: false,
        isPending: true,
        serverNow: effectiveNow.toISOString(),
        message: `Your seating arrangement will be available at ${accessTimeFormatted}.`,
        studentAccessTime: studentAccessTime.toISOString(),
        publicationTimeStr: accessTimeFormatted,
        accessTimeFormatted,
        accessDate,
        startTime: formatTime12h(targetExam.startTime || startDateTime),
        endTime: formatTime12h(targetExam.endTime || endDateTime),
        startDateTime,
        endDateTime,
        windowCloseTime,
      });
    }

    // RULE 3: Inside [studentAccessTime, windowCloseTime) -> Read-only Seat Lookup!
    let studentMatch = null;
    let studentSection = 'A1';
    let assignedFaculty = targetExam.facultyName || 'Department Faculty';
    let roomNumber = '3010';
    let classroomName = 'ET BLOCK 3010';
    let inferredGroup = targetExam.group || 'Group A';

    // Use cached O(1) read-only seat index per exam when not bypassed
    if (!cachedSeatIndex) {
      cachedSeatIndex = await loadCachedSeatIndex(targetExam._id);
    }

    if (cachedSeatIndex) {
      studentMatch = cachedSeatIndex.byRegNo.get(regNo) || null;
      if (studentMatch) {
        studentSection = studentMatch.section || cachedSeatIndex.section || 'A1';
        const secAlloc = (targetExam.sectionAllocations || []).find((sa) => sa.section === studentSection);
        roomNumber = secAlloc?.roomNumber || studentMatch.roomNumber || classroomMappingService.getRoomNumberForSection(studentSection) || '3010';
        classroomName = secAlloc?.classroomName || studentMatch.classroomName || `ET BLOCK ${roomNumber}`;
        assignedFaculty = secAlloc?.facultyName || studentMatch.facultyName || targetExam.facultyName || 'Department Faculty';
        inferredGroup = studentMatch.group || secAlloc?.group || cachedSeatIndex.group || (['A1', 'A2', 'A3'].includes(studentSection) ? 'Group A' : 'Group B');
      }
    } else if (preMatchedAlloc) {
      studentMatch = preMatchedAlloc.students?.[0] || null;
      if (studentMatch) {
        studentSection = studentMatch.section || preMatchedAlloc.section || 'A1';
        const secAlloc = (targetExam.sectionAllocations || []).find((sa) => sa.section === studentSection);
        roomNumber = secAlloc?.roomNumber || studentMatch.roomNumber || classroomMappingService.getRoomNumberForSection(studentSection) || '3010';
        classroomName = secAlloc?.classroomName || studentMatch.classroomName || `ET BLOCK ${roomNumber}`;
        assignedFaculty = secAlloc?.facultyName || studentMatch.facultyName || targetExam.facultyName || 'Department Faculty';
        inferredGroup = studentMatch.group || secAlloc?.group || preMatchedAlloc.group || (['A1', 'A2', 'A3'].includes(studentSection) ? 'Group A' : 'Group B');
      }
    }

    // Fallback: Check parent exam sectionAllocations snapshot directly only if Allocation didn't match
    if (!studentMatch) {
      const fullExamRoster = await Exam.findById(targetExam._id)
        .select('facultyName sectionAllocations.section sectionAllocations.group sectionAllocations.roomNumber sectionAllocations.classroomName sectionAllocations.facultyName sectionAllocations.rosterSnapshot')
        .lean();
      for (const sa of fullExamRoster?.sectionAllocations || []) {
        const found = (sa.rosterSnapshot || []).find(
          (s) => String(s.registrationNumber || '').trim().toUpperCase() === regNo
        );
        if (found) {
          studentMatch = found;
          studentSection = found.section || sa.section || 'A1';
          roomNumber = sa.roomNumber || classroomMappingService.getRoomNumberForSection(studentSection) || '3010';
          classroomName = sa.classroomName || `ET BLOCK ${roomNumber}`;
          assignedFaculty = sa.facultyName || fullExamRoster.facultyName || targetExam.facultyName || 'Department Faculty';
          inferredGroup = found.group || sa.group || (['A1', 'A2', 'A3'].includes(studentSection) ? 'Group A' : 'Group B');
          break;
        }
      }
    }

    if (!studentMatch) {
      const [studentExists, hasEnrollment] = await Promise.all([
        Student.exists({ registrationNumber: regNo }),
        StudentEnrollment.exists({ rollNumber: regNo }),
      ]);
      if (!studentExists && !hasEnrollment) {
        return res.status(404).json({
          success: false,
          message: `Candidate with Registration Number "${regNo}" was not found in permanent student records. Please check your roll number or contact the Exam Cell.`,
        });
      }
      return res.status(404).json({
        success: false,
        message: `No published seating record found for registration number "${regNo}" in ${targetExam.subjectName} (${targetExam.examDate}). Please contact the Exam Cell.`,
      });
    }

    // Return verified seating details during the active [studentAccessTime, endDateTime) window
    res.status(200).json({
      success: true,
      data: {
        studentName: studentMatch.name,
        registrationNumber: studentMatch.registrationNumber,
        examination: `${targetExam.subjectName} (${targetExam.subjectCode})`,
        subject: `${targetExam.subjectName} (${targetExam.subjectCode})`,
        subjectName: targetExam.subjectName,
        subjectCode: targetExam.subjectCode,
        examName: targetExam.examName,
        examType: resolveExamType(targetExam),
        academicYear: targetExam.academicYear || '2026-2027',
        semester: targetExam.semester || 'I Semester',
        group: inferredGroup,
        section: studentSection,
        faculty: assignedFaculty,
        facultyName: assignedFaculty,
        examinationDate: targetExam.examDate,
        examDate: targetExam.examDate,
        examinationTime: targetExam.startTime ? formatExamTimeRange(targetExam) : targetExam.session,
        startTime: formatTime12h(targetExam.startTime || startDateTime),
        endTime: formatTime12h(targetExam.endTime || endDateTime),
        session: targetExam.session || (targetExam.startTime?.toUpperCase().includes('PM') ? 'AN' : 'FN'),
        questionPaperSet: studentMatch.questionPaperSet || 'A',
        classroom: `${classroomName} (${roomNumber})`,
        classroomName: classroomName,
        classroomHall: classroomName,
        roomNumber: roomNumber,
        block: 'ET BLOCK',
        floor: '3rd Floor',
        row: `Row ${studentMatch.rowNumber || 1}`,
        rowNumber: studentMatch.rowNumber || 1,
        bench: `Bench ${studentMatch.benchNumber || 1}`,
        benchNumber: studentMatch.benchNumber || 1,
        chairNumber: studentMatch.seatNumber || 1,
        seatNumber: studentMatch.seatNumber || 1,
        seatId: studentMatch.seatId || `R${studentMatch.rowNumber || 1}-B${studentMatch.benchNumber || 1}-S${studentMatch.seatNumber || 1}`,
        studentAccessTime: studentAccessTime.toISOString(),
        publicationTimeStr: accessTimeFormatted,
        accessTimeFormatted,
        windowCloseTime: windowCloseTime ? windowCloseTime.toISOString() : null,
        serverNow: effectiveNow.toISOString(),
      },
    });
  } catch (error) {
    if (isDbConnectivityError(error) || mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database service is temporarily unavailable while reconnecting to MongoDB Atlas. Please retry shortly.',
      });
    }
    console.error('[StudentPortal lookupSeat Error]', error.message);
    res.status(500).json({
      success: false,
      code: 'SERVER_ERROR',
      message: 'Unable to complete seating lookup right now. Please try again.',
    });
  }
};

// @desc    Get authenticated student's own examination list and (once published) own seat details only
// @route   GET /api/student/my-exams
// @access  Private (Student Only)
exports.getStudentExams = async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'student' || !req.user.registrationNumber) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        message: 'Student authentication required.',
      });
    }

    const regNo = String(req.user.registrationNumber).trim().toUpperCase();
    const effectiveNow = getEffectiveNow(req);
    if (req.headers['x-test-timestamp']) {
      await publicationScheduler.completeOverdueExams(effectiveNow);
    }

    // Find approved examinations where this student is allocated or enrolled (never exposing other students)
    const [allocDocs, directExamIds] = await Promise.all([
      Allocation.find({
        isCurrent: true,
        status: { $ne: 'DRAFT' },
        'students.registrationNumber': regNo,
      })
        .select('examId students.$')
        .lean(),
      Exam.find({
        isDeleted: { $ne: true },
        approvalStatus: 'APPROVED',
        status: { $nin: ['CANCELLED', 'FAILED', 'DRAFT'] },
        'sectionAllocations.rosterSnapshot.registrationNumber': regNo,
      })
        .select('_id')
        .lean(),
    ]);

    const seatByExamId = new Map();
    const matchedExamIds = new Set(directExamIds.map((d) => String(d._id)));
    for (const ad of allocDocs) {
      if (ad.examId && ad.students?.[0]) {
        matchedExamIds.add(String(ad.examId));
        seatByExamId.set(String(ad.examId), ad.students[0]);
      }
    }

    // Strictly identify examinations by unique examination ID + this student's allocation
    // / roster snapshot mapping. Never fall back to matching by subject code alone, which
    // would leak examinations from other sections, groups, or units to this student.
    const examQuery = {
      isDeleted: { $ne: true },
      approvalStatus: 'APPROVED',
      status: { $nin: ['CANCELLED', 'FAILED', 'DRAFT'] },
      $or: [
        ...(matchedExamIds.size > 0 ? [{ _id: { $in: Array.from(matchedExamIds) } }] : []),
      ],
    };

    if (examQuery.$or.length === 0) {
      return res.status(200).json({
        success: true,
        serverNow: effectiveNow.toISOString(),
        student: req.user,
        count: 0,
        data: [],
      });
    }

    const exams = await Exam.find(examQuery)
      .select(
        'examName examType subjectName subjectCode academicYear semester section group facultyName examDate startTime endTime startDateTime endDateTime publicationTime publicationTimeStr allowOvernight session approvalStatus visibilityStatus status sectionAllocations.section sectionAllocations.group sectionAllocations.roomNumber sectionAllocations.classroomName sectionAllocations.facultyName'
      )
      .sort({ startDateTime: 1, examDate: 1 })
      .lean();

    const resultRows = exams.map((ex) => {
      const win = resolveExamWindow(ex, effectiveNow);
      let publicationStatusLabel = 'Scheduled';
      let notice = win.accessTimeFormatted
        ? `Your seating arrangement will be available at ${win.accessTimeFormatted}.`
        : 'Publication time pending configuration.';

      if (win.isCompleted || ex.status === 'COMPLETED') {
        publicationStatusLabel = 'Completed';
        notice = 'Examination concluded.';
      } else if (win.isClosed) {
        publicationStatusLabel = 'Window Closed';
        notice = 'Seating visibility window closed 10 minutes after examination start.';
      } else if (win.isOpen) {
        publicationStatusLabel = 'Published';
        notice = `Seating published at ${win.accessTimeFormatted} IST.`;
      }

      // Strictly only attach this student's OWN seat details when publication window is OPEN
      let ownSeat = null;
      if (win.isOpen) {
        const matched = seatByExamId.get(String(ex._id));
        if (matched) {
          const secAlloc = (ex.sectionAllocations || []).find((sa) => sa.section === matched.section);
          const roomNum = secAlloc?.roomNumber || matched.roomNumber || classroomMappingService.getRoomNumberForSection(matched.section) || '3010';
          const clsName = secAlloc?.classroomName || matched.classroomName || `ET BLOCK ${roomNum}`;
          const assignedFaculty = secAlloc?.facultyName || matched.facultyName || ex.facultyName || 'Department Faculty';
          ownSeat = {
            registrationNumber: matched.registrationNumber,
            studentName: matched.name,
            section: matched.section || ex.section,
            group: matched.group || secAlloc?.group || ex.group,
            facultyName: assignedFaculty,
            classroomName: clsName,
            classroomHall: clsName,
            roomNumber: roomNum,
            block: 'ET BLOCK',
            floor: '3rd Floor',
            row: `Row ${matched.rowNumber || 1}`,
            rowNumber: matched.rowNumber || 1,
            bench: `Bench ${matched.benchNumber || 1}`,
            benchNumber: matched.benchNumber || 1,
            chairNumber: matched.seatNumber || 1,
            seatNumber: matched.seatNumber || 1,
            seatId: matched.seatId,
            questionPaperSet: matched.questionPaperSet || 'A',
            instructions: 'Bring your valid Student ID Card and report at least 15 minutes before exam start.',
          };
        }
      }

      return {
        _id: ex._id,
        examName: ex.examName,
        examType: resolveExamType(ex),
        subjectName: ex.subjectName,
        subjectCode: ex.subjectCode,
        academicYear: ex.academicYear,
        semester: ex.semester,
        examDate: ex.examDate,
        session: formatSessionLabel(ex.session, ex.startTime),
        startTime: formatTime12h(ex.startTime || win.startDateTime),
        endTime: formatTime12h(ex.endTime || win.endDateTime),
        formattedTimeRange: formatExamTimeRange(ex),
        publicationTimeStr: win.accessTimeFormatted,
        publicationTime: win.studentAccessTime ? win.studentAccessTime.toISOString() : null,
        studentAccessTime: win.studentAccessTime ? win.studentAccessTime.toISOString() : null,
        windowCloseTime: win.windowCloseTime ? win.windowCloseTime.toISOString() : null,
        windowState: win.isCompleted ? 'COMPLETED' : win.isClosed ? 'CLOSED' : win.isPending ? 'PENDING' : 'OPEN',
        publicationStatusLabel,
        notice,
        seat: ownSeat,
      };
    });

    return res.status(200).json({
      success: true,
      serverNow: effectiveNow.toISOString(),
      student: {
        registrationNumber: req.user.registrationNumber,
        name: req.user.name,
        department: req.user.department,
        section: req.user.section,
        group: req.user.group,
      },
      count: resultRows.length,
      data: resultRows,
    });
  } catch (error) {
    if (isDbConnectivityError(error) || mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        success: false,
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database service is temporarily unavailable.',
      });
    }
    console.error('[StudentPortal getStudentExams Error]', error.message);
    return res.status(500).json({
      success: false,
      code: 'SERVER_ERROR',
      message: 'Failed to retrieve your examination schedule.',
    });
  }
};
