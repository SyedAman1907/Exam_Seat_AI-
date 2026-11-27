const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const Classroom = require('../models/Classroom');
const Timetable = require('../models/Timetable');

const seedDatabase = async () => {
  try {
    if (mongoose.connection.readyState === 0) {
      const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/examseat_ai';
      await mongoose.connect(mongoUri);
      console.log('[Seed] Connected to MongoDB');
    }

    // 1. Seed Super Admin
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@rgmcet.edu.in').toLowerCase().trim();
    let admin = await User.findOne({ email: adminEmail });

    if (!admin) {
      const password = process.env.ADMIN_PASSWORD || 'AdminExam@2026';
      const passwordHash = await User.hashPassword(password);

      admin = await User.create({
        name: process.env.ADMIN_NAME || 'Exam Controller Admin',
        username: 'admin',
        email: adminEmail,
        passwordHash,
        role: 'admin',
        department: process.env.ADMIN_DEPARTMENT || 'Computer Science and Engineering',
        designation: 'Chief Superintendent & Exam Controller',
        isActive: true,
      });
      console.log(`[Seed] Super Admin created: ${admin.email}`);
    } else {
      if (!admin.username) {
        admin.username = 'admin';
        await admin.save();
      }
      console.log(`[Seed] Super Admin already exists: ${admin.email}`);
    }

    // Retire any deprecated Exam Incharge accounts without touching Admin or Faculty
    await User.updateMany(
      { role: { $in: ['exam_incharge', 'incharge'] } },
      { $set: { role: 'faculty', isActive: false } }
    );

    // 2. Remove legacy mock classroom (A-101) if present
    await Classroom.deleteMany({ roomNumber: { $regex: /^A-101/i } });

    // 3. Ensure the active 6 ET BLOCK classrooms (3010, 3020, 3030, 3040, 3050, 3060) configured to EXACTLY 72 seats
    const { generateDefault72SeatLayout } = require('../controllers/classroomController');

    const targetRooms = ['3010', '3020', '3030', '3040', '3050', '3060'];
    await Classroom.updateMany(
      { roomNumber: { $nin: targetRooms } },
      { $set: { isActive: false, isDefault: false } }
    );

    for (const roomStr of targetRooms) {
      let room = await Classroom.findOne({ roomNumber: roomStr });
      const rows72 = generateDefault72SeatLayout();

      if (!room) {
        room = new Classroom({
          name: `ET BLOCK ${roomStr}`,
          roomNumber: roomStr,
          block: 'ET BLOCK',
          floor: '3rd Floor',
          rows: rows72,
          supportedGroups: ['Group A', 'Group B'],
          groupACapacity: 36,
          groupBCapacity: 36,
          isDefault: roomStr === '3010',
          isActive: true,
          adjacencyConfiguration: {
            enforceBenchAdjacency: true,
            maxAdjacentSameSet: 0,
          },
        });
        await room.save();
      } else {
        // Apply default 72-seat layout if not already 72 enabled seats
        const currentEnabled = (room.rows || []).reduce((acc, r) => {
          return acc + (r.benches || []).reduce((bAcc, b) => {
            return bAcc + (b.seats || []).filter((s) => s.isAvailable !== false).length;
          }, 0);
        }, 0);

        if (currentEnabled !== 72 || room.totalCapacity !== 72) {
          room.rows = rows72;
          room.name = `ET BLOCK ${roomStr}`;
          room.block = 'ET BLOCK';
          room.floor = '3rd Floor';
          room.isActive = true;
          room.isDefault = roomStr === '3010';
          await room.save();
        }
      }
    }
    console.log('[Seed] Configured 6 active ET BLOCK classrooms with exactly 72 seats (3010, 3020, 3030, 3040, 3050, 3060).');

    // Never auto-insert dummy subjects, faculty, students, or timetable records on boot.
    // 4. Ensure permanent FacultyMapping records carry correct Group classifications when present
    const FacultyMapping = require('../models/FacultyMapping');
    await FacultyMapping.updateMany({ section: { $in: ['A1', 'A2', 'A3'] } }, { $set: { group: 'Group A' } });
    await FacultyMapping.updateMany({ section: { $in: ['A4', 'A5', 'A6'] } }, { $set: { group: 'Group B' } });

    // 6. Safely drop obsolete session-wide unique index that ignored startTime/endTime
    const ExamModel = require('../models/Exam');
    try {
      const examIndexes = await ExamModel.collection.indexes();
      const oldIdx = examIndexes.find((idx) => idx.name === 'active_exam_unique_schedule' && idx.unique);
      if (oldIdx) {
        await ExamModel.collection.dropIndex('active_exam_unique_schedule');
        console.log('[Seed] Migrated obsolete "active_exam_unique_schedule" unique index to non-unique time-aware lookup.');
      }
      await ExamModel.syncIndexes();
    } catch (idxErr) {
      console.warn('[Seed Warning] Exam index synchronization note:', idxErr.message);
    }

    console.log('[Seed] Real data environment ready. Zero mock students/allocations.');
    return { admin };
  } catch (error) {
    console.error('[Seed Error]', error);
    throw error;
  }
};

if (require.main === module) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = seedDatabase;
