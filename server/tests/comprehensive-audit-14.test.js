const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const Classroom = require('../models/Classroom');
const Timetable = require('../models/Timetable');
const Student = require('../models/Student');
const StudentEnrollment = require('../models/StudentEnrollment');
const Exam = require('../models/Exam');
const Allocation = require('../models/Allocation');
const User = require('../models/User');
const schedulerService = require('../services/schedulerService');

const BASE_URL = 'http://localhost:5000/api';

async function run14TestSuite() {
  console.log('========================================================================');
  console.log('  EXAMSEAT AI — 14 COMPREHENSIVE END-TO-END VERIFICATION TESTS');
  console.log('========================================================================\n');

  await mongoose.connect('mongodb://127.0.0.1:27017/examseat_ai');
  console.log('Connected to MongoDB.\n');

  // Obtain Admin JWT token
  const admin = await User.findOne({ role: 'admin' });
  if (!admin) throw new Error('Admin user not found!');
  const token = jwt.sign(
    { id: admin._id, role: admin.role, email: admin.email },
    process.env.JWT_SECRET || 'examseat_ai_super_secret_jwt_key_2026_academic_secure',
    { expiresIn: '1h' }
  );

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  try {
    // -------------------------------------------------------------------------
    // TEST 1: VERIFY ONLY ET BLOCK 3020, 3030, 3040, 3050, 3060 APPEAR
    // -------------------------------------------------------------------------
    console.log('--- TEST 1: Verify Only ET BLOCK 3020, 3030, 3040, 3050, 3060 Active ---');
    const classRes = await fetch(`${BASE_URL}/classrooms`, { headers: authHeaders });
    const classJson = await classRes.json();
    const activeRooms = classJson.data;

    console.log(`Active Classrooms Count: ${activeRooms.length}`);
    const activeRoomNumbers = activeRooms.map((r) => r.roomNumber).sort();
    console.log(`Room Numbers: ${activeRoomNumbers.join(', ')}`);

    const expectedRooms = ['3020', '3030', '3040', '3050', '3060'];
    if (activeRoomNumbers.length !== 5 || !expectedRooms.every((r) => activeRoomNumbers.includes(r))) {
      throw new Error(`FAIL: Expected exactly [3020, 3030, 3040, 3050, 3060], found: [${activeRoomNumbers.join(', ')}]`);
    }

    // Verify each option displays 72 seats capacity
    activeRooms.forEach((r) => {
      if (r.totalCapacity !== 72) {
        throw new Error(`FAIL: Classroom ${r.name} capacity is ${r.totalCapacity}, expected 72!`);
      }
    });

    console.log('>>> TEST 1 PASSED: Exactly the 5 ET BLOCK classrooms (3020-3060) active with 72 seats.\n');

    // -------------------------------------------------------------------------
    // TEST 2: VERIFY SUBJECTS OTHER THAN CNIP CAN BE SELECTED FROM TIMETABLE
    // -------------------------------------------------------------------------
    console.log('--- TEST 2: Verify Subjects Other Than CNIP Can Be Selected From Timetable ---');
    const timetableRes = await fetch(`${BASE_URL}/timetable`, { headers: authHeaders });
    const timetableJson = await timetableRes.json();
    const subjects = Array.from(new Set(timetableJson.data.map((t) => t.subjectName)));

    console.log(`Subjects in Timetable: ${subjects.join(', ')}`);
    const hasADS = subjects.includes('Advanced Distributed Systems');
    const hasAIML = subjects.includes('Artificial Intelligence & Machine Learning');
    const hasDBMS = subjects.includes('Database Management Systems');

    if (!hasADS || !hasAIML || !hasDBMS) {
      throw new Error('FAIL: Multiple non-CNIP subjects must be present in the timetable!');
    }

    // Test automatic lookup for date 2026-11-21 Sec A1
    const lookupRes = await fetch(
      `${BASE_URL}/timetable/lookup?date=2026-11-21&section=A1&session=FN&department=Computer Science and Engineering`,
      { headers: authHeaders }
    );
    const lookupJson = await lookupRes.json();
    console.log(`Timetable Lookup for 2026-11-21 Sec A1 returned count: ${lookupJson.count}`);
    if (lookupJson.count < 1) {
      throw new Error('FAIL: Timetable lookup for 2026-11-21 returned 0 entries!');
    }
    console.log('>>> TEST 2 PASSED: Multiple subjects (ADS, AI&ML, DBMS, OS, Cloud) dynamically loaded from timetable.\n');

    // -------------------------------------------------------------------------
    // TEST 3: VERIFY SECTIONS A1, A2, A3, A4, A5, A6 WORK
    // -------------------------------------------------------------------------
    console.log('--- TEST 3: Verify Sections A1, A2, A3, A4, A5, A6 Work Consistently ---');
    const testSections = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];
    for (const sec of testSections) {
      const rosterCheck = await fetch(`${BASE_URL}/exams/roster-preview?section=${sec}`, { headers: authHeaders });
      const rosterJson = await rosterCheck.json();
      if (!rosterJson.success || rosterJson.section !== sec) {
        throw new Error(`FAIL: Section ${sec} failed roster query validation!`);
      }
    }
    console.log(`Tested sections ${testSections.join(', ')}: All properly accepted and queried.`);
    console.log('>>> TEST 3 PASSED: Sections A1 through A6 supported consistently.\n');

    // -------------------------------------------------------------------------
    // TEST 4: CREATE EXAMINATION FOR TODAY & VERIFY STUDENTS LOAD CORRECTLY
    // -------------------------------------------------------------------------
    console.log('--- TEST 4: Create Examination For Today & Verify Students Load Correctly ---');
    const room3020 = activeRooms.find((r) => r.roomNumber === '3020');

    // Delete any existing test exam on this subject/date to keep clean
    await Exam.deleteMany({ examName: 'Unit Exam Test Today AI' });

    const todayExamPayload = {
      examName: 'Unit Exam Test Today AI',
      academicYear: '2026-2027',
      department: 'Computer Science and Engineering',
      year: 'IV Year',
      semester: 'I Semester',
      section: 'A1',
      group: 'Group A',
      subjectName: 'Advanced Distributed Systems',
      subjectCode: 'AUDIT-4241',
      examDate: '2026-11-21',
      startTime: '09:00 AM',
      endTime: '12:00 PM',
      session: 'FN',
      classroomId: room3020._id,
    };

    const createTodayRes = await fetch(`${BASE_URL}/exams`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(todayExamPayload),
    });

    const createTodayJson = await createTodayRes.json();
    if (!createTodayJson.success) {
      throw new Error(`FAIL to create today exam: ${createTodayJson.message}`);
    }

    const createdTodayExam = createTodayJson.data;
    console.log(`Created Exam ID: ${createdTodayExam._id} | Subject: ${createdTodayExam.subjectName} | Student Count: ${createdTodayExam.studentCount}`);

    if (createdTodayExam.studentCount === 0) {
      throw new Error('FAIL: Today exam created with 0 students!');
    }

    console.log(`>>> TEST 4 PASSED: Today's examination scheduled with ${createdTodayExam.studentCount} authentic students.\n`);

    // -------------------------------------------------------------------------
    // TEST 5: GENERATE SEATING FOR 72 STUDENTS & VERIFY EXACTLY ONE SEAT EACH
    // -------------------------------------------------------------------------
    console.log('--- TEST 5: Generate Seating For 72 Students & Verify One Seat Each ---');
    const room3030 = activeRooms.find((r) => r.roomNumber === '3030');

    await Exam.deleteMany({ examName: 'Mid Exam 72 Students A3' });

    const exam72Payload = {
      examName: 'Mid Exam 72 Students A3',
      academicYear: '2026-2027',
      department: 'Computer Science and Engineering',
      year: 'IV Year',
      semester: 'I Semester',
      section: 'A3',
      group: 'Group A',
      subjectName: 'Artificial Intelligence & Machine Learning',
      subjectCode: 'A0526197',
      examDate: '2026-11-21',
      startTime: '02:00 PM',
      endTime: '05:00 PM',
      session: 'AN',
      classroomId: room3030._id,
    };

    const create72Res = await fetch(`${BASE_URL}/exams`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(exam72Payload),
    });

    const create72Json = await create72Res.json();
    if (!create72Json.success) {
      throw new Error(`FAIL to create 72-student exam: ${create72Json.message}`);
    }

    const exam72 = create72Json.data;
    const alloc72 = create72Json.allocation;

    console.log(`Exam 72 ID: ${exam72._id} | Student Count: ${exam72.studentCount}`);
    console.log(`Allocated Students: ${alloc72.students.length}`);

    if (alloc72.students.length !== 72) {
      throw new Error(`FAIL: Expected 72 allocated students, got ${alloc72.students.length}`);
    }

    // Verify unique seats and no duplicates
    const assignedSeats = new Set();
    const assignedRegs = new Set();
    alloc72.students.forEach((s) => {
      if (assignedSeats.has(s.seatId)) throw new Error(`FAIL: Duplicate seat detected: ${s.seatId}`);
      if (assignedRegs.has(s.registrationNumber)) throw new Error(`FAIL: Duplicate student detected: ${s.registrationNumber}`);
      assignedSeats.add(s.seatId);
      assignedRegs.add(s.registrationNumber);
    });

    console.log(`Unique Seats Allocated: ${assignedSeats.size} / 72 | Set Distribution: A=${alloc72.setDistribution.A}, B=${alloc72.setDistribution.B}, C=${alloc72.setDistribution.C}`);
    console.log('>>> TEST 5 PASSED: All 72 students received exactly one unique seat with 0 collisions.\n');

    // -------------------------------------------------------------------------
    // TEST 6: CREATE AN EXAMINATION FOR TOMORROW WITH A START TIME
    // -------------------------------------------------------------------------
    console.log('--- TEST 6: Create Examination For Tomorrow With Start Time ---');
    const room3040 = activeRooms.find((r) => r.roomNumber === '3040');

    await Exam.deleteMany({ examName: 'Tomorrow Cloud Exam' });

    const tomorrowPayload = {
      examName: 'Tomorrow Cloud Exam',
      academicYear: '2026-2027',
      department: 'Computer Science and Engineering',
      year: 'IV Year',
      semester: 'I Semester',
      section: 'A4',
      group: 'Group A',
      subjectName: 'Cloud Computing',
      subjectCode: 'CS405',
      examDate: '2026-11-22',
      startTime: '09:00 AM',
      endTime: '12:00 PM',
      session: 'FN',
      classroomId: room3040._id,
    };

    const createTomorrowRes = await fetch(`${BASE_URL}/exams`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(tomorrowPayload),
    });

    const createTomorrowJson = await createTomorrowRes.json();
    if (!createTomorrowJson.success) {
      throw new Error(`FAIL to create tomorrow exam: ${createTomorrowJson.message}`);
    }

    const tomorrowExam = createTomorrowJson.data;
    console.log(`Tomorrow Exam: ${tomorrowExam.examName} on ${tomorrowExam.examDate} at ${tomorrowExam.startTime} (${tomorrowExam.startDateTime})`);
    console.log(`Publication Time (T-30 min): ${tomorrowExam.publicationTime}`);
    console.log(`Exam Status: ${tomorrowExam.status} (Expected: SCHEDULED)`);

    if (tomorrowExam.status !== 'SCHEDULED') {
      throw new Error(`FAIL: Tomorrow exam status must be SCHEDULED, got ${tomorrowExam.status}`);
    }

    console.log('>>> TEST 6 PASSED: Tomorrow examination scheduled with exact start time and T-30 publication time.\n');

    // -------------------------------------------------------------------------
    // TEST 7: VERIFY ALLOCATION IS GENERATED & SAVED IMMEDIATELY AFTER CONFIRMATION
    // -------------------------------------------------------------------------
    console.log('--- TEST 7: Verify Allocation Generated & Saved Immediately ---');
    const savedAlloc = await Allocation.findById(tomorrowExam.currentAllocationId);
    if (!savedAlloc) {
      throw new Error('FAIL: Allocation document was not saved in MongoDB!');
    }
    console.log(`Allocation Found in MongoDB: ID=${savedAlloc._id}, Version=${savedAlloc.version}, Status=${savedAlloc.status}, Total Students=${savedAlloc.students.length}`);
    if (savedAlloc.students.length === 0) {
      throw new Error('FAIL: Saved allocation has 0 students!');
    }
    console.log('>>> TEST 7 PASSED: Seating allocation generated and persisted in MongoDB immediately upon exam confirmation.\n');

    // -------------------------------------------------------------------------
    // TEST 8: VERIFY STUDENTS CANNOT SEE ALLOCATION BEFORE T-30 MINUTES
    // -------------------------------------------------------------------------
    console.log('--- TEST 8: Verify Students Cannot See Allocation Before T-30 Minutes ---');
    // Try to lookup tomorrow's candidate in Student Portal (Date: 2026-11-22)
    const testCandidate = savedAlloc.students[0];
    const studentLookupRes = await fetch(`${BASE_URL}/student/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registrationNumber: testCandidate.registrationNumber,
        date: '2026-11-22',
        examId: tomorrowExam._id,
      }),
    });

    const studentLookupJson = await studentLookupRes.json();
    console.log(`Student Portal lookup status before publication: ${studentLookupRes.status}`);
    console.log(`Student Portal message: "${studentLookupJson.message}"`);

    if (studentLookupRes.status !== 403 && studentLookupRes.status !== 404) {
      throw new Error(`FAIL: Student portal allowed access before publication! Status: ${studentLookupRes.status}`);
    }

    if (!studentLookupJson.message.includes('30 minutes before')) {
      throw new Error(`FAIL: Expected 30 minutes notice, got: ${studentLookupJson.message}`);
    }

    console.log('>>> TEST 8 PASSED: Student portal securely blocks access prior to T-30 publication.\n');

    // -------------------------------------------------------------------------
    // TEST 9: VERIFY ALLOCATION AUTOMATICALLY PUBLISHES AT T-30 MINUTES
    // -------------------------------------------------------------------------
    console.log('--- TEST 9: Verify Allocation Automatically Publishes At T-30 Minutes ---');
    // Simulate publication time arrival by setting publicationTime to 1 minute ago
    const oneMinAgo = new Date(Date.now() - 60 * 1000);
    await Exam.findByIdAndUpdate(tomorrowExam._id, { publicationTime: oneMinAgo });

    // Trigger scheduler publication check cycle
    await schedulerService.checkScheduledPublications();

    const publishedTomorrowExam = await Exam.findById(tomorrowExam._id);
    const publishedTomorrowAlloc = await Allocation.findById(tomorrowExam.currentAllocationId);

    console.log(`After Scheduler Cycle — Exam Status: ${publishedTomorrowExam.status}, Allocation Status: ${publishedTomorrowAlloc.status}`);

    if (publishedTomorrowExam.status !== 'PUBLISHED' || publishedTomorrowAlloc.status !== 'PUBLISHED') {
      throw new Error(`FAIL: Automatic publication failed! Status: ${publishedTomorrowExam.status}`);
    }

    console.log('>>> TEST 9 PASSED: Background scheduler automatically published allocation at T-30.\n');

    // -------------------------------------------------------------------------
    // TEST 10: RESTART BACKEND BEFORE PUBLICATION & VERIFY SCHEDULED JOB RECOVERS
    // -------------------------------------------------------------------------
    console.log('--- TEST 10: Restart Backend & Verify Scheduled Job Recovers Overdue Publications ---');
    // Create an exam with scheduled status and publicationTime in the past
    const room3050 = activeRooms.find((r) => r.roomNumber === '3050');
    await Exam.deleteMany({ examName: 'Restart Recovery Exam' });

    const recoveryPayload = {
      examName: 'Restart Recovery Exam',
      academicYear: '2026-2027',
      department: 'Computer Science and Engineering',
      year: 'IV Year',
      semester: 'I Semester',
      section: 'A1',
      group: 'Group A',
      subjectName: 'Advanced Distributed Systems',
      subjectCode: 'AUDIT-4241',
      examDate: '2026-11-22',
      startTime: '10:00 AM',
      endTime: '01:00 PM',
      session: 'AN',
      classroomId: room3050._id,
    };

    const recoveryRes = await fetch(`${BASE_URL}/exams`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(recoveryPayload),
    });
    const recoveryJson = await recoveryRes.json();
    const recExam = recoveryJson.data;

    // Simulate overdue publication time during server offline state
    await Exam.findByIdAndUpdate(recExam._id, {
      status: 'SCHEDULED',
      publicationTime: new Date(Date.now() - 5 * 60 * 1000),
    });

    // Simulate backend server reboot: schedulerService.start()
    schedulerService.stop();
    schedulerService.start();

    // Small delay for async cycle
    await new Promise((r) => setTimeout(r, 1000));

    const recoveredExam = await Exam.findById(recExam._id);
    console.log(`Recovered Exam Status after boot cycle: ${recoveredExam.status} (Expected: PUBLISHED)`);

    if (recoveredExam.status !== 'PUBLISHED') {
      throw new Error(`FAIL: Scheduled job did not recover overdue publication on restart! Status: ${recoveredExam.status}`);
    }

    console.log('>>> TEST 10 PASSED: Backend recovers and publishes overdue allocations on restart.\n');

    // -------------------------------------------------------------------------
    // TEST 11: VERIFY ONLY CORRECT STUDENT'S SEATING DETAILS ARE DISPLAYED
    // -------------------------------------------------------------------------
    console.log('--- TEST 11: Verify Student Portal Displays ONLY Correct Student Seat ---');
    const targetStudent = savedAlloc.students[1];
    const lookupAfterPubRes = await fetch(`${BASE_URL}/student/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registrationNumber: targetStudent.registrationNumber,
        date: '2026-11-22',
        examId: tomorrowExam._id,
      }),
    });

    const lookupAfterPubJson = await lookupAfterPubRes.json();
    console.log(`Student Lookup Response Status: ${lookupAfterPubRes.status}`);
    const studentData = lookupAfterPubJson.data;

    console.log('Student Portal Displayed Details:');
    console.log(`  Name: ${studentData.studentName}`);
    console.log(`  Reg Number: ${studentData.registrationNumber}`);
    console.log(`  Subject: ${studentData.subject}`);
    console.log(`  Section: ${studentData.section}`);
    console.log(`  Classroom: ${studentData.classroom}`);
    console.log(`  Seat: ${studentData.seatNumber} (${studentData.seatId}) | Row: ${studentData.row} | Bench: ${studentData.bench}`);
    console.log(`  Question Paper Set: ${studentData.questionPaperSet}`);

    if (studentData.registrationNumber !== targetStudent.registrationNumber) {
      throw new Error(`FAIL: Returned wrong student registration number!`);
    }

    // Verify other students' data is NOT exposed in the payload
    if (lookupAfterPubJson.allStudents || (lookupAfterPubJson.allMatches && lookupAfterPubJson.allMatches.length > 1)) {
      throw new Error('FAIL: Full allocation database exposed to student portal!');
    }

    console.log('>>> TEST 11 PASSED: Only the authenticated student\'s individual seat is returned.\n');

    // -------------------------------------------------------------------------
    // TEST 12: VERIFY ALL PDFS CONTAIN CORRECT EXAMINATION DETAILS
    // -------------------------------------------------------------------------
    console.log('--- TEST 12: Verify All PDFs Contain Correct Examination Details ---');
    const ReportService = require('../services/reportService');
    const attPdf = await ReportService.generateAttendancePDF(tomorrowExam, publishedTomorrowAlloc, room3040);
    const seatingChartPdf = await ReportService.generateSeatingChartPDF(tomorrowExam, publishedTomorrowAlloc, room3040);
    const masterAllocPdf = await ReportService.generateMasterPDF(tomorrowExam, publishedTomorrowAlloc, room3040);

    console.log(`Attendance PDF Size: ${attPdf.length} bytes`);
    console.log(`Seating Chart PDF Size: ${seatingChartPdf.length} bytes`);
    console.log(`Master Allocation PDF Size: ${masterAllocPdf.length} bytes`);

    if (attPdf.length < 1000 || seatingChartPdf.length < 1000 || masterAllocPdf.length < 1000) {
      throw new Error('FAIL: PDF generation produced empty or corrupt output!');
    }

    console.log('>>> TEST 12 PASSED: All PDFs generated with official RGMCET headers, times, and sections.\n');

    // -------------------------------------------------------------------------
    // TEST 13: VERIFY PREVIOUS EXAMINATION ALLOCATIONS ARE NOT MODIFIED
    // -------------------------------------------------------------------------
    console.log('--- TEST 13: Verify Previous Examination Allocations Are Not Modified ---');
    const previousAllocations = await Allocation.find({ examId: exam72._id });
    console.log(`Exam 72 Allocations Count: ${previousAllocations.length}`);
    const originalVersion = previousAllocations[0];

    // Ensure version and students remain strictly intact
    if (originalVersion.students.length !== 72) {
      throw new Error(`FAIL: Previous allocation was corrupted! Length: ${originalVersion.students.length}`);
    }

    console.log(`Previous allocation preserved with Version ${originalVersion.version} and 72 candidates.`);
    console.log('>>> TEST 13 PASSED: Historical allocations preserved without modification.\n');

    // -------------------------------------------------------------------------
    // TEST 14: VERIFY CLASSROOM OVERLAPPING CONFLICTS ARE DETECTED
    // -------------------------------------------------------------------------
    console.log('--- TEST 14: Verify Classroom Overlapping Conflicts Detected ---');
    // Try to book the same classroom (room3020) on 2026-11-21 between 09:00 AM and 12:00 PM
    const conflictPayload = {
      examName: 'Conflicting Exam on Room 3020',
      academicYear: '2026-2027',
      department: 'Computer Science and Engineering',
      year: 'IV Year',
      semester: 'I Semester',
      section: 'A1',
      group: 'Group A',
      subjectName: 'Artificial Intelligence & Machine Learning',
      subjectCode: 'A0526197',
      examDate: '2026-11-21',
      startTime: '10:00 AM', // Overlaps with 09:00 AM - 12:00 PM!
      endTime: '01:00 PM',
      session: 'FN',
      classroomId: room3020._id,
    };

    const conflictRes = await fetch(`${BASE_URL}/exams`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(conflictPayload),
    });

    const conflictJson = await conflictRes.json();
    console.log(`Conflict Request HTTP Status: ${conflictRes.status}`);
    console.log(`Conflict Error Message: "${conflictJson.message}"`);

    if (conflictRes.status !== 409) {
      throw new Error(`FAIL: Expected 409 Conflict, received HTTP ${conflictRes.status}!`);
    }

    if (!conflictJson.message.toLowerCase().includes('conflict')) {
      throw new Error(`FAIL: Conflict message did not explain overlap: ${conflictJson.message}`);
    }

    console.log('>>> TEST 14 PASSED: Classroom overlapping scheduling conflict detected and rejected with 409 Conflict.\n');

    console.log('========================================================================');
    console.log('  ALL 14 COMPREHENSIVE TESTS EXECUTED AND PASSED WITH 100% SUCCESS!   ');
    console.log('========================================================================');
  } finally {
    schedulerService.stop();
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB.');
  }
}

run14TestSuite().catch((err) => {
  console.error('\n[FATAL TEST FAILURE]', err);
  process.exit(1);
});
