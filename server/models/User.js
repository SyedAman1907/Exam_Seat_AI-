const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
  },
  username: {
    type: String,
    lowercase: true,
    trim: true,
    sparse: true,
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
  },
  passwordHash: {
    type: String,
    required: [true, 'Password is required'],
  },
  role: {
    type: String,
    enum: ['admin', 'faculty', 'exam_incharge', 'incharge'],
    default: 'faculty',
  },
  department: {
    type: String,
    default: 'Computer Science and Engineering',
  },
  designation: {
    type: String,
    default: 'Assistant Professor / Exam Invigilator',
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Compare password safely (returns false if stored hash is missing or malformed)
userSchema.methods.matchPassword = async function (enteredPassword) {
  if (!enteredPassword || typeof enteredPassword !== 'string') return false;
  if (!this.passwordHash || typeof this.passwordHash !== 'string') return false;
  return await bcrypt.compare(enteredPassword, this.passwordHash);
};

// Static helper to hash password
userSchema.statics.hashPassword = async function (password) {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(password, salt);
};

module.exports = mongoose.model('User', userSchema);
