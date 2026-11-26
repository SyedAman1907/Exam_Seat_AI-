const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:5000/api';

async function timedFetch(endpoint, token, headers = {}) {
  const start = process.hrtime.bigint();
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  let data = null;
  if (res.headers.get('content-type')?.includes('json')) {
    data = JSON.parse(buf.toString('utf8'));
  }
  return { status: res.status, ms, bytes: buf.length, data, headers: res.headers };
}

async function run() {
  console.log('\n================================================================================');
  console.log('  EXAMSEAT AI — PHASE 9 PERFORMANCE & STUDENT DATA LOADING VERIFICATION');
  console.log('================================================================================\n');

  let passed = 0;
  let failed = 0;
  function assert(cond, label, details = '') {
    if (cond) {
      console.log(`  PASS: ${label}${details ? ` (${details})` : ''}`);
      passed++;
    } else {
      console.error(`  FAIL: ${label}${details ? ` (${details})` : ''}`);
      failed++;
    }
  }

  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'examseat_ai' });
  const db = mongoose.connection.db;

  // Verify MongoDB indexes created
  const studentIdxs = (await db.collection('students').indexes()).map((i) => i.name);
  const enrollIdxs = (await db.collection('studentenrollments').indexes()).map((i) => i.name);
  const classroomIdxs = (await db.collection('classrooms').indexes()).map((i) => i.name);
  const examIdxs = (await db.collection('exams').indexes()).map((i) => i.name);
  const auditIdxs = (await db.collection('auditlogs').indexes()).map((i) => i.name);

  assert(
    studentIdxs.some((n) => n.includes('section_1_group_1')) &&
      enrollIdxs.some((n) => n.includes('section_1_group_1_rollNumber_1')) &&
      classroomIdxs.some((n) => n.includes('isActive_1_roomNumber_1')) &&
      examIdxs.some((n) => n.includes('isDeleted_1_examDate_1_status_1')) &&
      auditIdxs.some((n) => n.includes('examId_1')),
    '0. Compound MongoDB indexes verified across collections',
    `students=${studentIdxs.length}, enrollments=${enrollIdxs.length}, classrooms=${classroomIdxs.length}`
  );

  // Admin Login
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@rgmcet.edu.in',
      password: process.env.ADMIN_INITIAL_PASSWORD || 'AdminExam@2026',
    }),
  });
  const loginJson = await loginRes.json();
  const token = loginJson.token;
  assert(Boolean(token), '0b. Admin Authentication Token Issued');

  // 1. Student Management Initial Load (Page 1, limit 50, with Meta)
  const dbLoad = await timedFetch('/students/database?page=1&limit=50&includeMeta=true', token);
  const d1 = dbLoad.data;
  assert(
    dbLoad.status === 200 &&
      d1?.success === true &&
      Array.isArray(d1?.data) &&
      d1.data.length <= 50 &&
      d1.pagination?.page === 1 &&
      d1.pagination?.limit === 50 &&
      d1.pagination?.totalRecords > 0 &&
      d1.count > 0 &&
      d1.masterStats?.total > 0 &&
      d1.masterStats?.groupA > 0 &&
      d1.masterStats?.groupB > 0 &&
      dbLoad.bytes < 100 * 1024,
    '1. Student Management paginated initial load is compact & returns real master + enrollment counts',
    `${dbLoad.ms.toFixed(1)}ms | ${(dbLoad.bytes / 1024).toFixed(1)} KB | rows=${d1?.data?.length}/${d1?.pagination?.totalRecords} | master=${d1?.masterStats?.total}`
  );

  // 2. Subsequent page load (Page 2, includeMeta=false)
  const dbPage2 = await timedFetch('/students/database?page=2&limit=50&includeMeta=false', token);
  const page1Ids = new Set((d1?.data || []).map((r) => r._id));
  const page2Ids = (dbPage2.data?.data || []).map((r) => r._id);
  const noOverlap = page2Ids.length > 0 && page2Ids.every((id) => !page1Ids.has(id));
  assert(
    dbPage2.status === 200 && dbPage2.data?.pagination?.page === 2 && noOverlap,
    '2. Server-side pagination page 2 returns distinct slice cleanly',
    `${dbPage2.ms.toFixed(1)}ms | ${(dbPage2.bytes / 1024).toFixed(1)} KB`
  );

  // 3. Active Classroom Count & Configuration (MUST be active rooms 3010-3060, NEVER 51 or 2010-2060)
  const rooms = d1?.classroomSummary?.roomNumbers || [];
  const dashRes = await timedFetch('/dashboard/stats', token);
  assert(
    d1?.classroomSummary?.activeCount === 6 &&
      rooms.includes('3010') &&
      rooms.includes('3060') &&
      !rooms.includes('2010') &&
      dashRes.data?.data?.totalClassrooms === 6 &&
      dashRes.data?.data?.totalStudents === d1?.masterStats?.total &&
      dashRes.bytes < 40 * 1024,
    '3. Classroom count dynamically matches active MongoDB classrooms (6 rooms: 3010–3060) & dashboard payload compact',
    `dashboard=${dashRes.ms.toFixed(1)}ms | ${(dashRes.bytes / 1024).toFixed(1)} KB | activeRooms=${d1?.classroomSummary?.activeCount}`
  );

  // 4. Filter by Subject, Section, Group & Search Registration Number
  const sampleSub = d1?.filtersAvailable?.subjects?.[0];
  const sampleRoll = d1?.data?.[0]?.rollNumber;

  const [subRes, secRes, grpARes, grpBRes, searchRes, filtersRes, classroomsRes, mappingsRes, examsRes] =
    await Promise.all([
      timedFetch(`/students/database?subject=${encodeURIComponent(sampleSub)}&page=1&limit=50&includeMeta=false`, token),
      timedFetch('/students/database?section=A1&page=1&limit=50&includeMeta=false', token),
      timedFetch('/students/database?group=Group%20A&page=1&limit=50&includeMeta=false', token),
      timedFetch('/students/database?group=Group%20B&page=1&limit=50&includeMeta=false', token),
      timedFetch(`/students/database?search=${encodeURIComponent(sampleRoll)}&page=1&limit=50&includeMeta=false`, token),
      timedFetch('/students/filters', token),
      timedFetch('/classrooms', token),
      timedFetch('/mappings', token),
      timedFetch('/exams?filter=all', token),
    ]);

  assert(
    subRes.status === 200 &&
      subRes.data.data.length > 0 &&
      subRes.data.data.every((r) => r.subjectName.toLowerCase() === sampleSub.toLowerCase()),
    '4a. Subject filter returns matching records cleanly',
    `${subRes.ms.toFixed(1)}ms`
  );
  assert(
    secRes.status === 200 &&
      secRes.data.data.length > 0 &&
      secRes.data.data.every((r) => r.section === 'A1'),
    '4b. Section filter returns Section A1 records cleanly',
    `${secRes.ms.toFixed(1)}ms`
  );
  assert(
    grpARes.status === 200 &&
      grpARes.data.count > 0 &&
      grpARes.data.data.every((r) => r.group === 'Group A') &&
      grpBRes.status === 200 &&
      grpBRes.data.count > 0 &&
      grpBRes.data.data.every((r) => r.group === 'Group B'),
    '4c. Group A & Group B filters isolate student groups properly',
    `GroupA=${grpARes.data?.count}, GroupB=${grpBRes.data?.count}`
  );
  assert(
    searchRes.status === 200 &&
      searchRes.data.data.some((r) => r.rollNumber === sampleRoll),
    '4d. Registration number search locates candidate accurately',
    `${searchRes.ms.toFixed(1)}ms`
  );
  assert(
    filtersRes.status === 200 && filtersRes.bytes < 5 * 1024 && filtersRes.data?.filtersAvailable?.subjects?.length > 0,
    '4e. Lightweight /students/filters endpoint (<5KB) works cleanly',
    `${filtersRes.ms.toFixed(1)}ms | ${(filtersRes.bytes / 1024).toFixed(2)} KB`
  );
  assert(
    classroomsRes.status === 200 && classroomsRes.data?.count === 6 && classroomsRes.bytes < 10 * 1024,
    '4f. Compact /classrooms endpoint returns 6 active rooms without bulky seating rows',
    `${classroomsRes.ms.toFixed(1)}ms | ${(classroomsRes.bytes / 1024).toFixed(2)} KB`
  );
  assert(
    mappingsRes.status === 200 && mappingsRes.data?.count > 0,
    '4g. Faculty mappings endpoint loads cleanly',
    `${mappingsRes.ms.toFixed(1)}ms | count=${mappingsRes.data?.count}`
  );
  assert(
    examsRes.status === 200 && examsRes.bytes < 100 * 1024,
    '4h. Compact /exams?filter=all strips heavy embedded snapshots',
    `${examsRes.ms.toFixed(1)}ms | ${(examsRes.bytes / 1024).toFixed(1)} KB`
  );

  // 5. Excel Master Export
  const excelRes = await timedFetch('/reports/master-students-excel?section=A1', token);
  assert(
    excelRes.status === 200 &&
      excelRes.headers.get('content-type')?.includes('spreadsheetml') &&
      excelRes.bytes > 5000,
    '5. Filtered Master Students Excel export succeeds cleanly',
    `${excelRes.ms.toFixed(1)}ms | ${(excelRes.bytes / 1024).toFixed(1)} KB`
  );

  // Also time unfiltered full Excel export for comparison
  const excelFullRes = await timedFetch('/reports/master-students-excel', token);
  assert(
    excelFullRes.status === 200 && excelFullRes.bytes > 50000,
    '5b. Full Master Students Excel export succeeds cleanly',
    `${excelFullRes.ms.toFixed(1)}ms | ${(excelFullRes.bytes / 1024).toFixed(1)} KB`
  );

  // 6. GET /api/students defaults to master students (not duplicate exam copies)
  const masterStudentsRes = await timedFetch('/students?page=1&limit=50', token);
  assert(
    masterStudentsRes.status === 200 &&
      masterStudentsRes.data?.pagination?.totalRecords === d1?.masterStats?.total,
    '6. GET /api/students returns unique master students rather than exam duplicates',
    `total=${masterStudentsRes.data?.pagination?.totalRecords} (${masterStudentsRes.ms.toFixed(1)}ms)`
  );

  await mongoose.disconnect();
  console.log(`\nSUMMARY: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
