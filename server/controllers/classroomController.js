const Classroom = require('../models/Classroom');
const AuditLog = require('../models/AuditLog');
const { sendControllerError } = require('../utils/controllerError');

function resolveClassroomCapacity(classroom) {
  const doc = classroom.toObject ? classroom.toObject() : classroom;
  const stored = Number(doc.totalCapacity || 0);
  const computed = Classroom.computeCapacity(doc);
  const total = computed > 0 ? computed : stored;
  return {
    ...doc,
    totalCapacity: total,
    availableCapacity: total,
  };
}

// @desc    Get all classrooms
// @route   GET /api/classrooms
// @access  Private
exports.getClassrooms = async (req, res) => {
  try {
    const filter = req.query.all === 'true' ? {} : { isActive: { $ne: false } };
    const query = Classroom.find(filter).sort({ roomNumber: 1 });
    const classrooms = await query.lean();
    // Always derive capacity from the actual seat layout so the UI never displays zero
    // capacity for legacy records whose stored totalCapacity was never backfilled.
    const resolved = classrooms.map((c) => {
      const computed = Classroom.computeCapacity(c);
      return {
        ...c,
        totalCapacity: computed > 0 ? computed : Number(c.totalCapacity || 0),
        availableCapacity: computed > 0 ? computed : Number(c.totalCapacity || 0),
      };
    });
    res.status(200).json({
      success: true,
      count: resolved.length,
      data: resolved,
    });
  } catch (error) {
    return sendControllerError(res, error, 'Classroom getClassrooms Error', 'Unable to load classrooms.');
  }
};

// @desc    Get single classroom with full layout
// @route   GET /api/classrooms/:id
// @access  Private
exports.getClassroomById = async (req, res) => {
  try {
    const classroom = await Classroom.findById(req.params.id);
    if (!classroom) {
      return res.status(404).json({ success: false, message: 'Classroom not found' });
    }
    const resolved = resolveClassroomCapacity(classroom);
    res.status(200).json({ success: true, data: resolved });
  } catch (error) {
    return sendControllerError(res, error, 'Classroom getClassroomById Error', 'Unable to load classroom.');
  }
};

// @desc    Create new classroom layout
// @route   POST /api/classrooms
// @access  Private (Admin / Faculty)
exports.createClassroom = async (req, res) => {
  try {
    const { name, roomNumber, block, floor, rows, adjacencyConfiguration } = req.body;

    if (!name || !roomNumber) {
      return res.status(400).json({
        success: false,
        message: 'Classroom name and room number are required.',
      });
    }

    const existing = await Classroom.findOne({ roomNumber: roomNumber.trim() });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: `Classroom with room number ${roomNumber} already exists.`,
      });
    }

    // Default 72-seat layout if rows not provided
    const layoutRows = rows && rows.length > 0 ? rows : generateDefault72SeatLayout();

    const classroom = new Classroom({
      name,
      roomNumber,
      block: block || 'Main Engineering Block',
      floor: floor || '1st Floor',
      rows: layoutRows,
      adjacencyConfiguration: adjacencyConfiguration || { enforceBenchAdjacency: true },
    });

    await classroom.save();

    await AuditLog.create({
      action: 'CLASSROOM_CREATED',
      performedBy: req.user._id,
      performedByName: req.user.name,
      details: { classroomId: classroom._id, name: classroom.name, capacity: classroom.totalCapacity },
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, data: classroom });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update classroom layout
// @route   PUT /api/classrooms/:id
// @access  Private
exports.updateClassroom = async (req, res) => {
  try {
    const classroom = await Classroom.findById(req.params.id);
    if (!classroom) {
      return res.status(404).json({ success: false, message: 'Classroom not found' });
    }

    const { name, roomNumber, block, floor, rows, adjacencyConfiguration, isDefault } = req.body;

    if (name) classroom.name = name;
    if (roomNumber) classroom.roomNumber = roomNumber;
    if (block) classroom.block = block;
    if (floor) classroom.floor = floor;
    if (rows) classroom.rows = rows;
    if (adjacencyConfiguration) classroom.adjacencyConfiguration = adjacencyConfiguration;
    if (typeof isDefault === 'boolean') classroom.isDefault = isDefault;

    await classroom.save();

    await AuditLog.create({
      action: 'CLASSROOM_UPDATED',
      performedBy: req.user._id,
      performedByName: req.user.name,
      details: { classroomId: classroom._id, capacity: classroom.totalCapacity },
      ipAddress: req.ip,
    });

    res.status(200).json({ success: true, data: classroom });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Helper: Generates the official 72-seat layout (3 rows x 5 benches x 5 chairs = 75 physical chairs, with exactly 3 disabled seats)
// Row 1: 5 benches x 5 seats = 25 enabled seats
// Row 2: 5 benches x 5 seats = 25 enabled seats
// Row 3: Benches 1-4 (5 seats each = 20 enabled); Bench 5 (2 enabled, 3 disabled = 2 enabled, 3 unavailable)
// Total enabled physical seats = 25 + 25 + 22 = exactly 72 seats!
function generateDefault72SeatLayout() {
  const rows = [];

  // Row 1: 5 benches x 5 seats = 25 enabled
  const row1Benches = [];
  for (let b = 1; b <= 5; b++) {
    const seats = [];
    for (let s = 1; s <= 5; s++) {
      seats.push({ seatId: `R1-B${b}-S${s}`, seatNumber: s, isAvailable: true, notes: 'Active seat' });
    }
    row1Benches.push({ benchNumber: b, capacity: 5, seats });
  }
  rows.push({ rowNumber: 1, benches: row1Benches });

  // Row 2: 5 benches x 5 seats = 25 enabled
  const row2Benches = [];
  for (let b = 1; b <= 5; b++) {
    const seats = [];
    for (let s = 1; s <= 5; s++) {
      seats.push({ seatId: `R2-B${b}-S${s}`, seatNumber: s, isAvailable: true, notes: 'Active seat' });
    }
    row2Benches.push({ benchNumber: b, capacity: 5, seats });
  }
  rows.push({ rowNumber: 2, benches: row2Benches });

  // Row 3: 5 benches x 5 chairs = 22 enabled + 3 disabled = 25 physical chairs
  const row3Benches = [];
  for (let b = 1; b <= 5; b++) {
    const seats = [];
    for (let s = 1; s <= 5; s++) {
      // In Bench 5, Seats 3, 4, 5 are disabled to achieve exactly 72 enabled seats
      const isSeatDisabled = (b === 5 && s > 2);
      seats.push({
        seatId: `R3-B${b}-S${s}`,
        seatNumber: s,
        isAvailable: !isSeatDisabled,
        notes: isSeatDisabled ? 'Unavailable / Disabled (72-seat capacity constraint)' : 'Active seat',
      });
    }
    row3Benches.push({ benchNumber: b, capacity: 5, seats });
  }
  rows.push({ rowNumber: 3, benches: row3Benches });

  return rows;
}

exports.generateDefault72SeatLayout = generateDefault72SeatLayout;

// @desc    Get section-to-classroom mapping configuration
// @route   GET /api/classrooms/section-mappings
// @access  Private
exports.getSectionMappings = async (req, res) => {
  try {
    const classroomMappingService = require('../services/classroomMappingService');
    const mappings = classroomMappingService.getAllMappings();
    const classrooms = await Classroom.find({ isActive: true }).select('name roomNumber totalCapacity');
    
    res.status(200).json({
      success: true,
      data: mappings,
      classrooms,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update section-to-classroom mapping configuration
// @route   PUT /api/classrooms/section-mappings
// @access  Private (Admin)
exports.updateSectionMappings = async (req, res) => {
  try {
    const classroomMappingService = require('../services/classroomMappingService');
    const { section, roomNumber } = req.body;
    
    if (!section || !roomNumber) {
      return res.status(400).json({
        success: false,
        message: 'Both section (e.g., A1) and roomNumber (e.g., 3010) are required.',
      });
    }

    const updated = classroomMappingService.updateMapping(section, roomNumber);
    res.status(200).json({
      success: true,
      message: `Section ${section} successfully mapped to classroom ET BLOCK ${roomNumber}.`,
      data: updated,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
