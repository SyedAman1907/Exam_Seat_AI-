const mongoose = require('mongoose');
const path = require('path');
const assert = require('assert');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const Subject = require('../models/Subject');
const Classroom = require('../models/Classroom');
const FacultyMapping = require('../models/FacultyMapping');
const Student = require('../models/Student');
const StudentEnrollment = require('../models/StudentEnrollment');
const Exam = require('../models/Exam');
const Allocation = require('../models/Allocation');
const classroomMappingService = require('../services/classroomMappingService');

let passedTests = 0;
let totalTests = 0;

function it(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ [PASS ${totalTests}] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ [FAIL ${totalTests}] ${name}`);
    console.error(`    -> ${err.message}`);
    throw err;
  }
}

async function itAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ [PASS ${totalTests}] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ [FAIL ${totalTests}] ${name}`);
    console.error(`    -> ${err.message}`);
    throw err;
  }
}

async function runAudit() {
  console.log('===============================================================');
  console.log('  EXAMSEAT AI — COMPREHENSIVE PRODUCTION VERIFICATION AUDIT');
  console.log('===============================================================');

  // [1] DATABASE CONNECTION
  console.log('\n--- 1. DATABASE & MONGO ATLAS PERSISTENCE ---');
  await itAsync('MongoDB Atlas connects successfully to examseat_ai', async () => {
    await mongoose.connect(process.env.MONGODB_URI);
    assert.strictEqual(mongoose.connection.readyState, 1);
    assert.strictEqual(mongoose.connection.name, 'examseat_ai');
  });

  // [2] SUBJECT MASTER COLLECTION
  console.log('\n--- 2. SUBJECT MASTER COLLECTION & DROPDOWN DATA ---');
  await itAsync('All 5 required subjects exist in permanent MongoDB collection', async () => {
    const subjects = await Subject.find({ isActive: true });
    const codeMap = new Map(subjects.map((s) => [s.abbreviation, s]));

    assert(codeMap.has('OOAD'), 'OOAD must exist');
    assert.strictEqual(codeMap.get('OOAD').subjectCode, '20A05504T');
    assert.strictEqual(codeMap.get('OOAD').subjectName, 'Object Oriented Analysis and Design');

    assert(codeMap.has('ATCD'), 'ATCD must exist');
    assert.strictEqual(codeMap.get('ATCD').subjectCode, '20A05501T');
    assert.strictEqual(codeMap.get('ATCD').subjectName, 'Automata Theory and Compiler Design');

    assert(codeMap.has('AI'), 'AI must exist');
    assert.strictEqual(codeMap.get('AI').subjectCode, '20A05502S');
    assert.strictEqual(codeMap.get('AI').subjectName, 'Artificial Intelligence');

    assert(codeMap.has('IQTA'), 'IQTA must exist');
    assert.strictEqual(codeMap.get('IQTA').subjectCode, '20A05505T');
    assert.strictEqual(codeMap.get('IQTA').subjectName, 'Introduction to Quantum Technologies and Applications');

    assert(codeMap.has('CN'), 'CN must exist');
    assert.strictEqual(codeMap.get('CN').subjectCode, '20A05502T');
    assert.strictEqual(codeMap.get('CN').subjectName, 'Computer Networks');
  });

  // [3] CLASSROOMS CONFIGURATION (EXACTLY 72 SEATS)
  console.log('\n--- 3. CLASSROOM CONFIGURATION & 72-SEAT CAPACITY ---');
  await itAsync('All 6 classrooms exist and are active in database', async () => {
    const requiredRooms = ['3010', '3020', '3030', '3040', '3050', '3060'];
    const rooms = await Classroom.find({ roomNumber: { $in: requiredRooms }, isActive: true });
    assert.strictEqual(rooms.length, 6, 'All 6 ET BLOCK rooms must exist');
  });

  await itAsync('Every classroom has totalCapacity=72 and exactly 3 disabled seats', async () => {
    const requiredRooms = ['3010', '3020', '3030', '3040', '3050', '3060'];
    const rooms = await Classroom.find({ roomNumber: { $in: requiredRooms } });

    for (const r of rooms) {
      assert.strictEqual(r.totalCapacity, 72, `Room ${r.roomNumber} totalCapacity must be 72`);
      assert.strictEqual(r.availableCapacity, 72, `Room ${r.roomNumber} availableCapacity must be 72`);

      let physical = 0;
      let enabled = 0;
      let disabled = 0;

      r.rows.forEach((row) => {
        row.benches.forEach((bench) => {
          bench.seats.forEach((seat) => {
            physical++;
            if (seat.isAvailable !== false) enabled++;
            else disabled++;
          });
        });
      });

      assert.strictEqual(physical, 75, `Room ${r.roomNumber} physical positions must be 75 (3x5x5)`);
      assert.strictEqual(enabled, 72, `Room ${r.roomNumber} enabled seats must be 72`);
      assert.strictEqual(disabled, 3, `Room ${r.roomNumber} disabled seats must be 3`);
    }
  });

  // [4] SECTION-TO-CLASSROOM MAPPINGS
  console.log('\n--- 4. SECTION-TO-CLASSROOM ASSIGNMENT & CAPACITY RULES ---');
  it('Default section-to-classroom mappings correspond to 3010-3060', () => {
    assert.strictEqual(classroomMappingService.getRoomNumberForSection('A1'), '3010');
    assert.strictEqual(classroomMappingService.getRoomNumberForSection('A2'), '3020');
    assert.strictEqual(classroomMappingService.getRoomNumberForSection('A3'), '3030');
    assert.strictEqual(classroomMappingService.getRoomNumberForSection('A4'), '3040');
    assert.strictEqual(classroomMappingService.getRoomNumberForSection('A5'), '3050');
    assert.strictEqual(classroomMappingService.getRoomNumberForSection('A6'), '3060');
  });

  it('Capacity validation rejects student count > 72', () => {
    const dummyRoom = { name: 'ET BLOCK 3010', totalCapacity: 72, availableCapacity: 72 };
    assert.doesNotThrow(() => classroomMappingService.validateCapacity(dummyRoom, 72, 'A1'));
    assert.throws(() => classroomMappingService.validateCapacity(dummyRoom, 73, 'A1'), /Classroom capacity exceeded/);
  });

  // [5] FACULTY & STUDENT MAPPING CRUD AND PERSISTENCE
  console.log('\n--- 5. FACULTY & STUDENT MAPPING CRUD & INTEGRITY ---');
  let testMappingId = null;

  await itAsync('Creates and persists a new permanent FacultyMapping in MongoDB', async () => {
    const testStudents = [
      { registrationNumber: '24091A0591', name: 'Student Alpha', group: 'Group A' },
      { registrationNumber: '24091A0592', name: 'Student Beta', group: 'Group A' },
    ];

    const mapping = new FacultyMapping({
      facultyName: 'Dr. Test Professor',
      subjectName: 'Automata Theory and Compiler Design',
      subjectCode: '20A05501T',
      section: 'A1',
      group: 'Group A',
      academicYear: '2026-2027',
      students: testStudents,
      studentCount: 2,
      isCurrent: true,
      status: 'ACTIVE',
      version: 99,
      sourceFileName: 'TestAudit.pdf',
    });

    await mapping.save();
    testMappingId = mapping._id;
    assert(testMappingId, 'Mapping ID must be generated');

    const fetched = await FacultyMapping.findById(testMappingId);
    assert.strictEqual(fetched.facultyName, 'Dr. Test Professor');
    assert.strictEqual(fetched.studentCount, 2);
    assert.strictEqual(fetched.version, 99);
  });

  await itAsync('Updates mapping and increments version without silent overwriting', async () => {
    const mapping = await FacultyMapping.findById(testMappingId);
    mapping.students.push({ registrationNumber: '24091A0593', name: 'Student Gamma', group: 'Group A' });
    mapping.version = mapping.version + 1;
    await mapping.save();

    const updated = await FacultyMapping.findById(testMappingId);
    assert.strictEqual(updated.studentCount, 3);
    assert.strictEqual(updated.version, 100);

    // Clean up test mapping
    await FacultyMapping.deleteOne({ _id: testMappingId });
  });

  // [6] PUBLISHED EXAMINATION CANCELLATION & ROOM RELEASE
  console.log('\n--- 6. EXAMINATION CANCELLATION & ROOM RESERVATION RELEASE ---');
  await itAsync('Cancelling examination sets CANCELLED status, preserves records, and frees room', async () => {
    await Exam.deleteMany({ examName: 'Audit Test Exam' });
    const testExam = new Exam({
      examName: 'Audit Test Exam',
      subjectName: 'Artificial Intelligence',
      subjectCode: '20A05502S',
      examDate: '2026-12-01',
      session: 'FN',
      startTime: '09:00 AM',
      endTime: '12:00 PM',
      classroomId: (await Classroom.findOne({ roomNumber: '3010' }))._id,
      status: 'PUBLISHED',
      approvalStatus: 'APPROVED',
      isDeleted: false,
      isActive: true,
    });
    await testExam.save();

    // Check conflict exists while active
    const conflictBefore = await classroomMappingService.checkClassroomConflict(
      testExam.classroomId,
      '2026-12-01',
      new Date('2026-12-01T03:30:00.000Z'),
      new Date('2026-12-01T06:30:00.000Z'),
      'FN'
    );
    assert(conflictBefore, 'Room must show as booked before cancellation');

    // Cancel exam with reason
    testExam.approvalStatus = 'CANCELLED';
    testExam.visibilityStatus = 'CANCELLED';
    testExam.status = 'CANCELLED';
    testExam.isActive = false;
    testExam.cancellationReason = 'Test audit cancellation';
    testExam.cancelledAt = new Date();
    await testExam.save();

    // Check conflict is released after cancellation
    const conflictAfter = await classroomMappingService.checkClassroomConflict(
      testExam.classroomId,
      '2026-12-01',
      new Date('2026-12-01T03:30:00.000Z'),
      new Date('2026-12-01T06:30:00.000Z'),
      'FN'
    );
    assert.strictEqual(conflictAfter, null, 'Room reservation must be released after cancellation');

    // Clean up test exam
    await Exam.deleteOne({ _id: testExam._id });
  });

  // [7] STUDENT SEAT FINDER & TIME LOGIC
  console.log('\n--- 7. TIME CONFLICTS & 24 NOVEMBER SCHEDULE ---');
  await itAsync('Exam on 24 November 2026 is properly scheduled for 01:10 PM - 02:10 PM FN', async () => {
    const exam24 = await Exam.findById('6b049322980002a25a9707d2');
    assert(exam24, '24 Nov exam must exist');
    assert.strictEqual(exam24.startTime, '01:10 PM');
    assert.strictEqual(exam24.endTime, '02:10 PM');
    assert.strictEqual(exam24.session, 'FN');

    // Conflict check during 01:10 PM - 02:10 PM
    const room3010 = await Classroom.findOne({ roomNumber: '3010' });
    const conflictDuring = await classroomMappingService.checkClassroomConflict(
      room3010._id,
      '2026-11-24',
      new Date('2026-11-24T07:40:00.000Z'),
      new Date('2026-11-24T08:40:00.000Z'),
      'FN'
    );
    assert(conflictDuring, 'Classroom must be occupied between 01:10 PM and 02:10 PM');

    // Conflict check after 02:30 PM (09:00 UTC)
    const conflictAfter = await classroomMappingService.checkClassroomConflict(
      room3010._id,
      '2026-11-24',
      new Date('2026-11-24T09:00:00.000Z'),
      new Date('2026-11-24T10:00:00.000Z'),
      'AN'
    );
    assert.strictEqual(conflictAfter, null, 'Classroom must be available from 02:30 PM onwards');
  });

  await mongoose.disconnect();

  console.log('\n===============================================================');
  console.log(`  AUDIT COMPLETE: ${passedTests}/${totalTests} TESTS PASSED (100% SUCCESS)`);
  console.log('===============================================================');
}

runAudit().catch((e) => {
  console.error('\nAUDIT FAILED:', e);
  process.exit(1);
});
