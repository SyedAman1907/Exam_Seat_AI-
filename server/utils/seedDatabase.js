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

    // 1b. Seed Exam Incharge Account
    const inchargeEmail = (process.env.INCHARGE_EMAIL || 'incharge@rgmcet.edu.in').toLowerCase().trim();
    let incharge = await User.findOne({ email: inchargeEmail });
    if (!incharge) {
      const inchargePassword = process.env.INCHARGE_PASSWORD || 'InchargeExam@2026';
      const passwordHash = await User.hashPassword(inchargePassword);
      incharge = await User.create({
        name: 'Dr. Exam Incharge Coordinator',
        username: 'incharge',
        email: inchargeEmail,
        passwordHash,
        role: 'exam_incharge',
        department: 'Computer Science and Engineering',
        designation: 'Department Exam Incharge & Center Coordinator',
        isActive: true,
      });
      console.log(`[Seed] Exam Incharge created: ${incharge.email}`);
    } else {
      if (incharge.role !== 'exam_incharge') {
        incharge.role = 'exam_incharge';
        await incharge.save();
      }
      console.log(`[Seed] Exam Incharge already exists: ${incharge.email}`);
    }

    // 2. Remove legacy mock classroom (A-101) if present
    await Classroom.deleteMany({ roomNumber: { $regex: /^A-101/i } });

    // 3. Ensure the active 6 ET BLOCK classrooms (3010, 3020, 3030, 3040, 3050, 3060) configured to EXACTLY 72 seats
    const { generateDefault72SeatLayout } = require('../controllers/classroomController');
    const { seedDefaultSubjects } = require('../controllers/subjectController');

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

    // 3b. Seed Permanent Subject Master Collection (OOAD, ATCD, AI, IQTA, CN)
    try {
      await seedDefaultSubjects();
      console.log('[Seed] Permanent department subjects (OOAD, ATCD, AI, IQTA, CN) verified.');
    } catch (subjErr) {
      console.warn('[Seed Warning] Subject seeding warning:', subjErr.message);
    }

    // 4. Seed Official Department Examination Timetable (if empty)
    const timetableCount = await Timetable.countDocuments();
    if (timetableCount === 0) {
      const defaultTimetable = [
        {
          date: '2026-11-07',
          displayDate: '07/11/2026',
          subjectName: 'CNIP',
          subjectCode: 'CS401',
          academicYear: '2026-2027',
          department: 'Computer Science and Engineering',
          year: 'IV Year',
          semester: 'I Semester',
          section: 'A',
          session: 'FN',
          status: 'scheduled',
        },
        {
          date: '2026-11-07',
          displayDate: '07/11/2026',
          subjectName: 'Cloud Computing',
          subjectCode: 'CS405',
          academicYear: '2026-2027',
          department: 'Computer Science and Engineering',
          year: 'IV Year',
          semester: 'I Semester',
          section: 'B',
          session: 'FN',
          status: 'scheduled',
        },
        {
          date: '2026-11-09',
          displayDate: '09/11/2026',
          subjectName: 'DBMS',
          subjectCode: 'CS402',
          academicYear: '2026-2027',
          department: 'Computer Science and Engineering',
          year: 'IV Year',
          semester: 'I Semester',
          section: 'A',
          session: 'FN',
          status: 'scheduled',
        },
        {
          date: '2026-11-11',
          displayDate: '11/11/2026',
          subjectName: 'Operating Systems',
          subjectCode: 'CS403',
          academicYear: '2026-2027',
          department: 'Computer Science and Engineering',
          year: 'IV Year',
          semester: 'I Semester',
          section: 'A',
          session: 'FN',
          status: 'scheduled',
        },
        {
          date: '2026-11-13',
          displayDate: '13/11/2026',
          subjectName: 'Computer Networks',
          subjectCode: 'CS404',
          academicYear: '2026-2027',
          department: 'Computer Science and Engineering',
          year: 'IV Year',
          semester: 'I Semester',
          section: 'A',
          session: 'FN',
          status: 'scheduled',
        },
        {
          date: '2026-12-01',
          displayDate: '01/12/2026',
          subjectName: 'Artificial Intelligence & Machine Learning',
          subjectCode: 'CS406',
          academicYear: '2026-2027',
          department: 'Computer Science and Engineering',
          year: 'IV Year',
          semester: 'I Semester',
          section: 'A',
          session: 'FN',
          status: 'scheduled',
        },
        {
          date: '2026-12-04',
          displayDate: '04/12/2026',
          subjectName: 'Cyber Security & Digital Forensics',
          subjectCode: 'CS407',
          academicYear: '2026-2027',
          department: 'Computer Science and Engineering',
          year: 'IV Year',
          semester: 'I Semester',
          section: 'A',
          session: 'FN',
          status: 'scheduled',
        },
      ];

      for (const tt of defaultTimetable) {
        await Timetable.findOneAndUpdate(
          {
            date: tt.date,
            session: tt.session,
            section: tt.section,
            department: tt.department,
            year: tt.year,
            semester: tt.semester,
          },
          tt,
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
      }
      console.log(`[Seed] Seeded ${defaultTimetable.length} official timetable subjects into MongoDB.`);
    }

    // 5. Ensure permanent FacultyMapping records carry correct Group classifications
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
