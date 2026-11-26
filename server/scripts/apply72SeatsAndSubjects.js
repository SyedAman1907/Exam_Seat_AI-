const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const Subject = require('../models/Subject');
const Classroom = require('../models/Classroom');
const { generateDefault72SeatLayout } = require('../controllers/classroomController');
const { seedDefaultSubjects } = require('../controllers/subjectController');

async function main() {
  try {
    console.log('[Migration] Connecting to MongoDB Atlas...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('[Migration] Connected to:', mongoose.connection.name);

    // 1. Seed Subjects
    console.log('\n[1] Seeding 5 verified department subjects...');
    await seedDefaultSubjects();
    const subjects = await Subject.find({ isActive: true }).sort({ abbreviation: 1 });
    console.log(`Seeded ${subjects.length} subjects:`);
    subjects.forEach((s) => {
      console.log(` - ${s.abbreviation} (${s.subjectCode}): ${s.subjectName}`);
    });

    // 2. Configure all 6 Classrooms to exactly 72 seats
    console.log('\n[2] Configuring 6 classrooms to EXACTLY 72 seats...');
    const roomNumbers = ['3010', '3020', '3030', '3040', '3050', '3060'];

    for (const roomNum of roomNumbers) {
      const layout72 = generateDefault72SeatLayout();
      let room = await Classroom.findOne({ roomNumber: roomNum });

      if (!room) {
        room = new Classroom({
          name: `ET BLOCK ${roomNum}`,
          roomNumber: roomNum,
          block: 'ET BLOCK',
          floor: '3rd Floor',
          rows: layout72,
          isDefault: roomNum === '3010',
          isActive: true,
        });
      } else {
        room.name = `ET BLOCK ${roomNum}`;
        room.block = 'ET BLOCK';
        room.floor = '3rd Floor';
        room.rows = layout72;
        room.isActive = true;
        room.isDefault = roomNum === '3010';
      }

      await room.save();
      console.log(` -> Configured ET BLOCK ${roomNum}: Total Cap: ${room.totalCapacity}, Avail Cap: ${room.availableCapacity}, Rows: ${room.rows.length}`);
    }

    // 3. Verification of all classrooms in Atlas
    console.log('\n[3] Verification check:');
    const allRooms = await Classroom.find({ roomNumber: { $in: roomNumbers } }).sort({ roomNumber: 1 });
    let allValid = true;
    for (const r of allRooms) {
      let enabled = 0;
      let disabled = 0;
      let totalPhysical = 0;
      r.rows.forEach(row => {
        row.benches.forEach(b => {
          b.seats.forEach(s => {
            totalPhysical++;
            if (s.isAvailable !== false) enabled++;
            else disabled++;
          });
        });
      });

      console.log(`Room ${r.roomNumber}: TotalPhysical=${totalPhysical}, Enabled=${enabled}, Disabled=${disabled}, totalCapacity=${r.totalCapacity}, availableCapacity=${r.availableCapacity}`);
      if (enabled !== 72 || r.totalCapacity !== 72 || r.availableCapacity !== 72 || disabled !== 3) {
        console.error(`ERROR: Room ${r.roomNumber} does not meet 72-seat requirement!`);
        allValid = false;
      }
    }

    if (allValid) {
      console.log('\nSUCCESS: All 6 classrooms configured with exactly 72 seats in MongoDB Atlas!');
    } else {
      console.error('\nFAILURE: Validation check failed for one or more classrooms.');
      process.exit(1);
    }

    await mongoose.disconnect();
    console.log('Done.');
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  }
}

main();
