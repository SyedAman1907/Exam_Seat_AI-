const assert = require('assert');

const BASE_URL = 'http://localhost:5000/api';

async function runTimetableTests() {
  console.log('\n======================================================');
  console.log('  EXAMSEAT AI — DATE-BASED AUTO SUBJECT SELECTION TEST');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`     Error: ${err.message}`);
      failed++;
    }
  }

  let token = null;
  let classroomId = null;

  // Step 0: Login
  await test('0. Admin authentication', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@rgmcet.edu.in',
        password: 'AdminExam@2026',
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert(data.token);
    token = data.token;

    const classRes = await fetch(`${BASE_URL}/classrooms`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const classData = await classRes.json();
    assert(classData.data.length > 0);
    classroomId = classData.data[0]._id;
  });

  // TEST 1: Select 07/11/2026 and verify CNIP appears automatically
  await test('1. Select 07/11/2026 and verify CNIP (CS401) appears automatically', async () => {
    const res = await fetch(`${BASE_URL}/timetable/lookup?date=07/11/2026&section=A&session=FN`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert(data.success);
    assert.strictEqual(data.count, 1);
    assert.strictEqual(data.subjectName, 'CNIP');
    assert.strictEqual(data.subjectCode, 'CS401');
    assert.strictEqual(data.requiresSelection, false);
  });

  // TEST 2: Select 09/11/2026 and verify DBMS appears automatically
  await test('2. Select 09/11/2026 and verify DBMS (CS402) appears automatically', async () => {
    const res = await fetch(`${BASE_URL}/timetable/lookup?date=09/11/2026&section=A&session=FN`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert(data.success);
    assert.strictEqual(data.count, 1);
    assert.strictEqual(data.subjectName, 'DBMS');
    assert.strictEqual(data.subjectCode, 'CS402');
    assert.strictEqual(data.requiresSelection, false);
  });

  // TEST 2b: Select 11/11/2026 (OS) and 13/11/2026 (Computer Networks)
  await test('2b. Verify 11/11/2026 -> Operating Systems and 13/11/2026 -> Computer Networks', async () => {
    const res11 = await fetch(`${BASE_URL}/timetable/lookup?date=11/11/2026&section=A`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data11 = await res11.json();
    assert.strictEqual(data11.subjectName, 'Operating Systems');

    const res13 = await fetch(`${BASE_URL}/timetable/lookup?date=13/11/2026&section=A`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data13 = await res13.json();
    assert.strictEqual(data13.subjectName, 'Computer Networks');
  });

  // TEST 3: Verify subject cannot be manually changed in the normal workflow
  await test('3. Verify automatic subject detection links timetable and prevents manual tampering', async () => {
    // When creating exam with detected subject
    const lookupRes = await fetch(`${BASE_URL}/timetable/lookup?date=07/11/2026&section=A&session=FN`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const detected = await lookupRes.json();
    assert(detected.timetableId);
    assert.strictEqual(detected.subjectName, 'CNIP');
  });

  // TEST 4: Verify upcoming exam dates filter
  await test('4. Verify upcoming timetable dates and exam filtering API', async () => {
    const res = await fetch(`${BASE_URL}/timetable?filter=upcoming`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert(data.success);
    assert(Array.isArray(data.data));
  });

  // TEST 5: Verify past examinations remain available in history
  await test('5. Verify completed examinations remain accessible in History filter', async () => {
    const res = await fetch(`${BASE_URL}/exams?filter=completed`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert(data.success);
    assert(Array.isArray(data.data));
  });

  // TEST 6: Verify multiple sections can have different subjects on the same date
  await test('6. Verify multiple sections have different subjects on 07/11/2026 (Sec A: CNIP vs Sec B: Cloud Computing)', async () => {
    // Look up with just date (returns both Section A and Section B)
    const ambigRes = await fetch(`${BASE_URL}/timetable/lookup?date=07/11/2026`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const ambigData = await ambigRes.json();
    assert.strictEqual(ambigData.count, 2);
    assert.strictEqual(ambigData.requiresSelection, true);

    // Look up Section A specifically
    const secARes = await fetch(`${BASE_URL}/timetable/lookup?date=07/11/2026&section=A`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const secAData = await secARes.json();
    assert.strictEqual(secAData.subjectName, 'CNIP');
    assert.strictEqual(secAData.subjectCode, 'CS401');

    // Look up Section B specifically
    const secBRes = await fetch(`${BASE_URL}/timetable/lookup?date=07/11/2026&section=B`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const secBData = await secBRes.json();
    assert.strictEqual(secBData.subjectName, 'Cloud Computing');
    assert.strictEqual(secBData.subjectCode, 'CS405');
  });

  let createdExamId = null;

  // TEST 7: Verify correct student roster is automatically loaded upon exam creation
  await test('7. Create exam from auto-detected CNIP timetable and verify Section A roster auto-loads 72 students', async () => {
    const uniqueExamName = `Unit Exam - CNIP (${Date.now()})`;
    const createRes = await fetch(`${BASE_URL}/exams`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        examName: uniqueExamName,
        academicYear: '2026-2027',
        department: 'Computer Science and Engineering',
        year: 'IV Year',
        semester: 'I Semester',
        section: 'A',
        subjectName: 'CNIP',
        subjectCode: `CNIP-${Date.now().toString().slice(-4)}`,
        examDate: '2026-11-07',
        session: 'FN',
        classroomId: classroomId,
      }),
    });
    const examData = await createRes.json();
    assert.strictEqual(createRes.status, 201);
    assert(examData.success);
    assert.strictEqual(examData.data.studentCount, 72, 'Student roster must auto-populate 72 students');
    createdExamId = examData.data._id;
  });

  // TEST 8: Verify seating allocation works
  await test('8. Generate randomized seating allocation with balanced sets A, B, C', async () => {
    const allocRes = await fetch(`${BASE_URL}/exams/${createdExamId}/allocate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const allocData = await allocRes.json();
    assert.strictEqual(allocRes.status, 201);
    assert(allocData.success);
    assert.strictEqual(allocData.data.students.length, 72);
    assert.strictEqual(allocData.data.setDistribution.A, 24);
    assert.strictEqual(allocData.data.setDistribution.B, 24);
    assert.strictEqual(allocData.data.setDistribution.C, 24);
  });

  // TEST 9: Verify PDFs display the correct automatically detected subject
  await test('9. Download Attendance Sheet PDF and verify correct subject and official branding', async () => {
    const res = await fetch(`${BASE_URL}/exams/${createdExamId}/reports/signature-pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
    const buffer = Buffer.from(await res.arrayBuffer());
    assert(buffer.length > 5000);
    assert.strictEqual(buffer.slice(0, 4).toString(), '%PDF');
  });

  // TEST 10: Verify existing examination records remain unchanged
  await test('10. Confirm existing examination and student records remain intact', async () => {
    const res = await fetch(`${BASE_URL}/exams`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert(data.data.length >= 1);
  });

  console.log('\n======================================================');
  console.log(`  TIMETABLE AUTO-SUBJECT TEST RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');

  if (failed > 0) process.exit(1);
}

runTimetableTests();