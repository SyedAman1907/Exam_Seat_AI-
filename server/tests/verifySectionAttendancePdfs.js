const pdfParse = require('pdf-parse');

(async () => {
  try {
    console.log('========================================================================');
    console.log('  EXAMSEAT AI — SECTION-WISE ATTENDANCE PDF AUDIT (A1 - A6)');
    console.log('========================================================================\n');

    // 1. Authenticate as Super Admin
    const loginRes = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@rgmcet.edu.in', password: 'AdminExam@2026' })
    });
    const { token } = await loginRes.json();
    console.log('[Auth] Admin logged in. Token acquired.');

    const examId = '6b049322980002a25a9707d2';
    let passed = 0;
    let failed = 0;

    function assert(cond, msg) {
      if (cond) {
        console.log('  ✓ PASS:', msg);
        passed++;
      } else {
        console.error('  ✗ FAIL:', msg);
        failed++;
      }
    }

    const sectionSpecs = {
      'A1': { faculty: 'Dr. S. Subbalakshmi', room: '3010', forbiddenFaculty: 'K. Viswanath' },
      'A2': { faculty: 'K. Viswanath', room: '3020', forbiddenFaculty: 'Dr. K. Nageswara Reddy' },
      'A3': { faculty: 'Dr. K. Nageswara Reddy', room: '3030', forbiddenFaculty: 'Dr. B. Rama Subbaiah' },
      'A4': { faculty: 'Dr. S. Subbalakshmi', room: '3040', forbiddenFaculty: 'K. Viswanath' },
      'A5': { faculty: 'K. Viswanath', room: '3050', forbiddenFaculty: 'Dr. K. Nageswara Reddy' },
      'A6': { faculty: 'Dr. B. Rama Subbaiah', room: '3060', forbiddenFaculty: 'Dr. S. Subbalakshmi' }
    };

    console.log('\n--- 1. VERIFYING ISOLATED SECTION-WISE ATTENDANCE PDFS (A1 - A6) ---');
    for (const [sec, spec] of Object.entries(sectionSpecs)) {
      const url = 'http://localhost:5000/api/reports/' + examId + '/section-attendance-pdf/' + sec;
      const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
      const disposition = res.headers.get('content-disposition') || '';
      const contentType = res.headers.get('content-type') || '';
      const buf = Buffer.from(await res.arrayBuffer());

      assert(res.status === 200, 'Section ' + sec + ' Attendance PDF returns HTTP 200');
      assert(contentType.includes('application/pdf'), 'Section ' + sec + ' has Content-Type: application/pdf');
      assert(disposition.includes('Attendance_' + sec + '.pdf'), 'Section ' + sec + ' filename is Attendance_' + sec + '.pdf');

      // Parse PDF content using pdf-parse
      const parsed = await pdfParse(buf);
      const text = parsed.text;

      assert(text.includes('Section: ' + sec), 'Section ' + sec + ' PDF contains header "Section: ' + sec + '"');
      assert(text.includes(spec.faculty), 'Section ' + sec + ' PDF contains assigned faculty "' + spec.faculty + '"');
      assert(text.includes('Room ' + spec.room), 'Section ' + sec + ' PDF contains designated classroom "Room ' + spec.room + '"');
      assert(!text.includes(spec.forbiddenFaculty), 'Section ' + sec + ' PDF DOES NOT contain other faculty ("' + spec.forbiddenFaculty + '")');
      assert(text.includes('S.No.') && text.includes('Registration Number') && text.includes('Signature'), 'Section ' + sec + ' PDF contains required table columns');
    }

    console.log('\n--- 2. VERIFYING DYNAMIC SECTION SELECTION IN ZIP ARCHIVE ---');
    // Test Example 1: Only A1 selected
    const zip1Res = await fetch('http://localhost:5000/api/reports/' + examId + '/attendance-zip?sections=A1', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const zip1Buf = Buffer.from(await zip1Res.arrayBuffer()).toString('binary');
    assert(zip1Buf.includes('Attendance_A1.pdf'), 'ZIP(?sections=A1) contains Attendance_A1.pdf');
    assert(!zip1Buf.includes('Attendance_A2.pdf'), 'ZIP(?sections=A1) EXCLUDES Attendance_A2.pdf');
    assert(!zip1Buf.includes('Attendance_A3.pdf'), 'ZIP(?sections=A1) EXCLUDES Attendance_A3.pdf');

    // Test Example 2: A1, A2, A3 selected (Group A sections)
    const zip3Res = await fetch('http://localhost:5000/api/reports/' + examId + '/attendance-zip?sections=A1,A2,A3', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const zip3Buf = Buffer.from(await zip3Res.arrayBuffer()).toString('binary');
    assert(zip3Buf.includes('Attendance_A1.pdf'), 'ZIP(?sections=A1,A2,A3) contains Attendance_A1.pdf');
    assert(zip3Buf.includes('Attendance_A2.pdf'), 'ZIP(?sections=A1,A2,A3) contains Attendance_A2.pdf');
    assert(zip3Buf.includes('Attendance_A3.pdf'), 'ZIP(?sections=A1,A2,A3) contains Attendance_A3.pdf');
    assert(!zip3Buf.includes('Attendance_A4.pdf'), 'ZIP(?sections=A1,A2,A3) EXCLUDES Attendance_A4.pdf');
    assert(!zip3Buf.includes('Attendance_A5.pdf'), 'ZIP(?sections=A1,A2,A3) EXCLUDES Attendance_A5.pdf');
    assert(!zip3Buf.includes('Attendance_A6.pdf'), 'ZIP(?sections=A1,A2,A3) EXCLUDES Attendance_A6.pdf');

    // Test Example 3: Deselect A2 and A4 (A1, A3, A5, A6 selected)
    const zip4Res = await fetch('http://localhost:5000/api/reports/' + examId + '/attendance-zip?sections=A1,A3,A5,A6', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const zip4Buf = Buffer.from(await zip4Res.arrayBuffer()).toString('binary');
    assert(zip4Buf.includes('Attendance_A1.pdf'), 'ZIP (Deselected A2, A4) contains Attendance_A1.pdf');
    assert(!zip4Buf.includes('Attendance_A2.pdf'), 'ZIP (Deselected A2, A4) EXCLUDES Attendance_A2.pdf');
    assert(zip4Buf.includes('Attendance_A3.pdf'), 'ZIP (Deselected A2, A4) contains Attendance_A3.pdf');
    assert(!zip4Buf.includes('Attendance_A4.pdf'), 'ZIP (Deselected A2, A4) EXCLUDES Attendance_A4.pdf');
    assert(zip4Buf.includes('Attendance_A5.pdf'), 'ZIP (Deselected A2, A4) contains Attendance_A5.pdf');
    assert(zip4Buf.includes('Attendance_A6.pdf'), 'ZIP (Deselected A2, A4) contains Attendance_A6.pdf');

    console.log('\n--- 3. VERIFYING SIGNATURE-PDF ENDPOINT DOES NOT OVERLAP ---');
    const sigRes = await fetch('http://localhost:5000/api/exams/' + examId + '/reports/signature-pdf', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const sigBuf = Buffer.from(await sigRes.arrayBuffer());
    assert(sigRes.status === 200, 'signature-pdf returns HTTP 200');
    const sigParsed = await pdfParse(sigBuf);
    assert(sigParsed.text.includes('Section: A1'), 'Default signature-pdf generates clean Section A1 without overlapping text');
    assert(!sigParsed.text.includes('K. Viswanath'), 'Default signature-pdf contains ONLY Section A1 faculty');

    console.log('\n========================================================================');
    console.log('  TEST SUMMARY: ' + passed + ' Passed, ' + failed + ' Failed');
    console.log('========================================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  }
})();
