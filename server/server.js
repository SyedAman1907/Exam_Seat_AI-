const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const app = require('./app');
const connectDB = require('./config/db');
const seedDatabase = require('./utils/seedDatabase');
const ensureExamIndexes = require('./utils/ensureExamIndexes');
const schedulerService = require('./services/schedulerService');

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    // 1 & 2. Connect to MongoDB Atlas and verify connection
    await connectDB();

    // 3. Ensure essential baseline indexes and accounts
    try {
      await seedDatabase();
      await ensureExamIndexes();
    } catch (seedErr) {
      console.error('[Startup Warning] Seed or index verification warning:', seedErr.message);
    }

    // 4. Start Express server only after database is confirmed connected
    const server = app.listen(PORT, () => {
      console.log(`====================================================`);
      console.log(`  EXAMSEAT AI — BACKEND SERVICE IS OPERATIONAL`);
      console.log(`  Port: http://localhost:${PORT}`);
      console.log(`  Database: MongoDB Atlas`);
      console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`====================================================`);
    });

    // 5. Initialize background examination scheduling service and recovery hook
    schedulerService.start();
    connectDB.onReconnect(async () => {
      try {
        await ensureExamIndexes();
      } catch (e) {}
      if (typeof schedulerService.onDatabaseReconnect === 'function') {
        await schedulerService.onDatabaseReconnect();
      }
    });

    // Handle graceful termination
    const handleShutdown = async (signal) => {
      console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
      connectDB.markShuttingDown();
      schedulerService.stop();
      const forceExitTimer = setTimeout(() => {
        console.warn('[Server] Forced exit after graceful shutdown timeout.');
        process.exit(0);
      }, 5000);
      if (forceExitTimer.unref) forceExitTimer.unref();

      server.close(async () => {
        try {
          const mongoose = require('mongoose');
          if (mongoose.connection.readyState !== 0) {
            await mongoose.connection.close(false);
          }
          console.log('[Server] Connections closed. Process terminating.');
        } catch (closeErr) {
          console.warn('[Server] Database close warning:', closeErr.message);
        } finally {
          clearTimeout(forceExitTimer);
          process.exit(0);
        }
      });
    };

    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));

    // Keep server alive during transient async DNS/MongoDB Atlas background rejections
    process.on('unhandledRejection', (reason) => {
      if (connectDB.isDbConnectivityError(reason)) {
        console.warn('[Process] Transient MongoDB/DNS rejection handled safely:', reason.message || reason);
        connectDB.scheduleReconnect();
      } else {
        console.error('[Process Unhandled Rejection]', reason);
      }
    });

    process.on('uncaughtException', (err) => {
      if (connectDB.isDbConnectivityError(err)) {
        console.warn('[Process] Transient MongoDB/DNS exception handled safely:', err.message);
        connectDB.scheduleReconnect();
      } else {
        console.error('[Process Uncaught Exception]', err);
      }
    });

  } catch (fatalError) {
    console.error('\n[Fatal Startup Error] Backend server failed to start due to database connection failure.');
    console.error(`Reason: ${fatalError.message}`);
    console.error('The backend process will now exit to prevent running in an inconsistent state.\n');
    process.exit(1);
  }
}

if (require.main === module && !process.env.VERCEL) {
  startServer();
}

module.exports = app;
