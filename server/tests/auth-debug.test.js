const assert = require('assert');

const BASE_URL = 'http://localhost:5000/api';

async function runAuthTests() {
  console.log('\n======================================================');
  console.log('  EXAMSEAT AI — AUTHENTICATION & SECURITY TEST SUITE');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`     Error: ${err.message}`);
      failed++;
    }
  }

  let validToken = null;

  // 1. Valid Admin Login with full email
  await test('1. Valid admin login with primary email (admin@rgmcet.edu.in)', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@rgmcet.edu.in',
        password: 'AdminExam@2026',
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert(data.success);
    assert(data.token);
    assert.strictEqual(data.user.email, 'admin@rgmcet.edu.in');
    assert.strictEqual(data.user.role, 'admin');
    assert.strictEqual(data.user.passwordHash, undefined, 'Password hash must never be exposed');
    validToken = data.token;
  });

  // 1b. Valid Admin Login with username 'admin'
  await test('1b. Valid admin login using username ("admin")', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin',
        password: 'AdminExam@2026',
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert(data.success);
    assert(data.token);
    assert.strictEqual(data.user.email, 'admin@rgmcet.edu.in');
  });

  // 1c. Valid Admin Login with case variation
  await test('1c. Case-insensitive login ("ADMIN@RGMCET.EDU.IN")', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'ADMIN@RGMCET.EDU.IN',
        password: 'AdminExam@2026',
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert(data.success);
  });

  // 2. Invalid password
  await test('2. Reject login with invalid password (returns 401)', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@rgmcet.edu.in',
        password: 'WrongPassword123!',
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 401);
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.code, 'INVALID_CREDENTIALS');
  });

  // 3. Unknown email
  await test('3. Reject login with unknown email / unregistered user (returns 401)', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'nonexistent@rgmcet.edu.in',
        password: 'SomePassword@2026',
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 401);
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.code, 'INVALID_CREDENTIALS');
  });

  // 4. Missing credentials
  await test('4. Reject login with missing credentials (returns 400)', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: '',
        password: '',
      }),
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.code, 'MISSING_CREDENTIALS');
  });

  // 5. JWT token validation on protected route
  await test('5. Authenticated route verification (/api/auth/me)', async () => {
    const res = await fetch(`${BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert(data.success);
    assert.strictEqual(data.user.email, 'admin@rgmcet.edu.in');
    assert.strictEqual(data.user.passwordHash, undefined);
  });

  // 6. Access protected dashboard statistics
  await test('6. Access protected dashboard statistics (/api/dashboard/stats)', async () => {
    const res = await fetch(`${BASE_URL}/dashboard/stats`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert(data.success);
    assert(typeof data.data.totalStudents === 'number');
    assert(typeof data.data.totalExaminations === 'number');
  });

  // 7. Reject unauthorized access without token
  await test('7. Reject access to protected route without token (returns 401)', async () => {
    const res = await fetch(`${BASE_URL}/dashboard/stats`);
    const data = await res.json();
    assert.strictEqual(res.status, 401);
    assert.strictEqual(data.success, false);
  });

  // 8. Logout
  await test('8. Faculty / Admin logout (/api/auth/logout)', async () => {
    const res = await fetch(`${BASE_URL}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${validToken}` },
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert(data.success);
  });

  // 9. Verify existing records integrity
  await test('9. Confirm existing student, exam and classroom records remain untouched', async () => {
    const res = await fetch(`${BASE_URL}/classrooms`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert(data.success);
    assert(data.data.length > 0, 'Classroom records must be intact');
  });

  console.log('\n======================================================');
  console.log(`  AUTH TEST RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');

  if (failed > 0) process.exit(1);
}

runAuthTests();