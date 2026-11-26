require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Exam = require('../models/Exam');
const Classroom = require('../models/Classroom');
const Allocation = require('../models/Allocation');
const FacultyMapping = require('../models/FacultyMapping');
const ReportService = require('../services/reportService');
const {
  resolveCentralizedMappings,
  createCentralizedExam,
  publishExam,
} = require('../controllers/examController');
const { lookupSeat } = require('../controllers/studentPortalController');
const {
  getSectionAttendancePDF,
  getCentralizedAttendanceZip,
} = require('../controllers/reportController');

async function runCentralizedTest() {
  console.log('===============================================================');
  console.log('  TEST SUITE: Centralized Examination Creation by Exam Incharge');
  console.log('===============================================================');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/examseat_ai';
  await mongoose.connect(mongoUri);
  console.log('- Connected to MongoDB:', mongoose.connection.name);

  // Helper mock res
  const makeMockRes = () => {
    let statusCode = 200;
    let responseData = null;
    let headers = {};
    let sentData = null;
    return {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      },
      setHeader(name, val) {
        headers[name] = val;
      },
      send(data) {
        sentData = data;
        return this;
      },
      getStatusCode: () => statusCode,
      getData: () => responseData,
      getSentData: () => sentData,
      getHeaders: () => headers,
    };
  };

  // Find or create Exam Incharge user
  let inchargeUser = await User.findOne({ role: 'exam_incharge' });
  if (!inchargeUser) {
    inchargeUser = await User.create({
      name: 'Dr. Exam Incharge Coordinator',
      email: 'incharge.test@rgmcet.edu.in',
      passwordHash: 'hashed_pwd',
      role: 'exam_incharge',
    });
  }

  let adminUser = await User.findOne({ role: 'admin' });

  // --- TEST 1: AUTOMATIC FACULTY & STUDENT MAPPING RESOLUTION ---
  console.log('\n[TEST 1] Resolving Permanent Mappings for Subject: "Automata Theory and Compiler Design"...');
  const resolveReq = {
    query: {
      subjectName: 'Automata Theory and Compiler Design',
      subjectCode: '20A05501T',
      academicYear: '2026-2027',
      year: 'III Year',
      semester: 'I Semester',
      group: 'Group A',
    },
    user: inchargeUser,
  };
  const resolveRes = makeMockRes();
  await resolveCentralizedMappings(resolveReq, resolveRes);

  const resolveData = resolveRes.getData();
  if (!resolveData || !resolveData.success) {
    throw new Error(`Mapping resolution failed: ${JSON.stringify(resolveData)}`);
  }

  console.log(`- Detected ${resolveData.count} matching section mappings`);
  console.log(`- Total enrollments: ${resolveData.summary.totalEnrollments}`);
  console.log(`- Unique students: ${resolveData.summary.uniqueStudents}`);
  console.log(`- Sections: ${resolveData.summary.sectionsDetected.join(', ')}`);
  console.log(`- Assigned Faculties: ${resolveData.summary.facultiesDetected.join(' | ')}`);

  if (resolveData.count < 3) {
    throw new Error(`Expected at least 3 matching section mappings, got ${resolveData.count}`);
  }
  console.log('>>> TEST 1 PASSED: Automatic mapping resolution successfully identified section rosters.');

  // Clean up any existing test parent exam
  await Exam.deleteMany({ examName: 'Centralized Test Exam - ATCD' });

  // --- TEST 2: CENTRALIZED EXAMINATION CREATION BY EXAM INCHARGE ---
  console.log('\n[TEST 2] Creating Centralized Examination with Section-Wise Seating Allocation...');
  const createReq = {
    body: {
      examName: 'Centralized Test Exam - ATCD',
      academicYear: '2026-2027',
      department: 'Computer Science and Engineering',
      year: 'III Year',
      semester: 'I Semester',
      subjectName: 'Automata Theory and Compiler Design',
      subjectCode: '20A05501T',
      examDate: '2026-11-28',
      startTime: '09:00 AM',
      endTime: '12:00 PM',
      session: 'FN',
      group: 'Group A',
    },
    user: inchargeUser,
  };
  const createRes = makeMockRes();
  await createCentralizedExam(createReq, createRes);

  const createData = createRes.getData();
  if (!createData || !createData.success) {
    throw new Error(`Centralized examination creation failed: ${JSON.stringify(createData)}`);
  }

  const createdExam = createData.data;
  console.log(`- Created Parent Exam ID: ${createdExam._id}`);
  console.log(`- Parent Exam Status: ${createdExam.approvalStatus} (Review by Admin)`);
  console.log(`- Section Allocations Count: ${createdExam.sectionAllocations.length}`);
  console.log(`- Total Students Allocated: ${createdExam.studentCount}`);

  for (const sAlloc of createdExam.sectionAllocations) {
    console.log(`  * Sec ${sAlloc.section} (${sAlloc.group}) -> Faculty: ${sAlloc.facultyName} | Classroom: ${sAlloc.classroomName} (${sAlloc.studentCount} students)`);
  }

  if (createdExam.sectionAllocations.length !== resolveData.count) {
    throw new Error(`Mismatch in section allocations: expected ${resolveData.count}, got ${createdExam.sectionAllocations.length}`);
  }
  console.log('>>> TEST 2 PASSED: Parent examination and section allocations created.');

  // --- TEST 3: SEPARATE FACULTY ATTENDANCE PDF GENERATION ---
  console.log('\n[TEST 3] Generating Faculty-Section Specific Attendance Sheet PDFs...');
  for (const sAlloc of createdExam.sectionAllocations) {
    const pdfReq = {
      params: { id: createdExam._id.toString(), section: sAlloc.section },
      user: inchargeUser,
    };
    const pdfRes = makeMockRes();
    await getSectionAttendancePDF(pdfReq, pdfRes);

    const pdfBuffer = pdfRes.getSentData();
    if (!pdfBuffer || pdfBuffer.length < 500) {
      throw new Error(`Failed to generate attendance PDF for Section ${sAlloc.section}`);
    }
    const headers = pdfRes.getHeaders();
    console.log(`  * Section ${sAlloc.section} Attendance PDF: ${pdfBuffer.length} bytes | Header: ${headers['Content-Disposition']}`);
  }

  // Test Combined Attendance ZIP Download
  console.log('- Generating Combined Attendance ZIP Archive...');
  const zipReq = {
    params: { id: createdExam._id.toString() },
    user: inchargeUser,
  };
  const zipRes = makeMockRes();
  await getCentralizedAttendanceZip(zipReq, zipRes);

  const zipBuffer = zipRes.getSentData();
  if (!zipBuffer || zipBuffer.length < 1000) {
    throw new Error(`Failed to generate combined attendance ZIP`);
  }
  console.log(`  * Combined ZIP Size: ${zipBuffer.length} bytes`);
  console.log('>>> TEST 3 PASSED: Individual section attendance PDFs and combined ZIP verified.');

  // --- TEST 4: ADMIN REVIEW AND APPROVAL ---
  console.log('\n[TEST 4] Admin Reviews & Approves Centralized Examination...');
  const approveReq = {
    params: { id: createdExam._id.toString() },
    user: adminUser,
  };
  const approveRes = makeMockRes();
  await publishExam(approveReq, approveRes);

  const approveData = approveRes.getData();
  if (!approveData || !approveData.success) {
    throw new Error(`Admin approval failed: ${JSON.stringify(approveData)}`);
  }
  console.log(`- Admin Approval Status: ${approveData.data.approvalStatus}`);
  console.log(`- Publication Scheduled Time: ${approveData.data.publicationTime}`);
  console.log('>>> TEST 4 PASSED: Admin review and approval verified.');

  // --- TEST 5: SIMULATE T-20 PUBLICATION & STUDENT PORTAL LOOKUP ---
  console.log('\n[TEST 5] Testing T-20 Student Portal Seating Visibility...');
  // Force exam visibilityStatus to PUBLISHED to simulate T-20 publication
  await Exam.findByIdAndUpdate(createdExam._id, {
    visibilityStatus: 'PUBLISHED',
    status: 'PUBLISHED',
  });
  await Allocation.updateMany({ examId: createdExam._id }, { status: 'PUBLISHED' });

  // Pick a sample student from first section (e.g. A1)
  const sampleSection = createdExam.sectionAllocations[0];
  if (sampleSection && sampleSection.rosterSnapshot.length > 0) {
    const sampleStudent = sampleSection.rosterSnapshot[0];
    console.log(`- Testing lookup for Student ${sampleStudent.registrationNumber} (Sec ${sampleSection.section})...`);

    const studentReq = {
      body: {
        registrationNumber: sampleStudent.registrationNumber,
        date: '2026-11-28',
      },
      query: {},
    };
    const studentRes = makeMockRes();
    await lookupSeat(studentReq, studentRes);

    const seatData = studentRes.getData();
    if (!seatData || !seatData.success || !seatData.data) {
      throw new Error(`Student lookup failed: ${JSON.stringify(seatData)}`);
    }

    console.log(`  * Student: ${seatData.data.studentName} (${seatData.data.registrationNumber})`);
    console.log(`  * Classroom: ${seatData.data.classroom}`);
    console.log(`  * Seat ID: ${seatData.data.seatId} | Set: ${seatData.data.questionPaperSet}`);
    console.log(`  * Row: ${seatData.data.row} | Bench: ${seatData.data.bench}`);

    if (!seatData.data.classroom || !seatData.data.seatId || !seatData.data.questionPaperSet) {
      throw new Error('Incomplete seating record returned for student');
    }
  }

  console.log('\n===============================================================');
  console.log('  ALL CENTRALIZED EXAMINATION TESTS PASSED SUCCESSFULLY! (5/5)');
  console.log('===============================================================\n');

  await mongoose.disconnect();
}

runCentralizedTest().catch((err) => {
  console.error('\nTEST FAILED WITH ERROR:', err);
  process.exit(1);
});
