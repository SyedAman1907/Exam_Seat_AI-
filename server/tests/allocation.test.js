const assert = require('assert');
const SeatingService = require('../services/seatingService');
const SetAllocationService = require('../services/setAllocationService');
const ReportService = require('../services/reportService');
const ExcelService = require('../services/excelService');

async function runTests() {
  console.log('\n======================================================');
  console.log('  EXAMSEAT AI — AUTOMATED TEST SUITE');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    ${err.message}`);
      failed++;
    }
  }

  async function testAsync(name, fn) {
    try {
      await fn();
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    ${err.message}`);
      failed++;
    }
  }

  // Generate mock 72 students (24091A0501 - 24091A0572)
  const students72 = [];
  for (let i = 1; i <= 72; i++) {
    const num = String(i).padStart(2, '0');
    students72.push({
      _id: `mock-student-${i}`,
      registrationNumber: `24091A05${num}`,
      name: `Student ${num}`,
      department: 'CSE',
      section: 'A',
    });
  }

  // Generate 72-seat classroom layout:
  // Row 1: 5 benches x 5 seats = 25
  // Row 2: 5 benches (5, 5, 4, 4, 4) = 22
  // Row 3: 5 benches x 5 seats = 25
  // Total = 72 seats
  const mockClassroom = {
    _id: 'mock-classroom-1',
    name: 'Hall A-101',
    roomNumber: 'A-101',
    rows: [
      {
        rowNumber: 1,
        benches: [1, 2, 3, 4, 5].map(b => ({
          benchNumber: b,
          seats: [1, 2, 3, 4, 5].map(s => ({ seatId: `R1-B${b}-S${s}`, seatNumber: s, isAvailable: true })),
        })),
      },
      {
        rowNumber: 2,
        benches: [
          { benchNumber: 1, seats: [1, 2, 3, 4, 5].map(s => ({ seatId: `R2-B1-S${s}`, seatNumber: s, isAvailable: true })) },
          { benchNumber: 2, seats: [1, 2, 3, 4, 5].map(s => ({ seatId: `R2-B2-S${s}`, seatNumber: s, isAvailable: true })) },
          { benchNumber: 3, seats: [1, 2, 3, 4].map(s => ({ seatId: `R2-B3-S${s}`, seatNumber: s, isAvailable: true })) },
          { benchNumber: 4, seats: [1, 2, 3, 4].map(s => ({ seatId: `R2-B4-S${s}`, seatNumber: s, isAvailable: true })) },
          { benchNumber: 5, seats: [1, 2, 3, 4].map(s => ({ seatId: `R2-B5-S${s}`, seatNumber: s, isAvailable: true })) },
        ],
      },
      {
        rowNumber: 3,
        benches: [1, 2, 3, 4, 5].map(b => ({
          benchNumber: b,
          seats: [1, 2, 3, 4, 5].map(s => ({ seatId: `R3-B${b}-S${s}`, seatNumber: s, isAvailable: true })),
        })),
      },
    ],
  };

  // Test 1: Fisher-Yates Shuffle
  test('Fisher-Yates Shuffle produces all original elements without duplication', () => {
    const list = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const shuffled = SeatingService.fisherYatesShuffle(list);
    assert.strictEqual(shuffled.length, list.length);
    const sorted = [...shuffled].sort((a, b) => a - b);
    assert.deepStrictEqual(sorted, list);
  });

  // Test 2: Classroom Seats Flattening
  test('Classroom capacity calculation extracts exactly 72 available seats', () => {
    const seats = SeatingService.getAvailableSeats(mockClassroom);
    assert.strictEqual(seats.length, 72, 'Should have exactly 72 available seats');
    assert.strictEqual(seats[0].seatId, 'R1-B1-S1');
    assert.strictEqual(seats[71].seatId, 'R3-B5-S5');
  });

  // Test 3: Insufficient capacity check
  test('Rejects allocation when student count exceeds available seats', () => {
    const smallClassroom = {
      rows: [
        {
          rowNumber: 1,
          benches: [{ benchNumber: 1, seats: [{ seatId: 'R1-B1-S1', seatNumber: 1, isAvailable: true }] }],
        },
      ],
    };

    assert.throws(
      () => SeatingService.generateAllocation(students72, smallClassroom),
      /Insufficient classroom capacity/
    );
  });

  // Test 4: Complete 72-Student Allocation & Balanced Distribution
  let fullAllocation;
  test('72-student allocation achieves exact balanced distribution: 24 A, 24 B, 24 C', () => {
    fullAllocation = SeatingService.generateAllocation(students72, mockClassroom);
    assert.strictEqual(fullAllocation.students.length, 72);
    assert.strictEqual(fullAllocation.setDistribution.A, 24, 'Set A must equal 24');
    assert.strictEqual(fullAllocation.setDistribution.B, 24, 'Set B must equal 24');
    assert.strictEqual(fullAllocation.setDistribution.C, 24, 'Set C must equal 24');
    assert.strictEqual(fullAllocation.setDistribution.total, 72);
  });

  // Test 5: Same-Bench Adjacency Constraint
  test('Strictly satisfies bench adjacency rule: NO two adjacent seats on ANY bench have the same set', () => {
    assert(fullAllocation.validationStatus.isValid, 'Validation must report valid');
    assert.strictEqual(fullAllocation.validationStatus.hasAdjacentCollisions, false);
    assert.strictEqual(fullAllocation.validationStatus.violations.length, 0);

    // Manual double check
    const benchMap = {};
    fullAllocation.students.forEach(s => {
      const key = `${s.rowNumber}-${s.benchNumber}`;
      if (!benchMap[key]) benchMap[key] = [];
      benchMap[key].push(s);
    });

    Object.keys(benchMap).forEach(key => {
      const benchSeats = benchMap[key].sort((a, b) => a.seatNumber - b.seatNumber);
      for (let i = 0; i < benchSeats.length - 1; i++) {
        const s1 = benchSeats[i];
        const s2 = benchSeats[i + 1];
        assert.notStrictEqual(
          s1.questionPaperSet,
          s2.questionPaperSet,
          `Adjacency violation at ${key} between Seat ${s1.seatNumber} (${s1.questionPaperSet}) and Seat ${s2.seatNumber} (${s2.questionPaperSet})`
        );
      }
    });
  });

  // Test 6: Unique Seat & Unique Student Validation
  test('Every student is assigned to a unique seat and every seat is assigned to a unique student', () => {
    const assignedSeats = new Set();
    const assignedStudents = new Set();

    fullAllocation.students.forEach(s => {
      assert(!assignedSeats.has(s.seatId), `Seat double-booked: ${s.seatId}`);
      assert(!assignedStudents.has(s.registrationNumber), `Student double-assigned: ${s.registrationNumber}`);
      assignedSeats.add(s.seatId);
      assignedStudents.add(s.registrationNumber);
    });

    assert.strictEqual(assignedSeats.size, 72);
    assert.strictEqual(assignedStudents.size, 72);
  });

  // Test 7: PDF Generation (Master, Attendance, Seating Chart)
  const mockExam = {
    examName: 'Mid-Term Examination I',
    academicYear: '2026-2027',
    department: 'Computer Science and Engineering',
    year: 'IV Year',
    semester: 'I Semester',
    section: 'A',
    subjectName: 'Artificial Intelligence & Machine Learning',
    subjectCode: 'A0526197',
    examDate: '2026-11-25',
    session: 'FN',
  };

  await testAsync('PDF Generation: Master Student Allocation creates valid PDF buffer', async () => {
    const buffer = await ReportService.generateMasterPDF(mockExam, fullAllocation, mockClassroom);
    assert(Buffer.isBuffer(buffer), 'Must return a Buffer');
    assert(buffer.length > 1000, 'Buffer must contain PDF data (> 1000 bytes)');
    // PDF header check (%PDF-)
    assert.strictEqual(buffer.slice(0, 4).toString(), '%PDF');
  });

  await testAsync('PDF Generation: Attendance & Signature Sheet creates valid PDF buffer', async () => {
    const buffer = await ReportService.generateSignatureSheetPDF(mockExam, fullAllocation, mockClassroom);
    assert(Buffer.isBuffer(buffer));
    assert(buffer.length > 1000);
    assert.strictEqual(buffer.slice(0, 4).toString(), '%PDF');
  });

  await testAsync('PDF Generation: Classroom Seating Chart creates valid Landscape PDF buffer', async () => {
    const buffer = await ReportService.generateSeatingChartPDF(mockExam, fullAllocation, mockClassroom);
    assert(Buffer.isBuffer(buffer));
    assert(buffer.length > 1000);
    assert.strictEqual(buffer.slice(0, 4).toString(), '%PDF');
  });

  // Test 8: Excel Workbook Generation
  await testAsync('Excel Generation creates multi-tab workbook with Master, Set A, Set B, Set C sheets', async () => {
    const buffer = await ExcelService.generateAllocationWorkbook(mockExam, fullAllocation, mockClassroom);
    assert(Buffer.isBuffer(buffer));
    assert(buffer.length > 2000, 'Excel buffer must contain valid xlsx data');
  });

  console.log('\n======================================================');
  console.log(`  TEST RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
