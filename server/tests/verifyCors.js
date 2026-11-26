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

    // 1. Preflight OPTIONS for /api/auth/login from Vercel production origin
    const loginPreflight = await sendRequest(port, {
      method: 'OPTIONS',
      path: '/api/auth/login',
      headers: {
        Origin: prodOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization, Content-Type',
      },
    });
    assert.strictEqual(loginPreflight.status, 204, 'OPTIONS /api/auth/login should return 204');
    assert.strictEqual(loginPreflight.headers['access-control-allow-origin'], prodOrigin);
    assert.strictEqual(loginPreflight.headers['access-control-allow-credentials'], undefined);
    assert.ok(
      String(loginPreflight.headers['access-control-allow-methods'] || '').includes('POST'),
      'Allowed methods must include POST'
    );
    assert.ok(
      String(loginPreflight.headers['access-control-allow-headers'] || '').includes('Authorization') &&
        String(loginPreflight.headers['access-control-allow-headers'] || '').includes('Content-Type'),
      'Allowed headers must include Authorization and Content-Type'
    );

    // 2. Preflight OPTIONS for /api/student/active-exams from Vercel production origin
    const activeExamsPreflight = await sendRequest(port, {
      method: 'OPTIONS',
      path: '/api/student/active-exams',
      headers: {
        Origin: prodOrigin,
        'Access-Control-Request-Method': 'GET',
      },
    });
    assert.strictEqual(activeExamsPreflight.status, 204);
    assert.strictEqual(activeExamsPreflight.headers['access-control-allow-origin'], prodOrigin);
    assert.strictEqual(activeExamsPreflight.headers['access-control-allow-credentials'], undefined);

    // 3. Development origins (5173 & 5174) and env-configured origin
    for (const devOrigin of ['http://localhost:5173', 'http://localhost:5174', 'https://custom-preview.vercel.app']) {
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

    // 4. Disallowed origin must be rejected (even when '*' was in CORS_ORIGINS)
    const blockedRes = await sendRequest(port, {
      method: 'OPTIONS',
      path: '/api/auth/login',
      headers: {
        Origin: 'https://unauthorized.example.com',
        'Access-Control-Request-Method': 'POST',
      },
    });
    assert.strictEqual(blockedRes.status, 403, 'Disallowed origin should return 403');
    assert.strictEqual(blockedRes.headers['access-control-allow-origin'], undefined);

    // 5. Actual GET /api/student/active-exams with allowed Origin
    const getActiveExams = await sendRequest(port, {
      method: 'GET',
      path: '/api/student/active-exams',
      headers: {
        Origin: prodOrigin,
      },
    });
    assert.strictEqual(getActiveExams.headers['access-control-allow-origin'], prodOrigin);
    assert.strictEqual(getActiveExams.headers['access-control-allow-credentials'], undefined);

    // 6. Actual POST /api/auth/login with allowed Origin
    const postLogin = await sendRequest(port, {
      method: 'POST',
      path: '/api/auth/login',
      headers: {
        Origin: prodOrigin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'admin@rgmcet.edu.in', password: 'test' }),
    });
    assert.strictEqual(postLogin.headers['access-control-allow-origin'], prodOrigin);
    assert.strictEqual(postLogin.headers['access-control-allow-credentials'], undefined);

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
