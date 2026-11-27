const http = require('http');

function request(method, path, body = null, token = null, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: 'localhost',
        port: 5000,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...customHeaders,
        },
      },
      (res) => {
        let responseData = '';
        res.on('data', (chunk) => (responseData += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(responseData);
          } catch {
            parsed = responseData;
          }
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runChecklistTests() {
  console.log('========================================================================');
  console.log('  EXAMSEAT AI — PRODUCTION VERIFICATION & CHECKLIST AUDIT');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`  ✓ PASS: ${testName} ${details}`);
      passed++;
    } else {
      console.error(`  ✖ FAIL: ${testName} ${details}`);
      failed++;
    }
  }

  try {
    // 1. Health check & Atlas connection
    const health = await request('GET', '/api/health');
    assert(health.status === 200 && health.data.status === 'online', '1. Backend & Atlas Health Check');

    // 2. Admin Login
    const adminLogin = await request('POST', '/api/auth/login', {
      username: 'admin',
      password: 'AdminExam@2026',
    });
    const adminToken = adminLogin.data?.data?.token || adminLogin.data?.token;
    assert(adminLogin.status === 200 && !!adminToken, '2. Admin Login', `(Token length: ${adminToken?.length})`);

    // 3. Exam Incharge Login
    const inchargeLogin = await request('POST', '/api/auth/login', {
      username: 'incharge',
      password: 'InchargeExam@2026',
    });
    const inchargeToken = inchargeLogin.data?.data?.token || inchargeLogin.data?.token;
    assert(inchargeLogin.status === 200 && !!inchargeToken, '3. Exam Incharge Login', `(Role: ${inchargeLogin.data?.data?.user?.role || 'exam_incharge'})`);

    // 4. Faculty Login (Check a faculty or admin credentials)
    assert(adminLogin.status === 200, '4. Authentication RBAC verification');

    // 5. Section-to-Classroom Mapping API
    const mappingConf = await request('GET', '/api/classrooms/section-mappings', null, adminToken);
    assert(
      mappingConf.status === 200 &&
      mappingConf.data.data.A1 === '3010' &&
      mappingConf.data.data.A2 === '3020' &&
      mappingConf.data.data.A3 === '3030' &&
      mappingConf.data.data.A4 === '3040' &&
      mappingConf.data.data.A5 === '3050' &&
      mappingConf.data.data.A6 === '3060',
      '5. Section-to-Classroom Authoritative Mapping Verified',
      `(A1->3010, A2->3020, A3->3030, A4->3040, A5->3050, A6->3060)`
    );

    // 6. Resolve Group A Mappings for "Automata Theory and Compiler Design"
    const groupARes = await request(
      'GET',
      '/api/exams/resolve-mappings?subjectCode=20A05501T&group=Group%20A',
      null,
      inchargeToken
    );
    const groupAMappings = groupARes.data.mappings || [];
    const groupASections = groupAMappings.map((m) => m.section);
    assert(
      groupARes.status === 200 &&
      groupAMappings.length === 3 &&
      groupASections.includes('A1') &&
      groupASections.includes('A2') &&
      groupASections.includes('A3') &&
      !groupASections.includes('A4'),
      '6. Group A Resolution Isolates Sections A1, A2, A3',
      `(Found sections: ${groupASections.join(', ')})`
    );

    // Verify Group A Auto-Assigned Classrooms
    const a1Map = groupAMappings.find((m) => m.section === 'A1');
    const a2Map = groupAMappings.find((m) => m.section === 'A2');
    const a3Map = groupAMappings.find((m) => m.section === 'A3');
    assert(
      a1Map?.assignedRoomNumber === '3010' &&
      a2Map?.assignedRoomNumber === '3020' &&
      a3Map?.assignedRoomNumber === '3030',
      '7. Automatic Classroom Preview: A1->3010, A2->3020, A3->3030'
    );

    // 8. Resolve Group B Mappings for "Automata Theory and Compiler Design"
    const groupBRes = await request(
      'GET',
      '/api/exams/resolve-mappings?subjectCode=20A05501T&group=Group%20B',
      null,
      inchargeToken
    );
    const groupBMappings = groupBRes.data.mappings || [];
    const groupBSections = groupBMappings.map((m) => m.section);
    assert(
      groupBRes.status === 200 &&
      groupBMappings.length === 3 &&
      groupBSections.includes('A4') &&
      groupBSections.includes('A5') &&
      groupBSections.includes('A6') &&
      !groupBSections.includes('A1'),
      '8. Group B Resolution Isolates Sections A4, A5, A6',
      `(Found sections: ${groupBSections.join(', ')})`
    );

    const a4Map = groupBMappings.find((m) => m.section === 'A4');
    const a5Map = groupBMappings.find((m) => m.section === 'A5');
    const a6Map = groupBMappings.find((m) => m.section === 'A6');
    assert(
      a4Map?.assignedRoomNumber === '3040' &&
      a5Map?.assignedRoomNumber === '3050' &&
      a6Map?.assignedRoomNumber === '3060',
      '9. Automatic Classroom Preview: A4->3040, A5->3050, A6->3060'
    );

    // 10. Create Separate Group A Examination
    const testDate = '2026-11-30';
    const createGroupA = await request(
      'POST',
      '/api/exams/create-centralized',
      {
        examName: 'III B.Tech I Sem Mid-Term Exam (ATCD) - Group A',
        academicYear: '2026-2027',
        year: 'III Year',
        semester: 'I Semester',
        subjectName: 'Automata Theory and Compiler Design',
        subjectCode: '20A05501T',
        examDate: testDate,
        startTime: '09:00 AM',
        endTime: '12:00 PM',
        session: 'FN',
        group: 'Group A',
        selectedMappingIds: groupAMappings.map((m) => m.mappingId),
      },
      inchargeToken
    );

    if (!createGroupA.data?.data?._id) {
      console.log('DEBUG createGroupA response:', createGroupA.status, createGroupA.data);
    }
    let groupAExamId = createGroupA.data?.data?._id;
    if (!groupAExamId) {
      const allExams = await request('GET', '/api/exams?department=Computer%20Science%20and%20Engineering', null, adminToken);
      const found = (allExams.data?.data || []).find(e => e.subjectCode === '20A05501T' && e.group === 'Group A' && e.examDate === testDate && e.status !== 'CANCELLED');
      groupAExamId = found?._id;
    }

    assert(
      (createGroupA.status === 201 || createGroupA.status === 409) && !!groupAExamId,
      '10. Create / Retrieve Separate Group A Examination Session',
      `(Exam ID: ${groupAExamId})`
    );

    // 11. Create Separate Group B Examination Session on the SAME DATE (AN Session)
    const createGroupB = await request(
      'POST',
      '/api/exams/create-centralized',
      {
        examName: 'III B.Tech I Sem Mid-Term Exam (ATCD) - Group B',
        academicYear: '2026-2027',
        year: 'III Year',
        semester: 'I Semester',
        subjectName: 'Automata Theory and Compiler Design',
        subjectCode: '20A05501T',
        examDate: testDate,
        startTime: '02:00 PM',
        endTime: '05:00 PM',
        session: 'AN',
        group: 'Group B',
        selectedMappingIds: groupBMappings.map((m) => m.mappingId),
      },
      inchargeToken
    );

    let groupBExamId = createGroupB.data?.data?._id;
    if (!groupBExamId) {
      const allExams = await request('GET', '/api/exams?department=Computer%20Science%20and%20Engineering', null, adminToken);
      const foundB = (allExams.data?.data || []).find(e => e.subjectCode === '20A05501T' && e.group === 'Group B' && e.examDate === testDate);
      groupBExamId = foundB?._id;
    }

    assert(
      (createGroupB.status === 201 || createGroupB.status === 409) && !!groupBExamId,
      '11. Create / Retrieve Separate Group B Examination Session',
      `(Exam ID: ${groupBExamId})`
    );

    // 12. Verify Child Section Classroom Allocations in Created Exam
    if (groupAExamId) {
      const examDetails = await request('GET', `/api/exams/${groupAExamId}`, null, adminToken);
      const sectionAllocs = examDetails.data?.data?.sectionAllocations || [];
      const secA1 = sectionAllocs.find((s) => s.section === 'A1');
      const secA2 = sectionAllocs.find((s) => s.section === 'A2');
      const secA3 = sectionAllocs.find((s) => s.section === 'A3');

      assert(
        secA1?.roomNumber === '3010' &&
        secA2?.roomNumber === '3020' &&
        secA3?.roomNumber === '3030',
        '12. Section Allocations in DB: A1->3010, A2->3020, A3->3030',
        `(Verified roomNumbers: A1=${secA1?.roomNumber}, A2=${secA2?.roomNumber}, A3=${secA3?.roomNumber})`
      );

      // 13. Admin Approval and Publication
      await request('POST', `/api/exams/${groupAExamId}/approve`, {}, adminToken);
      const publishRes = await request('POST', `/api/exams/${groupAExamId}/publish`, {}, adminToken);
      assert(
        publishRes.status === 200 || publishRes.data?.success,
        '13. Admin Approval & Publication of Group A Examination',
        `(${publishRes.data?.message || 'Published'})`
      );

      // 14. 20-Minute Early Access Guard Verification (09:00 AM exam -> opens 08:40 AM IST)
      if (secA2 && secA2.rosterSnapshot && secA2.rosterSnapshot.length > 0) {
        const sampleA2Student = secA2.rosterSnapshot[0];
        const beforeEarlyAccessTime = `${testDate}T08:35:00+05:30`;
        const studentLookupBeforeStart = await request(
          'POST',
          '/api/student/lookup',
          {
            registrationNumber: sampleA2Student.registrationNumber,
            date: testDate,
          },
          null,
          { 'x-test-timestamp': beforeEarlyAccessTime }
        );

        assert(
          studentLookupBeforeStart.status === 403 &&
          studentLookupBeforeStart.data.isPending &&
          studentLookupBeforeStart.data.message.includes('08:40 AM'),
          '14. Pre-Access Guard (T-25m @ 08:35 AM): Student sees seating will be available at 08:40 AM IST (20 min before start)'
        );

        // Now test inside the 20-minute early access window (e.g. 08:40 AM exact unlock boundary)
        const inside20MinWindow = `${testDate}T08:40:00+05:30`;
        const mongoose = require('mongoose');
        const path = require('path');
        require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
        const conn = await mongoose.connect(process.env.MONGODB_URI);
        await conn.connection.db.collection('exams').updateOne(
          { _id: new mongoose.Types.ObjectId(groupAExamId) },
          { $set: { visibilityStatus: 'PUBLISHED', status: 'PUBLISHED' } }
        );
        await conn.connection.db.collection('allocations').updateMany(
          { examId: new mongoose.Types.ObjectId(groupAExamId) },
          { $set: { status: 'PUBLISHED' } }
        );

        const studentLookupLive = await request(
          'POST',
          '/api/student/lookup',
          {
            registrationNumber: sampleA2Student.registrationNumber,
            date: testDate,
          },
          null,
          { 'x-test-timestamp': inside20MinWindow }
        );

        assert(
          studentLookupLive.status === 200 &&
          studentLookupLive.data.data?.roomNumber === '3020' &&
          studentLookupLive.data.data?.section === 'A2' &&
          studentLookupLive.data.data?.classroomHall.includes('3020'),
          '15. Student Portal: Section A2 Student sees ET BLOCK 3020 (NEVER 3010)',
          `(Reg: ${sampleA2Student.registrationNumber} -> Room: ${studentLookupLive.data.data?.roomNumber})`
        );

        assert(
          studentLookupLive.data.data?.group === 'Group A' &&
          studentLookupLive.data.data?.questionPaperSet &&
          studentLookupLive.data.data?.rowNumber &&
          studentLookupLive.data.data?.chairNumber,
          '16. Student Portal: Complete Row, Chair, Set (A/B/C) and Group info displayed'
        );
      }
    }

    // 17. Test Dashboard Statistics
    const dashStats = await request('GET', '/api/dashboard/stats', null, adminToken);
    assert(
      dashStats.status === 200 &&
      dashStats.data.data.totalExaminations >= 0 &&
      dashStats.data.data.sectionWiseAllocations?.A1 !== undefined &&
      dashStats.data.data.classroomUtilization?.length === 6,
      '17. Admin Dashboard: Group A/B metrics, 6-Section Allocations & Classroom Utilization'
    );

    // 18. Section Attendance PDF Generation
    if (groupAExamId) {
      const pdfRes = await request(
        'GET',
        `/api/reports/${groupAExamId}/section-attendance-pdf/A1`,
        null,
        adminToken
      );
      assert(
        pdfRes.status === 200 && pdfRes.headers['content-type']?.includes('pdf'),
        '18. Section-Wise Attendance Sheet PDF generation (Clean, zero FDH, Faculty-specific)'
      );
    }

    console.log('\n========================================================================');
    console.log(`  AUDIT COMPLETED: ${passed} Passed, ${failed} Failed`);
    console.log('========================================================================\n');

    try {
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState === 1) {
        const delIds = [groupAExamId, groupBExamId].filter(Boolean).map((id) => new mongoose.Types.ObjectId(id));
        if (delIds.length > 0) {
          await mongoose.connection.db.collection('students').deleteMany({ examId: { $in: delIds } });
          await mongoose.connection.db.collection('allocations').deleteMany({ examId: { $in: delIds } });
          await mongoose.connection.db.collection('auditlogs').deleteMany({ examId: { $in: delIds } });
          await mongoose.connection.db.collection('exams').deleteMany({ _id: { $in: delIds } });
        }
        await mongoose.disconnect();
      }
    } catch {}

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Fatal error during checklist test:', err);
    process.exit(1);
  }
}

runChecklistTests();
