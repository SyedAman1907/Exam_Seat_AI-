const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ExcelJS = require('exceljs');

const BASE_URL = 'http://localhost:5000/api';

async function runE2EAudit() {
  console.log('\n================================================================');
  console.log('       EXAMSEAT AI — END-TO-END PRODUCTION AUDIT SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  async function step(stepNumber, description, fn) {
    process.stdout.write(`Step ${stepNumber}: ${description}... `);
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

  let authToken = '';
  let classroomId = '';
  let examId = '';
  let version1Allocation = null;
  let version2Allocation = null;

  // 1. Authenticate Admin
  await step(1, 'Admin Authentication (POST /api/auth/login)', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@rgmcet.edu.in',
        password: 'AdminExam@2026',
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert(data.success, 'Login failed');
    assert(data.token, 'Token not received');
    authToken = data.token;
  });

  // 2. Classroom Verification
  await step(2, 'Classroom Layout Verification (GET /api/classrooms)', async () => {
    const res = await fetch(`${BASE_URL}/classrooms`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert(data.data.length > 0, 'No classroom configured');
    const hall = data.data.find(c => c.totalCapacity === 72) || data.data[0];
    assert.strictEqual(hall.totalCapacity, 72, `Expected 72 seats, found ${hall.totalCapacity}`);
    assert.strictEqual(hall.availableCapacity, 72, `Expected 72 available seats, found ${hall.availableCapacity}`);
    classroomId = hall._id;
  });

  // 3. Create Examination
  const testSubjectCode = `AUDIT-${Date.now().toString().slice(-4)}`;
  await step(3, 'Create New Examination (POST /api/exams)', async () => {
    const res = await fetch(`${BASE_URL}/exams`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        examName: 'Autonomous End-Semester Examination',
        academicYear: '2026-2027',
        department: 'Computer Science and Engineering',
        year: 'IV Year',
        semester: 'I Semester',
        section: 'A',
        subjectName: 'Advanced Distributed Systems',
        subjectCode: testSubjectCode,
        examDate: '2026-11-28',
        session: 'FN',
        classroomId: classroomId,
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(data)}`);
    assert(data.success);
    assert(data.data._id);
    examId = data.data._id;
  });

  // 4. Duplicate Examination Prevention
  await step(4, 'Prevent Duplicate Examination Scheduling (409 Conflict)', async () => {
    const res = await fetch(`${BASE_URL}/exams`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        examName: 'Autonomous End-Semester Examination Duplicate',
        academicYear: '2026-2027',
        department: 'Computer Science and Engineering',
        year: 'IV Year',
        semester: 'I Semester',
        section: 'A',
        subjectName: 'Advanced Distributed Systems',
        subjectCode: testSubjectCode,
        examDate: '2026-11-28',
        session: 'FN',
        classroomId: classroomId,
      }),
    });
    assert.strictEqual(res.status, 409, `Expected 409 Conflict, got ${res.status}`);
  });

  // 5. Student Data Import Preview (72 students from sample CSV)
  let extractedRecords = [];
  await step(5, 'Upload & Parse Student Data (POST /api/students/import-preview)', async () => {
    const csvPath = path.join(__dirname, '../../sample-data/sample-students-72.csv');
    assert(fs.existsSync(csvPath), `Sample CSV missing at ${csvPath}`);
    const fileBuffer = fs.readFileSync(csvPath);

    // Build multipart/form-data boundary
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    let body = `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="examId"\r\n\r\n${examId}\r\n`;
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="file"; filename="sample-students-72.csv"\r\n`;
    body += `Content-Type: text/csv\r\n\r\n`;

    const preamble = Buffer.from(body, 'utf-8');
    const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
    const fullBody = Buffer.concat([preamble, fileBuffer, epilogue]);

    const res = await fetch(`${BASE_URL}/students/import-preview`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: fullBody,
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${data.message}`);
    assert(data.success);
    assert.strictEqual(data.data.records.length, 72, `Expected 72 records, got ${data.data.records.length}`);
    assert.strictEqual(data.data.summary.validCount, 72, `Expected 72 valid records`);
    assert.strictEqual(data.data.summary.duplicateCount, 0, `Expected 0 duplicates`);
    assert.strictEqual(data.data.summary.missingNameCount, 0, `Expected 0 missing names`);
    extractedRecords = data.data.records;
  });

  // 6. Confirm 72 Students to Database
  await step(6, 'Confirm & Insert 72 Students to MongoDB (POST /api/students/confirm)', async () => {
    const res = await fetch(`${BASE_URL}/students/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        examId,
        students: extractedRecords,
        replaceExisting: true,
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert.strictEqual(data.count, 72, `Expected 72 confirmed students`);
  });

  // 7. Verify MongoDB Student Persistence
  await step(7, 'Verify MongoDB Student Records (GET /api/exams/:id/students)', async () => {
    const res = await fetch(`${BASE_URL}/exams/${examId}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.data.studentCount, 72, `Expected studentCount 72 in exam`);
  });

  // 8. Generate Initial Allocation (Version 1)
  await step(8, 'Generate Initial Allocation Engine (POST /api/exams/:id/allocate)', async () => {
    const res = await fetch(`${BASE_URL}/exams/${examId}/allocate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const data = await res.json();
    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}: ${data.message}`);
    assert(data.success);
    version1Allocation = data.data;
    assert.strictEqual(version1Allocation.version, 1);
    assert.strictEqual(version1Allocation.totalOccupiedSeats, 72);
  });

  // 9. Verify Seating Constraints (Unique Seats, 24/24/24 Balance, Adjacency)
  await step(9, 'Audit Seating Constraints (Unique Seats, Balanced 24/24/24, Adjacency)', async () => {
    const students = version1Allocation.students;
    assert.strictEqual(students.length, 72);

    // Rule 1: Every student gets exactly one unique seat
    const studentRegs = new Set();
    const assignedSeats = new Set();
    students.forEach(s => {
      assert(!studentRegs.has(s.registrationNumber), `Duplicate student ${s.registrationNumber}`);
      assert(!assignedSeats.has(s.seatId), `Double-booked seat ${s.seatId}`);
      studentRegs.add(s.registrationNumber);
      assignedSeats.add(s.seatId);
    });
    assert.strictEqual(studentRegs.size, 72);
    assert.strictEqual(assignedSeats.size, 72);

    // Rule 2: Set A, B, C balanced distribution (24 each)
    const dist = version1Allocation.setDistribution;
    assert.strictEqual(dist.A, 24, `Set A must be 24, got ${dist.A}`);
    assert.strictEqual(dist.B, 24, `Set B must be 24, got ${dist.B}`);
    assert.strictEqual(dist.C, 24, `Set C must be 24, got ${dist.C}`);

    // Rule 3: STRICT BENCH ADJACENCY RULE
    // No two adjacent students on the same bench have the same set
    const benchMap = {};
    students.forEach(s => {
      const key = `${s.rowNumber}-${s.benchNumber}`;
      if (!benchMap[key]) benchMap[key] = [];
      benchMap[key].push(s);
    });

    Object.keys(benchMap).forEach(key => {
      const benchSeats = benchMap[key].sort((a, b) => a.seatNumber - b.seatNumber);
      for (let i = 0; i < benchSeats.length - 1; i++) {
        const s1 = benchSeats[i];
        const s2 = benchSeats[i + 1];
        assert.notStrictEqual(
          s1.questionPaperSet,
          s2.questionPaperSet,
          `Adjacency violation at ${key}: Seat ${s1.seatNumber} (${s1.questionPaperSet}) and Seat ${s2.seatNumber} (${s2.questionPaperSet}) have identical sets!`
        );
      }
    });
  });

  // 10. Regeneration Test (Creates Version 2 with new permutation)
  await step(10, 'Regeneration Creates Genuinely New Allocation Version (POST /api/exams/:id/regenerate)', async () => {
    const res = await fetch(`${BASE_URL}/exams/${examId}/regenerate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const data = await res.json();
    assert.strictEqual(res.status, 201);
    version2Allocation = data.data;
    assert.strictEqual(version2Allocation.version, 2, 'Expected version 2');
    assert.notStrictEqual(version1Allocation.randomSeed, version2Allocation.randomSeed, 'Seed must be different');

    // Check that arrangement is genuinely new (not identical ordering of students)
    const seatsV1 = version1Allocation.students.map(s => s.seatId).join(',');
    const seatsV2 = version2Allocation.students.map(s => s.seatId).join(',');
    const regV1 = version1Allocation.students.map(s => s.registrationNumber).join(',');
    const regV2 = version2Allocation.students.map(s => s.registrationNumber).join(',');
    assert.notStrictEqual(regV1, regV2, 'Shuffled student order must differ between regenerations');

    // Verify V2 also satisfies adjacency and 24/24/24 balance
    assert.strictEqual(version2Allocation.setDistribution.A, 24);
    assert.strictEqual(version2Allocation.setDistribution.B, 24);
    assert.strictEqual(version2Allocation.setDistribution.C, 24);
  });

  // 11. Lock Allocation & Protection Against Accidental Modification
  await step(11, 'Lock Allocation & Prevent Modification (POST /api/exams/:id/lock)', async () => {
    const res = await fetch(`${BASE_URL}/exams/${examId}/lock`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.data.status, 'LOCKED');

    // Attempt to regenerate while locked -> MUST FAIL WITH 400
    const regenAttempt = await fetch(`${BASE_URL}/exams/${examId}/regenerate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.strictEqual(regenAttempt.status, 400, 'Regeneration on locked allocation must be rejected with 400');
  });

  // 12. Approve & Publish Allocation for Student Portal
  await step(12, 'Approve & Publish Allocation (POST /api/exams/:id/publish)', async () => {
    await fetch(`${BASE_URL}/exams/${examId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await fetch(`${BASE_URL}/exams/${examId}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.data.status, 'PUBLISHED');
  });

  // 13. Student Portal Seat Lookup (Rate-Limited, Privacy-Safe)
  await step(13, 'Student Portal Lookup (POST /api/student/lookup)', async () => {
    // 13a. Lookup valid student
    const testRegNo = '24091A0501';
    const res = await fetch(`${BASE_URL}/student/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationNumber: testRegNo, examId }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert(data.success);
    assert.strictEqual(data.data.registrationNumber, testRegNo);
    assert(data.data.row, 'Missing row in student result');
    assert(data.data.bench, 'Missing bench in student result');
    assert(data.data.seatNumber, 'Missing seat number');
    assert(['A', 'B', 'C'].includes(data.data.questionPaperSet), 'Missing or invalid set');
    // Ensure privacy: no full roster returned
    assert.strictEqual(data.data.allStudents, undefined, 'Must not leak roster in student lookup');

    // 13b. Lookup nonexistent student -> 404
    const resInvalid = await fetch(`${BASE_URL}/student/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationNumber: '24091A9999', examId }),
    });
    assert.strictEqual(resInvalid.status, 404, 'Nonexistent student must return 404');
  });

  // 14. Report 1: Master Student Allocation PDF
  await step(14, 'PDF 1 — Master Student Allocation (GET /reports/master-pdf)', async () => {
    const res = await fetch(`${BASE_URL}/exams/${examId}/reports/master-pdf`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
    const buffer = Buffer.from(await res.arrayBuffer());
    assert(buffer.length > 5000, `PDF size suspiciously small: ${buffer.length} bytes`);
    assert.strictEqual(buffer.slice(0, 4).toString(), '%PDF', 'Must start with PDF header %PDF-');
  });

  // 15. Report 2: Attendance & Signature Sheet PDF
  await step(15, 'PDF 2 — Attendance & Signature Sheet (GET /reports/signature-pdf)', async () => {
    const res = await fetch(`${BASE_URL}/exams/${examId}/reports/signature-pdf`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
    const buffer = Buffer.from(await res.arrayBuffer());
    assert(buffer.length > 5000);
    assert.strictEqual(buffer.slice(0, 4).toString(), '%PDF');
  });

  // 16. Report 3: Classroom Seating Chart PDF (Landscape)
  await step(16, 'PDF 3 — Classroom Seating Chart (GET /reports/seating-pdf)', async () => {
    const res = await fetch(`${BASE_URL}/exams/${examId}/reports/seating-pdf`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
    const buffer = Buffer.from(await res.arrayBuffer());
    assert(buffer.length > 2000, `PDF size suspiciously small: ${buffer.length} bytes`);
    assert.strictEqual(buffer.slice(0, 4).toString(), '%PDF');
  });

  // 17. Report 4: Multi-Tab Excel Workbook
  await step(17, 'Excel Report — Multi-Tab & Filterable (GET /reports/excel)', async () => {
    const res = await fetch(`${BASE_URL}/exams/${examId}/reports/excel`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.strictEqual(res.status, 200);
    const buffer = Buffer.from(await res.arrayBuffer());
    assert(buffer.length > 3000, 'Excel file too small');

    // Parse with ExcelJS to audit workbook structure
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    // Verify 4 sheets exist
    const sheetNames = workbook.worksheets.map(w => w.name);
    assert(sheetNames.includes('Master Allocation'), 'Missing Master Allocation sheet');
    assert(sheetNames.includes('Set A Students'), 'Missing Set A sheet');
    assert(sheetNames.includes('Set B Students'), 'Missing Set B sheet');
    assert(sheetNames.includes('Set C Students'), 'Missing Set C sheet');

    // Verify Master sheet row count & auto-filter
    const masterSheet = workbook.getWorksheet('Master Allocation');
    assert(masterSheet.rowCount >= 77, `Expected at least 77 rows (5 header + 72 data), got ${masterSheet.rowCount}`);
    assert(masterSheet.autoFilter, 'Auto-filter must be configured on Master Allocation sheet');

    // Verify Set A sheet has 24 students
    const setASheet = workbook.getWorksheet('Set A Students');
    assert.strictEqual(setASheet.rowCount, 29, `Expected 29 rows in Set A (5 header + 24 students), got ${setASheet.rowCount}`);
  });

  // 18. Dashboard Statistics
  await step(18, 'Dashboard Statistics Audit (GET /dashboard/stats)', async () => {
    const res = await fetch(`${BASE_URL}/dashboard/stats`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert(data.data.totalStudents >= 72);
    assert(data.data.totalExaminations >= 1);
    assert(data.data.totalAllocations >= 1);
    assert(data.data.totalClassrooms >= 1);
  });

  console.log('\n================================================================');
  console.log(`     AUDIT COMPLETE: ${passed} Passed, ${failed} Failed`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runE2EAudit().catch(err => {
  console.error('[Fatal Audit Error]', err);
  process.exit(1);
});
