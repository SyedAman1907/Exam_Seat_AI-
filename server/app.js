const express = require('express');
const rawCors = require('cors');
const cors = typeof rawCors === 'function' ? rawCors : (rawCors?.default || rawCors);
const fs = require('fs');
const path = require('path');
if (!process.env.MONGODB_URI) {
  require('dotenv').config({ path: path.resolve(__dirname, '.env') });
}
const { connectDB, getDbHealth, isDbConnected, isDbConnectivityError } = require('./config/db');

const authRoutes = require('./routes/authRoutes');
const examRoutes = require('./routes/examRoutes');
const studentRoutes = require('./routes/studentRoutes');
const classroomRoutes = require('./routes/classroomRoutes');
const allocationRoutes = require('./routes/allocationRoutes');
const reportRoutes = require('./routes/reportRoutes');
const studentPortalRoutes = require('./routes/studentPortalRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const timetableRoutes = require('./routes/timetableRoutes');
const mappingRoutes = require('./routes/mappingRoutes');
const subjectRoutes = require('./routes/subjectRoutes');
const facultyRoutes = require('./routes/facultyRoutes');

const app = express();

// Trust Render / reverse-proxy headers (required by express-rate-limit v7 in production)
app.set('trust proxy', 1);

const normalizeOrigin = (value) => {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed || trimmed === '*') return '';
  try {
    const parsed = new URL(trimmed);
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}`;
  } catch {
    return '';
  }
};

const normalizeVercelHostOrigin = (host) => {
  const cleaned = String(host || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return cleaned ? normalizeOrigin(`https://${cleaned}`) : '';
};

const envOrigins = [
  process.env.CLIENT_URL,
  process.env.FRONTEND_URL,
  process.env.CORS_ORIGIN,
  process.env.CORS_ORIGINS,
  process.env.ALLOWED_ORIGINS,
  process.env.RENDER_EXTERNAL_URL,
  normalizeVercelHostOrigin(process.env.VERCEL_URL),
  normalizeVercelHostOrigin(process.env.VERCEL_BRANCH_URL),
  normalizeVercelHostOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL),
]
  .filter(Boolean)
  .flatMap((entry) => String(entry).split(','))
  .map(normalizeOrigin)
  .filter(Boolean);

const DEFAULT_ALLOWED_ORIGINS = [
  'https://examseatai.vercel.app',
  'https://exam-seat-ai-eta.vercel.app',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const allowedOriginSet = new Set([
  ...DEFAULT_ALLOWED_ORIGINS.map(normalizeOrigin).filter(Boolean),
  ...envOrigins,
]);

const corsMiddleware = cors((req, callback) => {
  const origin = req.header('Origin');
  if (!origin) {
    // Allow non-browser / same-origin requests without an Origin header
    return callback(null, { origin: false });
  }

  const normalized = normalizeOrigin(origin);
  const rawHost = req.get('x-forwarded-host') || req.get('host') || '';
  const host = rawHost.split(',')[0].trim().toLowerCase();
  const isSameHost = Boolean(host && (normalized === `https://${host}` || normalized === `http://${host}`));

  if (normalized && (isSameHost || allowedOriginSet.has(normalized))) {
    return callback(null, {
      origin: normalized,
      credentials: false,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cache-Control', 'Pragma'],
      exposedHeaders: ['Content-Disposition', 'Content-Type', 'Content-Length'],
      optionsSuccessStatus: 204,
    });
  }

  const corsErr = new Error(`CORS origin '${origin}' not allowed.`);
  corsErr.statusCode = 403;
  return callback(corsErr);
});

// Register CORS and preflight handling before all routes, auth middleware, and error handlers
app.use(corsMiddleware);
app.options('*', corsMiddleware);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Graceful request timeout guard (longer for PDF/Excel exports and bulk uploads)
app.use('/api', (req, res, next) => {
  const isHeavyRoute =
    req.path.includes('/reports') ||
    req.path.includes('/multi-pdf') ||
    req.path.includes('/preview-pdf') ||
    req.path.includes('/confirm-batch') ||
    req.path.includes('/create-centralized') ||
    req.path.includes('/import');
  const timeoutMs = isHeavyRoute ? 120000 : 25000;
  res.setTimeout(timeoutMs, () => {
    if (!res.headersSent) {
      res.status(504).json({
        success: false,
        code: 'REQUEST_TIMEOUT',
        message: 'The server took too long to process this request. Please retry shortly.',
      });
    }
  });
  next();
});

// Development / Performance Timing Middleware
if (process.env.NODE_ENV !== 'production' || process.env.PERF_LOGS === 'true') {
  app.use((req, res, next) => {
    const startNs = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
      if (durationMs >= 250 || res.statusCode >= 500 || process.env.PERF_VERBOSE === 'true') {
        console.log(`[Perf] ${req.method} ${req.originalUrl} -> ${res.statusCode} in ${durationMs.toFixed(1)}ms`);
      }
    });
    next();
  });
}

// Serverless cold-start DB bootstrap (only active when running on Vercel)
if (process.env.VERCEL) {
  app.use('/api', async (req, res, next) => {
    if (!isDbConnected()) {
      try {
        await connectDB();
      } catch (err) {
        if (req.path === '/health') {
          return next();
        }
        return res.status(503).json({
          success: false,
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database service is temporarily unavailable while connecting to MongoDB Atlas. Please retry shortly.',
        });
      }
    }
    return next();
  });
}

// Health Check (always reachable even during database reconnection)
app.get('/api/health', (req, res) => {
  const dbHealth = getDbHealth();
  const isHealthy = dbHealth.connected;
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'online' : 'degraded',
    backendStatus: 'online',
    database: {
      status: dbHealth.stateLabel,
      connected: dbHealth.connected,
      name: dbHealth.databaseName || 'examseat_ai',
      poolConfig: dbHealth.poolConfig,
      reconnecting: dbHealth.isReconnecting,
      reconnectAttempt: dbHealth.reconnectAttempt,
      lastConnectedAt: dbHealth.lastConnectedAt,
      lastDisconnectedAt: dbHealth.lastDisconnectedAt,
      lastError: dbHealth.lastError,
    },
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date(),
    service: 'ExamSeat AI Core Server',
  });
});

// Fail-fast DB availability guard for all database-dependent API routes
app.use('/api', (req, res, next) => {
  if (req.path === '/health') {
    return next();
  }
  if (!isDbConnected()) {
    const dbHealth = getDbHealth();
    return res.status(503).json({
      success: false,
      code: 'DATABASE_UNAVAILABLE',
      message: 'Database service is temporarily unavailable while reconnecting to MongoDB Atlas. Please retry shortly.',
      database: {
        status: dbHealth.stateLabel,
        connected: false,
        reconnecting: dbHealth.isReconnecting,
      },
    });
  }
  next();
});

/**
 * Resolve CommonJS, ESM-transpiled and namespace-wrapped route exports.
 * Vercel's bundler can expose a CommonJS export through one or more `default`
 * wrappers. Never pass the wrapper object to Express: Express requires a
 * callable middleware/router and throws `Router.use() ... got an Object`.
 */
function resolveExpressRouter(moduleExport, moduleName) {
  const queue = [moduleExport];
  const visited = new Set();

  while (queue.length) {
    const candidate = queue.shift();
    if (candidate == null || visited.has(candidate)) continue;
    if ((typeof candidate === 'object' || typeof candidate === 'function')) {
      visited.add(candidate);
    }

    if (
      typeof candidate === 'function' &&
      typeof candidate.handle === 'function' &&
      Array.isArray(candidate.stack)
    ) {
      // Validate each registered layer before mounting it into the app.
      for (const layer of candidate.stack) {
        if (typeof layer.handle !== 'function') {
          throw new TypeError(`${moduleName} contains a non-function middleware layer`);
        }
        if (layer.route) {
          for (const routeLayer of layer.route.stack || []) {
            if (typeof routeLayer.handle !== 'function') {
              throw new TypeError(`${moduleName} route '${layer.route.path}' contains a non-function handler`);
            }
          }
        }
      }
      return candidate;
    }

    if (candidate && typeof candidate === 'object') {
      // Check explicit router first, then common module interop wrappers.
      for (const key of ['router', 'default', 'routes']) {
        if (candidate[key] != null) queue.push(candidate[key]);
      }
    }
  }

  const exportKeys = moduleExport && typeof moduleExport === 'object'
    ? Object.keys(moduleExport).join(', ') || '(no enumerable keys)'
    : '(not an object)';
  throw new TypeError(
    `[Route Bootstrap] ${moduleName} must export an Express Router function; ` +
    `received ${typeof moduleExport}, keys: ${exportKeys}`
  );
}

function mountApiRouter(prefix, moduleExport, moduleName) {
  const router = resolveExpressRouter(moduleExport, moduleName);
  app.use(prefix, router);
  console.info(`[Route Bootstrap] Mounted ${moduleName} at ${prefix}`);
}

// Mount Routes. Keep every mount explicit so a bad module is identified by name.
mountApiRouter('/api/auth', authRoutes, 'authRoutes');
mountApiRouter('/api/exams', examRoutes, 'examRoutes');
mountApiRouter('/api/students', studentRoutes, 'studentRoutes');
mountApiRouter('/api/classrooms', classroomRoutes, 'classroomRoutes');
mountApiRouter('/api/exams', allocationRoutes, 'allocationRoutes');
mountApiRouter('/api/exams', reportRoutes, 'reportRoutes');
mountApiRouter('/api/reports', reportRoutes, 'reportRoutes');
mountApiRouter('/api/student', studentPortalRoutes, 'studentPortalRoutes');
mountApiRouter('/api/dashboard', dashboardRoutes, 'dashboardRoutes');
mountApiRouter('/api/timetable', timetableRoutes, 'timetableRoutes');
mountApiRouter('/api/mappings', mappingRoutes, 'mappingRoutes');
mountApiRouter('/api/subjects', subjectRoutes, 'subjectRoutes');
mountApiRouter('/api/faculty', facultyRoutes, 'facultyRoutes');

// 404 Handler for unknown API endpoints (never fall through to React index.html)
const apiNotFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: `API endpoint '${req.originalUrl}' not found.`,
  });
};
app.use('/api/*', apiNotFoundHandler);
app.all('/api', apiNotFoundHandler);

// Serve unified React production build (client/dist) & SPA fallback routing
const clientDistPath = path.resolve(__dirname, '../client/dist');
const clientIndexPath = path.join(clientDistPath, 'index.html');

app.use(express.static(clientDistPath, {
  index: false,
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

app.get('*', (req, res, next) => {
  if (req.path === '/api' || req.path.startsWith('/api/')) {
    return next();
  }
  if (fs.existsSync(clientIndexPath)) {
    return res.sendFile(clientIndexPath);
  }
  if (req.path === '/') {
    return res.status(200).json({
      service: 'ExamSeat AI Core Server',
      status: 'online',
      health: '/api/health',
    });
  }
  return res.status(404).json({
    success: false,
    message: 'Frontend production build not found. Run "npm run build --prefix client".',
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err.stack || err.message);

  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'The uploaded file exceeds the maximum allowed size limit (30MB). Please upload a smaller PDF.',
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: `Unexpected file upload field '${err.field}'. Expected 'file'.`,
      });
    }
    return res.status(400).json({
      success: false,
      message: 'File upload error. Please select a valid student roster PDF and try again.',
    });
  }

  if (isDbConnectivityError(err)) {
    return res.status(503).json({
      success: false,
      code: 'DATABASE_UNAVAILABLE',
      message: 'Database service is temporarily unavailable while reconnecting to MongoDB Atlas. Please retry shortly.',
    });
  }

  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message:
      statusCode >= 500 && process.env.NODE_ENV !== 'development'
        ? 'Internal Server Error. Please contact support.'
        : (err.message || 'Internal Server Error. Please contact support.'),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

module.exports = app;
