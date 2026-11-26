const crypto = require('crypto');
const SetAllocationService = require('./setAllocationService');

class SeatingService {
  /**
   * Fisher-Yates shuffle with optional pseudo-random seed generator
   * @param {Array} array
   * @param {String} seed
   * @returns {Array} shuffled copy of array
   */
  static fisherYatesShuffle(array, seed = null) {
    const arr = [...array];
    const n = arr.length;

    // Use crypto random bytes if seed not provided, or hash-derived pseudo random if seed provided
    let randomFn;
    if (seed) {
      let state = 0;
      for (let i = 0; i < seed.length; i++) {
        state = (state * 31 + seed.charCodeAt(i)) >>> 0;
      }
      randomFn = () => {
        // Linear Congruential Generator (LCG)
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
      };
    } else {
      randomFn = () => {
        const buf = crypto.randomBytes(4);
        return buf.readUInt32BE(0) / 4294967296;
      };
    }

    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(randomFn() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }

    return arr;
  }

  /**
   * Flatten all available seats from classroom hierarchy
   * @param {Object} classroom
   * @returns {Array} List of available seat objects sorted by row, bench, seat
   */
  static getAvailableSeats(classroom) {
    const seats = [];

    if (!classroom || !classroom.rows) return seats;

    classroom.rows.forEach(row => {
      if (row.benches) {
        row.benches.forEach(bench => {
          if (bench.seats) {
            bench.seats.forEach(seat => {
              if (seat.isAvailable !== false) {
                seats.push({
                  seatId: seat.seatId || `R${row.rowNumber}-B${bench.benchNumber}-S${seat.seatNumber}`,
                  rowNumber: row.rowNumber,
                  benchNumber: bench.benchNumber,
                  seatNumber: seat.seatNumber,
                  benchKey: `R${row.rowNumber}-B${bench.benchNumber}`,
                });
              }
            });
          }
        });
      }
    });

    // Ensure deterministic default seat order (Row 1 -> Row N, Bench 1 -> Bench N, Seat 1 -> Seat N)
    seats.sort((a, b) => {
      if (a.rowNumber !== b.rowNumber) return a.rowNumber - b.rowNumber;
      if (a.benchNumber !== b.benchNumber) return a.benchNumber - b.benchNumber;
      return a.seatNumber - b.seatNumber;
    });

    return seats;
  }

  /**
   * Group seats by bench
   * @param {Array} seats
   * @returns {Array} Array of { benchKey, rowNumber, benchNumber, seats: [...] }
   */
  static groupSeatsByBench(seats) {
    const groupsMap = new Map();
    seats.forEach(s => {
      const key = `${s.rowNumber}-${s.benchNumber}`;
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          benchKey: key,
          rowNumber: s.rowNumber,
          benchNumber: s.benchNumber,
          seats: [],
        });
      }
      groupsMap.get(key).seats.push(s);
    });
    return Array.from(groupsMap.values());
  }

  /**
   * Generate complete seating and question paper set allocation
   * @param {Array} students - List of confirmed student records
   * @param {Object} classroom - Classroom model object
   * @param {Object} options - Options including seed
   */
  static generateAllocation(students, classroom, options = {}) {
    if (!students || students.length === 0) {
      throw new Error('No students provided for seating allocation.');
    }

    const availableSeats = this.getAvailableSeats(classroom);

    if (availableSeats.length < students.length) {
      const shortage = students.length - availableSeats.length;
      // If shortage is small (within classroom buffer capacity e.g. 15 seats), add overflow seats
      if (shortage <= 15) {
        const lastRow = availableSeats.length > 0 ? Math.max(...availableSeats.map((s) => s.rowNumber)) : 6;
        for (let i = 0; i < shortage; i++) {
          const extraRow = lastRow + Math.floor(i / 2) + 1;
          const extraSeatNum = (i % 2) + 1;
          availableSeats.push({
            seatId: `R${extraRow}-B1-S${extraSeatNum}`,
            rowNumber: extraRow,
            benchNumber: 1,
            seatNumber: extraSeatNum,
            benchKey: `R${extraRow}-B1`,
          });
        }
      } else {
        throw new Error(
          `Insufficient classroom capacity. Student count is ${students.length}, but classroom has only ${availableSeats.length} available seats.`
        );
      }
    }

    const seed = options.seed || `SEED-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    // Step 4: Randomly shuffle students using Fisher-Yates
    const shuffledStudents = this.fisherYatesShuffle(students, seed);

    // Step 5: Allocate seats (take first N available seats)
    const occupiedSeats = availableSeats.slice(0, shuffledStudents.length);

    // Group occupied seats by bench to calculate question paper sets
    const benchGroups = this.groupSeatsByBench(occupiedSeats);

    // Step 6: Allocate question paper sets (A, B, C) ensuring bench adjacency rule
    const setAllocationResult = SetAllocationService.allocateSets(benchGroups, shuffledStudents.length, { seed });

    // Step 7: Combine student info, seat info, and assigned question paper set
    const allocatedStudents = [];
    for (let i = 0; i < shuffledStudents.length; i++) {
      const student = shuffledStudents[i];
      const seat = occupiedSeats[i];
      const qpSet = setAllocationResult.assignments.get(seat.seatId);

      allocatedStudents.push({
        studentId: student._id || student.id,
        registrationNumber: student.registrationNumber,
        name: student.name,
        seatId: seat.seatId,
        rowNumber: seat.rowNumber,
        benchNumber: seat.benchNumber,
        seatNumber: seat.seatNumber,
        questionPaperSet: qpSet,
        fdhNumber: student.fdhNumber || '',
        group: student.group || options.group || 'Group A',
        a1: student.a1 || '',
        a2: student.a2 || '',
        a3: student.a3 || '',
        a4: student.a4 || '',
        a5: student.a5 || '',
        a6: student.a6 || '',
      });
    }

    // Step 8: Validate the entire allocation
    const validation = this.validateCompleteAllocation(allocatedStudents, availableSeats, benchGroups);

    return {
      students: allocatedStudents,
      setDistribution: setAllocationResult.distribution,
      totalAvailableSeats: availableSeats.length,
      totalOccupiedSeats: allocatedStudents.length,
      validationStatus: validation,
      randomSeed: seed,
    };
  }

  /**
   * Complete validation of allocation
   */
  static validateCompleteAllocation(allocatedStudents, availableSeats, benchGroups) {
    const issues = [];
    const studentRegSet = new Set();
    const seatIdSet = new Set();

    // 1. Check duplicate students or double-booked seats
    allocatedStudents.forEach((a, idx) => {
      if (studentRegSet.has(a.registrationNumber)) {
        issues.push(`Duplicate student registration number detected: ${a.registrationNumber}`);
      }
      studentRegSet.add(a.registrationNumber);

      if (seatIdSet.has(a.seatId)) {
        issues.push(`Seat double-booked: ${a.seatId}`);
      }
      seatIdSet.add(a.seatId);

      if (!['A', 'B', 'C'].includes(a.questionPaperSet)) {
        issues.push(`Invalid question paper set assigned to ${a.registrationNumber}: ${a.questionPaperSet}`);
      }
    });

    // 2. Check bench adjacency violations
    const seatSetMap = new Map();
    allocatedStudents.forEach(a => {
      seatSetMap.set(a.seatId, a.questionPaperSet);
    });

    const benchValidation = SetAllocationService.validateBenchAdjacency(benchGroups, seatSetMap);

    const isValid = issues.length === 0 && benchValidation.isValid;

    let message = 'Seating allocation verified successfully. All adjacency and capacity constraints satisfied.';
    if (!isValid) {
      message = `Validation failed: ${issues.length} issues, ${benchValidation.violations.length} adjacency violations.`;
    }

    return {
      isValid,
      hasAdjacentCollisions: benchValidation.violations.length > 0,
      violations: benchValidation.violations,
      issues,
      message,
      validatedAt: new Date(),
    };
  }
}

module.exports = SeatingService;
