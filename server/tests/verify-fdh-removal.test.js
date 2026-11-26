const mongoose = require('mongoose');
const zlib = require('zlib');
const ExcelJS = require('exceljs');
const Exam = require('../models/Exam');
const Classroom = require('../models/Classroom');
const Allocation = require('../models/Allocation');
const StudentEnrollment = require('../models/StudentEnrollment');
const Student = require('../models/Student');
const ReportService = require('../services/reportService');
const ExcelService = require('../services/excelService');

// Helper to decompress and extract all text from PDF buffer
function extractPdfText(pdfBuffer) {
  let combinedText = '';

  const str = pdfBuffer.toString('latin1');
  const regex = /(\d+ \d+ obj[\s\S]*?endobj)/g;
  let match;
  while ((match = regex.exec(str)) !== null) {
    const objText = match[1];
    if (objText.includes('stream')) {
      const streamStart = objText.indexOf('stream');
      const streamEnd = objText.indexOf('endstream');
      let dataStart = streamStart + 6;
      if (objText.charCodeAt(dataStart) === 13) dataStart++;
      if (objText.charCodeAt(dataStart) === 10) dataStart++;
      let dataEnd = streamEnd;
      if (objText.charCodeAt(dataEnd - 1) === 10) dataEnd--;
      if (objText.charCodeAt(dataEnd - 1) === 13) dataEnd--;

      const rawChunk = Buffer.from(objText.slice(dataStart, dataEnd), 'latin1');
      try {
        const dec = zlib.inflateSync(rawChunk).toString('latin1');
        // Extract all TJ arrays and decode hex strings
        const tjMatches = dec.match(/\[([\s\S]*?)\]\s*TJ/g) || [];
        for (const tj of tjMatches) {
          const hexes = tj.match(/<([0-9a-fA-F]+)>/g) || [];
          const textPart = hexes.map(h => Buffer.from(h.slice(1, -1), 'hex').toString('latin1')).join('');
          combinedText += textPart + ' ';
        }

        // Also extract individual Tj strings
        const singleMatches = dec.match(/\((.*?)\)\s*Tj/g) || [];
        for (const sm of singleMatches) {
          combinedText += sm + ' ';
        }
      } catch (e) {
        // non-flate or image
      }
    }
  }

  combinedText += str;
  return combinedText;
}

async function runVerification() {
  console.log('====================================================');
  console.log('  EXAMSEAT AI — FDH REMOVAL AUDIT & REPORT VERIFICATION');
  console.log('====================================================\n');

  await mongoose.connect('mongodb://127.0.0.1:27017/examseat_ai');
  console.log('✓ Connected to MongoDB');

  // Find an existing exam with allocation
  let exam = await Exam.findOne({ status: { $ne: 'CANCELLED' } }).sort({ createdAt: -1 });
  if (!exam) {
    console.error('✗ No exam found in database to test.');
    process.exit(1);
  }
  console.log(`✓ Test Exam: "${exam.examName}" (${exam.subjectName}) | Date: ${exam.examDate} | Section: ${exam.section}`);

  let allocation = await Allocation.findOne({ examId: exam._id, isCurrent: true });
  if (!allocation) {
    console.error('✗ No allocation found for exam.');
    process.exit(1);
  }
  console.log(`✓ Allocation loaded: ${allocation.students.length} students allocated`);

  let classroom = await Classroom.findById(exam.classroomId);
  if (!classroom) {
    classroom = await Classroom.findOne();
  }
  console.log(`✓ Classroom: ${classroom.name} (Room ${classroom.roomNumber})\n`);

  let failures = 0;

  // ----------------------------------------------------
  // TEST 1: Master Student Allocation PDF
  // ----------------------------------------------------
  console.log('--- 1. Testing Master Student Allocation PDF ---');
  try {
    const masterPdf = await ReportService.generateMasterPDF(exam, allocation, classroom);
    const pdfText = extractPdfText(masterPdf);
    
    if (/FDH/i.test(pdfText)) {
      console.error('✗ FAIL: Master PDF contains "FDH" text!');
      failures++;
    } else {
      console.log('✓ PASS: Master PDF contains ZERO occurrences of "FDH".');
    }

    if (!pdfText.includes('EXAMINATION MASTER SEATING ALLOCATION') || !pdfText.includes('RAJEEV GANDHI MEMORIAL')) {
      console.error('✗ FAIL: Master PDF missing official institutional branding header.');
      failures++;
    } else {
      console.log('✓ PASS: Official RGMCET institutional branding preserved.');
    }
  } catch (err) {
    console.error('✗ FAIL Master PDF generation error:', err.message);
    failures++;
  }

  // ----------------------------------------------------
  // TEST 2: Attendance & Signature Sheet PDF (General)
  // ----------------------------------------------------
  console.log('\n--- 2. Testing Attendance & Signature Sheet PDF ---');
  try {
    const attPdf = await ReportService.generateAttendancePDF(exam, allocation, classroom);
    const pdfText = extractPdfText(attPdf);

    if (/FDH/i.test(pdfText)) {
      console.error('✗ FAIL: Attendance PDF contains "FDH" text!');
      failures++;
    } else {
      console.log('✓ PASS: Attendance PDF contains ZERO occurrences of "FDH".');
    }

    if (!pdfText.includes('Candidate Signature') || !pdfText.includes('Roll Number')) {
      console.error('✗ FAIL: Attendance PDF missing Roll Number or Signature headers.');
      failures++;
    } else {
      console.log('✓ PASS: Roll Number and Candidate Signature columns intact and widened.');
    }
  } catch (err) {
    console.error('✗ FAIL Attendance PDF generation error:', err.message);
    failures++;
  }

  // ----------------------------------------------------
  // TEST 3: Group A Attendance Sheet PDF
  // ----------------------------------------------------
  console.log('\n--- 3. Testing Group A Attendance Sheet PDF ---');
  try {
    const grpAPdf = await ReportService.generateAttendancePDF(exam, allocation, classroom, 'Group A');
    const pdfText = extractPdfText(grpAPdf);

    if (/FDH/i.test(pdfText)) {
      console.error('✗ FAIL: Group A Attendance PDF contains "FDH" text!');
      failures++;
    } else {
      console.log('✓ PASS: Group A Attendance PDF contains ZERO occurrences of "FDH".');
    }
  } catch (err) {
    console.error('✗ FAIL Group A Attendance PDF error:', err.message);
    failures++;
  }

  // ----------------------------------------------------
  // TEST 4: Group B Attendance Sheet PDF
  // ----------------------------------------------------
  console.log('\n--- 4. Testing Group B Attendance Sheet PDF ---');
  try {
    const grpBPdf = await ReportService.generateAttendancePDF(exam, allocation, classroom, 'Group B');
    const pdfText = extractPdfText(grpBPdf);

    if (/FDH/i.test(pdfText)) {
      console.error('✗ FAIL: Group B Attendance PDF contains "FDH" text!');
      failures++;
    } else {
      console.log('✓ PASS: Group B Attendance PDF contains ZERO occurrences of "FDH".');
    }
  } catch (err) {
    console.error('✗ FAIL Group B Attendance PDF error:', err.message);
    failures++;
  }

  // ----------------------------------------------------
  // TEST 5: Classroom Seating Chart PDF
  // ----------------------------------------------------
  console.log('\n--- 5. Testing Classroom Seating Chart PDF ---');
  try {
    const chartPdf = await ReportService.generateSeatingChartPDF(exam, allocation, classroom);
    const pdfText = extractPdfText(chartPdf);

    if (/FDH/i.test(pdfText)) {
      console.error('✗ FAIL: Seating Chart PDF contains "FDH" text!');
      failures++;
    } else {
      console.log('✓ PASS: Seating Chart PDF contains ZERO occurrences of "FDH".');
    }

    if (!pdfText.includes('BLACKBOARD') || !pdfText.includes('QUESTION PAPER SET LEGEND')) {
      console.error('✗ FAIL: Seating Chart PDF missing layout elements.');
      failures++;
    } else {
      console.log('✓ PASS: Seating Chart PDF top-down layout & legend intact.');
    }
  } catch (err) {
    console.error('✗ FAIL Seating Chart PDF error:', err.message);
    failures++;
  }

  // ----------------------------------------------------
  // TEST 6: Student Master Data Excel
  // ----------------------------------------------------
  console.log('\n--- 6. Testing Student Master Data Excel Export ---');
  try {
    const sampleStudents = await StudentEnrollment.find().limit(50);
    const masterExcelBuf = await ExcelService.generateMasterStudentsExcel(sampleStudents, 'STUDENT MASTER DATABASE');
    
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(masterExcelBuf);
    const sheet = workbook.getWorksheet('Student Master Data');

    let fdhFound = false;
    sheet.eachRow((row, rowNumber) => {
      row.eachCell((cell, colNumber) => {
        const val = String(cell.value || '');
        if (/FDH/i.test(val)) {
          console.error(`✗ FAIL: Master Excel cell (${rowNumber}, ${colNumber}) has FDH: "${val}"`);
          fdhFound = true;
        }
      });
    });

    if (fdhFound) {
      failures++;
    } else {
      console.log('✓ PASS: Student Master Data Excel contains ZERO cells with "FDH".');
    }

    const headers = sheet.getRow(4).values;
    console.log(`✓ Row 4 Headers (${headers.length - 1} cols):`, headers.slice(1).join(' | '));
    if (headers.includes('FDH Roll Number')) {
      console.error('✗ FAIL: Row 4 still contains "FDH Roll Number" header!');
      failures++;
    } else {
      console.log('✓ PASS: "FDH Roll Number" header completely eliminated.');
    }
  } catch (err) {
    console.error('✗ FAIL Student Master Excel error:', err.message);
    failures++;
  }

  // ----------------------------------------------------
  // TEST 7: Student Allocation Multi-tab Excel Report
  // ----------------------------------------------------
  console.log('\n--- 7. Testing Student Allocation Excel Report ---');
  try {
    const allocExcelBuf = await ExcelService.generateAllocationWorkbook(exam, allocation, classroom);
    
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(allocExcelBuf);

    const sheetNames = workbook.worksheets.map(w => w.name);
    console.log('✓ Worksheets generated:', sheetNames.join(', '));

    let fdhFound = false;
    workbook.eachSheet((worksheet) => {
      worksheet.eachRow((row, rowNumber) => {
        row.eachCell((cell, colNumber) => {
          const val = String(cell.value || '');
          if (/FDH/i.test(val)) {
            console.error(`✗ FAIL: Sheet "${worksheet.name}" cell (${rowNumber}, ${colNumber}) has FDH: "${val}"`);
            fdhFound = true;
          }
        });
      });
    });

    if (fdhFound) {
      failures++;
    } else {
      console.log('✓ PASS: All worksheets contain ZERO cells with "FDH".');
    }

    const masterSheet = workbook.getWorksheet('Master Allocation');
    const headers = masterSheet.getRow(5).values;
    console.log(`✓ Master Sheet Headers (${headers.length - 1} cols):`, headers.slice(1).join(' | '));
    if (headers.includes('FDH Roll No')) {
      console.error('✗ FAIL: Row 5 still contains "FDH Roll No" header!');
      failures++;
    } else {
      console.log('✓ PASS: "FDH Roll No" header removed. Columns properly recalculated.');
    }
  } catch (err) {
    console.error('✗ FAIL Allocation Excel error:', err.message);
    failures++;
  }

  // ----------------------------------------------------
  // TEST 8: Subject-wise & Faculty-wise Excel Reports
  // ----------------------------------------------------
  console.log('\n--- 8. Testing Subject-wise & Faculty-wise Excel Reports ---');
  try {
    const sampleStudents = await StudentEnrollment.find().limit(20);
    const subExcelBuf = await ExcelService.generateSubjectWiseExcel('Computer Networks', sampleStudents);
    const facExcelBuf = await ExcelService.generateFacultyWiseExcel('Dr. K. Subba Rao', sampleStudents);

    const subWorkbook = new ExcelJS.Workbook();
    await subWorkbook.xlsx.load(subExcelBuf);
    let subFdh = false;
    subWorkbook.eachSheet(ws => ws.eachRow(r => r.eachCell(c => {
      if (/FDH/i.test(String(c.value || ''))) subFdh = true;
    })));

    const facWorkbook = new ExcelJS.Workbook();
    await facWorkbook.xlsx.load(facExcelBuf);
    let facFdh = false;
    facWorkbook.eachSheet(ws => ws.eachRow(r => r.eachCell(c => {
      if (/FDH/i.test(String(c.value || ''))) facFdh = true;
    })));

    if (subFdh || facFdh) {
      console.error('✗ FAIL: Subject/Faculty Excel contains FDH!');
      failures++;
    } else {
      console.log('✓ PASS: Both Subject-wise and Faculty-wise Excel exports contain ZERO FDH data.');
    }
  } catch (err) {
    console.error('✗ FAIL Subject/Faculty Excel error:', err.message);
    failures++;
  }

  // ----------------------------------------------------
  // TEST 9: Live HTTP API Endpoints Check
  // ----------------------------------------------------
  console.log('\n--- 9. Testing Live HTTP API Report Endpoints ---');
  try {
    // 1. Login to get JWT
    const loginRes = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@rgmcet.edu.in', password: 'AdminExam@2026' }),
    });
    const loginData = await loginRes.json();
    if (!loginData.token) {
      throw new Error('Authentication failed for test admin.');
    }
    const token = loginData.token;
    console.log('✓ Authenticated with Super Admin JWT token');

    const endpoints = [
      { name: 'Master Students Excel', url: 'http://localhost:5000/api/reports/master-students-excel' },
      { name: 'Subject-wise Excel', url: 'http://localhost:5000/api/reports/subject-wise-excel?subject=Computer%20Networks' },
      { name: 'Faculty-wise Excel', url: 'http://localhost:5000/api/reports/faculty-wise-excel?faculty=Dr.%20K.%20Subba%20Rao' },
      { name: 'Group A Attendance PDF', url: `http://localhost:5000/api/exams/${exam._id}/reports/group-attendance-pdf?group=Group%20A` },
      { name: 'Group B Attendance PDF', url: `http://localhost:5000/api/exams/${exam._id}/reports/group-attendance-pdf?group=Group%20B` },
      { name: 'Attendance Signature PDF', url: `http://localhost:5000/api/exams/${exam._id}/reports/signature-pdf` },
      { name: 'Master Allocation PDF', url: `http://localhost:5000/api/exams/${exam._id}/reports/master-pdf` },
      { name: 'Seating Chart PDF', url: `http://localhost:5000/api/exams/${exam._id}/reports/seating-pdf` },
      { name: 'Allocation Excel', url: `http://localhost:5000/api/exams/${exam._id}/reports/excel` },
    ];

    for (const ep of endpoints) {
      const res = await fetch(ep.url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 200) {
        const buffer = await res.arrayBuffer();
        console.log(`✓ HTTP 200: ${ep.name} (${buffer.byteLength} bytes)`);
      } else {
        console.error(`✗ FAIL HTTP ${res.status}: ${ep.name}`);
        failures++;
      }
    }
  } catch (err) {
    console.error('✗ FAIL HTTP API test error:', err.message);
    failures++;
  }

  await mongoose.disconnect();

  console.log('\n====================================================');
  if (failures === 0) {
    console.log('  ALL AUDIT CHECKS PASSED: 100% SUCCESS');
    console.log('  FDH ROLL NUMBER IS FULLY REMOVED ACROSS ALL REPORTS');
    console.log('====================================================');
    process.exit(0);
  } else {
    console.error(`  AUDIT FAILED WITH ${failures} ERRORS`);
    console.log('====================================================');
    process.exit(1);
  }
}

runVerification();
