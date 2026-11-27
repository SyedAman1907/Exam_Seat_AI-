/**
 * Explicit One-Time Safeguarded Academic Database Backup & Reset Script
 *
 * SAFETY SAFEGUARDS:
 * - Never executes automatically on server startup or deployment.
 * - Requires BOTH explicit confirmation (--confirm-reset or CONFIRM_ACADEMIC_RESET=YES_I_UNDERSTAND)
 *   AND writes a full JSON backup of every collection BEFORE deleting academic data.
 * - Preserves Admin accounts (`role: 'admin'`) and active classroom configs (`ET BLOCK 3010-3060`),
 *   unless mock `A-101` rooms exist.
 * - Guards against accidental repeat resets via an explicit reset marker (`SYSTEM_ACADEMIC_RESET`)
 *   unless `--force-repeat-reset` is explicitly passed.
 *
 * Usage (e.g. in Render Shell or local environment with server/.env):
 *   node server/scripts/resetAcademicData.js --confirm-reset
 */
const fs = require('fs');
const path = require('path');
if (!process.env.MONGODB_URI) {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
}
const mongoose = require('mongoose');

const ACADEMIC_COLLECTIONS_TO_CLEAR = [
  'facultymappings',
  'subjects',
  'studentenrollments',
  'students',
  'exams',
  'allocations',
  'mappingjobs',
  'timetables',
  'schedulerlocks',
];

async function performSafeguardedAcademicReset({
  backupDir = path.resolve(__dirname, '../backups'),
  confirmReset = false,
  forceRepeatReset = false,
  preserveAdminEmail = null,
} = {}) {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection must be established before running reset.');
  }

  if (!confirmReset) {
    throw new Error(
      'Reset aborted: missing explicit confirmation flag (--confirm-reset or CONFIRM_ACADEMIC_RESET=YES_I_UNDERSTAND).'
    );
  }

  const existingCollections = await db.listCollections().toArray();
  const collectionNames = new Set(existingCollections.map((c) => c.name));

  // Prevent accidental repeated resets on restarts or repeat script runs
  if (!forceRepeatReset && collectionNames.has('auditlogs')) {
    const priorReset = await db.collection('auditlogs').findOne({ action: 'SYSTEM_ACADEMIC_RESET' });
    if (priorReset) {
      const mappingCount = collectionNames.has('facultymappings')
        ? await db.collection('facultymappings').countDocuments()
        : 0;
      const examCount = collectionNames.has('exams')
        ? await db.collection('exams').countDocuments()
        : 0;
      if (mappingCount === 0 && examCount === 0) {
        return {
          alreadyReset: true,
          message:
            'Academic database was already reset cleanly earlier; skipping duplicate reset. Pass --force-repeat-reset to force another backup & reset.',
        };
      }
    }
  }

  // 1. Inspect & back up EVERY collection prior to any deletion
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `pre_reset_backup_${timestamp}.json`);
  const backupSnapshot = {
    createdAt: new Date().toISOString(),
    databaseName: mongoose.connection.name,
    collections: {},
    countsBefore: {},
  };

  for (const col of existingCollections) {
    const docs = await db.collection(col.name).find({}).toArray();
    backupSnapshot.collections[col.name] = docs;
    backupSnapshot.countsBefore[col.name] = docs.length;
  }

  fs.writeFileSync(backupFile, JSON.stringify(backupSnapshot, null, 2), 'utf8');

  // 2. Clear academic & stale scheduler collections
  const clearedCounts = {};
  for (const colName of ACADEMIC_COLLECTIONS_TO_CLEAR) {
    if (collectionNames.has(colName)) {
      const result = await db.collection(colName).deleteMany({});
      clearedCounts[colName] = result.deletedCount || 0;
    } else {
      clearedCounts[colName] = 0;
    }
  }

  // Clear non-admin users (removes old Exam Incharge, old Faculty, old test accounts) while strictly preserving Admin
  let removedUsers = 0;
  let preservedAdmins = 0;
  if (collectionNames.has('users')) {
    const adminQuery = preserveAdminEmail
      ? { role: 'admin', email: String(preserveAdminEmail).toLowerCase().trim() }
      : { role: 'admin' };
    preservedAdmins = await db.collection('users').countDocuments(adminQuery);
    if (preservedAdmins === 0) {
      throw new Error('Safety abort: no active Admin account found to preserve. Create Admin first.');
    }
    const delUsersRes = await db.collection('users').deleteMany({
      role: { $ne: 'admin' },
    });
    removedUsers = delUsersRes.deletedCount || 0;
  }

  // Clean old academic audit logs & mock A-101 classrooms while preserving ET BLOCK 3010-3060 classroom master data
  let removedMockClassrooms = 0;
  if (collectionNames.has('classrooms')) {
    const mockDel = await db.collection('classrooms').deleteMany({
      $or: [{ roomNumber: { $regex: /^A-101/i } }, { name: { $regex: /LoadTest/i } }],
    });
    removedMockClassrooms = mockDel.deletedCount || 0;
  }

  let removedAuditLogs = 0;
  if (collectionNames.has('auditlogs')) {
    const delAudit = await db.collection('auditlogs').deleteMany({
      action: { $ne: 'SYSTEM_ACADEMIC_RESET' },
    });
    removedAuditLogs = delAudit.deletedCount || 0;
    await db.collection('auditlogs').insertOne({
      action: 'SYSTEM_ACADEMIC_RESET',
      performedByName: 'SAFEGUARDED_RESET_SCRIPT',
      details: {
        backupFile,
        clearedCounts,
        removedUsers,
        removedMockClassrooms,
        removedAuditLogs,
        preservedAdmins,
      },
      timestamp: new Date(),
    });
  }

  const remainingClassrooms = collectionNames.has('classrooms')
    ? await db.collection('classrooms').countDocuments()
    : 0;

  return {
    alreadyReset: false,
    backupFile,
    countsBefore: backupSnapshot.countsBefore,
    clearedCounts,
    removedUsers,
    removedMockClassrooms,
    removedAuditLogs,
    preservedAdmins,
    remainingClassrooms,
  };
}

async function runCli() {
  const args = process.argv.slice(2);
  const confirmed =
    args.includes('--confirm-reset') || process.env.CONFIRM_ACADEMIC_RESET === 'YES_I_UNDERSTAND';
  const forceRepeatReset = args.includes('--force-repeat-reset');

  if (!process.env.MONGODB_URI) {
    console.error('[Reset Aborted] MONGODB_URI is not configured in environment or server/.env.');
    process.exit(1);
  }
  if (!confirmed) {
    console.error(
      '[Reset Aborted] Pass --confirm-reset (or set CONFIRM_ACADEMIC_RESET=YES_I_UNDERSTAND) to authorize this one-time reset.'
    );
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const report = await performSafeguardedAcademicReset({
      confirmReset: true,
      forceRepeatReset,
    });
    console.log('[Safeguarded Academic DB Reset Result]', JSON.stringify(report, null, 2));
  } finally {
    await mongoose.connection.close();
  }
}

if (require.main === module) {
  runCli().catch((err) => {
    console.error('[Reset Error]', err.message);
    process.exit(1);
  });
}

module.exports = {
  ACADEMIC_COLLECTIONS_TO_CLEAR,
  performSafeguardedAcademicReset,
};
