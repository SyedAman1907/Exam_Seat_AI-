/**
 * Question Paper Set Allocation Service
 * Assigns Set A, Set B, and Set C to students.
 * 
 * Main Constraint:
 * No two students sitting beside each other on the SAME BENCH must receive the same question paper set.
 * Target:
 * Balanced distribution (e.g., 24 A, 24 B, 24 C for 72 students).
 * Randomized patterns per allocation.
 */

class SetAllocationService {
  /**
   * Allocate question paper sets (A, B, C) across benches
   * @param {Array} benchGroups - Array of { benchKey, seats: [ { seatId, rowNumber, benchNumber, seatNumber, ... } ] }
   * @param {Number} totalStudents - Total students to be assigned
   * @param {Object} options - Optional random seed / strategy
   * @returns {Object} { assignments: Map(seatId -> 'A'|'B'|'C'), distribution: { A, B, C, total }, isValid: boolean }
   */
  static allocateSets(benchGroups, totalStudents, options = {}) {
    const SETS = ['A', 'B', 'C'];
    
    // Calculate target quota for each set
    const baseQuota = Math.floor(totalStudents / 3);
    const remainder = totalStudents % 3;
    
    // Randomize initial quota priority
    const quotaOrder = [...SETS].sort(() => Math.random() - 0.5);
    const quotas = {
      [quotaOrder[0]]: baseQuota + (remainder > 0 ? 1 : 0),
      [quotaOrder[1]]: baseQuota + (remainder > 1 ? 1 : 0),
      [quotaOrder[2]]: baseQuota,
    };

    // Flatten seats in bench-grouped order
    // In each bench, seats must be sorted by seatNumber (1, 2, 3...)
    const orderedSeats = [];
    benchGroups.forEach(bg => {
      const sortedSeats = [...bg.seats].sort((a, b) => a.seatNumber - b.seatNumber);
      sortedSeats.forEach((seat, idx) => {
        orderedSeats.push({
          ...seat,
          benchKey: bg.benchKey,
          isFirstOnBench: idx === 0,
          previousSeatId: idx > 0 ? sortedSeats[idx - 1].seatId : null,
        });
      });
    });

    const counts = { A: 0, B: 0, C: 0 };
    const assignmentMap = new Map();

    // Backtracking solver
    function solve(seatIdx) {
      if (seatIdx >= orderedSeats.length) {
        return true;
      }

      const currentSeat = orderedSeats[seatIdx];
      const prevSet = currentSeat.previousSeatId ? assignmentMap.get(currentSeat.previousSeatId) : null;

      // Available sets for this seat (cannot be same as previous seat on same bench)
      let candidateSets = SETS.filter(s => s !== prevSet);

      // Sort candidate sets by:
      // 1. Deficit remaining under quota (highest deficit first)
      // 2. Random tie-breaker
      candidateSets.sort((s1, s2) => {
        const deficit1 = quotas[s1] - counts[s1];
        const deficit2 = quotas[s2] - counts[s2];
        if (deficit1 !== deficit2) {
          return deficit2 - deficit1; // higher deficit prioritized
        }
        return Math.random() - 0.5;
      });

      for (const setChoice of candidateSets) {
        // Soft bound check: don't exceed target quota unless strictly necessary
        const remainingCapacity = orderedSeats.length - (counts.A + counts.B + counts.C);
        const overLimit = counts[setChoice] >= quotas[setChoice] && remainingCapacity > 0;
        
        // Even if overLimit, we may try if all candidates are overLimit, but prioritize underLimit
        counts[setChoice]++;
        assignmentMap.set(currentSeat.seatId, setChoice);

        if (solve(seatIdx + 1)) {
          return true;
        }

        // Backtrack
        counts[setChoice]--;
        assignmentMap.delete(currentSeat.seatId);
      }

      return false;
    }

    const solved = solve(0);

    if (!solved) {
      throw new Error('Unable to find valid set allocation satisfying bench adjacency constraints.');
    }

    // Verify adjacency constraint
    const validation = this.validateBenchAdjacency(benchGroups, assignmentMap);

    return {
      assignments: assignmentMap,
      distribution: {
        A: counts.A,
        B: counts.B,
        C: counts.C,
        total: counts.A + counts.B + counts.C,
      },
      targetQuotas: quotas,
      isValid: validation.isValid,
      violations: validation.violations,
    };
  }

  /**
   * Validate that no adjacent seats on any bench have the same set
   */
  static validateBenchAdjacency(benchGroups, assignmentMap) {
    const violations = [];

    benchGroups.forEach(bg => {
      const sortedSeats = [...bg.seats].sort((a, b) => a.seatNumber - b.seatNumber);
      for (let i = 0; i < sortedSeats.length - 1; i++) {
        const s1 = sortedSeats[i];
        const s2 = sortedSeats[i + 1];
        const set1 = assignmentMap.get ? assignmentMap.get(s1.seatId) : assignmentMap[s1.seatId];
        const set2 = assignmentMap.get ? assignmentMap.get(s2.seatId) : assignmentMap[s2.seatId];

        if (set1 && set2 && set1 === set2) {
          violations.push({
            rowNumber: s1.rowNumber,
            benchNumber: s1.benchNumber,
            seat1: s1.seatId,
            seat2: s2.seatId,
            set: set1,
          });
        }
      }
    });

    return {
      isValid: violations.length === 0,
      violations,
    };
  }
}

module.exports = SetAllocationService;
