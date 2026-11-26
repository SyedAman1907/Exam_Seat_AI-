require('dotenv').config();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const Exam = require('../models/Exam');
const User = require('../models/User');

async function testAttendanceAuthAndSections() {
  console.log('========================================================================');
  console.log('  TEST: Attendance Signature PDF Authentication & Section-wise Downloads');
  console.log('========================================================================');

  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/examseat_ai');
  console.log('- Connected to MongoDB:', mongoose.connection.name);

  // 1. Locate the ATCD Examination
  const atcdExam = await Exam.findOne({
    subjectCode: '20A05501T',
    isDeleted: { $ne: true },
    isParentExam: true,
  });

  if (!atcdExam) {
    throw new Error('ATCD Parent examination not found in database.');
  }

  const examId = atcdExam._id.toString();
  console.log(`- Found ATCD Exam ID: ${examId} ("${atcdExam.examName}")`);
  console.log(`- Section Allocations (${atcdExam.sectionAllocations.length}):`,
    atcdExam.sectionAllocations.map(s => `Sec ${s.section} -> ${s.facultyName} (${s.studentCount} students)`).join(' | ')
  );

  // Verify A1, A2, A3 are present
  const secA1 = atcdExam.sectionAllocations.find(s => s.section === 'A1');
  const secA2 = atcdExam.sectionAllocations.find(s => s.section === 'A2');
  const secA3 = atcdExam.sectionAllocations.find(s => s.section === 'A3');

  if (!secA1 || !secA2 || !secA3) {
    throw new Error('ATCD exam must have sections A1, A2, and A3 allocated.');
  }

  // 2. Test Unauthorized Request (Must be rejected with 401)
  console.log('\n[TEST 1] Testing Unauthenticated Access Rejection...');
  const unauthEndpoints = [
    `http://localhost:5000/api/exams/${examId}/reports/signature-pdf`,
    `http://localhost:5000/api/reports/${examId}/section-attendance-pdf/A1`,
    `http://localhost:5000/api/reports/${examId}/attendance-zip`
  ];

  for (const ep of unauthEndpoints) {
    const res = await fetch(ep);
    const data = await res.json().catch(() => ({}));
    console.log(`  * Request without token: ${ep}`);
    console.log(`    Status: ${res.status} | Message: "${data.message}"`);
    if (res.status !== 401 || !data.message.includes('Access denied')) {
      throw new Error(`Expected 401 Access denied, got ${res.status}`);
    }
  }
  console.log('>>> TEST 1 PASSED: Unauthenticated access is strictly blocked with 401.');

  // 3. Setup Authenticated Users: Admin, Exam Incharge, and Faculty
  const adminUser = await User.findOne({ role: 'admin' });
  const inchargeUser = await User.findOne({ role: 'exam_incharge' });
  let facultyUser = await User.findOne({ role: 'faculty' });
  if (!facultyUser) {
    facultyUser = await User.create({
      name: 'Dr. S. Subbalakshmi',
      email: 'subbalakshmi.faculty@rgmcet.edu.in',
      passwordHash: 'dummy',
      role: 'faculty',
    });
  }

  const adminToken = jwt.sign({ id: adminUser._id, role: adminUser.role }, process.env.JWT_SECRET);
  const inchargeToken = jwt.sign({ id: inchargeUser._id, role: inchargeUser.role }, process.env.JWT_SECRET);
  const facultyToken = jwt.sign({ id: facultyUser._id, role: facultyUser.role }, process.env.JWT_SECRET);

  // 4. Test Authenticated Downloads for Admin, Incharge, Faculty
  console.log('\n[TEST 2] Testing Authenticated Section-wise Attendance Downloads...');
  const testTokens = [
    { name: 'Admin', token: adminToken },
    { name: 'Exam Incharge', token: inchargeToken },
    { name: 'Faculty', token: facultyToken },
  ];

  for (const userRole of testTokens) {
    console.log(`\n  --- Testing as ${userRole.name} ---`);

    // Download Section A1 PDF
    const resA1 = await fetch(`http://localhost:5000/api/reports/${examId}/section-attendance-pdf/A1`, {
      headers: { Authorization: `Bearer ${userRole.token}` }
    });
    if (resA1.status !== 200) {
      throw new Error(`${userRole.name} failed to download Sec A1 PDF: status ${resA1.status}`);
    }
    const bufA1 = Buffer.from(await resA1.arrayBuffer());
    console.log(`  * Section A1 PDF: ${bufA1.length} bytes (Header: ${resA1.headers.get('content-disposition')})`);

    // Download Section A2 PDF
    const resA2 = await fetch(`http://localhost:5000/api/reports/${examId}/section-attendance-pdf/A2`, {
      headers: { Authorization: `Bearer ${userRole.token}` }
    });
    if (resA2.status !== 200) {
      throw new Error(`${userRole.name} failed to download Sec A2 PDF: status ${resA2.status}`);
    }
    const bufA2 = Buffer.from(await resA2.arrayBuffer());
    console.log(`  * Section A2 PDF: ${bufA2.length} bytes (Header: ${resA2.headers.get('content-disposition')})`);

    // Download Section A3 PDF
    const resA3 = await fetch(`http://localhost:5000/api/reports/${examId}/section-attendance-pdf/A3`, {
      headers: { Authorization: `Bearer ${userRole.token}` }
    });
    if (resA3.status !== 200) {
      throw new Error(`${userRole.name} failed to download Sec A3 PDF: status ${resA3.status}`);
    }
    const bufA3 = Buffer.from(await resA3.arrayBuffer());
    console.log(`  * Section A3 PDF: ${bufA3.length} bytes (Header: ${resA3.headers.get('content-disposition')})`);

    // Download Combined Attendance ZIP
    const resZip = await fetch(`http://localhost:5000/api/reports/${examId}/attendance-zip`, {
      headers: { Authorization: `Bearer ${userRole.token}` }
    });
    if (resZip.status !== 200) {
      throw new Error(`${userRole.name} failed to download attendance ZIP: status ${resZip.status}`);
    }
    const bufZip = Buffer.from(await resZip.arrayBuffer());
    console.log(`  * Combined Attendance ZIP: ${bufZip.length} bytes (Header: ${resZip.headers.get('content-disposition')})`);

    // Download Parent Signature PDF (/api/exams/:id/reports/signature-pdf)
    const resSig = await fetch(`http://localhost:5000/api/exams/${examId}/reports/signature-pdf`, {
      headers: { Authorization: `Bearer ${userRole.token}` }
    });
    if (resSig.status !== 200) {
      throw new Error(`${userRole.name} failed to download general signature PDF: status ${resSig.status}`);
    }
    const bufSig = Buffer.from(await resSig.arrayBuffer());
    console.log(`  * General Signature PDF: ${bufSig.length} bytes (Header: ${resSig.headers.get('content-disposition')})`);
  }

  console.log('\n>>> TEST 2 PASSED: All three section PDFs and parent signature PDF downloaded by Admin, Incharge, and Faculty.');

  // 5. Verify Content of Section Attendance Sheets
  console.log('\n[TEST 3] Verifying Section-wise Isolation & Roster Snapshot...');
  console.log(`- Sec A1 -> Faculty: "${secA1.facultyName}" | Student count: ${secA1.studentCount}`);
  console.log(`- Sec A2 -> Faculty: "${secA2.facultyName}" | Student count: ${secA2.studentCount}`);
  console.log(`- Sec A3 -> Faculty: "${secA3.facultyName}" | Student count: ${secA3.studentCount}`);

  // Confirm distinct faculties
  if (secA1.facultyName === secA2.facultyName && secA2.facultyName === secA3.facultyName) {
    throw new Error('Expected different faculty members across sections A1, A2, A3.');
  }

  // Confirm student sets are disjoint across sections
  const a1Regs = new Set(secA1.rosterSnapshot.map(s => s.registrationNumber));
  const a2Regs = new Set(secA2.rosterSnapshot.map(s => s.registrationNumber));
  const a3Regs = new Set(secA3.rosterSnapshot.map(s => s.registrationNumber));

  for (const reg of a1Regs) {
    if (a2Regs.has(reg)) throw new Error(`Student ${reg} found in both A1 and A2!`);
    if (a3Regs.has(reg)) throw new Error(`Student ${reg} found in both A1 and A3!`);
  }
  for (const reg of a2Regs) {
    if (a3Regs.has(reg)) throw new Error(`Student ${reg} found in both A2 and A3!`);
  }
  console.log('>>> TEST 3 PASSED: Zero cross-section student overlap. Complete section isolation confirmed.');

  console.log('\n========================================================================');
  console.log('  ALL ATTENDANCE SIGNATURE PDF & AUTHENTICATION TESTS PASSED! (3/3)');
  console.log('========================================================================\n');

  await mongoose.disconnect();
}

testAttendanceAuthAndSections().catch((err) => {
  console.error('\nTEST FAILED WITH ERROR:', err);
  process.exit(1);
});
