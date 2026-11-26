const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ExcelJS = require('exceljs');

const BASE_URL = 'http://localhost:5000/api';

async function runMultiUnitAudit() {
  console.log('\n================================================================');
  console.log('  EXAMSEAT AI — 15-POINT COMPREHENSIVE PRODUCTION AUDIT');
  console.log('  Department of CSE • RGMCET (Autonomous)');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(testNumber, name, fn) {
    process.stdout.write(`TEST ${testNumber}: ${name}... `);
    try {
      await fn();
      console.log('✓ PASS');
      passed++;
    } catch (err) {
      console.log('✗ FAIL');
      console.error(`   Error: ${err.message}`);
      if (err.stack) {
        console.error(`   Stack: ${err.stack.split('\n')[1]}`);
      }
      failed++;
    }
  }

  let token = '';
  let classroomId = '';
  let savedRosterId = '';
  let unit1ExamId = '';
  let unit1Allocation = null;
  let unit2ExamId = '';
  let unit2Allocation = null;

  // Setup: Login
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@rgmcet.edu.in', password: 'AdminExam@2026' }),
  });
  const loginData = await loginRes.json();
  assert(loginData.success);
  token = loginData.token;

  // Setup: Classroom
  const crRes = await fetch(`${BASE_URL}/classrooms`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const crData = await crRes.json();
  classroomId = crData.data[0]._id;

  // TEST 1: Upload a student Excel file containing 72 students
  let extractedExcelStudents = [];
  await test(1, 'Upload student Excel file containing 72 students', async () => {
    const xlsxPath = path.join(__dirname, '../../sample-data/sample-students-72.xlsx');
    assert(fs.existsSync(xlsxPath), 'sample-students-72.xlsx must exist');
    const fileBuffer = fs.readFileSync(xlsxPath);

    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    let body = `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="file"; filename="sample-students-72.xlsx"\r\n`;
    body += `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`;

    const preamble = Buffer.from(body, 'utf-8');
    const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
    const fullBody = Buffer.concat([preamble, fileBuffer, epilogue]);

    const res = await fetch(`${BASE_URL}/students/import-preview`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: fullBody,
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.data.records.length, 72, `Expected 72 records from Excel, got ${data.data.records.length}`);
    assert.strictEqual(data.data.summary.validCount, 72);
    extractedExcelStudents = data.data.records;
  });

  // TEST 2: Save the student roster
  await test(2, 'Save the student roster in MongoDB as a permanent reusable roster', async () => {
    const rosterPayload = {
      rosterName: `Audit CSE IV Year - Sec A (${Date.now()})`,
      department: 'Computer Science and Engineering',
      year: 'IV Year',
      semester: 'I Semester',
      section: 'A',
      academicYear: '2026-2027',
      subjects: ['Data Structures & Algorithms', 'Operating Systems', 'Artificial Intelligence'],
      students: extractedExcelStudents,
    };

    const res = await fetch(`${BASE_URL}/rosters`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(rosterPayload),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 201);
    assert(data.success);
    assert.strictEqual(data.data.studentCount, 72);
    savedRosterId = data.data._id;
  });

  // TEST 3: Create Unit 1 examination and generate allocation
  await test(3, 'Create Unit 1 examination using roster and generate allocation', async () => {
    // 3a. Create Unit 1
    const createRes = await fetch(`${BASE_URL}/exams`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        examName: 'Unit Examination I',
        academicYear: '2026-2027',
        department: 'Computer Science and Engineering',
        year: 'IV Year',
        semester: 'I Semester',
        section: 'A',
        subjectName: 'Data Structures & Algorithms',
        subjectCode: `DS-${Date.now().toString().slice(-4)}`,
        examDate: '2026-12-01',
        session: 'FN',
        classroomId: classroomId,
        rosterId: savedRosterId,
      }),
    });
    const createData = await createRes.json();
    assert.strictEqual(createRes.status, 201);
    unit1ExamId = createData.data._id;

    // 3b. Generate Allocation for Unit 1
    const allocRes = await fetch(`${BASE_URL}/exams/${unit1ExamId}/allocate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const allocData = await allocRes.json();
    assert.strictEqual(allocRes.status, 201);
    assert(allocData.success);
    unit1Allocation = allocData.data;
    assert.strictEqual(unit1Allocation.students.length, 72);
  });

  // TEST 4: Download master allocation PDF
  await test(4, 'Download master allocation PDF with official college branding', async () => {
    const res = await fetch(`${BASE_URL}/exams/${unit1ExamId}/reports/master-pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
    const buffer = Buffer.from(await res.arrayBuffer());
    assert(buffer.length > 5000);
    assert.strictEqual(buffer.slice(0, 4).toString(), '%PDF');
  });

  // TEST 5: Download attendance and signature PDF
  await test(5, 'Download attendance & signature PDF (Official CSE Dept format)', async () => {
    const res = await fetch(`${BASE_URL}/exams/${unit1ExamId}/reports/signature-pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
    const buffer = Buffer.from(await res.arrayBuffer());
    assert(buffer.length > 5000);
    assert.strictEqual(buffer.slice(0, 4).toString(), '%PDF');
  });

  // TEST 6: Download classroom seating chart
  await test(6, 'Download classroom seating chart PDF (Landscape blueprint with logo)', async () => {
    const res = await fetch(`${BASE_URL}/exams/${unit1ExamId}/reports/seating-pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
    const buffer = Buffer.from(await res.arrayBuffer());
    assert(buffer.length > 2000);
    assert.strictEqual(buffer.slice(0, 4).toString(), '%PDF');
  });

  // Lock Unit 1 exam to test immutability later
  await fetch(`${BASE_URL}/exams/${unit1ExamId}/lock`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  // TEST 7: Create Unit 2 using the existing roster without uploading again
  await test(7, 'Create Unit 2 examination selecting existing roster without uploading', async () => {
    const createRes = await fetch(`${BASE_URL}/exams`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        examName: 'Unit Examination II',
        academicYear: '2026-2027',
        department: 'Computer Science and Engineering',
        year: 'IV Year',
        semester: 'I Semester',
        section: 'A',
        subjectName: 'Operating Systems',
        subjectCode: `OS-${Date.now().toString().slice(-4)}`,
        examDate: '2026-12-15',
        session: 'AN',
        classroomId: classroomId,
        rosterId: savedRosterId, // Reusing existing roster!
      }),
    });
    const createData = await createRes.json();
    assert.strictEqual(createRes.status, 201);
    assert.strictEqual(createData.data.studentCount, 72, 'Should immediately have 72 students from roster');
    unit2ExamId = createData.data._id;
  });

  // TEST 8: Verify the same students are present
  await test(8, 'Verify identical student names and registration numbers loaded for Unit 2', async () => {
    const res = await fetch(`${BASE_URL}/exams/${unit2ExamId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    assert.strictEqual(data.data.studentCount, 72);

    // Generate allocation for Unit 2
    const allocRes = await fetch(`${BASE_URL}/exams/${unit2ExamId}/allocate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const allocData = await allocRes.json();
    assert.strictEqual(allocRes.status, 201);
    unit2Allocation = allocData.data;

    // Compare registration numbers
    const u1Regs = unit1Allocation.students.map(s => s.registrationNumber).sort();
    const u2Regs = unit2Allocation.students.map(s => s.registrationNumber).sort();
    assert.deepStrictEqual(u1Regs, u2Regs, 'All 72 students must match exactly between Unit 1 and Unit 2');
  });

  // TEST 9: Verify the seating arrangement is newly randomized
  await test(9, 'Verify Unit 2 seating arrangement is newly randomized (not identical to Unit 1)', async () => {
    assert.notStrictEqual(unit1Allocation.randomSeed, unit2Allocation.randomSeed);

    const u1SeatMap = new Map();
    unit1Allocation.students.forEach(s => u1SeatMap.set(s.registrationNumber, s.seatId));

    let differences = 0;
    unit2Allocation.students.forEach(s => {
      if (u1SeatMap.get(s.registrationNumber) !== s.seatId) {
        differences++;
      }
    });

    // In a random permutation of 72 items, majority of seats will differ
    assert(differences > 50, `Seating must be newly randomized. Only ${differences} of 72 changed.`);
  });

  // TEST 10: Verify new A/B/C set distribution
  await test(10, 'Verify balanced A/B/C set distribution and strict bench adjacency in Unit 2', async () => {
    const dist = unit2Allocation.setDistribution;
    assert.strictEqual(dist.A, 24);
    assert.strictEqual(dist.B, 24);
    assert.strictEqual(dist.C, 24);

    // Bench adjacency check
    const benchMap = {};
    unit2Allocation.students.forEach(s => {
      const key = `${s.rowNumber}-${s.benchNumber}`;
      if (!benchMap[key]) benchMap[key] = [];
      benchMap[key].push(s);
    });

    Object.keys(benchMap).forEach(key => {
      const benchSeats = benchMap[key].sort((a, b) => a.seatNumber - b.seatNumber);
      for (let i = 0; i < benchSeats.length - 1; i++) {
        assert.notStrictEqual(
          benchSeats[i].questionPaperSet,
          benchSeats[i + 1].questionPaperSet,
          `Adjacent collision on ${key}`
        );
      }
    });
  });

  // TEST 11: Upload a master dataset containing multiple sections and subjects
  let masterParsedResult = null;
  await test(11, 'Upload master dataset containing multiple sections (A, B, C)', async () => {
    const csvPath = path.join(__dirname, '../../sample-data/master-multi-section-students.csv');
    assert(fs.existsSync(csvPath), 'master-multi-section-students.csv must exist');
    const fileBuffer = fs.readFileSync(csvPath);

    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    let body = `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="file"; filename="master-multi-section-students.csv"\r\n`;
    body += `Content-Type: text/csv\r\n\r\n`;

    const preamble = Buffer.from(body, 'utf-8');
    const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
    const fullBody = Buffer.concat([preamble, fileBuffer, epilogue]);

    const res = await fetch(`${BASE_URL}/rosters/import-master`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: fullBody,
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert(data.success);
    assert(data.totalSections >= 3, `Expected at least 3 sections, found ${data.totalSections}`);
    assert(data.totalExtracted >= 216, `Expected at least 216 students across sections, found ${data.totalExtracted}`);
    masterParsedResult = data;
  });

  // TEST 12: Select only one subject and one section
  let sectionBRosterId = '';
  await test(12, 'Select only Section B and specific subject to save as dedicated roster', async () => {
    const sectionB = masterParsedResult.sections.find(s => s.section === 'B');
    assert(sectionB, 'Section B must be in master dataset');

    const res = await fetch(`${BASE_URL}/rosters`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        rosterName: `CSE Section B Only - 2026-27 (${Date.now()})`,
        department: 'Computer Science and Engineering',
        year: 'IV Year',
        semester: 'I Semester',
        section: 'B',
        academicYear: '2026-2027',
        subjects: ['Data Structures & Algorithms'],
        students: sectionB.students,
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(data.data.studentCount, 72);
    sectionBRosterId = data.data._id;
  });

  // TEST 13: Verify that only the selected student group is allocated
  await test(13, 'Verify only selected Section B students are allocated (no spillover)', async () => {
    const createRes = await fetch(`${BASE_URL}/exams`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        examName: 'Section B Mid-Term Exam',
        academicYear: '2026-2027',
        department: 'Computer Science and Engineering',
        year: 'IV Year',
        semester: 'I Semester',
        section: 'B',
        subjectName: 'Data Structures & Algorithms',
        subjectCode: `DS-B-${Date.now().toString().slice(-4)}`,
        examDate: '2026-12-20',
        session: 'FN',
        classroomId: classroomId,
        rosterId: sectionBRosterId,
      }),
    });
    const createData = await createRes.json();
    const secBExamId = createData.data._id;

    // Allocate
    const allocRes = await fetch(`${BASE_URL}/exams/${secBExamId}/allocate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const allocData = await allocRes.json();
    assert.strictEqual(allocRes.status, 201);
    assert.strictEqual(allocData.data.students.length, 72);

    // Ensure all 72 students have prefix 24091A06 (Section B), none from Section A or C
    allocData.data.students.forEach(s => {
      assert(s.registrationNumber.startsWith('24091A06'), `Unexpected student ${s.registrationNumber} allocated in Section B`);
    });
  });

  // TEST 14: Verify report downloads work after allocation is saved
  await test(14, 'Verify report downloads work seamlessly after allocation is saved', async () => {
    const masterPdfRes = await fetch(`${BASE_URL}/exams/${unit2ExamId}/reports/master-pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(masterPdfRes.status, 200, 'Master PDF download must succeed with 200');

    const excelRes = await fetch(`${BASE_URL}/exams/${unit2ExamId}/reports/excel`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(excelRes.status, 200, 'Excel report download must succeed with 200');
  });

  // TEST 15: Verify previous locked examinations remain unchanged
  await test(15, 'Verify previously locked Unit 1 examination allocation is strictly immutable', async () => {
    const u1Res = await fetch(`${BASE_URL}/exams/${unit1ExamId}/allocation`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const u1Data = await u1Res.json();
    assert.strictEqual(u1Data.data.status, 'LOCKED');
    assert.strictEqual(u1Data.data.randomSeed, unit1Allocation.randomSeed, 'Unit 1 seed must remain completely unchanged');
    assert.strictEqual(u1Data.data.version, unit1Allocation.version);

    // Verify student seat assignments in Unit 1 match original snapshot
    const originalSeatMap = new Map();
    unit1Allocation.students.forEach(s => originalSeatMap.set(s.registrationNumber, s.seatId));

    u1Data.data.students.forEach(s => {
      assert.strictEqual(s.seatId, originalSeatMap.get(s.registrationNumber), `Unit 1 seat changed for ${s.registrationNumber}`);
    });
  });

  console.log('\n================================================================');
  console.log(`  15-POINT AUDIT RESULT: ${passed} Passed, ${failed} Failed`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
}

runMultiUnitAudit().catch(err => {
  console.error('[Fatal Error]', err);
  process.exit(1);
});
