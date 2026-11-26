const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ReportService = require('../services/reportService');

const BASE_URL = 'http://localhost:5000/api';

async function runPaginationAudit() {
  console.log('\n======================================================');
  console.log('  EXAMSEAT AI — PDF PAGINATION & ASSETS MASTER AUDIT');
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

  // 1. Verify Favicon Assets
  await test('1. Verify all 5 favicon and browser identity assets exist', async () => {
    const pubDir = path.join(__dirname, '../../client/public');
    const requiredFiles = [
      'favicon.ico',
      'favicon.svg',
      'favicon-16x16.png',
      'favicon-32x32.png',
      'apple-touch-icon.png',
    ];
    for (const f of requiredFiles) {
      const p = path.join(pubDir, f);
      assert(fs.existsSync(p), `Missing asset: ${f}`);
      const stats = fs.statSync(p);
      assert(stats.size > 500, `Asset ${f} size is suspiciously small: ${stats.size}`);
    }
  });

  // 2. Verify HTML Metadata in index.html
  await test('2. Verify HTML metadata, tab title and favicon links in index.html', async () => {
    const htmlPath = path.join(__dirname, '../../client/index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');
    assert(html.includes('<title>ExamSeat AI | RGMCET CSE</title>'));
    assert(html.includes('href="/favicon.ico"'));
    assert(html.includes('href="/favicon.svg"'));
    assert(html.includes('href="/apple-touch-icon.png"'));
    assert(html.includes('name="theme-color"'));
    assert(html.includes('property="og:title"'));
  });

  // Helper to build test allocation
  function makeExamAndAllocation(count) {
    const students = [];
    for (let i = 1; i <= count; i++) {
      students.push({
        registrationNumber: '24091A05' + String(i).padStart(2, '0'),
        name: `Student Name ${i}`,
        questionPaperSet: ['A', 'B', 'C'][(i - 1) % 3],
        rowNumber: Math.ceil(i / 12),
        benchNumber: Math.ceil(((i - 1) % 12 + 1) / 3),
        seatNumber: ((i - 1) % 3) + 1,
        seatId: `R${Math.ceil(i / 12)}-B${Math.ceil(((i - 1) % 12 + 1) / 3)}-S${((i - 1) % 3) + 1}`,
      });
    }

    const exam = {
      examName: 'Unit Examination I',
      subjectName: 'CNIP',
      subjectCode: 'CS401',
      academicYear: '2026-2027',
      year: 'IV Year',
      semester: 'I Semester',
      section: 'A',
      examDate: '2026-11-07',
      session: 'FN',
      department: 'Computer Science and Engineering',
      totalStudents: count,
    };

    const allocation = {
      students,
      setDistribution: {
        A: Math.floor(count / 3),
        B: Math.floor(count / 3),
        C: count - 2 * Math.floor(count / 3),
      },
    };

    const classroom = { name: 'Main Examination Hall A-101', roomNumber: 'A-101' };
    return { exam, allocation, classroom };
  }

  function countPages(pdfBuffer) {
    const str = pdfBuffer.toString('latin1');
    const matches = str.match(/\/Type\s*\/Page[^s]/g) || [];
    return matches.length;
  }

  // 3. Test 72 students Attendance PDF generates EXACTLY 3 pages
  await test('3. Attendance PDF for 72 students generates EXACTLY 3 pages (was previously 8)', async () => {
    const { exam, allocation, classroom } = makeExamAndAllocation(72);
    const buf = await ReportService.generateAttendancePDF(exam, allocation, classroom);
    assert.strictEqual(buf.slice(0, 4).toString(), '%PDF');
    const pages = countPages(buf);
    assert.strictEqual(pages, 3, `Expected exactly 3 pages for 72 students, got ${pages}`);
  });

  // 4. Test 30 students -> 2 pages
  await test('4. Attendance PDF for 30 students generates EXACTLY 2 pages', async () => {
    const { exam, allocation, classroom } = makeExamAndAllocation(30);
    const buf = await ReportService.generateAttendancePDF(exam, allocation, classroom);
    const pages = countPages(buf);
    assert.strictEqual(pages, 2, `Expected 2 pages for 30 students, got ${pages}`);
  });

  // 5. Test 53 students -> 3 pages
  await test('5. Attendance PDF for 53 students generates EXACTLY 3 pages', async () => {
    const { exam, allocation, classroom } = makeExamAndAllocation(53);
    const buf = await ReportService.generateAttendancePDF(exam, allocation, classroom);
    const pages = countPages(buf);
    assert.strictEqual(pages, 3, `Expected 3 pages for 53 students, got ${pages}`);
  });

  // 6. Test 100 students -> 4 pages
  await test('6. Attendance PDF for 100 students generates EXACTLY 4 pages', async () => {
    const { exam, allocation, classroom } = makeExamAndAllocation(100);
    const buf = await ReportService.generateAttendancePDF(exam, allocation, classroom);
    const pages = countPages(buf);
    assert.strictEqual(pages, 4, `Expected 4 pages for 100 students, got ${pages}`);
  });

  // 7. Test 150 students -> 6 pages
  await test('7. Attendance PDF for 150 students generates EXACTLY 6 pages', async () => {
    const { exam, allocation, classroom } = makeExamAndAllocation(150);
    const buf = await ReportService.generateAttendancePDF(exam, allocation, classroom);
    const pages = countPages(buf);
    assert.strictEqual(pages, 6, `Expected 6 pages for 150 students, got ${pages}`);
  });

  // 8. Test Master PDF for 72 students -> EXACTLY 3 pages
  await test('8. Master Allocation PDF for 72 students generates EXACTLY 3 pages', async () => {
    const { exam, allocation, classroom } = makeExamAndAllocation(72);
    const buf = await ReportService.generateMasterPDF(exam, allocation, classroom);
    const pages = countPages(buf);
    assert.strictEqual(pages, 3, `Expected exactly 3 pages for 72 students, got ${pages}`);
  });

  // 9. Verify Seating Blueprint PDF
  await test('9. Seating Layout Blueprint PDF generates clean 1-page landscape', async () => {
    const { exam, allocation, classroom } = makeExamAndAllocation(72);
    const buf = await ReportService.generateSeatingChartPDF(exam, allocation, classroom);
    const pages = countPages(buf);
    assert.strictEqual(pages, 1, `Expected 1 landscape page for 72-seat layout, got ${pages}`);
  });

  // 10. Verify Live HTTP API download of Attendance PDF
  await test('10. Live HTTP API download of Attendance PDF returns valid 3-page buffer', async () => {
    // Login
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@rgmcet.edu.in', password: 'AdminExam@2026' }),
    });
    const loginData = await loginRes.json();
    const token = loginData.token;

    // Get an existing exam
    const examsRes = await fetch(`${BASE_URL}/exams`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const examsData = await examsRes.json();
    assert(examsData.data.length > 0);
    const targetExam = examsData.data[0];

    const reportRes = await fetch(`${BASE_URL}/exams/${targetExam._id}/reports/signature-pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(reportRes.status, 200);
    assert.strictEqual(reportRes.headers.get('content-type'), 'application/pdf');
    const arrayBuf = await reportRes.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    assert(buf.length > 5000);
    const pages = countPages(buf);
    assert(pages <= 4, `Live exam signature PDF should fit within 3-4 pages, got ${pages}`);
  });

  console.log('\n======================================================');
  console.log(`  AUDIT COMPLETED: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');

  if (failed > 0) process.exit(1);
}

runPaginationAudit();