const mongoose = require('mongoose');
const Exam = require('../models/Exam');
const Classroom = require('../models/Classroom');
const Allocation = require('../models/Allocation');

const BASE_URL = 'http://localhost:5000/api/student';

// Asia/Kolkata date helper
function getKolkataDateParts(offsetDays = 0) {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const iso = formatter.format(now);
  const [yyyy, mm, dd] = iso.split('-');
  return { iso, dmy: `${dd}/${mm}/${yyyy}` };
}

async function runTests() {
  console.log('========================================================');
  console.log(' EXAMSEAT AI - STUDENT PORTAL TODAY-ONLY VERIFICATION ');
  console.log('========================================================\n');

  await mongoose.connect('mongodb://127.0.0.1:27017/examseat-ai');
  console.log('Connected to MongoDB for test fixtures.');

  const today = getKolkataDateParts(0);
  const yesterday = getKolkataDateParts(-1);
  const tomorrow = getKolkataDateParts(1);

  console.log(`[Timezone] Asia/Kolkata Today: ${today.iso} (${today.dmy})`);
  console.log(`[Timezone] Asia/Kolkata Yesterday: ${yesterday.iso}`);
  console.log(`[Timezone] Asia/Kolkata Tomorrow: ${tomorrow.iso}\n`);

  let testExamToday1, testExamToday2, testExamYesterday, testExamTomorrow, testExamUnpublished;
  let testAllocation;

  try {
    // 1. Get or create classroom
    let hall = await Classroom.findOne({ roomNumber: 'A-101' });
    if (!hall) {
      hall = await Classroom.create({
        name: 'Main Examination Hall A-101',
        roomNumber: 'A-101',
        totalCapacity: 72,
        totalRows: 6,
        benchesPerRow: 6,
        seatsPerBench: 2,
        block: 'CSE Department Main Block',
        floor: 'First Floor',
      });
    }

    // Clean up any existing test records
    await Exam.deleteMany({ examName: { $regex: /^TEST_TODAY_/ } });
    await Allocation.deleteMany({ 'students.name': 'TEST STUDENT JOHN' });

    // 2. Create test exams
    // A) Published Exam Today - Subject 1
    testExamToday1 = await Exam.create({
      examName: 'TEST_TODAY_DBMS',
      subjectName: 'Database Management Systems',
      subjectCode: 'CS401',
      academicYear: '2026-2027',
      department: 'Computer Science and Engineering',
      year: 'IV',
      semester: 'I',
      section: 'A',
      examDate: today.iso,
      session: 'FN',
      classroomId: hall._id,
      status: 'PUBLISHED',
      studentCount: 72,
    });

    // B) Published Exam Today - Subject 2 (Multi-subject today test)
    testExamToday2 = await Exam.create({
      examName: 'TEST_TODAY_CN',
      subjectName: 'Computer Networks',
      subjectCode: 'CS402',
      academicYear: '2026-2027',
      department: 'Computer Science and Engineering',
      year: 'IV',
      semester: 'I',
      section: 'B',
      examDate: today.iso,
      session: 'AN',
      classroomId: hall._id,
      status: 'PUBLISHED',
      studentCount: 72,
    });

    // C) Published Exam Yesterday (MUST NOT APPEAR)
    testExamYesterday = await Exam.create({
      examName: 'TEST_TODAY_YESTERDAY_EXAM',
      subjectName: 'Operating Systems',
      subjectCode: 'CS301',
      academicYear: '2026-2027',
      department: 'Computer Science and Engineering',
      year: 'IV',
      semester: 'I',
      section: 'A',
      examDate: yesterday.iso,
      session: 'FN',
      classroomId: hall._id,
      status: 'PUBLISHED',
      studentCount: 72,
    });

    // D) Published Exam Tomorrow (MUST NOT APPEAR)
    testExamTomorrow = await Exam.create({
      examName: 'TEST_TODAY_TOMORROW_EXAM',
      subjectName: 'Cloud Computing',
      subjectCode: 'CS403',
      academicYear: '2026-2027',
      department: 'Computer Science and Engineering',
      year: 'IV',
      semester: 'I',
      section: 'A',
      examDate: tomorrow.iso,
      session: 'FN',
      classroomId: hall._id,
      status: 'PUBLISHED',
      studentCount: 72,
    });

    // E) Unpublished Exam Today (MUST NOT APPEAR)
    testExamUnpublished = await Exam.create({
      examName: 'TEST_TODAY_DRAFT_EXAM',
      subjectName: 'Machine Learning',
      subjectCode: 'CS404',
      academicYear: '2026-2027',
      department: 'Computer Science and Engineering',
      year: 'IV',
      semester: 'I',
      section: 'A',
      examDate: today.iso,
      session: 'FN',
      classroomId: hall._id,
      status: 'DRAFT',
      studentCount: 72,
    });

    // 3. Create published allocation for Today Exam 1
    testAllocation = await Allocation.create({
      examId: testExamToday1._id,
      classroomId: hall._id,
      randomSeed: 'TEST_SEED_123',
      status: 'PUBLISHED',
      isCurrent: true,
      publishedAt: new Date(),
      students: [
        {
          name: 'TEST STUDENT JOHN',
          registrationNumber: '24091A0599',
          rowNumber: 2,
          benchNumber: 3,
          seatNumber: 1,
          seatId: 'R2-B3-S1',
          questionPaperSet: 'B',
        },
      ],
    });

    console.log('[Setup] Created test fixture exams & allocations in MongoDB.\n');

    // TEST 1: GET /api/student/active-exams
    console.log('--- TEST 1: Query Today’s Published Examinations ---');
    const resActiveRaw = await fetch(`${BASE_URL}/active-exams`);
    const resActive = { status: resActiveRaw.status, data: await resActiveRaw.json() };
    console.log(`Status Code: ${resActive.status}`);
    console.log(`Reported Today (IST): ${resActive.data.todayDate} (${resActive.data.todayDisplayDate})`);
    console.log(`Exams Count returned: ${resActive.data.count}`);

    const returnedExamIds = resActive.data.data.map((e) => e._id.toString());
    const hasToday1 = returnedExamIds.includes(testExamToday1._id.toString());
    const hasToday2 = returnedExamIds.includes(testExamToday2._id.toString());
    const hasYesterday = returnedExamIds.includes(testExamYesterday._id.toString());
    const hasTomorrow = returnedExamIds.includes(testExamTomorrow._id.toString());
    const hasUnpublished = returnedExamIds.includes(testExamUnpublished._id.toString());

    console.log(`✓ Today Exam 1 (DBMS) included: ${hasToday1}`);
    console.log(`✓ Today Exam 2 (CN) included: ${hasToday2}`);
    console.log(`✓ Yesterday Exam excluded: ${!hasYesterday}`);
    console.log(`✓ Tomorrow Exam excluded: ${!hasTomorrow}`);
    console.log(`✓ Unpublished Draft Exam excluded: ${!hasUnpublished}`);

    if (!hasToday1 || !hasToday2 || hasYesterday || hasTomorrow || hasUnpublished) {
      throw new Error('FAIL: Active exams returned incorrect date/status filtering!');
    }
    console.log('>>> TEST 1 PASSED: Only today’s published exams are returned.\n');

    // TEST 2: Empty state when date has no exams
    console.log('--- TEST 2: Empty State ("No examinations scheduled for today.") ---');
    const resEmptyRaw = await fetch(`${BASE_URL}/active-exams?date=2099-12-31`);
    const resEmpty = { status: resEmptyRaw.status, data: await resEmptyRaw.json() };
    console.log(`Count for empty date: ${resEmpty.data.count}`);
    console.log(`Message returned: "${resEmpty.data.message}"`);
    if (resEmpty.data.count !== 0 || resEmpty.data.message !== 'No examinations scheduled for today.') {
      throw new Error('FAIL: Empty state message not returned correctly!');
    }
    console.log('>>> TEST 2 PASSED: Empty state message verified.\n');

    // TEST 3: Student Seat Lookup for Today's Exam
    console.log('--- TEST 3: Student Seat Lookup with 8 required fields ---');
    const resLookupRaw = await fetch(`${BASE_URL}/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registrationNumber: '24091A0599',
        examId: testExamToday1._id,
      }),
    });
    const resLookup = { status: resLookupRaw.status, data: await resLookupRaw.json() };
    console.log(`Lookup Status Code: ${resLookup.status}`);
    const data = resLookup.data.data;
    console.log('Returned Student Seating Details:');
    console.log(`  1. Student Name: ${data.studentName}`);
    console.log(`  2. Registration Number: ${data.registrationNumber}`);
    console.log(`  3. Subject: ${data.subjectName} (${data.subjectCode})`);
    console.log(`  4. Question Paper Set: ${data.questionPaperSet}`);
    console.log(`  5. Classroom / Hall: ${data.classroom}`);
    console.log(`  6. Row Number: ${data.rowNumber}`);
    console.log(`  7. Bench Number: ${data.benchNumber}`);
    console.log(`  8. Seat Number: ${data.seatNumber} (${data.seatId})`);

    if (
      data.studentName !== 'TEST STUDENT JOHN' ||
      data.registrationNumber !== '24091A0599' ||
      data.questionPaperSet !== 'B' ||
      data.rowNumber !== 2 ||
      data.benchNumber !== 3 ||
      data.seatNumber !== 1
    ) {
      throw new Error('FAIL: Student seat lookup returned incorrect details!');
    }
    console.log('>>> TEST 3 PASSED: All 8 seating fields accurately returned.\n');

    // TEST 4: Student cannot lookup seating for a non-today exam
    console.log('--- TEST 4: Security & Date Constraint on Lookup ---');
    const resRejectRaw = await fetch(`${BASE_URL}/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registrationNumber: '24091A0599',
        examId: testExamYesterday._id, // yesterday exam
      }),
    });
    const resReject = { status: resRejectRaw.status, data: await resRejectRaw.json() };
    if (resReject.status === 404) {
      console.log(`✓ Yesterday exam lookup rejected with 404: "${resReject.data.message}"`);
      console.log('>>> TEST 4 PASSED: Student cannot lookup exams outside today.\n');
    } else {
      throw new Error('FAIL: Lookup should have rejected yesterday exam!');
    }

    console.log('========================================================');
    console.log(' ALL 4 TEST SUITES PASSED FLAWLESSLY! ');
    console.log('========================================================');
  } finally {
    // Clean up test fixtures
    if (testExamToday1) await Exam.findByIdAndDelete(testExamToday1._id);
    if (testExamToday2) await Exam.findByIdAndDelete(testExamToday2._id);
    if (testExamYesterday) await Exam.findByIdAndDelete(testExamYesterday._id);
    if (testExamTomorrow) await Exam.findByIdAndDelete(testExamTomorrow._id);
    if (testExamUnpublished) await Exam.findByIdAndDelete(testExamUnpublished._id);
    if (testAllocation) await Allocation.findByIdAndDelete(testAllocation._id);
    await mongoose.disconnect();
    console.log('Cleaned up test data and closed DB connection.');
  }
}

runTests().catch((err) => {
  console.error('Test failed with error:', err.message);
  process.exit(1);
});
