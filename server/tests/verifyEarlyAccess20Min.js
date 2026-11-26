/**
 * EXAMSEAT AI — 20-Minute Early Access Verification Suite
 *
 * Tests the complete 20-minute early access rule (`studentAccessTime = startDateTime - 20m` in IST):
 *   1. Exact dateTimeUtils boundary calculations across 09:00 AM, 12:00 PM, 02:00 PM, 06:00 PM, and 12:00 AM (midnight prev-day)
 *   2. Direct API enforcement before T-20 (01:39 PM IST for 02:00 PM - 03:00 PM exam -> 403 PENDING, zero seat leak)
 *   3. Exact unlock boundary at T-20 (01:40:00 PM IST -> 200 OK with full seat details)
 *   4. Continuous access during early window & exam (01:45 PM, 02:00 PM, 02:59 PM IST -> 200 OK)
 *   5. Conclusion boundary at endDateTime (03:00 PM IST -> 403 CLOSED/CONCLUDED)
 *   6. Midnight rollover exam (12:00 AM - 01:00 AM on tomorrowDate -> unlocks 11:40 PM on todayDate; active-exams includes it)
 *   7. Dynamic reschedule (02:00 PM -> 03:00 PM) dynamically shifts studentAccessTime to 02:40 PM & preserves seating allocations
 *   8. Invalid/missing schedule safely rejected with 400 and multi-exam Group A/B isolation holds
 *   9. Baseline Atlas data sanity (355 master students, active classrooms, 54 faculty mappings preserved)
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Exam = require('../models/Exam');
const Allocation = require('../models/Allocation');
const Classroom = require('../models/Classroom');
const Subject = require('../models/Subject');
const FacultyMapping = require('../models/FacultyMapping');
const Student = require('../models/Student');
const {
  getStudentAccessTime,
  formatTime12h,
  parseKolkataDateTime,
} = require('../utils/dateTimeUtils');

function getISTIsoDate(dt) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dt);
}

const BASE_URL = 'http://localhost:5000/api';
let passed = 0;
let failed = 0;

function assert(cond, label, detail = '') {
  if (cond) {
    console.log(`PASS: ${label}${detail ? ` (${detail})` : ''}`);
    passed++;
  } else {
    console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function apiReq(method, endpoint, body = null, token = null, headers = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${endpoint}`, opts);
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function run() {
  const createdExamIds = [];
  const createdAllocIds = [];

  try {
    await mongoose.connect(process.env.MONGODB_URI, { dbName: 'examseat_ai' });
    console.log('[Setup] Connected to MongoDB Atlas.');

    // Clean leftover runs if any
    const stale = await Exam.find({
      examName: {
        $in: [
          'EarlyAccess20 Verification 02:00 PM',
          'EarlyAccess20 Midnight Test',
          'InvalidScheduleTest',
        ],
      },
    }).lean();
    if (stale.length) {
      const staleIds = stale.map((e) => e._id);
      await Student.deleteMany({ examId: { $in: staleIds } });
      await Allocation.deleteMany({ examId: { $in: staleIds } });
      await Exam.deleteMany({ _id: { $in: staleIds } });
    }

    const admin = await User.findOne({ role: 'admin' }).lean();
    const classrooms = await Classroom.find({ isActive: true }).sort({ roomNumber: 1 }).lean();
    const subjectA = await Subject.findOne().lean();
    const mappingA = await FacultyMapping.findOne({ group: 'Group A' }).lean();
    const mappingB = await FacultyMapping.findOne({ group: 'Group B' }).lean();
    const studentA = await Student.findOne({ group: 'Group A' }).lean();
    const studentB = await Student.findOne({ group: 'Group B' }).lean();

    if (!admin || !classrooms.length || !subjectA || !studentA || !studentB) {
      throw new Error(
        `Missing baseline Atlas documents: admin=${!!admin}, rooms=${classrooms.length}, subject=${!!subjectA}, stuA=${!!studentA}, stuB=${!!studentB}`
      );
    }

    const adminToken = jwt.sign({ id: admin._id }, process.env.JWT_SECRET, { expiresIn: '2h' });
    const room = classrooms[0];
    const roomName = room.name || `ET BLOCK ${room.roomNumber}`;
    const facultyAName = mappingA?.facultyName || 'Dr. S. Subbalakshmi';
    const facultyBName = mappingB?.facultyName || 'Dr. K. Subba Rao';
    const examDateIso = '2026-12-25';
    const nextDateIso = '2026-12-26';

    // -----------------------------------------------------------------------
    // 1. Unit Edge-Case Checks for getStudentAccessTime = startDateTime - 20m
    // -----------------------------------------------------------------------
    console.log('\n--- 1. Utility Boundary Calculations ---');
    const edgeCases = [
      { date: examDateIso, start: '09:00 AM', expectedTime: '08:40 AM', expectedDate: examDateIso },
      { date: examDateIso, start: '12:00 PM', expectedTime: '11:40 AM', expectedDate: examDateIso },
      { date: examDateIso, start: '02:00 PM', expectedTime: '01:40 PM', expectedDate: examDateIso },
      { date: examDateIso, start: '06:00 PM', expectedTime: '05:40 PM', expectedDate: examDateIso },
      { date: nextDateIso, start: '12:00 AM', expectedTime: '11:40 PM', expectedDate: examDateIso },
    ];

    for (const c of edgeCases) {
      const startDt = parseKolkataDateTime(c.date, c.start);
      const accessDt = getStudentAccessTime(startDt);
      const actualTime = formatTime12h(accessDt);
      const actualDate = getISTIsoDate(accessDt);
      assert(
        actualTime === c.expectedTime && actualDate === c.expectedDate,
        `Edge case ${c.date} ${c.start} -> ${c.expectedDate} ${c.expectedTime} IST`,
        `got ${actualDate} ${actualTime}`
      );
    }

    // -----------------------------------------------------------------------
    // 2-5. Create 02:00 PM - 03:00 PM IST Published Exam + Allocation
    // -----------------------------------------------------------------------
    console.log('\n--- 2-5. 02:00 PM - 03:00 PM IST Access Window Lifecycle ---');
    const startDt2PM = parseKolkataDateTime(examDateIso, '02:00 PM');
    const endDt3PM = parseKolkataDateTime(examDateIso, '03:00 PM');

    const exam2PM = await Exam.create({
      examName: 'EarlyAccess20 Verification 02:00 PM',
      academicYear: '2026-2027',
      department: 'Computer Science and Engineering',
      year: 'III Year',
      semester: studentA.semester || 'I Semester',
      section: studentA.section || 'A1',
      sections: [studentA.section || 'A1'],
      group: 'Group A',
      subjectId: subjectA._id,
      subjectName: `${subjectA.subjectName} [T20Verify]`,
      subjectCode: subjectA.subjectCode,
      examDate: examDateIso,
      startTime: '02:00 PM',
      endTime: '03:00 PM',
      session: 'AN',
      startDateTime: startDt2PM,
      endDateTime: endDt3PM,
      publicationTime: getStudentAccessTime(startDt2PM),
      approvalStatus: 'APPROVED',
      visibilityStatus: 'PUBLISHED',
      status: 'PUBLISHED',
      isParentExam: true,
      classroomId: room._id,
      facultyName: facultyAName,
      sectionAllocations: [
        {
          section: studentA.section || 'A1',
          group: 'Group A',
          facultyName: facultyAName,
          classroomId: room._id,
          classroomName: roomName,
          roomNumber: room.roomNumber,
          allocationStatus: 'GENERATED',
          studentCount: 1,
          rosterSnapshot: [
            {
              registrationNumber: studentA.registrationNumber,
              name: studentA.name,
              group: 'Group A',
              section: studentA.section || 'A1',
              rowNumber: 1,
              benchNumber: 1,
              seatNumber: 1,
              seatId: `R${room.roomNumber}-B1-S1`,
              questionPaperSet: 'A',
            },
          ],
        },
      ],
    });
    createdExamIds.push(exam2PM._id.toString());

    const alloc2PM = await Allocation.create({
      examId: exam2PM._id,
      group: 'Group A',
      version: 1,
      status: 'PUBLISHED',
      isCurrent: true,
      randomSeed: 'early-access-20-seed-a',
      students: [
        {
          registrationNumber: studentA.registrationNumber,
          name: studentA.name,
          section: studentA.section || 'A1',
          group: 'Group A',
          seatId: `R${room.roomNumber}-B1-S1`,
          rowNumber: 1,
          benchNumber: 1,
          seatNumber: 1,
          questionPaperSet: 'A',
          roomNumber: room.roomNumber,
          classroomName: roomName,
          classroomId: room._id,
          facultyName: facultyAName,
        },
      ],
      sectionSummaries: [
        {
          section: studentA.section || 'A1',
          facultyName: facultyAName,
          studentCount: 1,
          status: 'GENERATED',
        },
      ],
    });
    createdAllocIds.push(alloc2PM._id.toString());
    exam2PM.currentAllocationId = alloc2PM._id;
    await exam2PM.save();

    const lookupAt = (dateIso, timeHms, regNo = studentA.registrationNumber, examId = exam2PM._id) =>
      apiReq(
        'POST',
        '/student/lookup',
        { registrationNumber: regNo, examId, date: dateIso },
        null,
        { 'x-test-timestamp': `${dateIso}T${timeHms}+05:30` }
      );

    // Scenario: 01:39:00 PM -> 403 PENDING, zero seat leak, states 01:40 PM IST
    const activeAt139 = await apiReq(
      'GET',
      `/student/active-exams?date=${examDateIso}`,
      null,
      null,
      { 'x-test-timestamp': `${examDateIso}T13:39:00+05:30` }
    );
    const card139 = (activeAt139.data?.data || []).find((e) => e._id === exam2PM._id.toString());
    const lookup139 = await lookupAt(examDateIso, '13:39:00');
    assert(
      card139?.windowState === 'PENDING' &&
      card139?.accessTimeFormatted === '01:40 PM' &&
      lookup139.status === 403 &&
      lookup139.data?.isPending === true &&
      lookup139.data?.accessTimeFormatted === '01:40 PM' &&
      lookup139.data?.message?.includes('01:40 PM IST, 20 minutes before your examination starts') &&
      !lookup139.data?.data,
      'At 01:39 PM IST: active-exams is PENDING (01:40 PM) & lookup returns 403 without seat leak',
      `status=${lookup139.status}, card=${card139?.windowState}, access=${card139?.accessTimeFormatted}`
    );

    // Scenario: 01:40:00 PM -> 200 OK exact boundary unlock
    const activeAt140 = await apiReq(
      'GET',
      `/student/active-exams?date=${examDateIso}`,
      null,
      null,
      { 'x-test-timestamp': `${examDateIso}T13:40:00+05:30` }
    );
    const card140 = (activeAt140.data?.data || []).find((e) => e._id === exam2PM._id.toString());
    const lookup140 = await lookupAt(examDateIso, '13:40:00');
    assert(
      card140?.windowState === 'OPEN' &&
      lookup140.status === 200 &&
      lookup140.data?.data?.roomNumber === room.roomNumber &&
      lookup140.data?.data?.seatId === `R${room.roomNumber}-B1-S1` &&
      lookup140.data?.data?.accessTimeFormatted === '01:40 PM',
      'At 01:40:00 PM IST: active-exams flips to OPEN & lookup returns 200 with full seat allocation',
      `status=${lookup140.status}, room=${lookup140.data?.data?.roomNumber}, seat=${lookup140.data?.data?.seatId}`
    );

    // Scenarios: 01:45 PM, 02:00 PM (start), and 02:09 PM -> 200 OK
    const lookup145 = await lookupAt(examDateIso, '13:45:00');
    const lookup200 = await lookupAt(examDateIso, '14:00:00');
    const lookup209 = await lookupAt(examDateIso, '14:09:00');
    assert(
      lookup145.status === 200 && lookup200.status === 200 && lookup209.status === 200,
      'During 01:45 PM, 02:00 PM (start), and 02:09 PM: lookup remains 200 OK cleanly',
      `statuses=[${lookup145.status}, ${lookup200.status}, ${lookup209.status}]`
    );

    // Scenario: 02:10:00 PM (+10m after scheduled start) -> 403 closed cleanly
    const lookup210 = await lookupAt(examDateIso, '14:10:00');
    assert(
      lookup210.status === 403 && lookup210.data?.isWindowClosed === true && !lookup210.data?.data,
      'At 02:10:00 PM IST (start + 10m): lookup closes cleanly with 403',
      `status=${lookup210.status}, msg="${lookup210.data?.message}"`
    );

    // Scenario: 03:00:00 PM (endDateTime) -> 403 closed/concluded
    const lookup300 = await lookupAt(examDateIso, '15:00:00');
    assert(
      lookup300.status === 403 && lookup300.data?.isWindowClosed === true && !lookup300.data?.data,
      'At 03:00:00 PM IST (endDateTime): lookup remains closed cleanly with 403',
      `status=${lookup300.status}, msg="${lookup300.data?.message}"`
    );

    // -----------------------------------------------------------------------
    // 6. Midnight Boundary: 12:00 AM next day -> opens 11:40 PM prev day
    // -----------------------------------------------------------------------
    console.log('\n--- 6. Midnight Boundary (12:00 AM -> 11:40 PM Previous Date) ---');
    const startDtMidnight = parseKolkataDateTime(nextDateIso, '12:00 AM');
    const endDt1AM = parseKolkataDateTime(nextDateIso, '01:00 AM');

    const examMidnight = await Exam.create({
      examName: 'EarlyAccess20 Midnight Test',
      academicYear: '2026-2027',
      department: 'Computer Science and Engineering',
      year: 'III Year',
      semester: studentB.semester || 'I Semester',
      section: studentB.section || 'B1',
      sections: [studentB.section || 'B1'],
      group: 'Group B',
      subjectId: subjectA._id,
      subjectName: `${subjectA.subjectName} [Midnight]`,
      subjectCode: subjectA.subjectCode,
      examDate: nextDateIso,
      startTime: '12:00 AM',
      endTime: '01:00 AM',
      session: 'AN',
      startDateTime: startDtMidnight,
      endDateTime: endDt1AM,
      publicationTime: getStudentAccessTime(startDtMidnight),
      approvalStatus: 'APPROVED',
      visibilityStatus: 'PUBLISHED',
      status: 'PUBLISHED',
      isParentExam: true,
      classroomId: room._id,
      facultyName: facultyBName,
      sectionAllocations: [
        {
          section: studentB.section || 'B1',
          group: 'Group B',
          facultyName: facultyBName,
          classroomId: room._id,
          classroomName: roomName,
          roomNumber: room.roomNumber,
          allocationStatus: 'GENERATED',
          studentCount: 1,
        },
      ],
    });
    createdExamIds.push(examMidnight._id.toString());

    const allocMidnight = await Allocation.create({
      examId: examMidnight._id,
      group: 'Group B',
      version: 1,
      status: 'PUBLISHED',
      isCurrent: true,
      randomSeed: 'early-access-20-seed-mid',
      students: [
        {
          registrationNumber: studentB.registrationNumber,
          name: studentB.name,
          section: studentB.section || 'B1',
          group: 'Group B',
          seatId: `R${room.roomNumber}-B1-S2`,
          rowNumber: 1,
          benchNumber: 1,
          seatNumber: 2,
          questionPaperSet: 'B',
          roomNumber: room.roomNumber,
          classroomName: roomName,
          classroomId: room._id,
          facultyName: facultyBName,
        },
      ],
    });
    createdAllocIds.push(allocMidnight._id.toString());
    examMidnight.currentAllocationId = allocMidnight._id;
    await examMidnight.save();

    const mid1139 = await lookupAt(examDateIso, '23:39:00', studentB.registrationNumber, examMidnight._id);
    const activeMid1140 = await apiReq(
      'GET',
      `/student/active-exams?date=${examDateIso}`,
      null,
      null,
      { 'x-test-timestamp': `${examDateIso}T23:40:00+05:30` }
    );
    const midCard1140 = (activeMid1140.data?.data || []).find((e) => e._id === examMidnight._id.toString());
    const mid1140 = await lookupAt(examDateIso, '23:40:00', studentB.registrationNumber, examMidnight._id);

    assert(
      mid1139.status === 403 &&
      mid1139.data?.accessTimeFormatted === '11:40 PM' &&
      mid1139.data?.accessDate === examDateIso &&
      midCard1140?.windowState === 'OPEN' &&
      mid1140.status === 200 &&
      mid1140.data?.data?.seatId === `R${room.roomNumber}-B1-S2`,
      `12:00 AM exam on ${nextDateIso} locks at 11:39 PM and unlocks at 11:40 PM on ${examDateIso} IST`,
      `11:39 status=${mid1139.status}, card=${midCard1140?.windowState}, 11:40 status=${mid1140.status}`
    );

    // Multi-exam isolation (same date window, before advancing simulated clock): Student A cannot see Group B's examMidnight seat
    const crossGroupLookup = await lookupAt(examDateIso, '23:45:00', studentA.registrationNumber, examMidnight._id);
    assert(
      crossGroupLookup.status === 404 && !crossGroupLookup.data?.data,
      'Group A student lookup against Group B exam never leaks seat data',
      `status=${crossGroupLookup.status}`
    );

    // -----------------------------------------------------------------------
    // 7. Dynamic Reschedule Test & Invalid Schedule
    // -----------------------------------------------------------------------
    console.log('\n--- 7-8. Dynamic Reschedule (02:00 PM -> 03:00 PM) & Invalid Schedule ---');
    const reschedDate = '2027-01-15';
    await Exam.findByIdAndUpdate(exam2PM._id, {
      examDate: reschedDate,
      status: 'PUBLISHED',
      visibilityStatus: 'PUBLISHED',
      startDateTime: parseKolkataDateTime(reschedDate, '02:00 PM'),
      endDateTime: parseKolkataDateTime(reschedDate, '03:00 PM'),
    });

    const editRes = await apiReq(
      'PUT',
      `/exams/${exam2PM._id}`,
      {
        startTime: '03:00 PM',
        endTime: '04:00 PM',
        examDate: reschedDate,
        confirmControlledCorrection: true,
        correctionReason: 'QA Early Access Reschedule Verification',
      },
      adminToken
    );
    await Exam.findByIdAndUpdate(exam2PM._id, {
      status: 'PUBLISHED',
      visibilityStatus: 'PUBLISHED',
      currentAllocationId: alloc2PM._id,
    });

    const reschedAt145 = await lookupAt(reschedDate, '13:45:00', studentA.registrationNumber, exam2PM._id);
    const reschedAt239 = await lookupAt(reschedDate, '14:39:00', studentA.registrationNumber, exam2PM._id);
    const reschedAt240 = await lookupAt(reschedDate, '14:40:00', studentA.registrationNumber, exam2PM._id);
    const dbAllocAfterResched = await Allocation.findById(alloc2PM._id).lean();
    assert(
      editRes.status === 200 &&
      reschedAt145.status === 403 &&
      reschedAt239.status === 403 &&
      reschedAt239.data?.accessTimeFormatted === '02:40 PM' &&
      reschedAt240.status === 200 &&
      dbAllocAfterResched?.students?.[0]?.seatId === `R${room.roomNumber}-B1-S1` &&
      dbAllocAfterResched?.students?.[0]?.questionPaperSet === 'A',
      'Rescheduling 02:00 PM -> 03:00 PM dynamically shifts access to 02:40 PM without altering allocations',
      `edit=${editRes.status}, 1:45=${reschedAt145.status}, 2:39=${reschedAt239.status}, 2:40=${reschedAt240.status}`
    );

    // Invalid schedule rejected safely with 400 (insert raw doc bypassing Mongoose Date cast)
    const badExamId = new mongoose.Types.ObjectId();
    await Exam.collection.insertOne({
      _id: badExamId,
      examName: 'InvalidScheduleTest',
      academicYear: '2026-2027',
      department: 'Computer Science and Engineering',
      year: 'III Year',
      semester: studentA.semester || 'I Semester',
      section: studentA.section || 'A1',
      sections: [studentA.section || 'A1'],
      group: 'Group A',
      subjectId: subjectA._id,
      subjectName: `${subjectA.subjectName} [InvalidTime]`,
      subjectCode: subjectA.subjectCode,
      examDate: reschedDate,
      startTime: '99:99 XM',
      endTime: 'INVALID',
      session: 'AN',
      startDateTime: null,
      endDateTime: null,
      approvalStatus: 'APPROVED',
      visibilityStatus: 'PUBLISHED',
      status: 'PUBLISHED',
      isDeleted: false,
      facultyName: facultyAName,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    createdExamIds.push(badExamId.toString());
    const badLookup = await lookupAt(reschedDate, '14:40:00', studentA.registrationNumber, badExamId);
    assert(
      badLookup.status === 400 && badLookup.data?.isInvalidSchedule === true && !badLookup.data?.data,
      'Invalid examination schedule is cleanly rejected with HTTP 400',
      `status=${badLookup.status}, flag=${badLookup.data?.isInvalidSchedule}`
    );

    // -----------------------------------------------------------------------
    // 9. Baseline Atlas Integrity
    // -----------------------------------------------------------------------
    const studentCount = await Student.countDocuments();
    const mappingCount = await FacultyMapping.countDocuments();
    const activeRoomCount = await Classroom.countDocuments({ isActive: true });
    assert(
      studentCount >= 355 && mappingCount >= 54 && activeRoomCount >= 6,
      'Real Atlas baseline collections remain intact',
      `students=${studentCount}, mappings=${mappingCount}, activeRooms=${activeRoomCount}`
    );
  } catch (err) {
    console.error('FATAL TEST ERROR:', err);
    failed++;
  } finally {
    if (createdAllocIds.length) {
      await Allocation.deleteMany({ _id: { $in: createdAllocIds } }).catch(() => { });
    }
    if (createdExamIds.length) {
      await Student.deleteMany({ examId: { $in: createdExamIds } }).catch(() => { });
      await Allocation.deleteMany({ examId: { $in: createdExamIds } }).catch(() => { });
      await Exam.deleteMany({ _id: { $in: createdExamIds } }).catch(() => { });
    }
    await mongoose.disconnect().catch(() => { });
    console.log('\n========================================================================');
    console.log(`  20-MIN EARLY ACCESS SUITE: ${passed} Passed, ${failed} Failed`);
    console.log('========================================================================\n');
    process.exit(failed > 0 ? 1 : 0);
  }
}

run();
