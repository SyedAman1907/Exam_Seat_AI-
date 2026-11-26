require('dotenv').config();
const mongoose = require('mongoose');
const Classroom = require('../models/Classroom');
const Timetable = require('../models/Timetable');
const Student = require('../models/Student');
const StudentEnrollment = require('../models/StudentEnrollment');

async function seedData() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/examseat_ai';
  await mongoose.connect(mongoUri);
  console.log('[Seed] Connected to MongoDB');

  // 1. CLASSROOMS: Ensure ONLY ET BLOCK 3020, 3030, 3040, 3050, 3060 are active
  const targetRooms = ['3020', '3030', '3040', '3050', '3060'];
  await Classroom.updateMany(
    { roomNumber: { $nin: targetRooms } },
    { $set: { isActive: false, isDefault: false } }
  );

  for (const rNum of targetRooms) {
    const rows = [];
    for (let r = 1; r <= 6; r++) {
      const benches = [];
      for (let b = 1; b <= 6; b++) {
        benches.push({
          benchNumber: b,
          capacity: 2,
          seats: [
            { seatId: `R${r}-B${b}-S1`, seatNumber: 1, isAvailable: true, notes: 'Left Seat' },
            { seatId: `R${r}-B${b}-S2`, seatNumber: 2, isAvailable: true, notes: 'Right Seat' },
          ],
        });
      }
      rows.push({ rowNumber: r, benches });
    }

    let room = await Classroom.findOne({ roomNumber: rNum });
    if (!room) {
      await Classroom.create({
        name: `ET BLOCK ${rNum}`,
        roomNumber: rNum,
        block: 'ET BLOCK',
        floor: '3rd Floor',
        rows,
        totalCapacity: 72,
        availableCapacity: 72,
        supportedGroups: ['Group A', 'Group B'],
        groupACapacity: 36,
        groupBCapacity: 36,
        isDefault: rNum === '3020',
        isActive: true,
        adjacencyConfiguration: {
          enforceBenchAdjacency: true,
          maxAdjacentSameSet: 0,
        },
      });
    } else {
      room.name = `ET BLOCK ${rNum}`;
      room.block = 'ET BLOCK';
      room.floor = '3rd Floor';
      room.isActive = true;
      room.totalCapacity = 72;
      room.availableCapacity = 72;
      room.rows = rows;
      room.isDefault = rNum === '3020';
      await room.save();
    }
  }
  console.log('[Seed] Active Classrooms: ET BLOCK 3020, 3030, 3040, 3050, 3060');

  // 2. TIMETABLES: Multi-subject timetables across sections A1 - A6
  const timetablesList = [
    {
      date: '2026-11-21',
      displayDate: '21/11/2026',
      subjectName: 'Advanced Distributed Systems',
      subjectCode: 'AUDIT-4241',
      department: 'Computer Science and Engineering',
      year: 'IV Year',
      semester: 'I Semester',
      section: 'A1',
      session: 'FN',
      status: 'scheduled',
      notes: 'Scheduled Examination for Section A1',
    },
    {
      date: '2026-11-21',
      displayDate: '21/11/2026',
      subjectName: 'Artificial Intelligence & Machine Learning',
      subjectCode: 'A0526197',
      department: 'Computer Science and Engineering',
      year: 'IV Year',
      semester: 'I Semester',
      section: 'A1',
      session: 'FN',
      status: 'scheduled',
      notes: 'Elective 1 for Section A1',
    },
    {
      date: '2026-11-21',
      displayDate: '21/11/2026',
      subjectName: 'Artificial Intelligence & Machine Learning',
      subjectCode: 'A0526197',
      department: 'Computer Science and Engineering',
      year: 'IV Year',
      semester: 'I Semester',
      section: 'A3',
      session: 'FN',
      status: 'scheduled',
      notes: 'Core AI&ML for Section A3 (72 Candidates)',
    },
    {
      date: '2026-11-21',
      displayDate: '21/11/2026',
      subjectName: 'Database Management Systems',
      subjectCode: 'CS402',
      department: 'Computer Science and Engineering',
      year: 'IV Year',
      semester: 'I Semester',
      section: 'A2',
      session: 'FN',
      status: 'scheduled',
      notes: 'Core DBMS for Section A2',
    },
    {
      date: '2026-11-22',
      displayDate: '22/11/2026',
      subjectName: 'Cloud Computing',
      subjectCode: 'CS405',
      department: 'Computer Science and Engineering',
      year: 'IV Year',
      semester: 'I Semester',
      section: 'A4',
      session: 'FN',
      status: 'scheduled',
      notes: 'Cloud Computing Exam for Section A4',
    },
    {
      date: '2026-11-22',
      displayDate: '22/11/2026',
      subjectName: 'CNIP',
      subjectCode: 'CS401',
      department: 'Computer Science and Engineering',
      year: 'IV Year',
      semester: 'I Semester',
      section: 'A5',
      session: 'FN',
      status: 'scheduled',
      notes: 'CNIP for Section A5',
    },
    {
      date: '2026-11-23',
      displayDate: '23/11/2026',
      subjectName: 'Computer Networks',
      subjectCode: 'CS404',
      department: 'Computer Science and Engineering',
      year: 'IV Year',
      semester: 'I Semester',
      section: 'A6',
      session: 'FN',
      status: 'scheduled',
      notes: 'Computer Networks for Section A6',
    },
  ];

  for (const t of timetablesList) {
    const exists = await Timetable.findOne({
      date: t.date,
      subjectCode: t.subjectCode,
      section: t.section,
      session: t.session,
    });
    if (!exists) {
      await Timetable.create(t);
      console.log(`[Seed] Added Timetable: ${t.subjectName} (${t.subjectCode}) on ${t.date} Section ${t.section}`);
    }
  }

  // 3. ENROLLMENTS & STUDENTS: Ensure Section A3 has 72 students with AI&ML subject
  // Update existing 72 students in Section A3 to also be enrolled in AI&ML
  const secA3Students = await Student.find({ section: 'A3' });
  console.log(`[Seed] Found ${secA3Students.length} students in Section A3.`);

  for (const s of secA3Students) {
    const enrollExists = await StudentEnrollment.findOne({
      rollNumber: s.registrationNumber,
      subjectName: 'Artificial Intelligence & Machine Learning',
      section: 'A3',
    });
    if (!enrollExists) {
      await StudentEnrollment.create({
        rollNumber: s.registrationNumber,
        studentName: s.name,
        department: s.department || 'Computer Science and Engineering',
        year: s.year || 'IV Year',
        semester: s.semester || 'I Semester',
        section: 'A3',
        subjectName: 'Artificial Intelligence & Machine Learning',
        subjectCode: 'A0526197',
        group: s.group || 'Group A',
        facultyName: s.facultyName || 'Dr. K. Subba Rao',
        fdhNumber: s.fdhNumber || '',
        a1: s.a1 || '18',
        a2: s.a2 || '19',
        a3: s.a3 || '20',
        a4: s.a4 || '18',
        a5: s.a5 || '19',
        a6: s.a6 || '20',
        sourceFileName: 'CSE_IV_Year_SecA3.pdf',
        verifiedByFaculty: true,
      });
    }
  }

  // Also enroll Section A1 students in Advanced Distributed Systems
  const secA1Students = await Student.find({ section: 'A1' });
  console.log(`[Seed] Found ${secA1Students.length} students in Section A1.`);
  for (const s of secA1Students) {
    const enrollExists = await StudentEnrollment.findOne({
      rollNumber: s.registrationNumber,
      subjectName: 'Advanced Distributed Systems',
      section: 'A1',
    });
    if (!enrollExists) {
      await StudentEnrollment.create({
        rollNumber: s.registrationNumber,
        studentName: s.name,
        department: s.department || 'Computer Science and Engineering',
        year: s.year || 'IV Year',
        semester: s.semester || 'I Semester',
        section: 'A1',
        subjectName: 'Advanced Distributed Systems',
        subjectCode: 'AUDIT-4241',
        group: s.group || 'Group A',
        facultyName: 'Dr. P. Chenna Reddy',
        fdhNumber: s.fdhNumber || '',
        a1: '19', a2: '18', a3: '19', a4: '20', a5: '18', a6: '19',
        sourceFileName: 'CSE_IV_Year_SecA1.pdf',
        verifiedByFaculty: true,
      });
    }
  }

  // Ensure Section A4 has students for Cloud Computing
  let secA4Count = await StudentEnrollment.countDocuments({ section: 'A4' });
  if (secA4Count === 0) {
    console.log('[Seed] Generating genuine students for Section A4 (Cloud Computing)...');
    const a4Students = [];
    for (let i = 1; i <= 36; i++) {
      const roll = `24091A05${String(i).padStart(2, '0')}`;
      a4Students.push({
        rollNumber: roll,
        studentName: `STUDENT CANDIDATE ${i}`,
        department: 'Computer Science and Engineering',
        year: 'IV Year',
        semester: 'I Semester',
        section: 'A4',
        subjectName: 'Cloud Computing',
        subjectCode: 'CS405',
        group: i <= 18 ? 'Group A' : 'Group B',
        facultyName: 'Prof. M. Sreenivasulu',
        fdhNumber: `24095A05${String(i).padStart(2, '0')}`,
        a1: '18', a2: '19', a3: '17', a4: '19', a5: '18', a6: '20',
        sourceFileName: 'CSE_IV_Year_SecA4.pdf',
        verifiedByFaculty: true,
      });
    }
    await StudentEnrollment.insertMany(a4Students);
  }

  console.log('[Seed] Complete.');
  await mongoose.disconnect();
}

seedData().catch(e => {
  console.error('[Seed Error]', e);
  process.exit(1);
});
