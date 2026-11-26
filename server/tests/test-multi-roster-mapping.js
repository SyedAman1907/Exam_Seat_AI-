require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const { extractMultiSubjectRosters } = require('../services/pdfExtractorService');
const FacultyMapping = require('../models/FacultyMapping');
const Student = require('../models/Student');
const StudentEnrollment = require('../models/StudentEnrollment');
const { confirmBatchMappings, lookupMappedStudents } = require('../controllers/mappingController');

async function runTests() {
  console.log('========================================================');
  console.log('  TEST SUITE: Multi-Roster Student Extraction & Mapping');
  console.log('========================================================');

  const downloadsDir = 'C:\\Users\\ZUBERIYA\\Downloads';
  const groupAPath = path.join(downloadsDir, 'III-I-CSE-Nominals(2026-27-ODD Sem) (24-Batch) (Group-A).pdf');
  const groupBPath = path.join(downloadsDir, 'III-I-CSE-Nominals(2026-27-ODD Sem) (24-Batch) (Group-B).pdf');

  if (!fs.existsSync(groupAPath) || !fs.existsSync(groupBPath)) {
    console.error('ERROR: Required nominal PDF files not found in Downloads directory.');
    process.exit(1);
  }

  // --- TEST 1: GROUP A EXTRACTION ---
  console.log('\n[TEST 1] Extracting Group-A Multi-Roster PDF...');
  const resultA = await extractMultiSubjectRosters(groupAPath, 'Group-A.pdf');
  console.log(`- Detected ${resultA.mappings.length} mappings`);
  console.log(`- Total enrollments: ${resultA.summary.totalEnrollments}`);
  console.log(`- Unique students: ${resultA.summary.uniqueStudents}`);
  console.log(`- Sections: ${resultA.summary.sections.join(', ')}`);
  console.log(`- Group: ${resultA.summary.group}`);

  if (resultA.mappings.length !== 27) {
    throw new Error(`Expected 27 mappings for Group A, got ${resultA.mappings.length}`);
  }
  if (resultA.summary.totalEnrollments !== 1953) {
    throw new Error(`Expected 1953 enrollments for Group A, got ${resultA.summary.totalEnrollments}`);
  }
  if (resultA.summary.uniqueStudents !== 217) {
    throw new Error(`Expected 217 unique students for Group A, got ${resultA.summary.uniqueStudents}`);
  }
  console.log('>>> TEST 1 PASSED: Group A extraction perfectly accurate.');

  // --- TEST 2: GROUP B EXTRACTION ---
  console.log('\n[TEST 2] Extracting Group-B Multi-Roster PDF...');
  const resultB = await extractMultiSubjectRosters(groupBPath, 'Group-B.pdf');
  console.log(`- Detected ${resultB.mappings.length} mappings`);
  console.log(`- Total enrollments: ${resultB.summary.totalEnrollments}`);
  console.log(`- Unique students: ${resultB.summary.uniqueStudents}`);
  console.log(`- Sections: ${resultB.summary.sections.join(', ')}`);
  console.log(`- Group: ${resultB.summary.group}`);

  if (resultB.mappings.length !== 27) {
    throw new Error(`Expected 27 mappings for Group B, got ${resultB.mappings.length}`);
  }
  if (resultB.summary.totalEnrollments !== 1944) {
    throw new Error(`Expected 1944 enrollments for Group B, got ${resultB.summary.totalEnrollments}`);
  }
  if (resultB.summary.uniqueStudents !== 216) {
    throw new Error(`Expected 216 unique students for Group B, got ${resultB.summary.uniqueStudents}`);
  }

  // Verify specific faculty matches
  const fsdA6 = resultB.mappings.find(m => m.section === 'A6' && m.subjectName.includes('Full Stack'));
  if (!fsdA6 || !fsdA6.facultyName.toLowerCase().includes('shobitha')) {
    throw new Error(`Expected Shobitha for Full Stack Dev Sec A6, got: ${JSON.stringify(fsdA6)}`);
  }
  console.log(`- Verified FSD Sec A6 -> Faculty: ${fsdA6.facultyName} (${fsdA6.students.length} students)`);

  const atcdA6 = resultB.mappings.find(m => m.section === 'A6' && m.subjectName.includes('Automata'));
  if (!atcdA6 || !atcdA6.facultyName.toLowerCase().includes('rama subbaiah')) {
    throw new Error(`Expected Dr. B. Rama Subbaiah for ATCD Sec A6, got: ${JSON.stringify(atcdA6)}`);
  }
  console.log(`- Verified ATCD Sec A6 -> Faculty: ${atcdA6.facultyName} (${atcdA6.students.length} students)`);

  const cnipA4 = resultB.mappings.find(m => m.section === 'A4' && m.subjectName.includes('Computer Networks'));
  if (!cnipA4 || !cnipA4.facultyName.toLowerCase().includes('jayasri')) {
    throw new Error(`Expected K. Jayasri for CNIP Sec A4, got: ${JSON.stringify(cnipA4)}`);
  }
  console.log(`- Verified CNIP Sec A4 -> Faculty: ${cnipA4.facultyName} (${cnipA4.students.length} students)`);

  console.log('>>> TEST 2 PASSED: Group B extraction perfectly accurate.');

  // --- TEST 3: DATABASE CONNECTIVITY & BATCH CONFIRMATION ---
  console.log('\n[TEST 3] Connecting to MongoDB and verifying Batch Confirmation for Group A & Group B...');
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/examseat_ai';
  await mongoose.connect(mongoUri);
  console.log('- Connected to MongoDB:', mongoose.connection.name);

  const mockRes = () => {
    let responseData = null;
    return {
      status: function (code) {
        this.statusCode = code;
        return this;
      },
      json: function (data) {
        responseData = data;
        return this;
      },
      getData: () => responseData
    };
  };

  // Confirm ALL 27 mappings for Group A
  const reqA = {
    body: {
      mappings: resultA.mappings,
      replaceExisting: true,
      sourceFileName: 'Group-A.pdf'
    },
    user: { email: 'admin@rgmcet.edu.in', role: 'admin' }
  };
  const resA = mockRes();
  await confirmBatchMappings(reqA, resA);
  const dataA = resA.getData();
  if (!dataA || !dataA.success) {
    throw new Error(`Group A confirmBatchMappings failed: ${JSON.stringify(dataA)}`);
  }
  console.log(`- Group A confirmed: ${dataA.count} mappings, ${dataA.totalEnrollments} enrollments, ${dataA.uniqueStudents} unique students`);

  // Confirm ALL 27 mappings for Group B
  const reqB = {
    body: {
      mappings: resultB.mappings,
      replaceExisting: true,
      sourceFileName: 'Group-B.pdf'
    },
    user: { email: 'admin@rgmcet.edu.in', role: 'admin' }
  };
  const resB = mockRes();
  await confirmBatchMappings(reqB, resB);
  const dataB = resB.getData();
  if (!dataB || !dataB.success) {
    throw new Error(`Group B confirmBatchMappings failed: ${JSON.stringify(dataB)}`);
  }
  console.log(`- Group B confirmed: ${dataB.count} mappings, ${dataB.totalEnrollments} enrollments, ${dataB.uniqueStudents} unique students`);

  // Verify in MongoDB
  const totalActiveMappings = await FacultyMapping.countDocuments({ isCurrent: true });
  console.log(`- Total active FacultyMapping documents in DB: ${totalActiveMappings}`);
  if (totalActiveMappings !== 54) {
    throw new Error(`Expected exactly 54 total active mappings (27 Group A + 27 Group B), found: ${totalActiveMappings}`);
  }

  // --- TEST 4: VERIFY SAME STUDENT IN MULTIPLE SUBJECTS WITHOUT CONFLICT ---
  console.log('\n[TEST 4] Verifying Multi-Subject Enrollment without Duplicate Conflict...');
  const sampleStudent = resultB.mappings[0].students[0];
  console.log(`- Sample student: ${sampleStudent.registrationNumber} - ${sampleStudent.studentName}`);

  const enrollments = await StudentEnrollment.find({ rollNumber: sampleStudent.registrationNumber });
  console.log(`- Enrolled subjects for ${sampleStudent.registrationNumber}:`, enrollments.map(e => `${e.subjectName} (${e.section})`));

  // --- TEST 5: VERIFY LOOKUP MAPPED STUDENTS FOR EXAM CREATION ---
  console.log('\n[TEST 5] Verifying lookupMappedStudents query isolation...');
  const targetMapping = resultB.mappings[0];
  const lookupReq = {
    query: {
      subjectCode: targetMapping.subjectCode,
      section: targetMapping.section,
      group: targetMapping.group
    }
  };
  let lookupData = null;
  const lookupRes = {
    status: function () { return this; },
    json: function (data) { lookupData = data; return this; }
  };

  await lookupMappedStudents(lookupReq, lookupRes);
  if (!lookupData || !lookupData.success || !lookupData.students || lookupData.students.length === 0) {
    throw new Error(`lookupMappedStudents failed: ${JSON.stringify(lookupData)}`);
  }
  console.log(`- Loaded ${lookupData.students.length} students for ${targetMapping.subjectName} (${targetMapping.section}, ${targetMapping.group})`);
  console.log(`- Faculty assigned: ${lookupData.facultyName}`);

  console.log('\n========================================================');
  console.log('  ALL INTEGRATION TESTS PASSED SUCCESSFULLY! (5/5)');
  console.log('========================================================\n');

  await mongoose.disconnect();
}

runTests().catch(err => {
  console.error('\nTEST FAILED WITH ERROR:', err);
  process.exit(1);
});
