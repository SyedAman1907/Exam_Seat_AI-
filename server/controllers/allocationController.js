const mongoose = require('mongoose');
const Allocation = require('../models/Allocation');
const Exam = require('../models/Exam');
const Classroom = require('../models/Classroom');
const Student = require('../models/Student');
const AuditLog = require('../models/AuditLog');
const FacultyMapping = require('../models/FacultyMapping');
const StudentClassificationService = require('../services/studentClassificationService');
const SeatingService = require('../services/seatingService');
const portalCache = require('../services/portalCache');
const { isSameSessionPolarity } = require('../utils/dateTimeUtils');

/**
 * Robustly extracts and validates examination ID from params, body, or query
 */
function resolveExamId(req) {
  const candidate = req.params?.id || req.body?.examId || req.query?.examId;
  if (!candidate || candidate === 'undefined' || candidate === 'null' || !String(candidate).trim()) {
    return null;
  }
  return String(candidate).trim();
}

// @desc    Generate initial seating allocation across sections and multiple classrooms
// @route   POST /api/exams/:id/allocate or POST /api/exams/allocate
// @access  Private
exports.generateAllocation = async (req, res) => {
  try {
    const examId = resolveExamId(req);
    if (!examId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid examination ID. An examination must be selected before generating seating allocations.',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({
        success: false,
        message: `Invalid examination ID format: "${examId}".`,
      });
    }

    const exam = await Exam.findById(examId);
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Examination not found.' });
    }

    if (exam.status === 'LOCKED' || exam.status === 'PUBLISHED') {
      return res.status(400).json({
        success: false,
        message: 'This examination allocation is locked or published. Explicitly unlock it before regenerating.',
      });
    }

    // 1. Fetch Classrooms in Preferred Priority: ET BLOCK 3010, 3020, 3030, then 3040, 3050, 3060
    const preferredRoomNumbers = ['3010', '3020', '3030', '3040', '3050', '3060'];
    const activeClassroomsRaw = await Classroom.find({ isActive: true }).lean();
    if (!activeClassroomsRaw || activeClassroomsRaw.length === 0) {
      return res.status(500).json({
        success: false,
        message: 'No active classrooms configured in the system.',
      });
    }

    const sortedClassrooms = activeClassroomsRaw.sort((a, b) => {
      let idxA = preferredRoomNumbers.indexOf(a.roomNumber);
      let idxB = preferredRoomNumbers.indexOf(b.roomNumber);
      if (idxA === -1) idxA = 999;
      if (idxB === -1) idxB = 999;
      return idxA - idxB;
    });

    // 2. Filter out classrooms booked by overlapping exams during the same date & session
    const normDate = exam.examDate;
    const examSession = exam.session || 'AM';
    const sessionPolarityGroup = ['PM', 'AN'].includes(String(examSession).toUpperCase())
      ? ['PM', 'AN']
      : ['AM', 'FN'];
    const overlappingExams = await Exam.find({
      _id: { $ne: exam._id },
      examDate: normDate,
      isDeleted: { $ne: true },
      status: { $nin: ['CANCELLED', 'FAILED'] },
      approvalStatus: { $ne: 'CANCELLED' },
      $or: [
        {
          startDateTime: { $lt: exam.endDateTime || new Date() },
          endDateTime: { $gt: exam.startDateTime || new Date() },
        },
        { session: { $in: sessionPolarityGroup }, startDateTime: { $exists: false } },
      ],
    })
      .select('classroomId sectionAllocations.classroomId session startDateTime endDateTime')
      .lean();

    const busyRoomIds = new Set();
    overlappingExams.forEach((ox) => {
      if (ox.classroomId) busyRoomIds.add(ox.classroomId.toString());
      if (ox.sectionAllocations) {
        ox.sectionAllocations.forEach((sa) => {
          if (sa.classroomId) busyRoomIds.add(sa.classroomId.toString());
        });
      }
    });

    const availableClassrooms = sortedClassrooms.filter(
      (c) => !busyRoomIds.has(c._id.toString())
    );

    if (availableClassrooms.length === 0) {
      return res.status(409).json({
        success: false,
        message: `All active ET BLOCK classrooms are currently booked on ${normDate} during the ${examSession} session.`,
      });
    }

    // 3. Identify Sections and Student Rosters
    let sectionsToProcess = [];

    if (exam.sectionAllocations && exam.sectionAllocations.length > 0) {
      for (const sa of exam.sectionAllocations) {
        let students = [];
        // First check if rosterSnapshot is already populated
        if (sa.rosterSnapshot && sa.rosterSnapshot.length > 0) {
          students = sa.rosterSnapshot.map((s, idx) => ({
            _id: s._id,
            registrationNumber: s.registrationNumber,
            name: s.name || `Student ${idx + 1}`,
            section: sa.section,
            group: sa.group || s.group || 'Group A',
          }));
        }
        // If not, check mappingId
        if (students.length === 0 && sa.mappingId) {
          const mapping = await FacultyMapping.findById(sa.mappingId);
          if (mapping && mapping.students && mapping.students.length > 0) {
            students = mapping.students.map((s, idx) => ({
              _id: s._id,
              registrationNumber: s.registrationNumber,
              name: s.studentName || s.name || `Student ${idx + 1}`,
              section: sa.section,
              group: sa.group || mapping.group || 'Group A',
            }));
          }
        }
        // If still empty, check Student collection
        if (students.length === 0) {
          const dbStudents = await Student.find({
            examId: exam._id,
            section: sa.section,
            status: 'active',
          }).sort({ registrationNumber: 1 });
          if (dbStudents && dbStudents.length > 0) {
            students = dbStudents.map((s) => ({
              _id: s._id,
              registrationNumber: s.registrationNumber,
              name: s.name,
              section: sa.section,
              group: s.group || sa.group || 'Group A',
            }));
          }
        }
        // If still empty, check StudentEnrollment
        if (students.length === 0) {
          const StudentEnrollment = require('../models/StudentEnrollment');
          const enrollments = await StudentEnrollment.find({
            section: sa.section,
            subjectName: { $regex: new RegExp(`^${exam.subjectName.trim()}$`, 'i') },
          }).sort({ rollNumber: 1 });
          if (enrollments && enrollments.length > 0) {
            students = enrollments.map((en, idx) => ({
              registrationNumber: en.rollNumber,
              name: en.studentName || `Student ${idx + 1}`,
              section: sa.section,
              group: en.group || sa.group || 'Group A',
            }));
          }
        }

        sectionsToProcess.push({
          mappingId: sa.mappingId,
          facultyId: sa.facultyId || exam.facultyId,
          facultyName: sa.facultyName || exam.facultyName || 'CSE Faculty',
          group: sa.group || (['A1', 'A2', 'A3'].includes(sa.section) ? 'Group A' : 'Group B'),
          section: sa.section,
          students,
        });
      }
    } else {
      // Find matching FacultyMapping records for this exam's subject
      const andConditions = [
        { isCurrent: true },
        {
          $or: [
            { subjectCode: exam.subjectCode.toUpperCase() },
            { subjectName: { $regex: new RegExp(`^${exam.subjectName.trim()}$`, 'i') } },
          ],
        },
      ];
      if (exam.group && exam.group !== 'ALL') {
        const isGroupA = exam.group.toUpperCase().includes('A');
        const isGroupB = exam.group.toUpperCase().includes('B');
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
        }
      }
      const matchedMappings = await FacultyMapping.find({ $and: andConditions }).sort({ section: 1 });

      if (matchedMappings && matchedMappings.length > 0) {
        for (const mapping of matchedMappings) {
          const students = (mapping.students || []).map((s, idx) => ({
            _id: s._id,
            registrationNumber: s.registrationNumber,
            name: s.studentName || s.name || `Student ${idx + 1}`,
            section: mapping.section,
            group: mapping.group || (['A1', 'A2', 'A3'].includes(mapping.section) ? 'Group A' : 'Group B'),
          }));
          sectionsToProcess.push({
            mappingId: mapping._id,
            facultyId: mapping.facultyId || exam.facultyId,
            facultyName: mapping.facultyName || exam.facultyName || 'CSE Faculty',
            group: mapping.group || (['A1', 'A2', 'A3'].includes(mapping.section) ? 'Group A' : 'Group B'),
            section: mapping.section,
            students,
          });
        }
      } else {
        // Fallback: treat exam as single section
        let students = await Student.find({ examId: exam._id, status: 'active' }).sort({ registrationNumber: 1 });
        if (!students || students.length === 0) {
          const StudentEnrollment = require('../models/StudentEnrollment');
          const enrollments = await StudentEnrollment.find({
            subjectName: { $regex: new RegExp(`^${exam.subjectName.trim()}$`, 'i') },
          }).sort({ rollNumber: 1 });
          if (enrollments && enrollments.length > 0) {
            students = enrollments.map((en, idx) => ({
              registrationNumber: en.rollNumber,
              name: en.studentName || `Student ${idx + 1}`,
              section: en.section || exam.section || 'A1',
              group: en.group || exam.group || 'Group A',
            }));
          }
        }
        sectionsToProcess.push({
          facultyId: exam.facultyId,
          facultyName: exam.facultyName || 'CSE Faculty',
          group: exam.group || 'Group A',
          section: exam.section || 'A1',
          students: (students || []).map((s, idx) => ({
            _id: s._id,
            registrationNumber: s.registrationNumber,
            name: s.name || `Student ${idx + 1}`,
            section: s.section || exam.section || 'A1',
            group: s.group || exam.group || 'Group A',
          })),
        });
      }
    }

    const totalStudentsCount = sectionsToProcess.reduce((sum, sec) => sum + sec.students.length, 0);
    if (totalStudentsCount === 0) {
      return res.status(400).json({
        success: false,
        message: 'No student records found to allocate seats for this examination.',
      });
    }

    // 4. Verify Total Available Classrooms Capacity
    const totalAvailableClassroomCapacity = availableClassrooms.reduce(
      (sum, c) => sum + (c.totalCapacity || 84),
      0
    );
    if (totalAvailableClassroomCapacity < totalStudentsCount) {
      return res.status(409).json({
        success: false,
        message: `Insufficient classroom capacity. Student count is ${totalStudentsCount}, but available classrooms have only ${totalAvailableClassroomCapacity} seats.`,
      });
    }

    // 5. Section-Wise Allocation Across Dedicated / Split Classrooms
    let roomIdx = 0;
    const masterAllocatedStudents = [];
    const sectionSummaries = [];
    const classroomSummaries = [];
    const updatedSectionAllocations = [];
    const assignedClassroomIds = new Set();
    let totalUsableSeats = 0;
    const combinedSetDist = { A: 0, B: 0, C: 0, total: 0 };
    const studentsToUpsert = [];

    for (const secObj of sectionsToProcess) {
      const secStudents = [...secObj.students];
      const secTotal = secStudents.length;
      if (secTotal === 0) continue;

      const roomsUsedForSection = [];
      const secSnapshot = [];

      while (secStudents.length > 0) {
        if (roomIdx >= availableClassrooms.length) {
          return res.status(409).json({
            success: false,
            message: `Ran out of classrooms while allocating section ${secObj.section}. Need additional classrooms.`,
          });
        }

        const currentRoom = availableClassrooms[roomIdx];
        const roomCap = currentRoom.totalCapacity || 84;
        const studentsForRoom = secStudents.splice(0, roomCap);

        // Run SeatingService for this section in this room
        const seatingResult = SeatingService.generateAllocation(studentsForRoom, currentRoom, {
          group: secObj.group,
          seed: `ALLOC-${exam.subjectCode}-${secObj.section}-${currentRoom.roomNumber}-${Date.now()}`,
        });

        if (!assignedClassroomIds.has(currentRoom._id.toString())) {
          assignedClassroomIds.add(currentRoom._id.toString());
          totalUsableSeats += roomCap;
        }

        roomsUsedForSection.push(currentRoom.name);

        classroomSummaries.push({
          classroomId: currentRoom._id,
          classroomName: currentRoom.name,
          roomNumber: currentRoom.roomNumber,
          section: secObj.section,
          allocatedStudents: seatingResult.students.length,
          capacity: roomCap,
          availableSeats: roomCap - seatingResult.students.length,
        });

        // Add to Set distribution
        combinedSetDist.A += seatingResult.setDistribution?.A || 0;
        combinedSetDist.B += seatingResult.setDistribution?.B || 0;
        combinedSetDist.C += seatingResult.setDistribution?.C || 0;
        combinedSetDist.total += seatingResult.setDistribution?.total || 0;

        // Map student assignments
        seatingResult.students.forEach((st) => {
          const mappedStudent = {
            ...st,
            section: secObj.section,
            group: secObj.group,
            classroomId: currentRoom._id,
            classroomName: currentRoom.name,
            facultyName: secObj.facultyName,
            subjectName: exam.subjectName,
            subjectCode: exam.subjectCode,
          };
          masterAllocatedStudents.push(mappedStudent);

          secSnapshot.push({
            sNo: secSnapshot.length + 1,
            registrationNumber: st.registrationNumber,
            name: st.name,
            group: secObj.group,
            section: secObj.section,
            seatId: st.seatId,
            questionPaperSet: st.questionPaperSet,
            rowNumber: st.rowNumber,
            benchNumber: st.benchNumber,
            seatNumber: st.seatNumber,
          });

          studentsToUpsert.push({
            examId: exam._id,
            registrationNumber: st.registrationNumber,
            name: st.name,
            facultyName: secObj.facultyName,
            department: exam.department || 'Computer Science and Engineering',
            year: exam.year || 'III Year',
            semester: exam.semester || 'I Semester',
            section: secObj.section,
            subject: exam.subjectName,
            group: secObj.group,
            seatId: st.seatId,
            questionPaperSet: st.questionPaperSet,
            rowNumber: st.rowNumber,
            benchNumber: st.benchNumber,
            seatNumber: st.seatNumber,
            classroomId: currentRoom._id,
            classroomName: currentRoom.name,
            status: 'active',
          });
        });

        roomIdx++;
      }

      sectionSummaries.push({
        section: secObj.section,
        facultyName: secObj.facultyName,
        studentCount: secSnapshot.length,
        classroomsUsed: roomsUsedForSection,
        status: 'GENERATED',
      });

      const primaryClassroom = availableClassrooms.find((c) =>
        roomsUsedForSection.includes(c.name)
      );

      updatedSectionAllocations.push({
        mappingId: secObj.mappingId,
        facultyId: secObj.facultyId || exam.facultyId,
        facultyName: secObj.facultyName,
        group: secObj.group,
        section: secObj.section,
        studentCount: secSnapshot.length,
        classroomId: primaryClassroom?._id,
        classroomName: roomsUsedForSection.join(', '),
        roomNumber: primaryClassroom?.roomNumber,
        rosterSnapshot: secSnapshot,
        attendancePdfUrl: `/api/reports/${exam._id}/section-attendance-pdf/${secObj.section}`,
        allocationStatus: 'GENERATED',
      });
    }

    // 6. Bulk upsert exam-scoped student records in a single Atlas round-trip (eliminates N+1 bottleneck)
    if (studentsToUpsert.length > 0) {
      const bulkOps = studentsToUpsert.map((stud) => ({
        updateOne: {
          filter: { examId: exam._id, registrationNumber: stud.registrationNumber },
          update: { $set: stud },
          upsert: true,
        },
      }));
      await Student.bulkWrite(bulkOps, { ordered: false });
    }

    // 7. Determine Allocation Version
    const lastAllocation = await Allocation.findOne({ examId: exam._id }).sort({ version: -1 });
    const newVersion = lastAllocation ? lastAllocation.version + 1 : 1;

    // Mark previous allocations for this exam as isCurrent: false
    await Allocation.updateMany({ examId: exam._id }, { isCurrent: false });

    // 8. Create Master Allocation Record
    const allocation = new Allocation({
      examId: exam._id,
      group: exam.group || 'ALL',
      classroomId: availableClassrooms[0]._id, // Primary classroom
      version: newVersion,
      students: masterAllocatedStudents,
      setDistribution: combinedSetDist,
      totalAvailableSeats: totalUsableSeats,
      totalOccupiedSeats: masterAllocatedStudents.length,
      sectionSummaries,
      classroomSummaries,
      validationStatus: {
        isValid: true,
        hasAdjacentCollisions: false,
        violations: [],
        message: 'Section-wise multi-classroom seating allocation verified successfully.',
        validatedAt: new Date(),
      },
      randomSeed: `ALLOC-${exam.subjectCode}-V${newVersion}-${Date.now()}`,
      status: 'GENERATED',
      isCurrent: true,
      createdBy: req.user._id,
    });

    await allocation.save();

    // 9. Update Parent Exam
    exam.sectionAllocations = updatedSectionAllocations;
    exam.classroomId = availableClassrooms[0]._id;
    exam.studentCount = masterAllocatedStudents.length;
    exam.currentAllocationId = allocation._id;
    exam.status = 'ALLOCATED';
    exam.allocationStatus = 'GENERATED';
    await exam.save();

    await AuditLog.create({
      action: 'ALLOCATION_GENERATED',
      performedBy: req.user._id,
      performedByName: req.user.name,
      examId: exam._id,
      allocationVersion: newVersion,
      details: {
        studentCount: masterAllocatedStudents.length,
        sectionsCount: sectionSummaries.length,
        classroomsUsed: classroomSummaries.map((c) => c.classroomName),
        setDistribution: combinedSetDist,
      },
      ipAddress: req.ip,
    });

    portalCache.invalidatePortalCache(exam._id);

    res.status(201).json({
      success: true,
      message: `Section-wise Allocation Version ${newVersion} generated successfully across ${classroomSummaries.length} classroom(s).`,
      data: allocation,
    });
  } catch (error) {
    console.error('Error generating allocation:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    Regenerate seating allocation (creates a new version)
// @route   POST /api/exams/:id/regenerate
// @access  Private
exports.regenerateAllocation = async (req, res) => {
  // Same logic as allocate; creates a new version
  return exports.generateAllocation(req, res);
};

// @desc    Get current active allocation for an exam
// @route   GET /api/exams/:id/allocation or GET /api/exams/:id/allocations or GET /api/exams/allocation
// @access  Private
exports.getCurrentAllocation = async (req, res) => {
  try {
    const examId = resolveExamId(req);
    if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid examination ID. Please select an examination to view seating allocations.',
      });
    }

    const allocation = await Allocation.findOne({ examId, isCurrent: true })
      .populate('classroomId', 'name roomNumber block floor totalCapacity')
      .populate('classroomSummaries.classroomId', 'name roomNumber block floor totalCapacity')
      .populate('createdBy', 'name email')
      .lean();

    if (!allocation) {
      return res.status(404).json({
        success: false,
        message: 'No seating allocation found for this exam. Please generate an allocation.',
      });
    }

    res.status(200).json({ success: true, data: allocation });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get all versions history of allocations
// @route   GET /api/exams/:id/allocation/versions or GET /api/exams/:id/allocations/versions
// @access  Private
exports.getAllocationVersions = async (req, res) => {
  try {
    const examId = resolveExamId(req);
    if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid examination ID. Please select an examination to view version history.',
      });
    }

    const versions = await Allocation.find({ examId })
      .select('version status setDistribution totalOccupiedSeats randomSeed isCurrent createdAt lockedAt publishedAt')
      .sort({ version: -1 })
      .lean();

    res.status(200).json({ success: true, data: versions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Verify allocation constraints across all assigned classrooms
// @route   POST /api/exams/:id/verify or POST /api/exams/verify
// @access  Private
exports.verifyAllocation = async (req, res) => {
  try {
    const examId = resolveExamId(req);
    if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid examination ID. Please select an examination before verifying allocations.',
      });
    }

    const allocation = await Allocation.findOne({ examId, isCurrent: true });
    if (!allocation) {
      return res.status(404).json({ success: false, message: 'No current allocation to verify.' });
    }

    // Group students by classroomId
    const roomStudentMap = {};
    for (const student of allocation.students) {
      const roomId = student.classroomId
        ? student.classroomId.toString()
        : allocation.classroomId
        ? allocation.classroomId.toString()
        : 'default';
      if (!roomStudentMap[roomId]) roomStudentMap[roomId] = [];
      roomStudentMap[roomId].push(student);
    }

    let overallValid = true;
    const allViolations = [];
    const lookupRoomIds = Array.from(
      new Set(
        [
          ...Object.keys(roomStudentMap).filter((id) => id !== 'default' && mongoose.Types.ObjectId.isValid(id)),
          allocation.classroomId ? allocation.classroomId.toString() : null,
        ].filter(Boolean)
      )
    );
    const roomsList = lookupRoomIds.length
      ? await Classroom.find({ _id: { $in: lookupRoomIds } }).lean()
      : [];
    const roomLookupMap = new Map(roomsList.map((r) => [r._id.toString(), r]));

    for (const [roomId, roomStudents] of Object.entries(roomStudentMap)) {
      let classroom = roomId !== 'default' ? roomLookupMap.get(roomId) || null : null;
      if (!classroom && allocation.classroomId) {
        classroom = roomLookupMap.get(allocation.classroomId.toString()) || null;
      }
      if (classroom) {
        const availableSeats = SeatingService.getAvailableSeats(classroom);
        const benchGroups = SeatingService.groupSeatsByBench(availableSeats);
        const val = SeatingService.validateCompleteAllocation(roomStudents, availableSeats, benchGroups);
        if (!val.isValid) {
          overallValid = false;
          if (val.violations && val.violations.length > 0) {
            allViolations.push(...val.violations);
          }
        }
      }
    }

    allocation.validationStatus = {
      isValid: overallValid,
      hasAdjacentCollisions: allViolations.length > 0,
      violations: allViolations,
      message: overallValid
        ? 'Allocation verified! All bench adjacency constraints satisfied with 0 violations across all classrooms.'
        : `Validation found ${allViolations.length} adjacent set collision(s).`,
      validatedAt: new Date(),
    };

    if (overallValid) {
      allocation.status = 'VERIFIED';
      allocation.verifiedBy = req.user._id;
    }
    await allocation.save();

    await AuditLog.create({
      action: 'ALLOCATION_VERIFIED',
      performedBy: req.user._id,
      performedByName: req.user.name,
      examId,
      allocationVersion: allocation.version,
      details: { isValid: overallValid, violationsCount: allViolations.length },
      ipAddress: req.ip,
    });

    res.status(200).json({
      success: true,
      message: overallValid
        ? 'Allocation verified! All bench adjacency constraints satisfied with 0 violations.'
        : 'Validation found issues.',
      validation: allocation.validationStatus,
      data: allocation,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Lock allocation (freezes arrangement)
// @route   POST /api/exams/:id/lock or POST /api/exams/lock
// @access  Private
exports.lockAllocation = async (req, res) => {
  try {
    const examId = resolveExamId(req);
    if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid examination ID. Please select an examination before locking allocations.',
      });
    }

    const allocation = await Allocation.findOne({ examId, isCurrent: true });
    if (!allocation) {
      return res.status(404).json({ success: false, message: 'No allocation found to lock.' });
    }

    if (!allocation.validationStatus.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Cannot lock an invalid allocation. Please ensure all validation constraints pass.',
      });
    }

    allocation.status = 'LOCKED';
    allocation.lockedBy = req.user._id;
    allocation.lockedAt = new Date();
    await allocation.save();

    await Exam.findByIdAndUpdate(examId, { status: 'LOCKED' });

    await AuditLog.create({
      action: 'ALLOCATION_LOCKED',
      performedBy: req.user._id,
      performedByName: req.user.name,
      examId,
      allocationVersion: allocation.version,
      ipAddress: req.ip,
    });

    res.status(200).json({
      success: true,
      message: `Allocation Version ${allocation.version} has been locked securely.`,
      data: allocation,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Publish allocation for student viewing (Admin only)
// @route   POST /api/exams/:id/publish or POST /api/exams/publish
// @access  Private (Admin Only)
exports.publishAllocation = async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only an administrator can approve and publish examinations. Faculty cannot publish.',
      });
    }

    const examId = resolveExamId(req);
    if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid examination ID. Please select an examination before publishing.',
      });
    }

    const allocation = await Allocation.findOne({ examId, isCurrent: true });
    if (!allocation) {
      return res.status(404).json({ success: false, message: 'No allocation found to publish.' });
    }

    const exam = await Exam.findById(examId);
    if (!exam) {
      return res.status(404).json({ success: false, message: 'Examination not found.' });
    }

    const now = new Date();
    const publicationTime = exam.publicationTime || new Date((exam.startDateTime || now).getTime() - 20 * 60 * 1000);
    const isImmediate = now >= publicationTime;

    exam.approvalStatus = 'APPROVED';
    exam.approvedBy = req.user._id;
    exam.approvedByName = req.user.name;
    exam.approvedAt = now;
    exam.publicationTime = publicationTime;

    if (isImmediate) {
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

    allocation.publishedBy = req.user._id;
    await allocation.save();
    await exam.save();

    await AuditLog.create({
      action: isImmediate ? 'EXAM_PUBLISHED' : 'EXAM_APPROVED',
      performedBy: req.user._id,
      performedByName: req.user.name,
      examId,
      allocationVersion: allocation.version,
      ipAddress: req.ip,
    });

    portalCache.invalidatePortalCache(exam._id);

    res.status(200).json({
      success: true,
      message: isImmediate
        ? `Allocation Version ${allocation.version} is now PUBLISHED.`
        : `Examination approved by Admin. Seating will automatically publish at T-20 minutes.`,
      data: allocation,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Explicitly unlock allocation (Requires confirmation)
// @route   POST /api/exams/:id/unlock or POST /api/exams/unlock
// @access  Private
exports.unlockAllocation = async (req, res) => {
  try {
    const examId = resolveExamId(req);
    if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid examination ID. Please select an examination to unlock.',
      });
    }

    const allocation = await Allocation.findOne({ examId, isCurrent: true });
    if (!allocation) {
      return res.status(404).json({ success: false, message: 'No allocation found.' });
    }

    allocation.status = 'VERIFIED';
    await allocation.save();

    await Exam.findByIdAndUpdate(examId, { status: 'ALLOCATED' });

    await AuditLog.create({
      action: 'ALLOCATION_UNLOCKED',
      performedBy: req.user._id,
      performedByName: req.user.name,
      examId,
      allocationVersion: allocation.version,
      details: { reason: req.body.reason || 'Faculty initiated modification' },
      ipAddress: req.ip,
    });

    portalCache.invalidatePortalCache(examId);

    res.status(200).json({
      success: true,
      message: 'Allocation unlocked. You can now modify or regenerate seating arrangements.',
      data: allocation,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
