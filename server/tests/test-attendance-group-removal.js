const assert = require('assert');
const pdfParse = require('pdf-parse');
const ReportService = require('../services/reportService');

async function testAttendanceGroupRemoval() {
  console.log('========================================================');
  console.log('  TESTING ATTENDANCE & SIGNATURE PDF — GROUP REMOVAL   ');
  console.log('========================================================\n');

  // Create mock exam, allocation, classroom
  const mockExam = {
    _id: '6b0469f234e5f3fa8f392f61',
    examName: 'Mid-Term Examination I',
    academicYear: '2026-2027',
    department: 'Computer Science and Engineering',
    year: 'IV Year',
    semester: 'I Semester',
    subjectName: 'Artificial Intelligence',
    subjectCode: '20A05502T',
    facultyName: 'Dr. K. Subba Rao',
    section: 'A1',
    group: 'Group A',
    session: 'FN',
    examDate: '2026-11-23',
    startTime: '09:00 AM',
    endTime: '12:00 PM',
    studentCount: 50,
  };

  const mockClassroom = {
    name: 'ET BLOCK 3020',
    roomNumber: '3020',
  };

  const mockStudents = [];
  const sets = ['A', 'B', 'C'];
  for (let i = 1; i <= 50; i++) {
    mockStudents.push({
      registrationNumber: `24091A05${String(i).padStart(2, '0')}`,
      name: `KOLAGANI CANDIDATE ${i}`,
      group: i <= 25 ? 'Group A' : 'Group B',
      questionPaperSet: sets[(i - 1) % 3],
      rowNumber: Math.ceil(i / 12),
      benchNumber: Math.ceil((i % 12 || 12) / 2),
      seatNumber: (i % 2 === 1) ? 1 : 2,
    });
  }

  const mockAllocation = {
    examId: mockExam._id,
    students: mockStudents,
    setDistribution: { A: 17, B: 17, C: 16 },
  };

  // 1. Generate Attendance PDF
  console.log('1. Generating Attendance & Signature Sheet PDF buffer...');
  const pdfBuffer = await ReportService.generateAttendancePDF(mockExam, mockAllocation, mockClassroom);
  assert(Buffer.isBuffer(pdfBuffer), 'Must return a Buffer');
  assert(pdfBuffer.length > 5000, 'PDF buffer must contain content');
  console.log(`   ✓ Successfully generated PDF buffer (${pdfBuffer.length} bytes).\n`);

  // 2. Parse text with pdf-parse
  console.log('2. Parsing generated PDF text to inspect headers, columns, and rows...');
  const parsed = await pdfParse(pdfBuffer);
  const text = parsed.text;

  // 3. Verify Columns
  console.log('3. Verifying required columns exist in table header:');
  console.log('   - Checking "S.No."...');
  assert(text.includes('S.No.') || text.includes('S.No'), 'Must include S.No.');
  console.log('     ✓ S.No. present');

  console.log('   - Checking "Registration Number"...');
  assert(text.includes('Registration Number'), 'Must include Registration Number');
  console.log('     ✓ Registration Number present');

  console.log('   - Checking "Student Name"...');
  assert(text.includes('Student Name'), 'Must include Student Name');
  console.log('     ✓ Student Name present');

  console.log('   - Checking "Set (A/B/C)"...');
  assert(text.includes('Set (A/B/C)'), 'Must include Set (A/B/C)');
  console.log('     ✓ Set (A/B/C) present');

  console.log('   - Checking "Signature"...');
  assert(text.includes('Signature'), 'Must include Signature');
  console.log('     ✓ Signature present\n');

  // 4. Verify Group column and Group values are NOT present
  console.log('4. Verifying Group is NOT present:');
  // Check that "Group" is not a table column header
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Check header text: Should say "Total Candidates: 50" and NOT "Group: Group A"
  assert(!text.includes('Group: Group A'), 'Must NOT display "Group: Group A" in header');
  assert(!text.includes('Group: Group B'), 'Must NOT display "Group: Group B" in header');
  assert(text.includes('Total Candidates: 50'), 'Must display "Total Candidates: 50" in header');
  console.log('   ✓ Header displays "Total Candidates: 50" with zero Group labels.');

  // Check title
  assert(!text.includes('— GROUP A'), 'Title must NOT contain — GROUP A');
  assert(!text.includes('— [Group A]'), 'Title must NOT contain — [Group A]');
  assert(text.includes('EXAMINATION ATTENDANCE & SIGNATURE SHEET'), 'Title must be clean examination attendance sheet');
  console.log('   ✓ Document title is clean: "EXAMINATION ATTENDANCE & SIGNATURE SHEET".');

  // Verify students rows do not contain "Group A" or "Group B" in table
  assert(!text.includes('Group A'), 'PDF text must not contain "Group A"');
  assert(!text.includes('Group B'), 'PDF text must not contain "Group B"');
  console.log('   ✓ PDF contains zero occurrences of "Group A" or "Group B".');

  // 5. Verify Academic Section (A1) is preserved
  console.log('\n5. Verifying Academic Section (A1) is preserved:');
  assert(text.includes('Section: A1'), 'Section: A1 must be preserved in exam info box');
  console.log('   ✓ Section: A1 preserved intact.');

  // 6. Verify page count (50 students at 25 per page = exactly 2 pages, no extra blank page)
  console.log('\n6. Verifying Page Layout & Pagination:');
  console.log(`   - Total Pages: ${parsed.numpages}`);
  assert.strictEqual(parsed.numpages, 2, '50 students should occupy exactly 2 pages with 25 rows per page');
  console.log('   ✓ Exactly 2 pages generated. No unnecessary blank pages.\n');

  console.log('========================================================');
  console.log('  ALL ATTENDANCE GROUP REMOVAL TESTS PASSED!           ');
  console.log('========================================================');
}

testAttendanceGroupRemoval().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
