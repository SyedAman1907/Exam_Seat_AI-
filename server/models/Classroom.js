const mongoose = require('mongoose');

const seatSchema = new mongoose.Schema({
  seatId: {
    type: String,
    required: true,
  },
  seatNumber: {
    type: Number,
    required: true,
  },
  isAvailable: {
    type: Boolean,
    default: true,
  },
  notes: {
    type: String,
    default: '',
  },
}, { _id: false });

const benchSchema = new mongoose.Schema({
  benchNumber: {
    type: Number,
    required: true,
  },
  capacity: {
    type: Number,
    required: true,
    default: 5,
  },
  seats: [seatSchema],
}, { _id: false });

const rowSchema = new mongoose.Schema({
  rowNumber: {
    type: Number,
    required: true,
  },
  benches: [benchSchema],
}, { _id: false });

const classroomSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Classroom name is required'],
    trim: true,
  },
  roomNumber: {
    type: String,
    required: [true, 'Room number is required'],
    trim: true,
  },
  block: {
    type: String,
    default: 'Main Engineering Block',
  },
  floor: {
    type: String,
    default: '1st Floor',
  },
  rows: [rowSchema],
  totalCapacity: {
    type: Number,
    default: 0,
  },
  availableCapacity: {
    type: Number,
    default: 0,
  },
  supportedGroups: {
    type: [String],
    default: ['Group A', 'Group B'],
  },
  groupACapacity: {
    type: Number,
    default: 36,
  },
  groupBCapacity: {
    type: Number,
    default: 36,
  },
  adjacencyConfiguration: {
    enforceBenchAdjacency: {
      type: Boolean,
      default: true,
    },
    maxAdjacentSameSet: {
      type: Number,
      default: 0, // 0 means strictly no same set adjacent on same bench
    },
  },
  isDefault: {
    type: Boolean,
    default: false,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Middleware to calculate total and available capacity from enabled physical seats
classroomSchema.pre('save', function (next) {
  let enabledCount = 0;
  if (this.rows && Array.isArray(this.rows)) {
    for (const row of this.rows) {
      if (row.benches && Array.isArray(row.benches)) {
        for (const bench of row.benches) {
          if (bench.seats && Array.isArray(bench.seats)) {
            const enabledSeats = bench.seats.filter((s) => s.isAvailable !== false);
            enabledCount += enabledSeats.length;
          }
        }
      }
    }
  }
  // Disabled seats must not count towards capacity: exactly 72 enabled seats
  this.totalCapacity = enabledCount;
  this.availableCapacity = enabledCount;
  this.updatedAt = new Date();
  next();
});

classroomSchema.index({ isActive: 1, roomNumber: 1 });

module.exports = mongoose.model('Classroom', classroomSchema);
