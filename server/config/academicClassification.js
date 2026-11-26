/**
 * Official Academic Year & Group Classification Configuration
 * Department of Computer Science & Engineering, RGMCET (Autonomous)
 *
 * Configurable classification rules for Academic Years (3-2, 2-2, etc.) and Seating Groups (Group A / Group B).
 */

const ACADEMIC_CLASSIFICATION_RULES = {
  // =========================================================================
  // THIRD YEAR (3-2 / III Year) CLASSIFICATION
  // =========================================================================
  thirdYear: {
    yearName: 'III Year',
    semester: 'II Semester',
    academicYear: '2026-2027',
    displayName: '3-2 (III Year II Sem)',
    isConfigured: true,

    // Regular Students: 24091A0501 through 24091A05KN
    regular: {
      prefix: '24091A05',
      regex: /^24091A05[0-9A-Z]{2}$/i,
      startRange: '24091A0501',
      endRange: '24091A05KN',
      // Group Cutoff: Up to and including E2 is Group A, after E2 is Group B
      groupCutoff: '24091A05E2',
    },

    // FDH (Lateral Entry) Students: 25095A501 to 25095A549 (or 25095A0501 to 25095A0549)
    fdh: {
      prefix: '25095A',
      regex: /^25095A0?5[0-9]{2}$/i,
      startRange: '25095A501',
      endRange: '25095A549',
      defaultGroup: 'Group B',
    },
  },

  // =========================================================================
  // SECOND YEAR (2-2 / II Year) CLASSIFICATION (Awaiting Final Data)
  // =========================================================================
  secondYear: {
    yearName: 'II Year',
    semester: 'II Semester',
    academicYear: '2026-2027',
    displayName: '2-2 (II Year II Sem)',
    isConfigured: false,
    configurable: true,
    notes: 'Configurable structure ready. Second-year registration number patterns and group boundaries will be activated when official data is provided.',
    regular: {
      prefix: null,
      regex: null,
      startRange: null,
      endRange: null,
      groupCutoff: null,
    },
    fdh: {
      prefix: null,
      regex: null,
      startRange: null,
      endRange: null,
      defaultGroup: 'Group A',
    },
  },
};

module.exports = ACADEMIC_CLASSIFICATION_RULES;
