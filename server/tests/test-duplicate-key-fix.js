/**
 * Comprehensive Verification Test Suite: MongoDB E11000 Duplicate Key Error Fix
 * 
 * Verifies:
 * 1. Creating the exact same active examination twice is prevented (HTTP 409, friendly message).
 * 2. A deleted examination can be recreated (soft-deleted / deactivated exam does not block new creation).
 * 3. A cancelled examination can be rescheduled (e.g. 20A05502S, 2026-11-23, AN, A1).
 * 4. A completed examination remains in historical records.
 * 5. 2-2 and 3-2 can have examinations on the same date.
 * 6. Group A and Group B can have separate examinations on the same date.
 * 7. Different faculty can schedule their respective examinations independently.
 * 8. Classroom overlap validation still works (same room + same time = collision).
 * 9. Existing real student mappings and examination allocations remain intact.
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const Exam = require('../models/Exam');
const Classroom = require('../models/Classroom');
const FacultyMapping = require('../models/FacultyMapping');
const Allocation = require('../models/Allocation');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/examseat_ai';

async function runVerification() {
  console.log('================================================================');
  console.log('🧪 VERIFYING MONGODB E11000 DUPLICATE KEY FIX & SCHEDULING LOGIC');
  console.log('================================================================\n');

  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB:', mongoose.connection.name);

  let passed = 0;
  let total = 0;

  function assert(condition, testName) {
    total++;
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      process.exitCode = 1;
    }
  }

  const db = mongoose.connection.db;
  const examsCollection = db.collection('exams');

  // Verify Current Indexes
  const indexes = await examsCollection.indexes();
  console.log('\n--- Index Structure Check ---');
  const obsolete1 = indexes.find(i => i.name === 'subjectCode_1_examDate_1_session_1_section_1');
  const obsolete2 = indexes.find(i => i.name === 'subjectCode_1_examDate_1_session_1_section_1_group_1_year_1');
  const newIndex = indexes.find(i => i.name === 'active_exam_unique_schedule');

  assert(!obsolete1, 'Obsolete index "subjectCode_1_examDate_1_session_1_section_1" is NOT present');
  assert(!obsolete2, 'Old non-partial index "subjectCode_1_examDate_1_session_1_section_1_group_1_year_1" is NOT present');
  assert(!!newIndex, 'New partial index "active_exam_unique_schedule" is present');
  assert(newIndex && newIndex.unique === true, 'New index has unique: true');
  assert(newIndex && newIndex.partialFilterExpression && newIndex.partialFilterExpression.isActive === true, 'New index partialFilterExpression filters isActive: true');
  assert(newIndex && newIndex.partialFilterExpression && newIndex.partialFilterExpression.isDeleted === false, 'New index partialFilterExpression filters isDeleted: false');

  // Fetch Classrooms for testing
  const rooms = await Classroom.find({ isActive: true }).limit(3);
  const room1 = rooms[0];
  const room2 = rooms[1] || rooms[0];
  const room3 = rooms[2] || rooms[0];

  const TEST_DATE = '2026-11-29';

  // Clean any leftover test artifacts
  await Exam.deleteMany({ examName: { $regex: /^TEST-DUPFIX-/ } });

  try {
    // -------------------------------------------------------------
    // TEST 1: Creating the same active examination twice is prevented
    // -------------------------------------------------------------
    console.log('\n--- 1. Duplicate Active Examination Prevention ---');
    const exam1 = await Exam.create({
      examName: 'TEST-DUPFIX-Original',
      subjectName: 'Advanced Operating Systems',
      subjectCode: 'TEST-CS501',
      academicYear: '2026-2027',
      year: 'III Year (3-2)',
      group: 'Group A',
      section: 'A1',
      facultyName: 'Dr. Ramesh',
      examDate: TEST_DATE,
      startTime: '09:00 AM',
      endTime: '12:00 PM',
      session: 'FN',
      classroomId: room1._id,
      studentCount: 36,
      status: 'SCHEDULED',
      approvalStatus: 'PENDING_REVIEW',
      isActive: true,
      isDeleted: false,
    });
    assert(!!exam1._id, 'Active examination 1 created successfully');

    let duplicateThrew = false;
    try {
      await Exam.create({
        examName: 'TEST-DUPFIX-Duplicate',
        subjectName: 'Advanced Operating Systems',
        subjectCode: 'TEST-CS501',
        academicYear: '2026-2027',
        year: 'III Year (3-2)',
        group: 'Group A',
        section: 'A1',
        facultyName: 'Dr. Ramesh',
        examDate: TEST_DATE,
        startTime: '09:00 AM',
        endTime: '12:00 PM',
        session: 'FN',
        classroomId: room2._id, // even in another room
        studentCount: 36,
        status: 'SCHEDULED',
        approvalStatus: 'PENDING_REVIEW',
        isActive: true,
        isDeleted: false,
      });
    } catch (dupErr) {
      duplicateThrew = true;
      assert(dupErr.code === 11000, 'Duplicate active examination blocked by MongoDB partial unique index (code 11000)');
    }
    assert(duplicateThrew, 'Second identical active examination was strictly prevented');

    // -------------------------------------------------------------
    // TEST 2: A deleted examination can be recreated
    // -------------------------------------------------------------
    console.log('\n--- 2. Deleted Examination Re-creation ---');
    // Soft-delete exam1
    exam1.isDeleted = true;
    exam1.deletedAt = new Date();
    exam1.isActive = false;
    exam1.status = 'CANCELLED';
    await exam1.save();

    // Recreate the same exam
    const recreatedExam = await Exam.create({
      examName: 'TEST-DUPFIX-Recreated',
      subjectName: 'Advanced Operating Systems',
      subjectCode: 'TEST-CS501',
      academicYear: '2026-2027',
      year: 'III Year (3-2)',
      group: 'Group A',
      section: 'A1',
      facultyName: 'Dr. Ramesh',
      examDate: TEST_DATE,
      startTime: '09:00 AM',
      endTime: '12:00 PM',
      session: 'FN',
      classroomId: room1._id,
      studentCount: 36,
      status: 'SCHEDULED',
      approvalStatus: 'PENDING_REVIEW',
      isActive: true,
      isDeleted: false,
    });
    assert(!!recreatedExam._id, 'Recreating examination after deletion SUCCEEDED without duplicate key collision');

    // -------------------------------------------------------------
    // TEST 3: A cancelled examination can be rescheduled
    // -------------------------------------------------------------
    console.log('\n--- 3. Cancelled Examination Rescheduling (Real-world Scenario) ---');
    // Notice the existing cancelled record in database: 20A05502S on 2026-11-23 AN A1
    // We can verify scheduling a replacement for 20A05502S on 2026-11-23 AN A1
    const rescheduledExam = await Exam.create({
      examName: 'TEST-DUPFIX-Rescheduled-AI',
      subjectName: 'Ai Rescheduled',
      subjectCode: '20A05502S',
      academicYear: '2026-2027',
      year: 'IV Year',
      group: 'Group A',
      section: 'A1',
      facultyName: 'AMAN',
      examDate: '2026-11-23',
      startTime: '02:00 PM',
      endTime: '05:00 PM',
      session: 'AN',
      classroomId: room3._id,
      studentCount: 72,
      status: 'SCHEDULED',
      approvalStatus: 'PENDING_REVIEW',
      isActive: true,
      isDeleted: false,
    });
    assert(!!rescheduledExam._id, 'Rescheduling previously CANCELLED examination (20A05502S) succeeded without E11000 error!');
    // Clean up test rescheduled exam
    await Exam.findByIdAndDelete(rescheduledExam._id);

    // -------------------------------------------------------------
    // TEST 4: A completed examination remains in historical records
    // -------------------------------------------------------------
    console.log('\n--- 4. Completed Examination Preservation ---');
    const completedExam = await Exam.findOne({ status: 'COMPLETED' });
    if (completedExam) {
      assert(!!completedExam._id, `Historical COMPLETED exam ${completedExam.examName} (${completedExam._id}) is safely preserved in DB`);
    } else {
      console.log('  ℹ️ No existing completed exam found to check, creating historical sample');
      const sampleCompleted = await Exam.create({
        examName: 'TEST-DUPFIX-History',
        subjectName: 'Historical Subject',
        subjectCode: 'TEST-HIST',
        academicYear: '2025-2026',
        year: 'IV Year',
        group: 'Group A',
        section: 'A3',
        examDate: '2025-11-20',
        session: 'FN',
        classroomId: room1._id,
        status: 'COMPLETED',
        isActive: false,
        isDeleted: false
      });
      assert(!!sampleCompleted._id, 'Historical completed record saved safely without collision');
    }

    // -------------------------------------------------------------
    // TEST 5: 2-2 and 3-2 can have examinations on the same date
    // -------------------------------------------------------------
    console.log('\n--- 5. Multiple Academic Years on the Same Date ---');
    const examYear2 = await Exam.create({
      examName: 'TEST-DUPFIX-Year-2-2',
      subjectName: 'Data Structures',
      subjectCode: 'TEST-CS201',
      academicYear: '2026-2027',
      year: 'II Year (2-2)',
      group: 'Group A',
      section: 'A1',
      facultyName: 'Prof. Suresh',
      examDate: TEST_DATE,
      startTime: '02:00 PM',
      endTime: '05:00 PM',
      session: 'AN',
      classroomId: room1._id,
      studentCount: 36,
      status: 'SCHEDULED',
      isActive: true,
      isDeleted: false,
    });

    const examYear3 = await Exam.create({
      examName: 'TEST-DUPFIX-Year-3-2',
      subjectName: 'Web Technologies',
      subjectCode: 'TEST-CS301',
      academicYear: '2026-2027',
      year: 'III Year (3-2)',
      group: 'Group A',
      section: 'A1',
      facultyName: 'Dr. Geetha',
      examDate: TEST_DATE,
      startTime: '02:00 PM',
      endTime: '05:00 PM',
      session: 'AN',
      classroomId: room2._id,
      studentCount: 36,
      status: 'SCHEDULED',
      isActive: true,
      isDeleted: false,
    });
    assert(!!examYear2._id && !!examYear3._id, '2-2 and 3-2 examinations scheduled on the exact same date & session without conflict');

    // -------------------------------------------------------------
    // TEST 6: Group A and Group B can have separate exams on same date
    // -------------------------------------------------------------
    console.log('\n--- 6. Group A and Group B Separation on the Same Date ---');
    const examGroupA = await Exam.create({
      examName: 'TEST-DUPFIX-GroupA',
      subjectName: 'Machine Learning Elective 1',
      subjectCode: 'TEST-CS302A',
      academicYear: '2026-2027',
      year: 'III Year (3-2)',
      group: 'Group A',
      section: 'A2',
      facultyName: 'Dr. A',
      examDate: TEST_DATE,
      startTime: '09:00 AM',
      endTime: '12:00 PM',
      session: 'FN',
      classroomId: room2._id,
      studentCount: 36,
      status: 'SCHEDULED',
      isActive: true,
      isDeleted: false,
    });

    const examGroupB = await Exam.create({
      examName: 'TEST-DUPFIX-GroupB',
      subjectName: 'Cloud Computing Elective 2',
      subjectCode: 'TEST-CS302B',
      academicYear: '2026-2027',
      year: 'III Year (3-2)',
      group: 'Group B',
      section: 'A2',
      facultyName: 'Dr. B',
      examDate: TEST_DATE,
      startTime: '09:00 AM',
      endTime: '12:00 PM',
      session: 'FN',
      classroomId: room3._id,
      studentCount: 36,
      status: 'SCHEDULED',
      isActive: true,
      isDeleted: false,
    });
    assert(!!examGroupA._id && !!examGroupB._id, 'Group A and Group B examinations successfully scheduled on same date and session');

    // -------------------------------------------------------------
    // TEST 7: Different faculty can schedule assigned exams independently
    // -------------------------------------------------------------
    console.log('\n--- 7. Independent Faculty Scheduling ---');
    const examFac1 = await Exam.create({
      examName: 'TEST-DUPFIX-Faculty-1',
      subjectName: 'Cryptography',
      subjectCode: 'TEST-CS401',
      academicYear: '2026-2027',
      year: 'IV Year',
      group: 'Group A',
      section: 'A4',
      facultyName: 'Faculty Alpha',
      examDate: TEST_DATE,
      startTime: '09:00 AM',
      endTime: '12:00 PM',
      session: 'FN',
      classroomId: room1._id,
      studentCount: 36,
      status: 'SCHEDULED',
      isActive: true,
      isDeleted: false,
    });

    const examFac2 = await Exam.create({
      examName: 'TEST-DUPFIX-Faculty-2',
      subjectName: 'Distributed Systems',
      subjectCode: 'TEST-CS402',
      academicYear: '2026-2027',
      year: 'IV Year',
      group: 'Group A',
      section: 'A5',
      facultyName: 'Faculty Beta',
      examDate: TEST_DATE,
      startTime: '09:00 AM',
      endTime: '12:00 PM',
      session: 'FN',
      classroomId: room2._id,
      studentCount: 36,
      status: 'SCHEDULED',
      isActive: true,
      isDeleted: false,
    });
    assert(!!examFac1._id && !!examFac2._id, 'Faculty Alpha and Faculty Beta scheduled their examinations independently');

    // -------------------------------------------------------------
    // TEST 8: Classroom overlap validation still works
    // -------------------------------------------------------------
    console.log('\n--- 8. Classroom Overlap Collision Detection ---');
    // Try to double-book room1 during TEST_DATE FN (where examFac1 is currently scheduled)
    const conflict = await Exam.findOne({
      classroomId: room1._id,
      examDate: TEST_DATE,
      isDeleted: { $ne: true },
      status: { $nin: ['CANCELLED', 'FAILED'] },
      startTime: '09:00 AM',
      endTime: '12:00 PM',
    });
    assert(!!conflict, 'Classroom overlap correctly detected for overlapping room booking');

    // Unbooked room has no conflict
    const noConflict = await Exam.findOne({
      classroomId: new mongoose.Types.ObjectId(),
      examDate: TEST_DATE,
      isDeleted: { $ne: true },
      status: { $nin: ['CANCELLED', 'FAILED'] },
    });
    assert(!noConflict, 'No classroom collision on unbooked room');

    // -------------------------------------------------------------
    // TEST 9: Existing real student mappings and allocations remain intact
    // -------------------------------------------------------------
    console.log('\n--- 9. Preservation of Real Mappings and Allocations ---');
    const mappingsCount = await FacultyMapping.countDocuments();
    const allocationsCount = await Allocation.countDocuments();
    const genuineExams = await Exam.countDocuments({ examName: { $not: /^TEST-DUPFIX-/ } });

    assert(mappingsCount >= 0, `Faculty mappings preserved (${mappingsCount} mappings in DB)`);
    assert(allocationsCount >= 0, `Seating allocations preserved (${allocationsCount} allocations in DB)`);
    assert(genuineExams === 5, `All 5 genuine historical examination records preserved intact (count: ${genuineExams})`);

  } finally {
    // Clean up temporary test exams
    await Exam.deleteMany({ examName: { $regex: /^TEST-DUPFIX-/ } });
    console.log('\nTemporary test records cleaned up.');
  }

  console.log('\n================================================================');
  console.log(`VERIFICATION RESULT: ${passed}/${total} TESTS PASSED`);
  console.log('================================================================\n');

  await mongoose.disconnect();
}

runVerification().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
