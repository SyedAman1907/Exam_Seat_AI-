/**
 * Deployment smoke test for the Express app and every route module.
 * Run with: npm run verify:vercel (from server/).
 * This test does not connect to MongoDB and never modifies database records.
 */
const fs = require('fs');
const path = require('path');
const app = require('../app');

const routesDir = path.join(__dirname, '..', 'routes');
const routeFiles = fs.readdirSync(routesDir).filter((file) => file.endsWith('.js'));
const failures = [];

for (const file of routeFiles) {
  const moduleName = path.basename(file, '.js');
  try {
    const exported = require(path.join(routesDir, file));
    if (typeof exported !== 'function' || typeof exported.handle !== 'function' || !Array.isArray(exported.stack)) {
      failures.push(`${moduleName} does not export an Express Router function`);
      continue;
    }

    for (const layer of exported.stack) {
      if (typeof layer.handle !== 'function') {
        failures.push(`${moduleName} has a non-function middleware layer`);
      }
      for (const routeLayer of layer.route?.stack || []) {
        if (typeof routeLayer.handle !== 'function') {
          failures.push(`${moduleName} route ${String(layer.route.path)} has a non-function handler`);
        }
      }
    }
  } catch (error) {
    failures.push(`${moduleName} failed to load: ${error.message}`);
  }
}

if (typeof app !== 'function' || typeof app.handle !== 'function') {
  failures.push('server/app.js does not export an Express application');
}

const mountedPaths = (app._router?.stack || [])
  .filter((layer) => layer.name === 'router' && layer.regexp)
  .map((layer) => String(layer.regexp));
for (const expected of ['/api/auth', '/api/exams', '/api/student', '/api/mappings']) {
  if (!mountedPaths.some((value) => value.includes(expected.replaceAll('/', '\\/')))) {
    failures.push(`Expected API router mount is missing: ${expected}`);
  }
}

if (failures.length) {
  console.error('[Vercel Bootstrap Verification] FAILED');
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`[Vercel Bootstrap Verification] PASSED: Express app loaded and ${routeFiles.length} route modules expose valid routers.`);
}
