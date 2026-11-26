const ACADEMIC_CLASSIFICATION_RULES = require('../config/academicClassification');

class StudentClassificationService {
  /**
   * Classify a student by registration number into Academic Year and Seating Group (Group A / Group B)
   * @param {string} regNo - Candidate registration number (e.g. 24091A0501, 24091A05E2, 25095A501)
   * @returns {Object} { year, semester, displayName, group, studentType, isThirdYear, isSecondYear }
   */
  static classifyStudent(regNo) {
    if (!regNo || typeof regNo !== 'string') {
      return {
        year: 'III Year',
        semester: 'II Semester',
        displayName: '3-2',
        group: 'Group A',
        studentType: 'UNKNOWN',
        isThirdYear: true,
        isSecondYear: false,
      };
    }

    const clean = regNo.trim().toUpperCase();
    const rules = ACADEMIC_CLASSIFICATION_RULES;

    // 1. Check Third-Year Regular Students: 24091A0501 through 24091A05KN
    const thirdRegular = rules.thirdYear.regular;
    if (clean.startsWith(thirdRegular.prefix)) {
      // Validate suffix is within 01 through KN
      const suffix = clean.substring(thirdRegular.prefix.length);
      const isGroupA = clean <= thirdRegular.groupCutoff;

      return {
        year: rules.thirdYear.yearName,
        semester: rules.thirdYear.semester,
        academicYear: rules.thirdYear.academicYear,
        displayName: rules.thirdYear.displayName,
        group: isGroupA ? 'Group A' : 'Group B',
        studentType: 'REGULAR',
        isThirdYear: true,
        isSecondYear: false,
        cutoffApplied: thirdRegular.groupCutoff,
      };
    }

    // 2. Check Third-Year FDH Students: 25095A501 to 25095A549 (or 25095A0501 to 25095A0549)
    const thirdFdh = rules.thirdYear.fdh;
    if (thirdFdh.regex.test(clean) || (clean >= thirdFdh.startRange && clean <= thirdFdh.endRange)) {
      return {
        year: rules.thirdYear.yearName,
        semester: rules.thirdYear.semester,
        academicYear: rules.thirdYear.academicYear,
        displayName: rules.thirdYear.displayName,
        group: thirdFdh.defaultGroup || 'Group B',
        studentType: 'FDH',
        isThirdYear: true,
        isSecondYear: false,
      };
    }

    // 3. Check Second-Year Students (when configured in future)
    if (rules.secondYear.isConfigured && rules.secondYear.regular?.regex?.test(clean)) {
      const isGroupA = rules.secondYear.regular.groupCutoff
        ? clean <= rules.secondYear.regular.groupCutoff
        : true;
      return {
        year: rules.secondYear.yearName,
        semester: rules.secondYear.semester,
        academicYear: rules.secondYear.academicYear,
        displayName: rules.secondYear.displayName,
        group: isGroupA ? 'Group A' : 'Group B',
        studentType: 'REGULAR',
        isThirdYear: false,
        isSecondYear: true,
      };
    }

    // Default Fallback: Not classified as 3rd year or configured 2nd year
    return {
      year: 'Unknown',
      semester: '',
      academicYear: '2026-2027',
      displayName: 'Unclassified',
      group: 'Group A',
      studentType: 'UNKNOWN',
      isThirdYear: false,
      isSecondYear: false,
    };
  }

  /**
   * Filter an array of students by Group (Group A or Group B)
   * @param {Array} students
   * @param {string} targetGroup - 'Group A' | 'Group B'
   * @returns {Array}
   */
  static filterStudentsByGroup(students, targetGroup) {
    if (!Array.isArray(students)) return [];
    if (!targetGroup) return students;

    const normTarget = targetGroup.toUpperCase();
    return students.filter((s) => {
      const reg = s.regNo || s.registrationNumber;
      if (!reg) return false;
      const res = this.classifyStudent(reg);
      return res.group.toUpperCase() === normTarget;
    });
  }

  /**
   * Check if a registration number belongs to Group A
   */
  static isGroupA(regNo) {
    return this.classifyStudent(regNo).group === 'Group A';
  }

  /**
   * Check if a registration number belongs to Group B
   */
  static isGroupB(regNo) {
    return this.classifyStudent(regNo).group === 'Group B';
  }

  /**
   * Get active classification rules
   */
  static getRules() {
    return ACADEMIC_CLASSIFICATION_RULES;
  }
}

module.exports = StudentClassificationService;
