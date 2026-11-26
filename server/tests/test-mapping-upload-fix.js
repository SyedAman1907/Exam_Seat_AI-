const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const mongoose = require('mongoose');

const BASE_URL = 'http://localhost:5000/api';

async function generateSamplePdf(filePath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 30, size: 'A4' });
    const writeStream = fs.createWriteStream(filePath);

    doc.pipe(writeStream);

    doc.fontSize(16).text('RAJEEV GANDHI MEMORIAL COLLEGE OF ENGINEERING & TECHNOLOGY', { align: 'center' });
    doc.fontSize(12).text('DEPARTMENT OF COMPUTER SCIENCE AND ENGINEERING', { align: 'center' });
    doc.fontSize(10).text('Student Roster — Academic Year 2026-2027', { align: 'center' });
    doc.moveDown();

    doc.fontSize(10).text('S.No    Regd. No.       Student Name', { underline: true });
    doc.moveDown(0.5);

    const names = [
      'A. RAHUL', 'B. SNEHA', 'C. VIKRAM', 'D. ANANYA', 'E. KARTHIK',
      'F. DIVYA', 'G. MANOJ', 'H. POOJA', 'I. SAI TEJA', 'J. KAVYA'
    ];

    for (let i = 1; i <= 10; i++) {
      const regNo = `24091A05${String(i).padStart(2, '0')}`;
      const name = names[i - 1];
      doc.text(`${String(i).padEnd(8)}${regNo.padEnd(16)}${name}`);
    }

    doc.end();
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });
}

async function run() {
  console.log('===========================================================');
  console.log('  TESTING FACULTY MAPPING UPLOAD WORKFLOW & MULTER FIX');
  console.log('===========================================================\n');

  await mongoose.connect('mongodb://127.0.0.1:27017/examseat_ai');
  const FacultyMapping = require('../models/FacultyMapping');

  // 1. Authenticate as Admin
  console.log('1. Authenticating as Admin...');
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@rgmcet.edu.in', password: 'AdminExam@2026' }),
  });
  const loginData = await loginRes.json();
  if (!loginData.success || !loginData.token) {
    throw new Error('Admin login failed: ' + JSON.stringify(loginData));
  }
  const token = loginData.token;
  console.log('   ✓ Logged in successfully.\n');

  // 2. Prepare Sample PDF
  const testPdfPath = path.join(__dirname, 'test-roster.pdf');
  await generateSamplePdf(testPdfPath);
  console.log('2. Generated test student roster PDF: test-roster.pdf\n');

  // 3. Test: Unexpected field name produces friendly HTTP 400 (not raw crash)
  console.log('3. Testing Multer error handling with unexpected field name ("wrong_field")...');
  const wrongFormData = new FormData();
  const pdfBlob1 = new Blob([fs.readFileSync(testPdfPath)], { type: 'application/pdf' });
  wrongFormData.append('wrong_field', pdfBlob1, 'test-roster.pdf');

  const wrongRes = await fetch(`${BASE_URL}/mappings/upload-preview`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: wrongFormData,
  });
  const wrongData = await wrongRes.json();
  if (wrongRes.status === 400 && wrongData.message.includes("Unexpected upload field 'wrong_field'")) {
    console.log(`   ✓ Received user-friendly error: "${wrongData.message}"`);
  } else {
    throw new Error(`Unexpected behavior for invalid field: status=${wrongRes.status}, data=${JSON.stringify(wrongData)}`);
  }
  console.log();

  // 4. Test: Invalid file type (.txt) produces friendly HTTP 400
  console.log('4. Testing fileFilter rejection for non-PDF file (.txt)...');
  const txtFormData = new FormData();
  const txtBlob = new Blob(['Not a PDF file content'], { type: 'text/plain' });
  txtFormData.append('file', txtBlob, 'invalid-roster.txt');

  const txtRes = await fetch(`${BASE_URL}/mappings/upload-preview`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: txtFormData,
  });
  const txtData = await txtRes.json();
  if (txtRes.status === 400 && txtData.message.includes('Only PDF documents are accepted')) {
    console.log(`   ✓ Received user-friendly rejection: "${txtData.message}"`);
  } else {
    throw new Error(`FileFilter failed: status=${txtRes.status}, data=${JSON.stringify(txtData)}`);
  }
  console.log();

  // 5. Test: Missing file produces HTTP 400
  console.log('5. Testing upload without file...');
  const emptyFormData = new FormData();
  emptyFormData.append('subjectName', 'CNIP');

  const emptyRes = await fetch(`${BASE_URL}/mappings/upload-preview`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: emptyFormData,
  });
  const emptyData = await emptyRes.json();
  if (emptyRes.status === 400 && emptyData.message.includes('upload a student roster PDF')) {
    console.log(`   ✓ Received friendly validation: "${emptyData.message}"`);
  } else {
    throw new Error(`Empty file check failed: status=${emptyRes.status}, data=${JSON.stringify(emptyData)}`);
  }
  console.log();

  // 6. Test: Valid Upload with field name 'file' -> Extract & Preview Students
  console.log('6. Testing standard upload with field name "file" (Extract & Preview)...');
  const validFormData = new FormData();
  const pdfBlobValid = new Blob([fs.readFileSync(testPdfPath)], { type: 'application/pdf' });
  validFormData.append('file', pdfBlobValid, 'test-roster.pdf');
  validFormData.append('facultyName', 'Dr. K. Subba Rao');
  validFormData.append('subjectName', 'CNIP');
  validFormData.append('subjectCode', '20A05502T');
  validFormData.append('section', 'A1');

  const validRes = await fetch(`${BASE_URL}/mappings/upload-preview`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: validFormData,
  });
  const validData = await validRes.json();
  if (!validData.success) {
    throw new Error('Upload preview failed: ' + JSON.stringify(validData));
  }

  const students = validData.students || validData.data?.students;
  if (!students || students.length === 0) {
    throw new Error('Zero students extracted from PDF: ' + JSON.stringify(validData));
  }
  console.log(`   ✓ Successfully extracted ${students.length} students!`);
  console.log(`   Sample extracted student: Reg: ${students[0].registrationNumber}, Name: ${students[0].studentName}`);
  console.log();

  // 7. Test: Confirm and Permanently Save Mapping (Version 1)
  console.log('7. Testing Confirm & Permanently Save Mapping (Version 1)...');
  // Clean up any test mapping for 20A05502T / A1 first
  await FacultyMapping.deleteMany({ subjectCode: '20A05502T', section: 'A1' });

  const confirmPayload = {
    facultyName: 'Dr. K. Subba Rao',
    subjectName: 'CNIP',
    subjectCode: '20A05502T',
    section: 'A1',
    replaceExisting: true,
    students: students.map((s, idx) => ({
      sNo: idx + 1,
      registrationNumber: s.registrationNumber,
      studentName: s.studentName,
    })),
  };

  const confirmRes = await fetch(`${BASE_URL}/mappings/confirm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(confirmPayload),
  });
  const confirmData = await confirmRes.json();
  if (!confirmData.success) {
    throw new Error('Confirm mapping failed: ' + JSON.stringify(confirmData));
  }
  const savedMappingV1 = await FacultyMapping.findOne({ subjectCode: '20A05502T', section: 'A1', isCurrent: true });
  if (!savedMappingV1 || savedMappingV1.version !== 1) {
    throw new Error(`Version 1 mapping check failed: version=${savedMappingV1?.version}`);
  }
  console.log(`   ✓ Version 1 mapping saved in MongoDB (ID: ${savedMappingV1._id}, Version: ${savedMappingV1.version}, Students: ${savedMappingV1.studentCount})`);
  console.log();

  // 8. Test: Replace Existing Mapping (Version 2 Workflow)
  console.log('8. Testing Version Replacement Workflow (Version 2)...');
  confirmPayload.facultyName = 'Dr. K. Subba Rao (Updated)';
  confirmPayload.replaceExisting = true;

  const replaceRes = await fetch(`${BASE_URL}/mappings/confirm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(confirmPayload),
  });
  const replaceData = await replaceRes.json();
  if (!replaceData.success) {
    throw new Error('Replace mapping failed: ' + JSON.stringify(replaceData));
  }

  const allVersions = await FacultyMapping.find({ subjectCode: '20A05502T', section: 'A1' }).sort({ version: 1 });
  if (allVersions.length !== 2) {
    throw new Error(`Expected 2 mapping versions, found: ${allVersions.length}`);
  }
  const v1 = allVersions.find(v => v.version === 1);
  const v2 = allVersions.find(v => v.version === 2);

  if (v1.isCurrent !== false) throw new Error('Version 1 should be marked isCurrent: false');
  if (v2.isCurrent !== true) throw new Error('Version 2 should be marked isCurrent: true');
  console.log(`   ✓ Version 1 archived (isCurrent: ${v1.isCurrent})`);
  console.log(`   ✓ Version 2 active (isCurrent: ${v2.isCurrent}, Faculty: "${v2.facultyName}")`);
  console.log();

  // Clean up test file and test database entries
  if (fs.existsSync(testPdfPath)) fs.unlinkSync(testPdfPath);
  await FacultyMapping.deleteMany({ subjectCode: '20A05502T', section: 'A1' });
  await mongoose.disconnect();

  console.log('===========================================================');
  console.log('  ALL UPLOAD & MULTER WORKFLOW TESTS PASSED SUCCESSFULLY!  ');
  console.log('===========================================================');
}

run().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
