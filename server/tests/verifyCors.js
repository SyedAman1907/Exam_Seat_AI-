/**
 * CORS regression and preflight verification test for server/app.js.
 * Starts Express on an ephemeral port without modifying MongoDB records.
 */
const assert = require('assert');
const http = require('http');

process.env.CORS_ORIGINS = 'https://custom-preview.vercel.app, *';

const app = require('../app');

function sendRequest(port, { method, path, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function run() {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const prodOrigin = 'https://exam-seat-ai-eta.vercel.app';
    const previewOrigin = 'https://exam-seat-8cbspyvcq-syedaman1907s-projects.vercel.app';
    const branchPreviewOrigin = 'https://exam-seat-ai-git-main-syedaman1907s-projects.vercel.app';

    // 1. Preflight OPTIONS for /api/auth/login from Vercel production & preview origins
    for (const allowedOrigin of [prodOrigin, previewOrigin, branchPreviewOrigin]) {
      const loginPreflight = await sendRequest(port, {
        method: 'OPTIONS',
        path: '/api/auth/login',
        headers: {
          Origin: allowedOrigin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Authorization, Content-Type',
        },
      });
      assert.strictEqual(loginPreflight.status, 204, `OPTIONS /api/auth/login should return 204 for ${allowedOrigin}`);
      assert.strictEqual(loginPreflight.headers['access-control-allow-origin'], allowedOrigin);
      assert.strictEqual(loginPreflight.headers['access-control-allow-credentials'], undefined);
      assert.ok(
        String(loginPreflight.headers['access-control-allow-methods'] || '').includes('POST') &&
          String(loginPreflight.headers['access-control-allow-methods'] || '').includes('PUT') &&
          String(loginPreflight.headers['access-control-allow-methods'] || '').includes('PATCH') &&
          String(loginPreflight.headers['access-control-allow-methods'] || '').includes('DELETE'),
        'Allowed methods must include GET, POST, PUT, PATCH, DELETE, OPTIONS'
      );
      assert.ok(
        String(loginPreflight.headers['access-control-allow-headers'] || '').includes('Authorization') &&
          String(loginPreflight.headers['access-control-allow-headers'] || '').includes('Content-Type'),
        'Allowed headers must include Authorization and Content-Type'
      );
    }

    // 2. Preflight OPTIONS for /api/student/active-exams from Vercel production & preview origins
    for (const allowedOrigin of [prodOrigin, previewOrigin]) {
      const activeExamsPreflight = await sendRequest(port, {
        method: 'OPTIONS',
        path: '/api/student/active-exams',
        headers: {
          Origin: allowedOrigin,
          'Access-Control-Request-Method': 'GET',
        },
      });
      assert.strictEqual(activeExamsPreflight.status, 204);
      assert.strictEqual(activeExamsPreflight.headers['access-control-allow-origin'], allowedOrigin);
      assert.strictEqual(activeExamsPreflight.headers['access-control-allow-credentials'], undefined);
    }

    // 3. Development origins (5173 & 5174), second Vercel origin, and env-configured origin
    for (const devOrigin of [
      'https://examseatai.vercel.app',
      'http://localhost:5173',
      'http://localhost:5174',
      'https://custom-preview.vercel.app',
    ]) {
      const res = await sendRequest(port, {
        method: 'OPTIONS',
        path: '/api/auth/login',
        headers: {
          Origin: devOrigin,
          'Access-Control-Request-Method': 'POST',
        },
      });
      assert.strictEqual(res.status, 204, `Preflight should succeed for ${devOrigin}`);
      assert.strictEqual(res.headers['access-control-allow-origin'], devOrigin);
    }

    // 4. Disallowed origins must be rejected (even when '*' was in CORS_ORIGINS, or untrusted vercel.app apps)
    for (const badOrigin of [
      'https://unauthorized.example.com',
      'https://evil-app-syedaman1907s-projects.vercel.app',
      'https://exam-seat-phish.vercel.app',
      'http://exam-seat-8cbspyvcq-syedaman1907s-projects.vercel.app',
      'https://exam-seat-8cbspyvcq-syedaman1907s-projects.vercel.app.attacker.com',
    ]) {
      const blockedRes = await sendRequest(port, {
        method: 'OPTIONS',
        path: '/api/auth/login',
        headers: {
          Origin: badOrigin,
          'Access-Control-Request-Method': 'POST',
        },
      });
      assert.strictEqual(blockedRes.status, 403, `Disallowed origin ${badOrigin} should return 403`);
      assert.strictEqual(blockedRes.headers['access-control-allow-origin'], undefined);
    }

    // 5. Actual GET /api/student/active-exams with allowed production & preview Origins
    for (const allowedOrigin of [prodOrigin, previewOrigin]) {
      const getActiveExams = await sendRequest(port, {
        method: 'GET',
        path: '/api/student/active-exams',
        headers: {
          Origin: allowedOrigin,
        },
      });
      assert.strictEqual(getActiveExams.headers['access-control-allow-origin'], allowedOrigin);
      assert.strictEqual(getActiveExams.headers['access-control-allow-credentials'], undefined);
      assert.notStrictEqual(getActiveExams.status, 403, `Public active-exams must not be CORS-rejected for ${allowedOrigin}`);

      // 6. Actual POST /api/auth/login with allowed Origin
      const postLogin = await sendRequest(port, {
        method: 'POST',
        path: '/api/auth/login',
        headers: {
          Origin: allowedOrigin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: 'admin@rgmcet.edu.in', password: 'test' }),
      });
      assert.strictEqual(postLogin.headers['access-control-allow-origin'], allowedOrigin);
      assert.strictEqual(postLogin.headers['access-control-allow-credentials'], undefined);
      assert.notStrictEqual(postLogin.status, 403, `POST /api/auth/login must not be CORS-rejected for ${allowedOrigin}`);
    }

    // 7. Protected route GET /api/auth/me with Authorization header and Origin
    const getMe = await sendRequest(port, {
      method: 'GET',
      path: '/api/auth/me',
      headers: {
        Origin: prodOrigin,
        Authorization: 'Bearer invalid-token',
      },
    });
    assert.strictEqual(getMe.headers['access-control-allow-origin'], prodOrigin);

    // 8. Health check GET /api/health with Origin
    const getHealth = await sendRequest(port, {
      method: 'GET',
      path: '/api/health',
      headers: {
        Origin: prodOrigin,
      },
    });
    assert.strictEqual(getHealth.headers['access-control-allow-origin'], prodOrigin);

    console.log('[CORS Verification] PASSED: All preflight OPTIONS and GET/POST CORS checks succeeded.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((err) => {
  console.error('[CORS Verification] FAILED:', err);
  process.exit(1);
});
