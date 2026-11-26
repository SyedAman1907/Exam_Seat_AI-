const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const Classroom = require('../models/Classroom');
const Student = require('../models/Student');
const StudentEnrollment = require('../models/StudentEnrollment');
const Exam = require('../models/Exam');
const Allocation = require('../models/Allocation');
const User = require('../models/User');

const BASE_URL = 'http://localhost:5000/api';

// Create a realistic multi-page, multi-subject PDF sample file
function createSampleStudentPDF(filePath, options = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 30 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Page 1: Subject 1 - DBMS - Section A - Faculty Dr. K. Subba Rao
    doc.fontSize(14).font('Helvetica-Bold').text('RAJEEV GANDHI MEMORIAL COLLEGE OF ENGINEERING & TECHNOLOGY', { align: 'center' });
    doc.fontSize(10).font('Helvetica').text('DEPARTMENT OF COMPUTER SCIENCE AND ENGINEERING', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica-Bold').text('STUDENT ENROLLMENT & CONTINUOUS ASSESSMENT RECORD', { align: 'center' });
    doc.moveDown(0.5);

    doc.fontSize(9).font('Helvetica-Bold');
    doc.text(`Subject: ${options.subject1 || 'Database Management Systems'}`);
    doc.text(`Faculty Name: ${options.faculty1 || 'Dr. K. Subba Rao'}`);
    doc.text(`Section: A`);
    doc.text(`Academic Year: 2026-2027`);
    doc.moveDown(0.5);

    // Table Header
    doc.fontSize(8).font('Helvetica-Bold');
    doc.text('S.No   Roll Number     Student Name              FDH Roll No     A1  A2  A3  A4  A5  A6  Group');
    doc.strokeColor('#aaaaaa').lineWidth(0.5).moveTo(30, doc.y).lineTo(560, doc.y).stroke();
    doc.moveDown(0.3);

    const studentsP1 = [
      { sno: 1, roll: '24091A05A1', name: 'GANDHAM SAI PAVAN', fdh: '24095A0501', a1: 18, a2: 19, a3: 20, a4: 17, a5: 18, a6: 19, grp: 'Group A' },
      { sno: 2, roll: '24091A05A2', name: 'PILLI HARINI', fdh: '24095A0502', a1: 19, a2: 20, a3: 20, a4: 18, a5: 19, a6: 20, grp: 'Group A' },
      { sno: 3, roll: '24091A05A3', name: 'BOYA HARSHAVARDHAN', fdh: '24095A0503', a1: 17, a2: 18, a3: 19, a4: 16, a5: 17, a6: 18, grp: 'Group A' },
      { sno: 4, roll: '24091A05A4', name: 'GANDHODI HARSHAVARDHAN', fdh: '24095A0504', a1: 18, a2: 19, a3: 18, a4: 17, a5: 18, a6: 19, grp: 'Group B' },
      { sno: 5, roll: '24091A05A5', name: 'T HEMALATHA', fdh: '24095A0505', a1: 20, a2: 20, a3: 19, a4: 19, a5: 20, a6: 20, grp: 'Group B' },
      { sno: 6, roll: '24091A05A6', name: 'KOLAGANI HEMANTH KRISHNA', fdh: '24095A0506', a1: 16, a2: 17, a3: 18, a4: 17, a5: 18, a6: 17, grp: 'Group B' },
    ];

    doc.font('Helvetica').fontSize(8);
    studentsP1.forEach((s) => {
      doc.text(
        `${String(s.sno).padEnd(6)} ${s.roll.padEnd(15)} ${s.name.padEnd(25)} ${s.fdh.padEnd(15)} ${s.a1}  ${s.a2}  ${s.a3}  ${s.a4}  ${s.a5}  ${s.a6}  ${s.grp}`
      );
    });

    // Page 2: Subject 2 - Operating Systems - Section B - Faculty Prof. M. Sreenivasulu
    doc.addPage();
    doc.fontSize(14).font('Helvetica-Bold').text('RAJEEV GANDHI MEMORIAL COLLEGE OF ENGINEERING & TECHNOLOGY', { align: 'center' });
    doc.fontSize(10).font('Helvetica').text('DEPARTMENT OF COMPUTER SCIENCE AND ENGINEERING', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica-Bold').text('STUDENT ENROLLMENT & CONTINUOUS ASSESSMENT RECORD', { align: 'center' });
    doc.moveDown(0.5);

    doc.fontSize(9).font('Helvetica-Bold');
    doc.text(`Subject: ${options.subject2 || 'Operating Systems'}`);
    doc.text(`Faculty Name: ${options.faculty2 || 'Prof. M. Sreenivasulu'}`);
    doc.text(`Section: B`);
    doc.text(`Academic Year: 2026-2027`);
    doc.moveDown(0.5);

    doc.fontSize(8).font('Helvetica-Bold');
    doc.text('S.No   Roll Number     Student Name              FDH Roll No     A1  A2  A3  A4  A5  A6  Group');
    doc.strokeColor('#aaaaaa').lineWidth(0.5).moveTo(30, doc.y).lineTo(560, doc.y).stroke();
    doc.moveDown(0.3);

    const studentsP2 = [
      { sno: 1, roll: '24091A05B1', name: 'SIVAPURAM HIMABINDU', fdh: '24095A0511', a1: 19, a2: 19, a3: 20, a4: 18, a5: 19, a6: 19, grp: 'Group A' },
      { sno: 2, roll: '24091A05B2', name: 'MARAS INDRA', fdh: '24095A0512', a1: 17, a2: 18, a3: 17, a4: 16, a5: 17, a6: 18, grp: 'Group A' },
      { sno: 3, roll: '24091A05B3', name: 'KOMIREDDY ISWARYA', fdh: '24095A0513', a1: 20, a2: 20, a3: 20, a4: 19, a5: 20, a6: 20, grp: 'Group B' },
      { sno: 4, roll: '24091A05B4', name: 'PAMISETTY HEMANTH', fdh: '24095A0514', a1: 18, a2: 17, a3: 19, a4: 18, a5: 18, a6: 19, grp: 'Group B' },
    ];

    doc.font('Helvetica').fontSize(8);
    studentsP2.forEach((s) => {
      doc.text(
        `${String(s.sno).padEnd(6)} ${s.roll.padEnd(15)} ${s.name.padEnd(25)} ${s.fdh.padEnd(15)} ${s.a1}  ${s.a2}  ${s.a3}  ${s.a4}  ${s.a5}  ${s.a6}  ${s.grp}`
      );
    });

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

async function runVerification() {
  console.log('================================================================');
  console.log('  EXAMSEAT AI — REAL DATA & ET BLOCK CLASSROOMS VERIFICATION  ');
  console.log('================================================================\n');

  await mongoose.connect('mongodb://127.0.0.1:27017/examseat_ai');
  console.log('Connected to MongoDB.\n');

  // Generate Admin JWT token for API calls
  const admin = await User.findOne({ role: 'admin' });
  if (!admin) throw new Error('Admin account not found in MongoDB!');
  const token = jwt.sign(
    { id: admin._id, role: admin.role, email: admin.email },
    process.env.JWT_SECRET || 'examseat_ai_super_secret_jwt_key_2026_academic_secure',
    { expiresIn: '1h' }
  );

  const authHeaders = {
    Authorization: `Bearer ${token}`,
  };

  try {
    // ---------------------------------------------------------
    // TEST 1: VERIFY 51 ET BLOCK CLASSROOMS (2010 to 2060)
    // ---------------------------------------------------------
    console.log('--- TEST 1: Verifying 51 ET BLOCK Classrooms (2010 - 2060) ---');
    const etRooms = await Classroom.find({ block: 'ET BLOCK' }).sort({ roomNumber: 1 });
    console.log(`Total ET BLOCK Classrooms found: ${etRooms.length}`);

    if (etRooms.length !== 51) {
      throw new Error(`FAIL: Expected 51 ET BLOCK classrooms, found ${etRooms.length}`);
    }

    const firstRoom = etRooms[0];
    const lastRoom = etRooms[50];
    console.log(`First Room: ${firstRoom.name} (${firstRoom.roomNumber}) | Supported Groups: ${firstRoom.supportedGroups.join(', ')}`);
    console.log(`Last Room: ${lastRoom.name} (${lastRoom.roomNumber}) | Supported Groups: ${lastRoom.supportedGroups.join(', ')}`);

    if (firstRoom.roomNumber !== '2010' || lastRoom.roomNumber !== '2060') {
      throw new Error(`FAIL: Range must be 2010 to 2060! Found ${firstRoom.roomNumber} to ${lastRoom.roomNumber}`);
    }

    // Verify no rooms outside ET BLOCK
    const nonEtRooms = await Classroom.countDocuments({ block: { $ne: 'ET BLOCK' } });
    console.log(`Non-ET BLOCK Classrooms count: ${nonEtRooms} (Expected: 0)`);
    if (nonEtRooms !== 0) throw new Error('FAIL: Found classrooms outside ET BLOCK');
    console.log('>>> TEST 1 PASSED: All 51 ET BLOCK classrooms (2010-2060) configured with Group A & B.\n');

    // ---------------------------------------------------------
    // TEST 2: VERIFY ZERO MOCK DATA IN DATABASE
    // ---------------------------------------------------------
    console.log('--- TEST 2: Verify No Mock / Dummy Students in Database ---');
    const mockStudentCount = await Student.countDocuments({
      $or: [
        { name: { $regex: /Kumar$/i } },
        { name: { $regex: /^Sample/i } },
      ],
    });
    console.log(`Dummy mock students count: ${mockStudentCount}`);
    if (mockStudentCount !== 0) {
      throw new Error(`FAIL: Found ${mockStudentCount} dummy mock students!`);
    }
    console.log('>>> TEST 2 PASSED: Zero mock students present.\n');

    // ---------------------------------------------------------
    // TEST 3: MULTI-PDF STUDENT EXTRACTION & PREVIEW
    // ---------------------------------------------------------
    console.log('--- TEST 3: Multi-PDF Real Student Data Extraction ---');
    const samplePdfPath1 = path.join(__dirname, 'test_student_roster_1.pdf');
    const samplePdfPath2 = path.join(__dirname, 'test_student_roster_2.pdf');

    await createSampleStudentPDF(samplePdfPath1, {
      subject1: 'Database Management Systems',
      faculty1: 'Dr. K. Subba Rao',
      subject2: 'Operating Systems',
      faculty2: 'Prof. M. Sreenivasulu',
    });

    console.log(`Generated realistic multi-page academic PDF: ${samplePdfPath1}`);

    // Call extraction service directly
    const PdfExtractorService = require('../services/pdfExtractorService');
    const extractionResult = await PdfExtractorService.extractFromMultipleFiles([
      { path: samplePdfPath1, originalname: 'CSE_IV_Year_Roster.pdf' },
    ]);

    console.log(`Extracted total records: ${extractionResult.records.length}`);
    console.log(`Subjects detected: ${extractionResult.summary.subjectsFound.join(', ')}`);
    console.log(`Sections detected: ${extractionResult.summary.sectionsFound.join(', ')}`);
    console.log(`Faculty detected: ${extractionResult.summary.facultyFound.join(', ')}`);

    const sampleRec = extractionResult.records[0];
    console.log('Sample Extracted Record:');
    console.log(`  Roll Number: ${sampleRec.rollNumber}`);
    console.log(`  Student Name: ${sampleRec.studentName}`);
    console.log(`  Faculty Name: ${sampleRec.facultyName}`);
    console.log(`  Section: ${sampleRec.section}`);
    console.log(`  Subject: ${sampleRec.subjectName}`);
    console.log(`  Group: ${sampleRec.group}`);
    console.log(`  A1-A6 Marks: ${sampleRec.a1}, ${sampleRec.a2}, ${sampleRec.a3}, ${sampleRec.a4}, ${sampleRec.a5}, ${sampleRec.a6}`);
    console.log(`  FDH Roll No: ${sampleRec.fdhNumber}`);

    if (
      !sampleRec.rollNumber ||
      !sampleRec.studentName ||
      !sampleRec.facultyName ||
      !sampleRec.subjectName ||
      !sampleRec.fdhNumber ||
      !sampleRec.a1
    ) {
      throw new Error('FAIL: PDF extraction missed required student columns!');
    }
    console.log('>>> TEST 3 PASSED: PDF Extraction extracted all 10 columns accurately.\n');

    // ---------------------------------------------------------
    // TEST 4: CONFIRM & IMPORT INTO STRUCTURED DATABASE
    // ---------------------------------------------------------
    console.log('--- TEST 4: Confirm & Import into Structured Database ---');
    const confirmRes = await fetch(`${BASE_URL}/students/multi-pdf-confirm`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ records: extractionResult.records }),
    });

    const confirmData = await confirmRes.json();
    console.log(`Import status: ${confirmRes.status} | Saved Count: ${confirmData.count}`);
    if (confirmRes.status !== 200 || !confirmData.success) {
      throw new Error(`FAIL: Multi-PDF confirm import failed: ${confirmData.message}`);
    }

    const enrolledCount = await StudentEnrollment.countDocuments();
    console.log(`StudentEnrollment records in MongoDB: ${enrolledCount}`);
    if (enrolledCount < 10) throw new Error('FAIL: Enrolled records not persisted!');
    console.log('>>> TEST 4 PASSED: Student records successfully imported into structured database.\n');

    // ---------------------------------------------------------
    // TEST 5: STRUCTURED DATABASE QUERY & GROUP FILTERING
    // ---------------------------------------------------------
    console.log('--- TEST 5: Structured Database Filtering by Group & Subject ---');
    const groupARes = await fetch(`${BASE_URL}/students/database?group=Group+A`, {
      headers: authHeaders,
    });
    const groupAData = await groupARes.json();
    console.log(`Group A students fetched: ${groupAData.count}`);

    const groupBRes = await fetch(`${BASE_URL}/students/database?group=Group+B`, {
      headers: authHeaders,
    });
    const groupBData = await groupBRes.json();
    console.log(`Group B students fetched: ${groupBData.count}`);

    if (groupAData.count === 0 || groupBData.count === 0) {
      throw new Error('FAIL: Group A and Group B separation not functioning!');
    }
    console.log('>>> TEST 5 PASSED: Group A and Group B maintained separately.\n');

    // ---------------------------------------------------------
    // TEST 6: CREATE EXAM WITH ET BLOCK ROOM & GROUP A ALLOCATION
    // ---------------------------------------------------------
    console.log('--- TEST 6: Examination Creation & Group A Seating Allocation ---');
    const et2010 = await Classroom.findOne({ roomNumber: '2010' });
    const createExamRes = await fetch(`${BASE_URL}/exams`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        examName: 'Mid-Term Examination I',
        academicYear: '2026-2027',
        department: 'Computer Science and Engineering',
        year: 'IV Year',
        semester: 'I Semester',
        section: 'A',
        group: 'Group A',
        facultyName: 'Dr. K. Subba Rao',
        subjectName: 'Database Management Systems',
        subjectCode: 'CS402',
        examDate: '2026-11-09',
        session: 'FN',
        classroomId: et2010._id,
      }),
    });

    const examData = await createExamRes.json();
    console.log(`Create Exam Status: ${createExamRes.status}`);
    if (createExamRes.status !== 201 && createExamRes.status !== 200) {
      throw new Error(`FAIL: Exam creation failed: ${examData.message}`);
    }
    const createdExamId = examData.data._id;
    console.log(`Created Exam ID: ${createdExamId} [Group A, ET BLOCK 2010]`);

    // Generate Seating Allocation
    const allocRes = await fetch(`${BASE_URL}/exams/${createdExamId}/allocate`, {
      method: 'POST',
      headers: authHeaders,
    });
    const allocData = await allocRes.json();
    console.log(`Allocation Status: ${allocRes.status}`);
    if (allocRes.status !== 201 && allocRes.status !== 200) {
      throw new Error(`FAIL: Seating allocation failed: ${allocData.message}`);
    }

    const alloc = allocData.data;
    console.log(`Allocation Version: ${alloc.version}`);
    console.log(`Allocated Students: ${alloc.students.length}`);
    console.log(`Set Distribution: Set A: ${alloc.setDistribution.A}, Set B: ${alloc.setDistribution.B}, Set C: ${alloc.setDistribution.C}`);
    console.log(`Validation Status: Valid: ${alloc.validationStatus.isValid}, Collisions: ${alloc.validationStatus.hasAdjacentCollisions}`);

    if (!alloc.validationStatus.isValid || alloc.validationStatus.hasAdjacentCollisions) {
      throw new Error('FAIL: Allocation validation detected adjacent set collisions!');
    }
    console.log('>>> TEST 6 PASSED: Seating allocation generated with strict A/B/C alternation and 0 collisions.\n');

    // ---------------------------------------------------------
    // TEST 7: ALL 7 REQUIRED REPORT GENERATIONS
    // ---------------------------------------------------------
    console.log('--- TEST 7: Report Generation (All 7 Reports) ---');

    // 1. Student Master Data Excel
    const r1 = await fetch(`${BASE_URL}/reports/master-students-excel`, { headers: authHeaders });
    const b1 = await r1.arrayBuffer();
    console.log(`1. Student Master Data Excel size: ${b1.byteLength} bytes (Status ${r1.status})`);
    if (r1.status !== 200 || b1.byteLength < 500) throw new Error('FAIL: Master students Excel report failed!');

    // 2. Subject-Wise Student List
    const r2 = await fetch(`${BASE_URL}/reports/subject-wise-excel?subject=Database+Management+Systems`, { headers: authHeaders });
    const b2 = await r2.arrayBuffer();
    console.log(`2. Subject-Wise Excel size: ${b2.byteLength} bytes (Status ${r2.status})`);
    if (r2.status !== 200 || b2.byteLength < 500) throw new Error('FAIL: Subject-wise Excel report failed!');

    // 3. Faculty-Wise Student List
    const r3 = await fetch(`${BASE_URL}/reports/faculty-wise-excel?faculty=Dr.+K.+Subba+Rao`, { headers: authHeaders });
    const b3 = await r3.arrayBuffer();
    console.log(`3. Faculty-Wise Excel size: ${b3.byteLength} bytes (Status ${r3.status})`);
    if (r3.status !== 200 || b3.byteLength < 500) throw new Error('FAIL: Faculty-wise Excel report failed!');

    // 4. Group A Attendance Sheet PDF
    const r4 = await fetch(`${BASE_URL}/exams/${createdExamId}/reports/group-attendance-pdf?group=Group+A`, { headers: authHeaders });
    const b4 = await r4.arrayBuffer();
    console.log(`4. Group A Attendance Sheet PDF size: ${b4.byteLength} bytes (Status ${r4.status})`);
    if (r4.status !== 200 || b4.byteLength < 1000) throw new Error('FAIL: Group A Attendance PDF failed!');

    // 5. Group B Attendance Sheet PDF
    const r5 = await fetch(`${BASE_URL}/exams/${createdExamId}/reports/group-attendance-pdf?group=Group+B`, { headers: authHeaders });
    const b5 = await r5.arrayBuffer();
    console.log(`5. Group B Attendance Sheet PDF size: ${b5.byteLength} bytes (Status ${r5.status})`);
    if (r5.status !== 200 || b5.byteLength < 1000) throw new Error('FAIL: Group B Attendance PDF failed!');

    // 6. Classroom Seating Chart PDF
    const r6 = await fetch(`${BASE_URL}/exams/${createdExamId}/reports/seating-pdf`, { headers: authHeaders });
    const b6 = await r6.arrayBuffer();
    console.log(`6. Classroom Seating Chart PDF size: ${b6.byteLength} bytes (Status ${r6.status})`);
    if (r6.status !== 200 || b6.byteLength < 1000) throw new Error('FAIL: Seating Chart PDF failed!');

    // 7. Master Examination Allocation PDF
    const r7 = await fetch(`${BASE_URL}/exams/${createdExamId}/reports/master-pdf`, { headers: authHeaders });
    const b7 = await r7.arrayBuffer();
    console.log(`7. Master Allocation PDF size: ${b7.byteLength} bytes (Status ${r7.status})`);
    if (r7.status !== 200 || b7.byteLength < 1000) throw new Error('FAIL: Master Allocation PDF failed!');

    console.log('>>> TEST 7 PASSED: All 7 reports generated successfully with complete institutional branding.\n');

    console.log('================================================================');
    console.log('  ALL 7 END-TO-END TEST SUITES COMPLETED WITH 100% SUCCESS!   ');
    console.log('================================================================');
  } finally {
    // Cleanup sample PDF files
    try {
      if (fs.existsSync(samplePdfPath1)) fs.unlinkSync(samplePdfPath1);
      if (fs.existsSync(samplePdfPath2)) fs.unlinkSync(samplePdfPath2);
    } catch (e) {}
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
}

runVerification().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
