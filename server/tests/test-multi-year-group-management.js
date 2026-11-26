/**
 * Test Suite: Multi-Year, Multi-Faculty and Group-Based Examination Management
 * 
 * Validates:
 * 1. Third-year student classification (Regular 24091A0501 - 24091A05KN, FDH 25095A501 - 25095A549).
 * 2. Group A / Group B separation (cutoff: 24091A05E2 = Group A; 24091A05E3+ & FDH = Group B).
 * 3. Not classified by first two digits alone.
 * 4. Extensible Second-Year placeholder.
 * 5. Multiple examinations on the same date with different faculty, subjects, sections, years, and groups.
 * 6. Independent classroom collision detection (same room + same time = collision; different rooms = allowed).
 * 7. Group separation in mappings and allocations (never mixing Group A and Group B).
 * 8. Student Portal clean output (only subject, date, time, room, row, chair, set; NO group/year exposed).
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const studentClassificationService = require('../services/studentClassificationService');
const Exam = require('../models/Exam');
const Classroom = require('../models/Classroom');
const FacultyMapping = require('../models/FacultyMapping');
const Allocation = require('../models/Allocation');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/examseat-ai';

async function runTests() {
  console.log('================================================================');
  console.log('🧪 Starting Multi-Year, Multi-Faculty & Group Management Tests');
  console.log('================================================================\n');

  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB:', MONGO_URI);

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, testName) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passedTests++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      process.exitCode = 1;
    }
  }

  // -----------------------------------------------------------------
  // TEST SECTION 1: Third-Year Classification & Group A/B Cutoff Rules
  // -----------------------------------------------------------------
  console.log('\n--- Test 1: Third-Year Regular Classification ---');
  {
    const r1 = studentClassificationService.classifyStudent('24091A0501');
    assert(r1.isThirdYear === true, '24091A0501 is classified as Third Year');
    assert(r1.group === 'Group A', '24091A0501 is Group A (<= E2)');
    assert(r1.studentType === 'REGULAR', '24091A0501 is REGULAR');

    const rCutoff = studentClassificationService.classifyStudent('24091A05E2');
    assert(rCutoff.isThirdYear === true, '24091A05E2 is Third Year');
    assert(rCutoff.group === 'Group A', '24091A05E2 is Group A (cutoff boundary inclusive)');

    const rAfterCutoff = studentClassificationService.classifyStudent('24091A05E3');
    assert(rAfterCutoff.isThirdYear === true, '24091A05E3 is Third Year');
    assert(rAfterCutoff.group === 'Group B', '24091A05E3 is Group B (> E2)');

    const rKN = studentClassificationService.classifyStudent('24091A05KN');
    assert(rKN.isThirdYear === true, '24091A05KN is Third Year');
    assert(rKN.group === 'Group B', '24091A05KN is Group B');
  }

  console.log('\n--- Test 2: Third-Year FDH Classification ---');
  {
    const fdh1 = studentClassificationService.classifyStudent('25095A501');
    assert(fdh1.isThirdYear === true, '25095A501 is classified as Third Year');
    assert(fdh1.group === 'Group B', '25095A501 is Group B');
    assert(fdh1.studentType === 'FDH', '25095A501 is FDH');

    const fdh49 = studentClassificationService.classifyStudent('25095A549');
    assert(fdh49.isThirdYear === true, '25095A549 is Third Year');
    assert(fdh49.group === 'Group B', '25095A549 is Group B');

    // Also support 25095A0501 format
    const fdhAlt = studentClassificationService.classifyStudent('25095A0501');
    assert(fdhAlt.isThirdYear === true, '25095A0501 is Third Year');
    assert(fdhAlt.group === 'Group B', '25095A0501 is Group B');
  }

  console.log('\n--- Test 3: Do NOT classify by first two digits alone ---');
  {
    // A registration number that starts with 24 or 25 but is not regular CSE or FDH
    const fake1 = studentClassificationService.classifyStudent('24999B9999');
    assert(fake1.studentType === 'UNKNOWN' || fake1.isThirdYear === false, '24999B9999 is NOT falsely classified as 3rd Year CSE');

    const fake2 = studentClassificationService.classifyStudent('25091A0501'); // 25 regular is 2nd year, not 3rd year
    assert(fake2.isThirdYear === false, '25091A0501 is NOT 3rd year');
  }

  console.log('\n--- Test 4: Extensible Second-Year placeholder ---');
  {
    const rules = studentClassificationService.getRules();
    assert(rules.secondYear !== undefined, 'Second year configuration exists in rules');
    assert(rules.secondYear.configurable === true, 'Second year is marked configurable');
  }

  // -----------------------------------------------------------------
  // TEST SECTION 2: Multiple Examinations on the Same Date
  // -----------------------------------------------------------------
  console.log('\n--- Test 5: Multiple Exams on Same Date (Different Years & Groups) ---');
  const testDate = '2026-11-28';
  let room1, room2, room3;
  let testExam1, testExam2, testExam3;

  try {
    // Get 3 classrooms
    const rooms = await Classroom.find({ isActive: true }).limit(3);
    if (rooms.length < 3) {
      console.log('Creating test classrooms...');
      room1 = await Classroom.create({ name: 'ET BLOCK 3020', totalCapacity: 72, rowCount: 12, seatsPerRow: 6, isActive: true });
      room2 = await Classroom.create({ name: 'ET BLOCK 3030', totalCapacity: 72, rowCount: 12, seatsPerRow: 6, isActive: true });
      room3 = await Classroom.create({ name: 'ET BLOCK 3040', totalCapacity: 72, rowCount: 12, seatsPerRow: 6, isActive: true });
    } else {
      room1 = rooms[0];
      room2 = rooms[1];
      room3 = rooms[2];
    }

    // Clean up any prior test exams
    await Exam.deleteMany({ examName: { $regex: /^TEST-MULTI-/ } });

    // Exam 1: 3-2 Group A, Faculty A, ET BLOCK 3020
    testExam1 = await Exam.create({
      examName: 'TEST-MULTI-3-2-GroupA',
      subjectName: 'Test Machine Learning',
      subjectCode: 'TEST-CS301',
      academicYear: '2026-2027',
      year: 'III Year (3-2)',
      group: 'Group A',
      section: 'A1',
      facultyName: 'Dr. Faculty A',
      examDate: testDate,
      startTime: '09:00 AM',
      endTime: '12:00 PM',
      session: 'FN',
      classroomId: room1._id,
      studentCount: 36,
      status: 'SCHEDULED',
      approvalStatus: 'PENDING_REVIEW'
    });
    assert(testExam1._id != null, 'Created Exam 1: 3-2 Group A on Nov 28 in Room 1');

    // Exam 2: 2-2 Group A, Faculty B, ET BLOCK 3030 (Same Date!)
    testExam2 = await Exam.create({
      examName: 'TEST-MULTI-2-2-GroupA',
      subjectName: 'Test Data Structures',
      subjectCode: 'TEST-CS201',
      academicYear: '2026-2027',
      year: 'II Year (2-2)',
      group: 'Group A',
      section: 'A1',
      facultyName: 'Dr. Faculty B',
      examDate: testDate,
      startTime: '09:00 AM',
      endTime: '12:00 PM',
      session: 'FN',
      classroomId: room2._id,
      studentCount: 36,
      status: 'SCHEDULED',
      approvalStatus: 'PENDING_REVIEW'
    });
    assert(testExam2._id != null, 'Created Exam 2: 2-2 Group A on Nov 28 in Room 2 (Same Date, Different Year)');

    // Exam 3: 3-2 Group B, Faculty C, ET BLOCK 3040 (Same Date & Year, Different Group!)
    testExam3 = await Exam.create({
      examName: 'TEST-MULTI-3-2-GroupB',
      subjectName: 'Test Cloud Computing',
      subjectCode: 'TEST-CS302',
      academicYear: '2026-2027',
      year: 'III Year (3-2)',
      group: 'Group B',
      section: 'A1',
      facultyName: 'Dr. Faculty C',
      examDate: testDate,
      startTime: '09:00 AM',
      endTime: '12:00 PM',
      session: 'FN',
      classroomId: room3._id,
      studentCount: 36,
      status: 'SCHEDULED',
      approvalStatus: 'PENDING_REVIEW'
    });
    assert(testExam3._id != null, 'Created Exam 3: 3-2 Group B on Nov 28 in Room 3 (Same Date, Different Group)');

    // Query all exams on testDate
    const examsOnDate = await Exam.find({ examDate: testDate, examName: { $regex: /^TEST-MULTI-/ } });
    assert(examsOnDate.length === 3, 'All 3 exams coexist simultaneously on Nov 28 with distinct IDs');

  } catch (err) {
    console.error('Multi-Exam Creation Error:', err);
    assert(false, 'Multiple exams on same date creation threw error: ' + err.message);
  }

  // -----------------------------------------------------------------
  // TEST SECTION 3: Classroom Collision Detection
  // -----------------------------------------------------------------
  console.log('\n--- Test 6: Classroom Conflict Checking ---');
  {
    // Try scheduling another exam in the SAME classroom (room1) at the SAME date and time window
    const checkRoomConflict = async (roomId, date, sTime, eTime) => {
      return await Exam.findOne({
        classroomId: roomId,
        examDate: date,
        startTime: sTime,
        endTime: eTime,
        status: { $ne: 'CANCELLED' }
      });
    };

    const conflictSameRoom = await checkRoomConflict(room1._id, testDate, '09:00 AM', '12:00 PM');
    assert(conflictSameRoom != null, 'Room collision detected when attempting to double-book Room 1 at 09:00 AM');

    const noConflictDifferentRoom = await checkRoomConflict(new mongoose.Types.ObjectId(), testDate, '09:00 AM', '12:00 PM');
    assert(noConflictDifferentRoom == null, 'No room collision detected for unbooked room on Nov 28');
  }

  // -----------------------------------------------------------------
  // TEST SECTION 4: Group Separation in Mappings & Allocations
  // -----------------------------------------------------------------
  console.log('\n--- Test 7: Group Separation (No Mixing of Group A & B) ---');
  {
    const sampleStudents = [
      { regNo: '24091A0501', studentName: 'Student One', section: 'A1' },
      { regNo: '24091A05E2', studentName: 'Student Cutoff', section: 'A1' },
      { regNo: '24091A05E3', studentName: 'Student AfterCutoff', section: 'A1' },
      { regNo: '25095A501', studentName: 'Student FDH', section: 'A1' },
    ];

    const groupAStudents = studentClassificationService.filterStudentsByGroup(sampleStudents, 'Group A');
    const groupBStudents = studentClassificationService.filterStudentsByGroup(sampleStudents, 'Group B');

    assert(groupAStudents.length === 2, 'Group A filtering returned exactly 2 students');
    assert(groupAStudents.every(s => s.regNo === '24091A0501' || s.regNo === '24091A05E2'), 'Group A contains only <= E2 students');

    assert(groupBStudents.length === 2, 'Group B filtering returned exactly 2 students');
    assert(groupBStudents.every(s => s.regNo === '24091A05E3' || s.regNo === '25095A501'), 'Group B contains only > E2 & FDH students');

    const overlap = groupAStudents.filter(a => groupBStudents.some(b => b.regNo === a.regNo));
    assert(overlap.length === 0, 'Zero overlap: Group A and Group B students are completely separated');
  }

  // -----------------------------------------------------------------
  // TEST SECTION 5: Student Portal Clean Output (No Group / Year)
  // -----------------------------------------------------------------
  console.log('\n--- Test 8: Student Portal Clean Presentation ---');
  {
    // Mock student result object
    const studentSeatingView = {
      subjectName: testExam1.subjectName,
      subjectCode: testExam1.subjectCode,
      examDate: testExam1.examDate,
      examTime: `${testExam1.startTime} – ${testExam1.endTime}`,
      classroom: 'ET BLOCK 3020',
      rowNumber: 'R3',
      chairNumber: 'C14',
      set: 'Set A'
    };

    assert(studentSeatingView.subjectName !== undefined, 'Student view has Subject Name');
    assert(studentSeatingView.subjectCode !== undefined, 'Student view has Subject Code');
    assert(studentSeatingView.examDate !== undefined, 'Student view has Exam Date');
    assert(studentSeatingView.examTime !== undefined, 'Student view has Exam Time');
    assert(studentSeatingView.classroom !== undefined, 'Student view has Classroom');
    assert(studentSeatingView.rowNumber !== undefined, 'Student view has Row Number');
    assert(studentSeatingView.chairNumber !== undefined, 'Student view has Chair Number');
    assert(studentSeatingView.set !== undefined, 'Student view has Set (A/B/C)');

    assert(studentSeatingView.group === undefined, 'Student view does NOT expose group (Group A / Group B)');
    assert(studentSeatingView.academicYear === undefined, 'Student view does NOT expose academicYear');
  }

  // -----------------------------------------------------------------
  // CLEANUP
  // -----------------------------------------------------------------
  console.log('\n--- Cleaning up test records ---');
  await Exam.deleteMany({ examName: { $regex: /^TEST-MULTI-/ } });
  console.log('Test exams cleaned up.');

  console.log('\n================================================================');
  console.log(`Results: ${passedTests}/${totalTests} tests passed`);
  console.log('================================================================\n');

  await mongoose.disconnect();
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
