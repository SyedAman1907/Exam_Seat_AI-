const Classroom = require('../models/Classroom');
const Exam = require('../models/Exam');
const {
  normalizeDateStr,
  parseExamDateRange,
  formatTime12h,
  isSameSessionPolarity,
} = require('../utils/dateTimeUtils');

/**
 * Authoritative Section-to-Classroom Configuration.
 * Default mapping:
 *   A1 -> ET BLOCK 3010
 *   A2 -> ET BLOCK 3020
 *   A3 -> ET BLOCK 3030
 *   A4 -> ET BLOCK 3040
 *   A5 -> ET BLOCK 3050
 *   A6 -> ET BLOCK 3060
 */
let dynamicSectionRoomMap = {
  A1: '3010',
  A2: '3020',
  A3: '3030',
  A4: '3040',
  A5: '3050',
  A6: '3060',
};

const classroomMappingService = {
  getAllMappings() {
    return { ...dynamicSectionRoomMap };
  },

  updateMapping(section, roomNumber) {
    const sec = (section || '').trim().toUpperCase();
    const room = (roomNumber || '').trim();
    if (sec && room) {
      dynamicSectionRoomMap[sec] = room;
    }
    return { ...dynamicSectionRoomMap };
  },

  getRoomNumberForSection(section) {
    const sec = (section || '').trim().toUpperCase();
    return dynamicSectionRoomMap[sec] || null;
  },

  async getClassroomForSection(section) {
    const sec = (section || '').trim().toUpperCase();
    const roomNumber = dynamicSectionRoomMap[sec];

    if (!roomNumber) {
      throw new Error(`No classroom mapping configured for section "${sec}".`);
    }

    const classroom = await Classroom.findOne({
      roomNumber,
      isActive: true,
    });

    if (!classroom) {
      throw new Error(
        `Assigned classroom "ET BLOCK ${roomNumber}" for Section ${sec} does not exist or is inactive in the database.`
      );
    }

    return classroom;
  },

  async verifyAllClassroomsActive() {
    const requiredRooms = ['3010', '3020', '3030', '3040', '3050', '3060'];
    const activeRooms = await Classroom.find({
      roomNumber: { $in: requiredRooms },
      isActive: true,
    });

    const foundSet = new Set(activeRooms.map((r) => r.roomNumber));
    const missing = requiredRooms.filter((r) => !foundSet.has(r));

    if (missing.length > 0) {
      throw new Error(
        `Required ET BLOCK classrooms are missing or inactive: ${missing.map((r) => `ET BLOCK ${r}`).join(', ')}`
      );
    }

    return activeRooms;
  },

  validateCapacity(classroom, studentCount, section) {
    const capacity = classroom.totalCapacity || classroom.availableCapacity || 72;
    if (studentCount > capacity) {
      const err = new Error(
        `Classroom capacity exceeded for Section ${section}: ${studentCount} students exceeds capacity of ${classroom.name} (${capacity} seats). Authorized overflow configuration required.`
      );
      err.statusCode = 422;
      err.code = 'CAPACITY_EXCEEDED';
      throw err;
    }
    return true;
  },

  /**
   * Resolves the authoritative UTC interval [startDateTime, endDateTime) and canonical 12h strings
   * for an existing Exam document without falling back to session-wide blocking when timestamps exist.
   */
  resolveExamInterval(exam) {
    if (!exam) return null;
    if (exam.examDate && exam.startTime && exam.endTime) {
      try {
        const storedOvernight =
          Boolean(exam.allowOvernight) ||
          Boolean(
            exam.startDateTime &&
              exam.endDateTime &&
              new Date(exam.endDateTime).getTime() > new Date(exam.startDateTime).getTime() &&
              new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(exam.endDateTime)) >
                normalizeDateStr(exam.examDate)
          );
        return parseExamDateRange(exam.examDate, exam.startTime, exam.endTime, null, {
          allowOvernight: storedOvernight,
        });
      } catch (e) {
        console.warn('[ClassroomMappingService] Failed to parse exam interval:', e.message);
      }
    }
    if (exam.startDateTime && exam.endDateTime) {
      const startDT = new Date(exam.startDateTime);
      const endDT = new Date(exam.endDateTime);
      if (!isNaN(startDT.getTime()) && !isNaN(endDT.getTime()) && startDT < endDT) {
        return {
          examDate: normalizeDateStr(exam.examDate) || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(startDT),
          startTime: formatTime12h(exam.startTime || startDT),
          endTime: formatTime12h(exam.endTime || endDT),
          startDateTime: startDT,
          endDateTime: endDT,
        };
      }
    }
    return null;
  },

  /**
   * Batched interval-overlap conflict check across multiple classroom IDs in a single query.
   * Returns Map<classroomIdStr, conflictingExamWithMeta>.
   */
  async checkClassroomsConflictsBatch(
    classroomIds,
    examDate,
    startDateTime,
    endDateTime,
    session,
    excludeExamId = null
  ) {
    const conflictMap = new Map();
    if (!Array.isArray(classroomIds) || classroomIds.length === 0 || !startDateTime || !endDateTime) {
      return conflictMap;
    }

    const uniqIdStrings = [...new Set(classroomIds.filter(Boolean).map((id) => id.toString()))];
    if (uniqIdStrings.length === 0) return conflictMap;

    const normTargetDate = normalizeDateStr(examDate);
    const prevDayDt = new Date(startDateTime.getTime() - 24 * 60 * 60 * 1000);
    const prevDayIso = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(prevDayDt);

    const query = {
      isDeleted: { $ne: true },
      status: { $nin: ['CANCELLED', 'FAILED', 'COMPLETED'] },
      approvalStatus: { $nin: ['CANCELLED', 'REJECTED'] },
      $or: [
        { classroomId: { $in: uniqIdStrings } },
        { 'sectionAllocations.classroomId': { $in: uniqIdStrings } },
      ],
      $and: [
        {
          $or: [
            { startDateTime: { $lt: endDateTime }, endDateTime: { $gt: startDateTime } },
            { examDate: { $in: [normTargetDate, prevDayIso].filter(Boolean) } },
          ],
        },
      ],
    };

    if (excludeExamId) {
      query._id = { $ne: excludeExamId };
    }

    const candidates = await Exam.find(query)
      .select(
        'examName subjectName subjectCode examDate startTime endTime startDateTime endDateTime allowOvernight session section classroomId sectionAllocations.classroomId sectionAllocations.classroomName sectionAllocations.roomNumber sectionAllocations.section sectionAllocations.allocationStatus'
      )
      .populate('classroomId', 'name roomNumber')
      .lean();

    for (const ex of candidates) {
      const interval = this.resolveExamInterval(ex);
      let overlaps = false;

      if (interval) {
        overlaps = startDateTime < interval.endDateTime && endDateTime > interval.startDateTime;
      } else if (ex.examDate && normalizeDateStr(ex.examDate) === normTargetDate && session && isSameSessionPolarity(ex.session, session)) {
        overlaps = true;
      }

      if (!overlaps) continue;

      for (const roomIdStr of uniqIdStrings) {
        if (conflictMap.has(roomIdStr)) continue;

        const matchingSa = (ex.sectionAllocations || []).find(
          (sa) => sa.classroomId && sa.classroomId.toString() === roomIdStr && sa.allocationStatus !== 'CANCELLED'
        );
        const topLevelUsesRoom =
          ex.classroomId &&
          (ex.classroomId._id ? ex.classroomId._id.toString() : ex.classroomId.toString()) === roomIdStr;

        if ((ex.sectionAllocations || []).length > 0 && !matchingSa && !topLevelUsesRoom) {
          continue;
        }
        if ((ex.sectionAllocations || []).length === 0 && !topLevelUsesRoom) {
          continue;
        }

        const conflictRoomNum =
          matchingSa?.roomNumber ||
          ex.classroomId?.roomNumber ||
          this.getRoomNumberForSection(matchingSa?.section || ex.section) ||
          '';
        const conflictRoomName =
          matchingSa?.classroomName ||
          ex.classroomId?.name ||
          (conflictRoomNum ? `ET BLOCK ${conflictRoomNum}` : 'Assigned Classroom');
        const conflictSection = matchingSa?.section || ex.section || '';
        const conflictStart = interval ? interval.startTime : formatTime12h(ex.startTime || '09:00 AM');
        const conflictEnd = interval ? interval.endTime : formatTime12h(ex.endTime || '12:00 PM');
        const conflictDate = interval ? interval.examDate : normalizeDateStr(ex.examDate);

        conflictMap.set(roomIdStr, {
          ...ex,
          conflictMeta: {
            existingExamId: ex._id,
            existingExamTitle: ex.examName || ex.subjectName,
            subjectCode: ex.subjectCode,
            roomNumber: conflictRoomNum,
            classroomName: conflictRoomName,
            section: conflictSection,
            examDate: conflictDate,
            startTime: conflictStart,
            endTime: conflictEnd,
            session: ex.session || 'FN',
            message: `${conflictRoomName}${conflictRoomNum ? ` (Room ${conflictRoomNum})` : ''} for Section ${conflictSection} is already booked by "${ex.examName || ex.subjectName}" on ${conflictDate} from ${conflictStart} to ${conflictEnd}.`,
          },
        });
      }
    }

    return conflictMap;
  },

  /**
   * Single-classroom convenience wrapper delegating to batched conflict checker.
   */
  async checkClassroomConflict(classroomId, examDate, startDateTime, endDateTime, session, excludeExamId = null) {
    if (!classroomId || !startDateTime || !endDateTime) return null;
    const map = await this.checkClassroomsConflictsBatch(
      [classroomId],
      examDate,
      startDateTime,
      endDateTime,
      session,
      excludeExamId
    );
    return map.get(classroomId.toString()) || null;
  },
};

module.exports = classroomMappingService;
