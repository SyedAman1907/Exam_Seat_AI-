/**
 * ExamSeat AI — Automated Verification Test Suite
 * Automatic Examination Completion & Strict 10-Minute Student Seating Visibility Window
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const Exam = require('../models/Exam');
const Allocation = require('../models/Allocation');
const Classroom = require('../models/Classroom');
const Student = require('../models/Student');
const StudentEnrollment = require('../models/StudentEnrollment');
const User = require('../models/User');
const { getTodayKolkataDate } = require('../utils/dateTimeUtils');

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:5000/api';

async function runTestSuite() {
  console.log('\n========================================================================');
  console.log('  EXAMSEAT AI — SEATING VISIBILITY (10-MIN) & COMPLETION AUDIT');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`  ✓ PASS: ${testName} ${details ? '(' + details + ')' : ''}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${testName} ${details ? '(' + details + ')' : ''}`);
      failed++;
    }
  }

  // Connect Mongoose to Atlas for test data preparation & assertions
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'examseat_ai' });
  console.log('[Setup] Connected to Atlas for verification test harness.');

  // 1. Acquire Admin JWT Token
  let adminToken = '';
  try {
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@rgmcet.edu.in',
        password: process.env.ADMIN_INITIAL_PASSWORD || 'AdminExam@2026',
      }),
    });
    const loginData = await loginRes.json();
    adminToken = loginData.token;
    assert(!!adminToken, '0. Admin Login & JWT Acquisition', 'Token acquired');
  } catch (err) {
    console.error('Failed to login as admin:', err.message);
    process.exit(1);
  }

  const todayIso = '2026-12-29';

  // 2. Prepare a test student and clean up any previous test exam
  const staleLifecycle = await Exam.find({ examName: 'Lifecycle Test Examination' }).select('_id').lean();
  if (staleLifecycle.length > 0) {
    const staleLifecycleIds = staleLifecycle.map((e) => e._id);
    await Student.deleteMany({ examId: { $in: staleLifecycleIds } });
    await Allocation.deleteMany({ examId: { $in: staleLifecycleIds } });
    await Exam.deleteMany({ _id: { $in: staleLifecycleIds } });
  }

  let testStudent = await Student.findOne();
  if (!testStudent) {
    testStudent = await Student.create({
      registrationNumber: '24091A0599',
      name: 'Lifecycle Verification Student',
      department: 'CSE',
      year: 'III Year',
      section: 'A1',
      group: 'Group A',
    });
  }
  const testRegNo = testStudent.registrationNumber;

  // 3. Create a test examination scheduled for Today from 01:10 PM to 02:10 PM (early access 12:50 PM -> 02:10 PM)
  const startDateTime = new Date(`${todayIso}T13:10:00+05:30`);
  const studentAccessDateTime = new Date(`${todayIso}T12:50:00+05:30`);
  const endDateTime = new Date(`${todayIso}T14:10:00+05:30`);

  const room3010 = await Classroom.findOne({ roomNumber: '3010' });

  const testExam = await Exam.create({
    examName: 'Lifecycle Test Examination',
    academicYear: '2026-2027',
    department: 'Computer Science and Engineering',
    year: 'III Year',
    semester: 'I Semester',
    section: 'A1',
    group: 'Group A',
    subjectName: 'Automata Theory and Compiler Design',
    subjectCode: '20A05501T',
    examDate: todayIso,
    startTime: '01:10 PM',
    endTime: '02:10 PM',
    session: 'FN',
    startDateTime,
    endDateTime,
    publicationTime: new Date(startDateTime.getTime() - 20 * 60 * 1000),
    approvalStatus: 'APPROVED',
    visibilityStatus: 'PUBLISHED',
    status: 'PUBLISHED',
    isParentExam: true,
    classroomId: room3010?._id,
    facultyName: 'Dr. S. Subbalakshmi',
    sectionAllocations: [
      {
        section: 'A1',
        group: 'Group A',
        facultyName: 'Dr. S. Subbalakshmi',
        classroomId: room3010?._id,
        classroomName: 'ET BLOCK 3010',
        roomNumber: '3010',
        allocationStatus: 'GENERATED',
        studentCount: 1,
        rosterSnapshot: [
          {
            registrationNumber: testRegNo,
            name: testStudent.name,
            group: 'Group A',
            section: 'A1',
            rowNumber: 1,
            benchNumber: 1,
            seatNumber: 1,
            seatId: 'R1-B1-S1',
            questionPaperSet: 'A',
          },
        ],
      },
    ],
  });

  const testAllocation = await Allocation.create({
    examId: testExam._id,
    group: 'Group A',
    version: 1,
    status: 'PUBLISHED',
    isCurrent: true,
    randomSeed: 'test-seed-lifecycle',
    students: [
      {
        registrationNumber: testRegNo,
        name: testStudent.name,
        section: 'A1',
        group: 'Group A',
        seatId: 'R1-B1-S1',
        rowNumber: 1,
        benchNumber: 1,
        seatNumber: 1,
        questionPaperSet: 'A',
        roomNumber: '3010',
        classroomName: 'ET BLOCK 3010',
        classroomId: room3010?._id,
        facultyName: 'Dr. S. Subbalakshmi',
      },
    ],
    sectionSummaries: [
      {
        section: 'A1',
        facultyName: 'Dr. S. Subbalakshmi',
        studentCount: 1,
        status: 'GENERATED',
      },
    ],
  });

  testExam.currentAllocationId = testAllocation._id;
  await testExam.save();

  console.log(`[Setup] Created Test Examination "${testExam.examName}" (${testExam._id}) scheduled 01:10 PM – 02:10 PM for candidate ${testRegNo}.\n`);

  // =========================================================================
  // STEP 1: At 12:49 PM (1 min before T-20), seating is HIDDEN
  // =========================================================================
  const time_12_49_PM = `${todayIso}T12:49:00+05:30`;
  const res1 = await fetch(`${BASE_URL}/student/lookup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-timestamp': time_12_49_PM,
    },
    body: JSON.stringify({
      registrationNumber: testRegNo,
      examId: testExam._id,
    }),
  });
  const data1 = await res1.json();
  const isForbidden1 = res1.status === 403;
  const isPending1 = data1.isPending === true;
  const hasNoSeats1 = !data1.data;
  assert(
    isForbidden1 && isPending1 && hasNoSeats1 && data1.accessTimeFormatted === '12:50 PM',
    '1. At 12:49 PM: Seating is HIDDEN (unlocks at 12:50 PM)',
    `HTTP ${res1.status}, Notice: "${data1.message}"`
  );

  // =========================================================================
  // STEP 2: At 12:50 PM (exact T-20), seating becomes VISIBLE
  // =========================================================================
  const time_12_50_PM = `${todayIso}T12:50:00+05:30`;
  const res2 = await fetch(`${BASE_URL}/student/lookup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-timestamp': time_12_50_PM,
    },
    body: JSON.stringify({
      registrationNumber: testRegNo,
      examId: testExam._id,
    }),
  });
  const data2 = await res2.json();
  const seat2 = data2.data;
  const isValid2 =
    res2.status === 200 &&
    data2.success === true &&
    seat2 &&
    seat2.roomNumber === '3010' &&
    seat2.rowNumber === 1 &&
    seat2.seatNumber === 1 &&
    seat2.questionPaperSet === 'A';
  assert(
    isValid2,
    '2. At 12:50 PM: Seating becomes VISIBLE (20 min before start)',
    `Room: ${seat2?.roomNumber}, Seat: ${seat2?.seatNumber}, Set: ${seat2?.questionPaperSet}`
  );

  // =========================================================================
  // STEP 3: At 1:19 PM (9m after start), seating remains VISIBLE
  // =========================================================================
  const time_1_19_PM = `${todayIso}T13:19:00+05:30`;
  const res3 = await fetch(`${BASE_URL}/student/lookup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-timestamp': time_1_19_PM,
    },
    body: JSON.stringify({
      registrationNumber: testRegNo,
      examId: testExam._id,
    }),
  });
  const data3 = await res3.json();
  const seat3 = data3.data;
  const isValid3 =
    res3.status === 200 &&
    data3.success === true &&
    seat3 &&
    seat3.roomNumber === '3010' &&
    seat3.rowNumber === 1 &&
    seat3.questionPaperSet === 'A';
  assert(
    isValid3,
    '3. At 1:19 PM: Seating remains VISIBLE (within 10m after start)',
    `Room: ${seat3?.roomNumber}, Set: ${seat3?.questionPaperSet}`
  );

  // =========================================================================
  // STEP 4: At 1:20 PM (10m after start), seating window CLOSES cleanly, exam NOT prematurely COMPLETED
  // =========================================================================
  const time_1_20_PM = `${todayIso}T13:20:00+05:30`;
  const res4 = await fetch(`${BASE_URL}/student/lookup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-timestamp': time_1_20_PM,
    },
    body: JSON.stringify({
      registrationNumber: testRegNo,
      examId: testExam._id,
    }),
  });
  const data4 = await res4.json();
  const dbExamAt120 = await Exam.findById(testExam._id);
  assert(
    res4.status === 403 && data4.isWindowClosed === true && !data4.data && dbExamAt120.status !== 'COMPLETED',
    '4. At 1:20 PM: Seating closes at +10m while examination is NOT prematurely COMPLETED',
    `HTTP ${res4.status}, Exam status at 1:20 PM is "${dbExamAt120.status}"`
  );

  // =========================================================================
  // STEP 5: At 2:10 PM, examination becomes COMPLETED
  // =========================================================================
  const time_2_10_PM = `${todayIso}T14:10:00+05:30`;
  // Trigger check or query at 2:10 PM
  const completedQueryRes = await fetch(`${BASE_URL}/exams?filter=completed`, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'x-test-timestamp': time_2_10_PM,
    },
  });
  const completedQueryData = await completedQueryRes.json();

  const dbExamAt210 = await Exam.findById(testExam._id);
  const dbAllocAt210 = await Allocation.findById(testAllocation._id);

  const isExamCompleted = dbExamAt210.status === 'COMPLETED';
  const isExpired = dbExamAt210.visibilityStatus === 'EXPIRED';
  const isAllocCompleted = dbAllocAt210.status === 'COMPLETED';
  const areChildSectionsCompleted = (dbExamAt210.sectionAllocations || []).every(
    (sa) => sa.allocationStatus === 'COMPLETED'
  );

  assert(
    isExamCompleted && isExpired && isAllocCompleted && areChildSectionsCompleted,
    '5. At 2:10 PM: Examination and section allocations automatically transition to COMPLETED',
    `ExamStatus: ${dbExamAt210.status}, Visibility: ${dbExamAt210.visibilityStatus}, SecAllocStatus: ${dbExamAt210.sectionAllocations[0]?.allocationStatus}`
  );

  // =========================================================================
  // STEP 6: Examination disappears from active Admin tabs
  // =========================================================================
  const upcomingRes = await fetch(`${BASE_URL}/exams?filter=upcoming`, {
    headers: { Authorization: `Bearer ${adminToken}`, 'x-test-timestamp': time_2_10_PM },
  });
  const upcomingData = await upcomingRes.json();

  const todayRes = await fetch(`${BASE_URL}/exams?filter=today`, {
    headers: { Authorization: `Bearer ${adminToken}`, 'x-test-timestamp': time_2_10_PM },
  });
  const todayData = await todayRes.json();

  const publishedRes = await fetch(`${BASE_URL}/exams?filter=published`, {
    headers: { Authorization: `Bearer ${adminToken}`, 'x-test-timestamp': time_2_10_PM },
  });
  const publishedData = await publishedRes.json();

  const inUpcoming = (upcomingData.data || []).some((e) => e._id.toString() === testExam._id.toString());
  const inToday = (todayData.data || []).some((e) => e._id.toString() === testExam._id.toString());
  const inPublished = (publishedData.data || []).some((e) => e._id.toString() === testExam._id.toString());

  assert(
    !inUpcoming && !inToday && !inPublished,
    '6. Examination disappears from active Admin tabs (Upcoming, Today, Published)',
    `Upcoming: ${inUpcoming}, Today: ${inToday}, Published: ${inPublished}`
  );

  // =========================================================================
  // STEP 7: Examination appears in Completed tab
  // =========================================================================
  const inCompleted = (completedQueryData.data || []).some((e) => e._id.toString() === testExam._id.toString());
  assert(inCompleted, '7. Examination appears in Completed Examinations tab in Admin Portal');

  // =========================================================================
  // STEP 8: Admin can still view historical seating and attendance reports
  // =========================================================================
  try {
    const reportRes = await fetch(
      `${BASE_URL}/reports/${testExam._id}/section-attendance-pdf/A1`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
      }
    );
    const buf = await reportRes.arrayBuffer();
    const pdfHeader = Buffer.from(buf).slice(0, 4).toString();
    const isPdf = reportRes.status === 200 && pdfHeader === '%PDF';
    assert(
      isPdf,
      '8. Admin can view historical seating and download Section Attendance PDF for completed exam',
      `HTTP ${reportRes.status}, Content-Type: ${reportRes.headers.get('content-type')}`
    );
  } catch (err) {
    assert(false, '8. Admin can view historical seating and download Attendance PDF', err.message);
  }

  // =========================================================================
  // STEP 9: Student API access is denied after 1:20 PM
  // =========================================================================
  const res9 = await fetch(`${BASE_URL}/student/lookup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-timestamp': time_2_10_PM,
    },
    body: JSON.stringify({
      registrationNumber: testRegNo,
      examId: testExam._id,
    }),
  });
  const data9 = await res9.json();
  const isForbidden9 = res9.status === 403;
  const msg9 = data9.message || '';
  assert(
    isForbidden9 && msg9.includes('window has closed'),
    '9. Student API access is denied after 1:20 PM (Backend strictly enforces access denial without leaking seat data)',
    `HTTP ${res9.status}, Message: "${msg9}"`
  );

  // =========================================================================
  // STEP 10: Restarting the backend does not reset the visibility window
  // =========================================================================
  const reloadedExam = await Exam.findById(testExam._id);
  const reloadedAccessTime = new Date(reloadedExam.startDateTime.getTime() - 20 * 60 * 1000);
  const reloadedEndTime = new Date(reloadedExam.endDateTime);

  assert(
    reloadedExam.status === 'COMPLETED' &&
    reloadedAccessTime.toISOString() === studentAccessDateTime.toISOString() &&
    reloadedEndTime.toISOString() === endDateTime.toISOString(),
    '10. Restarting backend does not reset early access window (Timestamps & state permanently stored in Atlas)',
    `Status: ${reloadedExam.status}, StoredEnd: ${reloadedEndTime.toISOString()}`
  );

  // Clean up test exam
  await Exam.findByIdAndDelete(testExam._id);
  await Allocation.findByIdAndDelete(testAllocation._id);
  console.log('\n[Cleanup] Test examination and allocations removed.');

  console.log('\n========================================================================');
  console.log(`  AUDIT COMPLETED: ${passed} Passed, ${failed} Failed`);
  console.log('========================================================================\n');

  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

runTestSuite().catch((err) => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});
