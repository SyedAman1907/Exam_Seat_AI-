const User = require('../models/User');

// @desc    Get all faculty members with search and department filtering
// @route   GET /api/faculty
// @access  Private
exports.getFaculties = async (req, res) => {
  try {
    const { search, department, role } = req.query;
    const filter = {};

    if (role && role !== 'ALL') {
      filter.role = role;
    } else {
      filter.role = { $in: ['faculty', 'exam_incharge', 'incharge'] };
    }

    if (department && department !== 'ALL') {
      filter.department = department;
    }

    if (search && search.trim()) {
      const q = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: new RegExp(q, 'i') } },
        { email: { $regex: new RegExp(q, 'i') } },
        { designation: { $regex: new RegExp(q, 'i') } },
      ];
    }

    const faculties = await User.find(filter)
      .select('-passwordHash')
      .sort({ name: 1 })
      .lean();

    res.status(200).json({
      success: true,
      count: faculties.length,
      data: faculties,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get single faculty member by ID
// @route   GET /api/faculty/:id
// @access  Private
exports.getFacultyById = async (req, res) => {
  try {
    const faculty = await User.findById(req.params.id).select('-passwordHash');
    if (!faculty) {
      return res.status(404).json({ success: false, message: 'Faculty member not found.' });
    }
    res.status(200).json({ success: true, data: faculty });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create a new faculty member
// @route   POST /api/faculty
// @access  Private (Admin / Exam Incharge)
exports.createFaculty = async (req, res) => {
  try {
    const { name, email, password, role = 'faculty', department, designation } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Faculty name is required.' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, message: 'Email address is required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existing = await User.findOne({ email: cleanEmail });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Faculty or user with email '${cleanEmail}' already exists.`,
      });
    }

    const initialPassword = password && password.trim() ? password.trim() : 'Faculty@2026';
    const passwordHash = await User.hashPassword(initialPassword);

    const faculty = await User.create({
      name: name.trim(),
      email: cleanEmail,
      passwordHash,
      role: role || 'faculty',
      department: department || 'Computer Science and Engineering',
      designation: designation || 'Assistant Professor / Exam Invigilator',
      isActive: true,
    });

    const sanitized = faculty.toObject();
    delete sanitized.passwordHash;

    res.status(201).json({
      success: true,
      message: 'Faculty member created successfully.',
      data: sanitized,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update faculty member details
// @route   PUT /api/faculty/:id
// @access  Private (Admin / Exam Incharge)
exports.updateFaculty = async (req, res) => {
  try {
    const { name, designation, department, isActive, role } = req.body;

    const faculty = await User.findById(req.params.id);
    if (!faculty) {
      return res.status(404).json({ success: false, message: 'Faculty member not found.' });
    }

    if (name) faculty.name = name.trim();
    if (designation) faculty.designation = designation.trim();
    if (department) faculty.department = department.trim();
    if (typeof isActive === 'boolean') faculty.isActive = isActive;
    if (role) faculty.role = role;

    await faculty.save();

    const sanitized = faculty.toObject();
    delete sanitized.passwordHash;

    res.status(200).json({
      success: true,
      message: 'Faculty details updated successfully.',
      data: sanitized,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete faculty member
// @route   DELETE /api/faculty/:id
// @access  Private (Admin)
exports.deleteFaculty = async (req, res) => {
  try {
    const faculty = await User.findById(req.params.id);
    if (!faculty) {
      return res.status(404).json({ success: false, message: 'Faculty member not found.' });
    }

    if (faculty.role === 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) {
        return res.status(400).json({ success: false, message: 'Cannot delete the primary administrator.' });
      }
    }

    await User.findByIdAndDelete(req.params.id);

    res.status(200).json({
      success: true,
      message: 'Faculty member deleted successfully.',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
