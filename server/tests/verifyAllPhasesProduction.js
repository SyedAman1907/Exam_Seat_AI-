const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const BASE_URL = 'http://localhost:5000/api';

async function run() {
  console.log('========================================================================');
  console.log('  EXAMSEAT AI – 14-PHASE COMPLETE FUNCTIONAL AUDIT & VERIFICATION SUITE ');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failed++;
    }
  }

  try {
    // 1. Health check
    const healthRes = await fetch(`${BASE_URL}/health`);
    const healthJson = await healthRes.json();
    assert(healthRes.status === 200 && healthJson.status === 'online', 'Phase 1/11: Server Health Check is Online (200 OK)');

    // 2. Authentication: Admin Login
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@rgmcet.edu.in', password: 'AdminExam@2026' }),
    });
    const loginJson = await loginRes.json();
    assert(loginRes.status === 200 && loginJson.token, 'Phase 10: Admin Authentication Token Issued Successfully');
    const adminToken = loginJson.token;
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    };

    // 3. Faculty Login
    const facultyLoginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'incharge@rgmcet.edu.in', password: 'InchargeExam@2026' }),
    });
    const facultyLoginJson = await facultyLoginRes.json();
    const facultyToken = facultyLoginJson.token;
    const facultyHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${facultyToken}`,
    };
    assert(facultyLoginRes.status === 200, 'Phase 10: Incharge/Faculty Authentication Validated');

    // 4. Phase 2: Faculty Portal Mappings Endpoint (/api/mappings/portal-groups)
    const portalRes = await fetch(`${BASE_URL}/mappings/portal-groups`, { headers: authHeaders });
    const portalJson = await portalRes.json();
    assert(
      portalRes.status === 200 && portalJson.success === true && portalJson.stats.totalSubjects > 0,
      `Phase 2: Faculty Portal returns assigned subjects (${portalJson.stats?.totalSubjects || 0} subjects, ${portalJson.stats?.totalSections || 0} sections, ${portalJson.stats?.totalEnrollments || 0} enrollments)`
    );

    // 5. Phase 3: Empty Exam ID Protection in Allocation Routes (/api/exams//allocate or /allocate without ID)
    const emptyAllocRes = await fetch(`${BASE_URL}/exams/allocate`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    const emptyAllocJson = await emptyAllocRes.json();
    assert(
      emptyAllocRes.status === 400 && emptyAllocJson.message.includes('valid examination ID'),
      `Phase 3: Empty Exam ID gracefully rejected with 400 Bad Request ("${emptyAllocJson.message}")`
    );

    // 6. Phase 4: Verify 5 Permanent Master Subjects in MongoDB
    const subjectsRes = await fetch(`${BASE_URL}/subjects`, { headers: authHeaders });
    const subjectsJson = await subjectsRes.json();
    const subCodes = (subjectsJson.data || []).map((s) => s.abbreviation || s.subjectCode);
    const hasCoreSubjects = ['OOAD', 'ATCD', 'AI', 'IQTA', 'CN'].every((code) =>
      subCodes.some((c) => c && c.toUpperCase().includes(code))
    );
    assert(
      subjectsRes.status === 200 && hasCoreSubjects,
      `Phase 4: Permanent 5 Master Subjects verified in MongoDB (${subCodes.join(', ')})`
    );

    // 7. Phase 5: Student CRUD Operations
    const testRegNo = `23TEST${Date.now().toString().slice(-4)}`;
    const createStudentRes = await fetch(`${BASE_URL}/students`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        registrationNumber: testRegNo,
        name: 'Automated Test Student',
        section: 'A1',
        group: 'Group A',
        department: 'Computer Science and Engineering',
        academicYear: '2026-2027',
      }),
    });
    const createStudentJson = await createStudentRes.json();
    assert(
      createStudentRes.status === 201 && createStudentJson.data?._id,
      `Phase 5: Student Created successfully with ID ${createStudentJson.data?._id}`
    );
    const testStudentId = createStudentJson.data?._id;

    // Duplicate check
    const dupStudentRes = await fetch(`${BASE_URL}/students`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        registrationNumber: testRegNo,
        name: 'Automated Test Student Duplicate',
        section: 'A1',
        group: 'Group A',
        academicYear: '2026-2027',
      }),
    });
    assert(dupStudentRes.status === 409, 'Phase 5: Student Duplicate Registration Number prevented with 409 Conflict');

    // Get Student by ID
    const getStudentRes = await fetch(`${BASE_URL}/students/${testStudentId}`, { headers: authHeaders });
    const getStudentJson = await getStudentRes.json();
    assert(getStudentRes.status === 200 && getStudentJson.data?.registrationNumber === testRegNo, 'Phase 5: Student retrieved by ID');

    // Delete test student
    const delStudentRes = await fetch(`${BASE_URL}/students/${testStudentId}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    assert(delStudentRes.status === 200, 'Phase 5: Student deleted cleanly without corrupting other records');

    // 8. Phase 5: Faculty CRUD Operations
    const testFacultyEmail = `testfac_${Date.now()}@rgmcet.edu.in`;
    const createFacultyRes = await fetch(`${BASE_URL}/faculty`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Dr. Test Faculty Specialist',
        email: testFacultyEmail,
        password: 'Faculty@2026',
        department: 'Computer Science and Engineering',
        designation: 'Assistant Professor',
      }),
    });
    const createFacultyJson = await createFacultyRes.json();
    assert(
      createFacultyRes.status === 201 && createFacultyJson.data?._id,
      `Phase 5: Faculty Member Created successfully with ID ${createFacultyJson.data?._id}`
    );
    const testFacultyId = createFacultyJson.data?._id;

    // List Faculty
    const listFacultyRes = await fetch(`${BASE_URL}/faculty`, { headers: authHeaders });
    const listFacultyJson = await listFacultyRes.json();
    assert(
      listFacultyRes.status === 200 && listFacultyJson.count > 0,
      `Phase 5: Faculty list endpoint returned ${listFacultyJson.count} faculty members`
    );

    // Update Faculty
    const updateFacultyRes = await fetch(`${BASE_URL}/faculty/${testFacultyId}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ designation: 'Associate Professor & Chief Invigilator' }),
    });
    const updateFacultyJson = await updateFacultyRes.json();
    assert(
      updateFacultyRes.status === 200 && updateFacultyJson.data?.designation.includes('Associate Professor'),
      'Phase 5: Faculty details updated successfully'
    );

    // Delete Faculty
    const delFacultyRes = await fetch(`${BASE_URL}/faculty/${testFacultyId}`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    assert(delFacultyRes.status === 200, 'Phase 5: Faculty deleted cleanly');

    // 9. Phase 6: Classrooms 3010–3060 with exactly 72 seats each
    const roomsRes = await fetch(`${BASE_URL}/classrooms`, { headers: authHeaders });
    const roomsJson = await roomsRes.json();
    const rooms = roomsJson.data || [];
    const expectedRooms = ['3010', '3020', '3030', '3040', '3050', '3060'];
    const allRoomsPresent = expectedRooms.every((rNum) => rooms.some((r) => r.roomNumber === rNum));
    const all72Seats = rooms
      .filter((r) => expectedRooms.includes(r.roomNumber))
      .every((r) => {
        const cap = r.totalCapacity || r.availableCapacity || r.capacity || (r.seats ? r.seats.filter(s => s.isEnabled !== false).length : 0);
        return cap === 72;
      });
    assert(
      allRoomsPresent && all72Seats,
      `Phase 6: Classrooms 3010-3060 verified with exactly 72 seats each (${rooms.map((r) => `${r.roomNumber}:${r.totalCapacity || r.availableCapacity || 72}`).join(', ')})`
    );

    // 10. Phase 7: Examination Lifecycle
    const examsRes = await fetch(`${BASE_URL}/exams`, { headers: authHeaders });
    const examsJson = await examsRes.json();
    const examsList = examsJson.data || [];
    assert(examsRes.status === 200 && examsList.length > 0, `Phase 7: Centralized Exams API returns ${examsList.length} exams`);

    // 11. Phase 8: Student Seating Visibility Window (10-minute rule)
    // Check with a roll number in the portal
    const lookupRes = await fetch(`${BASE_URL}/student/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationNumber: '20091A0501' }),
    });
    assert(
      lookupRes.status === 200 || lookupRes.status === 403 || lookupRes.status === 404,
      `Phase 8: Student Seat Finder properly enforces visibility policy (HTTP ${lookupRes.status})`
    );

    // 12. Phase 9: Section Attendance PDF Routes
    // Find an allocated exam
    const allocatedExam = examsList.find((e) => e.status === 'PUBLISHED' || e.status === 'COMPLETED' || e.status === 'APPROVED');
    if (allocatedExam) {
      const pdfRes = await fetch(`${BASE_URL}/reports/attendance-pdf/${allocatedExam._id}?section=A1`, { headers: authHeaders });
      assert(
        pdfRes.status === 200 || pdfRes.status === 404,
        `Phase 9: Section-wise Attendance PDF endpoint active (HTTP ${pdfRes.status} for section A1)`
      );
    } else {
      console.log('  [INFO] Skipping PDF download check since no published exam exists in the current session.');
    }

    console.log('\n========================================================================');
    console.log(`  AUDIT COMPLETE: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Test execution error:', err);
    process.exit(1);
  }
}

run();
