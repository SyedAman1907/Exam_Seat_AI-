const fs = require('fs');
const pdfParse = require('pdf-parse');
const { createWorker } = require('tesseract.js');

class PdfExtractorService {
  /**
   * Extract student data from one or more uploaded PDF files
   * @param {Array<Object>} files - Array of Multer file objects
   * @param {Object} options - Custom options (e.g., defaultSubject, defaultFaculty, defaultSection)
   */
  static async extractFromMultipleFiles(files, options = {}) {
    if (!files || files.length === 0) {
      throw new Error('No files provided for extraction.');
    }

    const allRecords = [];
    const fileSummaries = [];
    let grandTotalExtracted = 0;

    for (let fIdx = 0; fIdx < files.length; fIdx++) {
      const file = files[fIdx];
      try {
        const fileResult = await this.extractFromFile(file, options);
        fileSummaries.push({
          fileName: file.originalname,
          extractedCount: fileResult.records.length,
          subject: fileResult.detectedSubject || 'Not specified',
          faculty: fileResult.detectedFaculty || 'Not specified',
          section: fileResult.detectedSection || 'A',
          groups: Array.from(new Set(fileResult.records.map(r => r.group))),
        });

        // Merge records
        fileResult.records.forEach(r => {
          allRecords.push(r);
        });
        grandTotalExtracted += fileResult.records.length;
      } catch (err) {
        console.error(`[PDF Extraction Error in ${file.originalname}]`, err.message);
        fileSummaries.push({
          fileName: file.originalname,
          error: err.message,
          extractedCount: 0,
        });
      }
    }

    // Post-process all records: check for duplicates across files, assign serial numbers
    return this.organizeAndValidateRecords(allRecords, fileSummaries);
  }

  /**
   * Extract records from a single PDF (or Excel/CSV) file
   */
  static async extractFromFile(file, options = {}) {
    const filePath = file.path;
    const originalName = file.originalname.toLowerCase();

    if (originalName.endsWith('.pdf')) {
      return this.parsePdfContent(filePath, file.originalname, options);
    } else if (originalName.endsWith('.xlsx') || originalName.endsWith('.xls')) {
      const ImportService = require('./importService');
      const records = await ImportService.parseExcel(filePath);
      return this.standardizeRawRecords(records, file.originalname, options);
    } else if (originalName.endsWith('.csv')) {
      const ImportService = require('./importService');
      const records = await ImportService.parseCSV(filePath);
      return this.standardizeRawRecords(records, file.originalname, options);
    } else {
      throw new Error(`Unsupported file type: ${file.originalname}`);
    }
  }

  /**
   * Extract text and pages using pdfjs-dist
   */
  static async extractTextWithPdfJs(filePath) {
    try {
      const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
      const data = new Uint8Array(fs.readFileSync(filePath));
      const doc = await pdfjsLib.getDocument({
        data,
        useSystemFonts: true,
        disableFontFace: true,
      }).promise;
      
      let fullText = '';
      const numPages = doc.numPages;
      for (let p = 1; p <= numPages; p++) {
        const page = await doc.getPage(p);
        const textContent = await page.getTextContent();
        let lastY = null;
        let pageStr = '';
        for (const item of textContent.items) {
          if (lastY !== null && Math.abs(item.transform[5] - lastY) > 4) {
            pageStr += '\n';
          } else if (lastY !== null) {
            pageStr += ' ';
          }
          pageStr += item.str;
          lastY = item.transform[5];
        }
        fullText += pageStr + '\n';
      }
      return { text: fullText, numPages };
    } catch (err) {
      console.warn('[pdfjs-dist extraction warning]:', err.message);
      return null;
    }
  }

  /**
   * Parse PDF text with OCR fallback if necessary
   */
  static async parsePdfContent(filePath, originalName, options = {}) {
    let pdfText = '';
    let numPages = 1;

    // 1. Try modern pdfjs-dist parser first
    const pdfJsResult = await this.extractTextWithPdfJs(filePath);
    if (pdfJsResult && pdfJsResult.text && pdfJsResult.text.trim().length > 20) {
      pdfText = pdfJsResult.text;
      numPages = pdfJsResult.numPages;
    }

    // 2. Fallback to pdf-parse if pdfjs-dist didn't return text
    if (!pdfText || pdfText.trim().length < 20) {
      try {
        const dataBuffer = fs.readFileSync(filePath);
        const parsed = await pdfParse(dataBuffer);
        if (parsed.text && parsed.text.trim().length > 20) {
          pdfText = parsed.text;
          numPages = parsed.numpages || 1;
        }
      } catch (parseErr) {
        console.warn(`[pdf-parse failed]`, parseErr.message);
      }
    }

    // 3. OCR Fallback if text is still empty or too short (scanned PDF)
    if (!pdfText || pdfText.trim().length < 20) {
      console.log(`[OCR] Scanned PDF detected for ${originalName}, invoking Tesseract OCR engine...`);
      pdfText = await this.performOcrFallback(filePath);
    }

    return this.parseTextIntoRecords(pdfText, originalName, numPages, options);
  }

  /**
   * OCR Fallback using Tesseract.js (safely handled)
   */
  static async performOcrFallback(filePath) {
    let worker;
    try {
      worker = await createWorker('eng');
      const ret = await worker.recognize(filePath);
      await worker.terminate();
      return ret.data.text || '';
    } catch (err) {
      if (worker) {
        try { await worker.terminate(); } catch (e) {}
      }
      console.warn('[OCR Fallback Notice]: OCR scanning encountered an error or unsupported format:', err.message);
      return '';
    }
  }

  /**
   * Parse extracted raw text into structured academic records
   */
  static parseTextIntoRecords(fullText, originalName, numPages, options = {}) {
    const lines = fullText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

    // 1. Detect Metadata from Document Headers
    let detectedSubject = options.subjectName || '';
    let detectedFaculty = options.facultyName || '';
    let detectedSection = options.section || '';
    let detectedAcademicYear = options.academicYear || '2026-2027';
    let detectedDefaultGroup = options.group || '';

    // Search header lines (first 40 lines) for metadata
    const headerSlice = lines.slice(0, 45);
    for (const line of headerSlice) {
      // Subject detection
      if (!detectedSubject) {
        const subMatch = line.match(/(?:Subject|Course|Sub)(?:\s*Name)?\s*[:\-–]\s*([A-Za-z0-9\s&()\-]+)/i);
        if (subMatch && subMatch[1].trim().length > 2) {
          detectedSubject = subMatch[1].trim().replace(/\s{2,}/g, ' ');
        }
      }

      // Faculty Name detection
      if (!detectedFaculty) {
        const facMatch = line.match(/(?:Faculty|Instructor|Teacher|Lecturer|Staff)(?:\s*Name)?\s*[:\-–]\s*([A-Za-z\.\s]+)/i);
        if (facMatch && facMatch[1].trim().length > 2) {
          detectedFaculty = facMatch[1].trim().replace(/\s{2,}/g, ' ');
        } else {
          // Check for Dr. / Prof. / Mr. in line
          const titleMatch = line.match(/\b(Dr\.|Prof\.|Mr\.|Mrs\.|Ms\.)\s+([A-Za-z\.\s]{3,30})\b/);
          if (titleMatch) {
            detectedFaculty = titleMatch[0].trim();
          }
        }
      }

      // Section detection (supports A1 to A6, or legacy A to F)
      if (!detectedSection) {
        const secMatch = line.match(/(?:Section|Sec)\s*[:\-–]\s*(A[1-6]|[A-F]|1|2|3|4|5|6)\b/i) || line.match(/CSE\s*[-–]\s*(A[1-6]|[A-F]|1|2|3|4|5|6)\b/i);
        if (secMatch) {
          let rawSec = secMatch[1].toUpperCase();
          if (rawSec === 'A') rawSec = 'A1';
          else if (rawSec === 'B') rawSec = 'A2';
          else if (rawSec === 'C') rawSec = 'A3';
          else if (rawSec === 'D') rawSec = 'A4';
          else if (rawSec === 'E') rawSec = 'A5';
          else if (rawSec === 'F') rawSec = 'A6';
          else if (/^[1-6]$/.test(rawSec)) rawSec = `A${rawSec}`;
          detectedSection = rawSec;
        }
      }

      // Academic Year detection
      if (!detectedAcademicYear || detectedAcademicYear === '2026-2027') {
        const yrMatch = line.match(/\b(202[0-9]\s*[-–]\s*202[0-9])\b/);
        if (yrMatch) {
          detectedAcademicYear = yrMatch[1].replace(/\s+/g, '');
        }
      }

      // Group detection in header
      if (!detectedDefaultGroup) {
        const grpMatch = line.match(/\bGroup\s*[-–:]?\s*([AB])\b/i);
        if (grpMatch) {
          detectedDefaultGroup = `Group ${grpMatch[1].toUpperCase()}`;
        }
      }
    }

    if (!detectedSection) detectedSection = 'A1';
    if (!detectedSubject) detectedSubject = 'General Examination';

    // 2. Identify Table Header Columns (A1-A6, FDH, Group, Roll Number)
    let hasA1 = false;
    let hasFDH = false;
    for (const line of headerSlice) {
      if (/\bA1\b/i.test(line) && /\bA2\b/i.test(line)) hasA1 = true;
      if (/\bFDH\b/i.test(line) || /Lateral\s*Entry/i.test(line)) hasFDH = true;
    }

    // 3. Extract Student Rows
    // Standard RGMCET Roll Pattern: 10 alphanumeric e.g. 24091A0501, 23091A05A1, 24095A0501
    const rollRegex = /\b([0-9]{2}09[15][A-Z0-9]{5}|[0-9]{2}[0-9A-Z]{3}[A-Z0-9]{5})\b/gi;
    const records = [];

    // Temporary context when multiple subjects exist in distinct pages/sections of the document
    let currentSubject = detectedSubject;
    let currentFaculty = detectedFaculty;
    let currentSection = detectedSection;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check if page header switched subject/faculty
      const inlineSub = line.match(/(?:Subject|Course)(?:\s*Name)?\s*[:\-–]\s*([A-Za-z0-9\s&()\-]+)/i);
      if (inlineSub && inlineSub[1].trim().length > 2) {
        currentSubject = inlineSub[1].trim().replace(/\s{2,}/g, ' ');
      }
      const inlineFac = line.match(/(?:Faculty|Instructor)(?:\s*Name)?\s*[:\-–]\s*([A-Za-z\.\s]+)/i);
      if (inlineFac && inlineFac[1].trim().length > 2) {
        currentFaculty = inlineFac[1].trim().replace(/\s{2,}/g, ' ');
      }
      const inlineSec = line.match(/(?:Section|Sec)\s*[:\-–]\s*(A[1-6]|[A-F]|1|2|3|4|5|6)\b/i);
      if (inlineSec) {
        let secVal = inlineSec[1].toUpperCase();
        if (secVal === 'A') secVal = 'A1';
        else if (secVal === 'B') secVal = 'A2';
        else if (secVal === 'C') secVal = 'A3';
        else if (secVal === 'D') secVal = 'A4';
        else if (secVal === 'E') secVal = 'A5';
        else if (secVal === 'F') secVal = 'A6';
        else if (/^[1-6]$/.test(secVal)) secVal = `A${secVal}`;
        currentSection = secVal;
      }

      // Check for Roll Number match in line
      const rollMatches = line.match(rollRegex);
      if (rollMatches && rollMatches.length > 0) {
        const primaryRoll = rollMatches[0].toUpperCase();

        // Check if there is a secondary roll number on the same line (FDH / Lateral Entry Roll Number)
        let fdhNumber = '';
        if (rollMatches.length > 1) {
          // Second match is likely FDH roll number
          fdhNumber = rollMatches[1].toUpperCase();
        } else {
          // Check for FDH explicitly marked
          const fdhMatch = line.match(/FDH(?:\s*No)?\s*[:\-]?\s*([A-Z0-9]{6,12})/i);
          if (fdhMatch) fdhNumber = fdhMatch[1].toUpperCase();
        }

        // Clean out S.No and Roll numbers to extract Student Name
        let cleanText = line
          .replace(rollMatches[0], ' ')
          .replace(/^\s*\d+[\.\)]?\s*/, '') // Remove leading serial number (e.g. "1. " or "1 ")
          .trim();

        if (fdhNumber) {
          cleanText = cleanText.replace(fdhNumber, ' ');
        }

        // Extract Group if present in row
        let group = detectedDefaultGroup || 'Group A';
        const rowGrpMatch = cleanText.match(/\bGroup\s*([AB])\b/i) || cleanText.match(/\b([AB])\s*Group\b/i);
        if (rowGrpMatch) {
          group = `Group ${rowGrpMatch[1].toUpperCase()}`;
          cleanText = cleanText.replace(rowGrpMatch[0], ' ');
        }

        // Extract A1..A6 values if numbers are present at end or within columns
        let a1 = '', a2 = '', a3 = '', a4 = '', a5 = '', a6 = '';
        // Look for trailing numeric assessment scores (e.g. 18 19 20 17 18 19)
        const scoreMatches = cleanText.match(/\b(\d{1,3}(?:\.\d+)?)\b/g);
        if (scoreMatches && scoreMatches.length >= 6) {
          // Last 6 numbers are A1 through A6
          const last6 = scoreMatches.slice(-6);
          a1 = last6[0];
          a2 = last6[1];
          a3 = last6[2];
          a4 = last6[3];
          a5 = last6[4];
          a6 = last6[5];
          // Remove scores from cleanText
          for (const s of last6) {
            cleanText = cleanText.replace(new RegExp(`\\b${s}\\b`), ' ');
          }
        }

        // Remove extraneous symbols and compress spaces to get Candidate Name
        let studentName = cleanText
          .replace(/[,|\t;:]+/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim();

        // If student name became empty, fallback cleanly
        if (!studentName || studentName.length < 2) {
          studentName = `Student ${primaryRoll.slice(-4)}`;
        }

        records.push({
          rollNumber: primaryRoll,
          studentName: studentName.toUpperCase(),
          facultyName: currentFaculty || 'CSE Faculty',
          section: currentSection || 'A',
          subjectName: currentSubject,
          group,
          a1,
          a2,
          a3,
          a4,
          a5,
          a6,
          fdhNumber,
          academicYear: detectedAcademicYear,
          sourceFileName: originalName,
          hasMissingOptional: !fdhNumber || !a1,
        });
      }
    }

    return {
      records,
      detectedSubject,
      detectedFaculty,
      detectedSection,
      numPages,
    };
  }

  /**
   * Standardize raw records from CSV / Excel into uniform academic structure
   */
  static standardizeRawRecords(rawRecords, fileName, options = {}) {
    const records = rawRecords.map((r) => {
      const rollNumber = (r.registrationNumber || r.rollNumber || '').trim().toUpperCase();
      const studentName = (r.name || r.studentName || '').trim().toUpperCase();
      const section = (r.section || options.section || 'A').trim().toUpperCase();
      const subjectName = r.subject || options.subjectName || 'General Examination';
      const facultyName = r.facultyName || options.facultyName || 'CSE Faculty';
      const group = r.group || options.group || 'Group A';

      return {
        rollNumber,
        studentName: studentName || `Student ${rollNumber.slice(-4)}`,
        facultyName,
        section,
        subjectName,
        group,
        a1: r.a1 || '',
        a2: r.a2 || '',
        a3: r.a3 || '',
        a4: r.a4 || '',
        a5: r.a5 || '',
        a6: r.a6 || '',
        fdhNumber: r.fdhNumber || '',
        academicYear: r.academicYear || options.academicYear || '2026-2027',
        sourceFileName: fileName,
        hasMissingOptional: !r.fdhNumber || !r.a1,
      };
    });

    return {
      records,
      detectedSubject: options.subjectName || (records[0]?.subjectName) || '',
      detectedFaculty: options.facultyName || (records[0]?.facultyName) || '',
      detectedSection: options.section || (records[0]?.section) || 'A',
      numPages: 1,
    };
  }

  /**
   * Organize, validate, and index all extracted records for faculty preview
   */
  static organizeAndValidateRecords(allRecords, fileSummaries) {
    const seenRollMap = new Map();
    const processed = [];

    // Count occurrences for duplicate detection
    allRecords.forEach((r) => {
      if (r.rollNumber) {
        seenRollMap.set(r.rollNumber, (seenRollMap.get(r.rollNumber) || 0) + 1);
      }
    });

    let validCount = 0;
    let duplicateCount = 0;
    let missingFieldCount = 0;

    const subjectsFound = new Set();
    const sectionsFound = new Set();
    const facultyFound = new Set();

    allRecords.forEach((r, idx) => {
      const errors = [];
      const warnings = [];

      if (!r.rollNumber) {
        errors.push('Missing Roll Number');
        missingFieldCount++;
      }

      if (!r.studentName) {
        errors.push('Missing Student Name');
        missingFieldCount++;
      }

      if (seenRollMap.get(r.rollNumber) > 1) {
        warnings.push(`Duplicate roll number (${seenRollMap.get(r.rollNumber)} occurrences across records)`);
        duplicateCount++;
      }

      if (!r.fdhNumber) {
        warnings.push('FDH roll number not present in source');
      }

      if (!r.a1 && !r.a2) {
        warnings.push('A1–A6 assessment marks not found in source document');
      }

      const isValid = errors.length === 0;
      if (isValid) validCount++;

      if (r.subjectName) subjectsFound.add(r.subjectName);
      if (r.section) sectionsFound.add(r.section);
      if (r.facultyName) facultyFound.add(r.facultyName);

      processed.push({
        id: `rec-${idx + 1}`,
        serialNumber: idx + 1,
        rollNumber: r.rollNumber,
        studentName: r.studentName,
        facultyName: r.facultyName || 'CSE Faculty',
        section: r.section || 'A',
        subjectName: r.subjectName || 'General Examination',
        group: r.group || 'Group A',
        a1: r.a1 || '',
        a2: r.a2 || '',
        a3: r.a3 || '',
        a4: r.a4 || '',
        a5: r.a5 || '',
        a6: r.a6 || '',
        fdhNumber: r.fdhNumber || '',
        academicYear: r.academicYear || '2026-2027',
        sourceFileName: r.sourceFileName || 'Uploaded Document',
        isValid,
        errors,
        warnings,
      });
    });

    return {
      records: processed,
      summary: {
        totalFiles: fileSummaries.length,
        totalExtracted: processed.length,
        validCount,
        invalidCount: processed.length - validCount,
        duplicateCount,
        missingFieldCount,
        subjectsFound: Array.from(subjectsFound),
        sectionsFound: Array.from(sectionsFound),
        facultyFound: Array.from(facultyFound),
        fileSummaries,
        canConfirm: validCount > 0,
      },
    };
  }

  /**
   * Intelligently extract multiple independent subject-wise student rosters from a single PDF document.
   * Handles multi-page nominal lists where each subject-section has its own faculty, group, and student roster.
   * Does NOT merge unrelated subject blocks, assign everyone to A1, or treat cross-subject students as duplicates.
   */
  static async extractMultiSubjectRosters(filePath, originalName = 'Roster.pdf', options = {}) {
    const dataBuffer = fs.readFileSync(filePath);
    const parsed = await pdfParse(dataBuffer);

    if (!parsed.text || parsed.text.trim().length < 20) {
      throw new Error('PDF document appears to be empty or contains no readable text.');
    }

    // Split document into individual page blocks using RGMCET institutional header boundary
    const pageBlocks = parsed.text
      .split(/(?=RGM[\s\n]*(?:\(AUTONOMOUS\)|\( AUTONOMOUS \)))/i)
      .filter((b) => b.trim().length > 20);

    if (pageBlocks.length === 0) {
      // If splitting by header didn't find multiple blocks, treat entire text as single block
      pageBlocks.push(parsed.text);
    }

    const KNOWN_SUBJECTS = {
      'artificial intelligence': { name: 'Artificial Intelligence', code: '20A05502S' },
      'automata theory and compiler design': { name: 'Automata Theory and Compiler Design', code: '20A05501T' },
      'computer networks and internet protocols': { name: 'Computer Networks and Internet Protocols', code: '20A05502T' },
      'full stack development': { name: 'Full Stack Development', code: '20A05503T' },
      'object oriented analysis and design': { name: 'Object Oriented Analysis and Design', code: '20A05504T' },
      'iqta': { name: 'IQTA', code: '20A05505T' },
      'tinkering lab': { name: 'Tinkering Lab', code: '20A05506L' },
      'assignment': { name: 'Assignment', code: '20A05507A' },
      "mooc's": { name: "MOOC's", code: '20A05508M' },
      'moocs': { name: "MOOC's", code: '20A05508M' },
    };

    const KNOWN_FACULTY_NAMES = [
      'Dr. N. Madhusudhana Reddy',
      'Dr. N Madhusudhana Reddy',
      'B. V. Chandra Sekhar',
      'B V Chandra Sekhar',
      'Dr. P. Nagaraju',
      'Dr. P Nagaraju',
      'Dr. S. Subbalakshmi',
      'Dr S Subbalakshmi',
      'K. Viswanath',
      'K Viswanath',
      'Dr. K. Nageswara Reddy',
      'Dr. K Nageswara Reddy',
      'K. Jayasri',
      'K Jayasri',
      'K. Lakshmi Rupa',
      'K Lakshmi Rupa',
      'S. Tahseen Banu',
      'S Tahseen Banu',
      'P. Naveen Sundar Kumar',
      'P Naveen Sundar Kumar',
      'Y. Durga Tejaswi',
      'Y Durga Tejaswi',
      'Dr. M. Ayyavaraiah',
      'Dr. N. Ramajaneya Reddy',
      'Dr. N Ramajaneya Reddy',
      'M. Ravi Kumar',
      'M Ravi Kumar',
      'R. Sreehari Reddy',
      'R Sreehari Reddy',
      'Dr. N. Ravi',
      'Dr. S. Farooq',
      'Dr. V.B. Sreedhar',
      'Dr. V. B. Sreedhar',
      'Mr. J. Leela Mahendra Kumar',
      'Mr.J.Leela Mahendra Kumar',
      'Dr. D. Usen',
      'Dr.D.Usen',
      'Mr. P. Rangappa',
      'Mr.P.Rangappa',
      'Mr. K. Viswanath',
      'Mr.K.Viswanath',
      'Mrs. S. Rubiya Parveen',
      'Mrs.S.Rubiya Parveen',
      'Mr. A. Ramesh',
      'Mr.A.Ramesh',
      'Mrs. V. Shobitha',
      'Mrs.V Shobitha',
      'V. Shobitha',
      'V Shobitha',
      'Shobitha',
      'Dr. B. Rama Subbaiah',
      'Dr. B Rama Subbaiah',
      'Dr B Rama Subbaiah',
      'Dr. O. Sampath',
      'Dr.OSampath',
      'P. Sucharitha',
      'PSucharitha',
      'Mrs. P. Sucharitha',
      'Mrs.P.Sucharitha',
      'Dr. Sk. Nayab Rasool',
      'Dr.Sk.Nayab Rasool',
      'Dr. K. Venkata Krishnaiah',
      'Dr.K.Venkata Krishnaiah',
      'Dr. N. Ravi Chandra Raju',
      'Dr.N.Ravi Chandra Raju',
      'Mr. M.V. Raja Sekar',
      'Mr.M.V.Raja Sekar',
      'Mr. N. Vinod Kumar',
      'Mr.N.Vinod Kumar',
      'Mr. N. Nagendra Kumar',
      'Mr.N.Nagendra Kumar',
      'Mrs. K. Lakshmi Roopa',
      'Mrs.K.Lakshmi Roopa',
      'Mr. M. Ravi Kumar',
      'Mr.M.Ravi Kumar',
      'Mr. R. Srihari Reddy',
      'Mr.R.Srihari Reddy',
      'Dr. C. Rama Krishnaiah',
      'Dr.C.Rama Krishnaiah',
    ];

    const KNOWN_SUBJECT_LOOKUP = new Map(
      Object.entries(KNOWN_SUBJECTS).map(([key, info]) => [key.replace(/[^a-z0-9]/g, ''), info])
    );
    const KNOWN_FACULTY_LOOKUP = new Map(
      KNOWN_FACULTY_NAMES.map((fac) => [fac.toLowerCase().replace(/[^a-z0-9]/g, ''), fac])
    );

    const formatSubject = (raw) => {
      if (!raw) return { name: 'General Subject', code: '' };
      const norm = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
      const matched = KNOWN_SUBJECT_LOOKUP.get(norm);
      if (matched) return matched;
      const formattedName = raw.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s{2,}/g, ' ').trim();
      return { name: formattedName, code: '' };
    };

    const formatFaculty = (raw) => {
      if (!raw) return 'Faculty Member';
      const norm = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
      const matched = KNOWN_FACULTY_LOOKUP.get(norm);
      if (matched) return matched;
      return raw
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\bDr([A-Z])/g, 'Dr. $1')
        .replace(/\bMr([A-Z])/g, 'Mr. $1')
        .replace(/\bMrs([A-Z])/g, 'Mrs. $1')
        .replace(/\s{2,}/g, ' ')
        .trim();
    };

    const rosters = [];
    let currentRoster = null;
    let totalDuplicatesWithinRosters = 0;

    for (let pIdx = 0; pIdx < pageBlocks.length; pIdx++) {
      // Yield periodically on large multi-page PDFs so concurrent student requests stay responsive
      if (pIdx > 0 && pIdx % 8 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }

      const blockText = pageBlocks[pIdx];
      const lines = blockText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const headerSlice = lines.slice(0, 16);
      const headerBlock = headerSlice.join('\n');

      // Check if this page is a new roster definition
      const isNewRoster = /Group\s*[-–]?\s*[AB]/i.test(headerBlock) && /Section/i.test(headerBlock);

      if (isNewRoster) {
        // 1. Group & Subject Name
        let group = 'Group A';
        let subjectName = 'General Subject';
        let subjectCode = '';
        const grpMatch = headerBlock.match(/Group\s*[-–]?\s*([AB])\s*\(([^)]+)\)/i);
        if (grpMatch) {
          group = `Group ${grpMatch[1].toUpperCase()}`;
          const subInfo = formatSubject(grpMatch[2]);
          subjectName = subInfo.name;
          subjectCode = subInfo.code;
        }

        // 2. Academic Year & Semester
        let academicYear = '2026-2027';
        let yearSemester = 'III-I CSE';
        let year = 'III Year';
        let semester = 'I Semester';

        const ayMatch =
          headerBlock.match(/A\s*\.\s*Y\s*\.\s*(202[0-9]\s*[-–]\s*[0-9]{2,4})/i) ||
          headerBlock.match(/(202[0-9]\s*[-–]\s*202[0-9])/i);
        if (ayMatch) {
          const rawAy = ayMatch[1].replace(/\s+/g, '');
          if (rawAy.length === 7) {
            const parts = rawAy.split('-');
            academicYear = `${parts[0]}-20${parts[1]}`;
          } else {
            academicYear = rawAy;
          }
        }

        const progMatch = headerBlock.match(/I{1,3}\s*[-–]\s*I{1,2}\s*CSE/i);
        if (progMatch) {
          yearSemester = progMatch[0].replace(/\s+/g, '');
          if (yearSemester.includes('III')) year = 'III Year';
          else if (yearSemester.includes('II')) year = 'II Year';
          else if (yearSemester.includes('IV')) year = 'IV Year';

          if (yearSemester.includes('-I') || yearSemester.includes('I-')) semester = 'I Semester';
          else if (yearSemester.includes('-II') || yearSemester.includes('II-')) semester = 'II Semester';
        }

        // 3. Faculty Name & Section
        let facultyName = '';
        let section = 'A1';

        // Check single line: Name ... Section ...
        const singleLineMatch =
          headerBlock.match(/Name\s*[:\-–]?\s*(.+?)\s*Section\s*[:\-–]?\s*(A[1-6])/i) ||
          headerBlock.match(/Name\s*(.+?)\s*Section(A[1-6])/i);
        if (singleLineMatch) {
          facultyName = formatFaculty(singleLineMatch[1]);
          section = singleLineMatch[2].toUpperCase();
        } else {
          // Multi-line
          for (let l = 0; l < headerSlice.length; l++) {
            if (/^Name\s*[:\-–]?$/i.test(headerSlice[l])) {
              if (l + 1 < headerSlice.length) {
                facultyName = formatFaculty(headerSlice[l + 1]);
              }
              if (l + 2 < headerSlice.length) {
                const secM =
                  headerSlice[l + 2].match(/Section\s*[:\-–]?\s*(A[1-6])/i) ||
                  headerSlice[l + 2].match(/Section(A[1-6])/i);
                if (secM) section = secM[1].toUpperCase();
              }
              break;
            }
          }
        }

        // Direct section fallback if still A1 or not set
        const secDirect =
          headerBlock.match(/Section\s*[:\-–]?\s*(A[1-6])/i) ||
          headerBlock.match(/Section(A[1-6])/i);
        if (secDirect) {
          section = secDirect[1].toUpperCase();
        }

        if (!facultyName) {
          facultyName = options.facultyName || 'Faculty Member';
        }

        // Subject code fallback via O(1) lookup map
        if (!subjectCode) {
          const normSubKey = subjectName.toLowerCase().replace(/[^a-z0-9]/g, '');
          const matchedSub = KNOWN_SUBJECT_LOOKUP.get(normSubKey);
          if (matchedSub) {
            subjectCode = matchedSub.code;
          }
        }

        // Handle continuation pages that repeat the exact same subject-faculty-section-group header
        const isContinuationOfCurrent = Boolean(
          currentRoster &&
            currentRoster.section === section &&
            currentRoster.group === group &&
            currentRoster.subjectName.toLowerCase() === subjectName.toLowerCase() &&
            (currentRoster.subjectCode || '') === (subjectCode || '') &&
            currentRoster.facultyName.toLowerCase() === facultyName.toLowerCase()
        );

        if (isContinuationOfCurrent) {
          currentRoster.pages.push(pIdx + 1);
        } else {
          if (currentRoster) {
            rosters.push(currentRoster);
          }
          currentRoster = {
            id: `mapping-${rosters.length + 1}`,
            mappingIndex: rosters.length + 1,
            subjectName,
            subjectCode,
            facultyName,
            section,
            group,
            academicYear,
            year,
            semester,
            program: yearSemester,
            pages: [pIdx + 1],
            students: [],
            _seenRegs: new Set(),
            duplicateCount: 0,
            errors: [],
            warnings: [],
            isValid: true,
          };
        }
      } else if (currentRoster) {
        currentRoster.pages.push(pIdx + 1);
      }

      // 4. Extract student rows from this page block
      const rowRegex = /(?:^|\s*)(\d{1,3})?\s*(2[0-9]{4}[A-Z0-9]{5})\s*(.*)$/i;

      for (const line of lines) {
        if (/^RGM|^DEPARTMENT|^III\s*B\.Tech|^S\.No|^Name|^Group|^Section/i.test(line)) {
          continue;
        }

        const match = line.match(rowRegex);
        if (match) {
          const sNo = match[1] ? parseInt(match[1], 10) : (currentRoster ? currentRoster.students.length + 1 : 1);
          const regNo = match[2].toUpperCase();
          let name = match[3] ? match[3].trim().replace(/\s{2,}/g, ' ') : '';

          if (currentRoster) {
            // O(1) duplicate check strictly within this same subject-wise mapping
            if (currentRoster._seenRegs.has(regNo)) {
              currentRoster.duplicateCount++;
              totalDuplicatesWithinRosters++;
            } else {
              currentRoster._seenRegs.add(regNo);
              currentRoster.students.push({
                sNo,
                registrationNumber: regNo,
                studentName: name || 'Student Name',
                section: currentRoster.section,
                group: currentRoster.group,
                subjectName: currentRoster.subjectName,
                facultyName: currentRoster.facultyName,
                year: currentRoster.year,
              });
            }
          }
        }
      }
    }

    if (currentRoster) {
      rosters.push(currentRoster);
    }

    // Post-process validation and stats
    const uniqueStudentsSet = new Set();
    const sectionsSet = new Set();
    const facultySet = new Set();
    const subjectsSet = new Set();
    let totalEnrollments = 0;

    rosters.forEach((r) => {
      delete r._seenRegs;
      totalEnrollments += r.students.length;
      r.studentCount = r.students.length;
      sectionsSet.add(r.section);
      facultySet.add(r.facultyName);
      subjectsSet.add(r.subjectName);

      if (!r.subjectCode) {
        r.warnings.push('Subject code is missing; please specify or confirm.');
      }
      if (!r.facultyName || r.facultyName === 'Faculty Member') {
        r.warnings.push('Faculty name may need manual review.');
      }
      if (r.students.length === 0) {
        r.errors.push('No students extracted for this roster.');
        r.isValid = false;
      }

      r.students.forEach((s) => uniqueStudentsSet.add(s.registrationNumber));
    });

    const summary = {
      totalPages: pageBlocks.length,
      totalMappings: rosters.length,
      totalEnrollments,
      totalStudentEnrollments: totalEnrollments,
      uniqueStudents: uniqueStudentsSet.size,
      totalUniqueStudents: uniqueStudentsSet.size,
      totalDuplicatesWithinMappings: totalDuplicatesWithinRosters,
      totalExtractionErrors: rosters.filter((r) => !r.isValid).length,
      sections: Array.from(sectionsSet).sort(),
      sectionsDetected: Array.from(sectionsSet).sort(),
      facultyDetected: Array.from(facultySet).sort(),
      subjectsDetected: Array.from(subjectsSet).sort(),
      group: rosters.length > 0 ? rosters[0].group : 'Group A',
      sourceFileName: originalName,
    };

    return {
      isMultiRoster: rosters.length > 1,
      mappings: rosters,
      summary,
    };
  }
}

module.exports = PdfExtractorService;
