const mongoose = require('mongoose');

const STATE_LABELS = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

const INITIAL_RETRY_MS = 2000;
const MAX_RETRY_MS = 30000;
const MAX_STARTUP_ATTEMPTS = 4;
const MAX_RECONNECT_ATTEMPTS = 25;

let isListenersAttached = false;
let isShuttingDown = false;
let connectingPromise = null;
let reconnectTimer = null;
let isReconnecting = false;
let reconnectAttempt = 0;
let lastConnectedAt = null;
let lastDisconnectedAt = null;
let lastErrorInfo = null;
let lastReconnectNotifiedAt = 0;
let onReconnectCallbacks = [];

/**
 * Safely masks username and password credentials in MongoDB connection strings.
 * e.g., "mongodb+srv://user:pass@cluster0..." -> "mongodb+srv://***:***@cluster0..."
 */
function maskMongoURI(uri) {
  if (!uri || typeof uri !== 'string') return '';
  return uri.replace(/\/\/[^/@]+@/, '//***:***@');
}

/**
 * Identifies whether an error is a MongoDB connection / DNS / network availability failure.
 */
function isDbConnectivityError(err) {
  if (!err) return false;
  const name = err.name || '';
  const msg = String(err.message || '');
  const code = String(err.code || '');
  return (
    name === 'MongooseServerSelectionError' ||
    name === 'MongoServerSelectionError' ||
    name === 'MongoNetworkError' ||
    name === 'MongoNetworkTimeoutError' ||
    name === 'MongoTopologyClosedError' ||
    name === 'MongoNotConnectedError' ||
    name === 'MongoWaitQueueTimeoutError' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'ETIMEDOUT' ||
    msg.includes('ENOTFOUND') ||
    msg.includes('EAI_AGAIN') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('secureConnect') ||
    msg.includes('Could not connect to any servers') ||
    msg.includes('ReplicaSetNoPrimary') ||
    msg.includes('buffering timed out') ||
    msg.includes('Client must be connected') ||
    msg.includes('Topology is closed') ||
    msg.includes('pool destroyed')
  );
}

/**
 * Classifies connection failures accurately without blaming every failure on IP whitelisting.
 */
function classifyDbError(err) {
  const msg = String(err?.message || '');
  const lowerMsg = msg.toLowerCase();
  if (msg.includes('ENOTFOUND') || msg.includes('EAI_AGAIN') || msg.includes('querySrv')) {
    return {
      category: 'DNS_RESOLUTION_FAILURE',
      retryable: true,
      summary: 'DNS resolution failed for MongoDB Atlas cluster hostname (temporary DNS or network interruption).',
    };
  }
  if (lowerMsg.includes('authentication failed') || lowerMsg.includes('bad auth') || err?.code === 8000 || err?.code === 18) {
    return {
      category: 'AUTHENTICATION_FAILURE',
      retryable: false,
      summary: 'MongoDB Atlas authentication failed. Verify MONGODB_URI username and password in server/.env.',
    };
  }
  if (lowerMsg.includes('whitelist') || lowerMsg.includes('not authorized') || lowerMsg.includes('tlsv1 alert internal error')) {
    return {
      category: 'IP_ACCESS_RESTRICTION',
      retryable: true,
      summary: 'Connection rejected by MongoDB Atlas network access controls. Verify your current public IP is allowed in Atlas Network Access.',
    };
  }
  if (msg.includes('ETIMEDOUT') || lowerMsg.includes('timed out') || msg.includes('secureConnect')) {
    return {
      category: 'NETWORK_TIMEOUT',
      retryable: true,
      summary: 'TLS handshake or socket connection to MongoDB Atlas timed out due to network latency or firewall restrictions.',
    };
  }
  if (msg.includes('Could not connect to any servers') || err?.name === 'MongooseServerSelectionError') {
    return {
      category: 'SERVER_SELECTION_FAILURE',
      retryable: true,
      summary: 'Unable to reach MongoDB Atlas replica set nodes (check internet connectivity, DNS, firewall port 27017, or Atlas Network Access IP list).',
    };
  }
  return {
    category: 'CONNECTION_ERROR',
    retryable: true,
    summary: msg || 'Unknown MongoDB connection error.',
  };
}

function getConnectionOptions() {
  const isServerless = Boolean(process.env.VERCEL);
  return {
    serverSelectionTimeoutMS: isServerless ? 8000 : 25000,
    connectTimeoutMS: isServerless ? 8000 : 20000,
    socketTimeoutMS: isServerless ? 20000 : 45000,
    heartbeatFrequencyMS: 10000,
    maxPoolSize: isServerless ? 5 : 10,
    minPoolSize: isServerless ? 1 : 3,
    retryWrites: true,
    retryReads: true,
    family: 4, // Use IPv4 DNS resolution reliably on Windows/Node for mongodb+srv hosts
    autoSelectFamily: false, // Prevent Node 20/22 Happy Eyeballs stalls on dual-stack Windows networks
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  isReconnecting = false;
}

function scheduleReconnect() {
  if (isShuttingDown) return;
  if (mongoose.connection.readyState === 1) {
    clearReconnectTimer();
    reconnectAttempt = 0;
    return;
  }
  if (lastErrorInfo?.category === 'AUTHENTICATION_FAILURE') {
    isReconnecting = false;
    return; // Do not loop infinitely on invalid credentials
  }
  if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
    isReconnecting = false;
    console.error(
      `[Database Reconnect] Reached maximum controlled retry attempts (${MAX_RECONNECT_ATTEMPTS}). Stopping automatic retries until next recovery trigger.`
    );
    return;
  }
  if (reconnectTimer || connectingPromise) {
    return; // Prevent duplicate reconnection loops
  }

  reconnectAttempt += 1;
  const delayMs = Math.min(INITIAL_RETRY_MS * Math.pow(2, reconnectAttempt - 1), MAX_RETRY_MS);
  isReconnecting = true;

  console.warn(
    `[Database Reconnect] Attempt #${reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS} scheduled in ${(delayMs / 1000).toFixed(1)}s (state=${STATE_LABELS[mongoose.connection.readyState] || 'unknown'}).`
  );

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (isShuttingDown || mongoose.connection.readyState === 1) {
      isReconnecting = false;
      return;
    }

    try {
      await connectDB({ isReconnectAttempt: true });
    } catch (err) {
      // connectDB handles error logging & schedules the next backoff attempt cleanly
    }
  }, delayMs);

  // Allow Node process to exit cleanly during forced shutdown if timer is pending
  if (reconnectTimer.unref) {
    reconnectTimer.unref();
  }
}

function attachConnectionListeners() {
  if (isListenersAttached) return;
  isListenersAttached = true;

  const notifyReconnect = () => {
    const nowMs = Date.now();
    if (nowMs - lastReconnectNotifiedAt < 1000) return;
    lastReconnectNotifiedAt = nowMs;
    const callbacks = [...onReconnectCallbacks];
    for (const cb of callbacks) {
      Promise.resolve()
        .then(() => cb())
        .catch((cbErr) => console.warn('[Database] Reconnect listener warning:', cbErr.message));
    }
  };

  mongoose.connection.on('connected', () => {
    const wasDown = reconnectAttempt > 0 || lastDisconnectedAt !== null;
    clearReconnectTimer();
    reconnectAttempt = 0;
    lastConnectedAt = new Date();
    lastErrorInfo = null;
    const host = mongoose.connection.host || 'mongodb-atlas';
    const dbName = mongoose.connection.name || 'examseat_ai';
    console.log(
      `[Database] ${wasDown ? 'Reconnected' : 'Connected'} successfully to "${dbName}" (host: ${host}).`
    );
    if (wasDown) {
      notifyReconnect();
    }
  });

  mongoose.connection.on('reconnected', () => {
    clearReconnectTimer();
    reconnectAttempt = 0;
    lastConnectedAt = new Date();
    lastErrorInfo = null;
    console.log('[Database] MongoDB connection re-established.');
    notifyReconnect();
  });

  mongoose.connection.on('disconnected', () => {
    lastDisconnectedAt = new Date();
    if (isShuttingDown) {
      console.log('[Database] MongoDB disconnected gracefully during shutdown.');
      return;
    }
    console.warn('[Database Warning] MongoDB connection lost. Triggering backoff reconnection...');
    scheduleReconnect();
  });

  mongoose.connection.on('error', (err) => {
    const classified = classifyDbError(err);
    lastErrorInfo = {
      category: classified.category,
      message: classified.summary,
      at: new Date(),
    };
    if (!isShuttingDown) {
      console.error(`[Database Error] (${classified.category}): ${err.message}`);
      if (mongoose.connection.readyState !== 1) {
        scheduleReconnect();
      }
    }
  });
}

/**
 * Establishes or returns the singleton MongoDB Atlas connection.
 * Prevents duplicate concurrent connect() calls and manages exponential-backoff recovery.
 */
async function connectDB(opts = {}) {
  const { isReconnectAttempt = false } = opts;

  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  if (connectingPromise) {
    return connectingPromise;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    const errorMsg =
      '[Database Configuration Error] process.env.MONGODB_URI is not defined. Please set it in server/.env';
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  attachConnectionListeners();

  const maskedUri = maskMongoURI(uri);
  if (!isReconnectAttempt) {
    console.log(`[Database] Initiating connection to MongoDB: ${maskedUri}`);
  } else {
    console.log(`[Database Reconnect] Connecting to MongoDB Atlas (attempt #${reconnectAttempt})...`);
  }

  connectingPromise = (async () => {
    const maxAttempts = (isReconnectAttempt || process.env.VERCEL) ? 1 : MAX_STARTUP_ATTEMPTS;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (isShuttingDown) {
        throw new Error('Server shutdown requested during database connection.');
      }

      try {
        if (!isReconnectAttempt && attempt > 1) {
          console.log(
            `[Database] Retrying initial Atlas connection (attempt ${attempt}/${maxAttempts})...`
          );
        }

        const conn = await mongoose.connect(uri, getConnectionOptions());
        const dbName = conn.connection.name;
        const host = conn.connection.host;
        clearReconnectTimer();
        reconnectAttempt = 0;
        lastConnectedAt = new Date();
        lastErrorInfo = null;
        console.log(`[Database] Connection verified. Database: "${dbName}" | Cluster Host: ${host}`);
        return conn;
      } catch (error) {
        const classified = classifyDbError(error);
        lastErrorInfo = {
          category: classified.category,
          message: classified.summary,
          at: new Date(),
        };

        console.error('========================================================================');
        console.error(`  [DATABASE CONNECTION FAILURE] (${classified.category})`);
        console.error(`  Target URI (Masked): ${maskedUri}`);
        console.error(`  Attempt: ${attempt}/${maxAttempts}`);
        console.error(`  Error: ${error.name}: ${error.message}`);
        console.error(`  Summary: ${classified.summary}`);
        console.error('========================================================================');

        // Reset partial failed state cleanly before retrying
        if (mongoose.connection.readyState !== 0 && mongoose.connection.readyState !== 1) {
          try {
            await mongoose.disconnect();
          } catch {}
        }

        if (!isReconnectAttempt && classified.retryable && attempt < maxAttempts && !isShuttingDown) {
          const backoffMs = Math.min(INITIAL_RETRY_MS * Math.pow(2, attempt - 1), MAX_RETRY_MS);
          console.warn(`[Database] Retrying initial connection in ${(backoffMs / 1000).toFixed(1)}s...`);
          await sleep(backoffMs);
          continue;
        }

        if (isReconnectAttempt && classified.retryable && !isShuttingDown) {
          scheduleReconnect();
        }

        throw error;
      }
    }
  })().finally(() => {
    connectingPromise = null;
  });

  return connectingPromise;
}

function getDbHealth() {
  const readyState = mongoose.connection.readyState;
  return {
    connected: readyState === 1,
    readyState,
    stateLabel: STATE_LABELS[readyState] || 'unknown',
    databaseName: mongoose.connection.name || null,
    isReconnecting,
    reconnectAttempt,
    lastConnectedAt,
    lastDisconnectedAt,
    lastError: lastErrorInfo ? { category: lastErrorInfo.category, message: lastErrorInfo.message, at: lastErrorInfo.at } : null,
  };
}

function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

function onReconnect(fn) {
  if (typeof fn === 'function' && !onReconnectCallbacks.includes(fn)) {
    onReconnectCallbacks.push(fn);
  }
}

function markShuttingDown() {
  isShuttingDown = true;
  clearReconnectTimer();
}

module.exports = connectDB;
module.exports.connectDB = connectDB;
module.exports.maskMongoURI = maskMongoURI;
module.exports.getDbHealth = getDbHealth;
module.exports.isDbConnected = isDbConnected;
module.exports.isDbConnectivityError = isDbConnectivityError;
module.exports.scheduleReconnect = scheduleReconnect;
module.exports.onReconnect = onReconnect;
module.exports.markShuttingDown = markShuttingDown;
