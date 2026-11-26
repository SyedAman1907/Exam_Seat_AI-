const fs = require('fs');
const pdfParse = require('pdf-parse');
const ExcelJS = require('exceljs');

class ImportService {
  /**
   * Parse uploaded file according to mime/extension
   * @param {Object} file - Multer file object
   * @param {Object} options - { regPattern: string }
   */
  static async parseFile(file, options = {}) {
    const filePath = file.path;
    const originalName = file.originalname.toLowerCase();
    const regPattern = options.regPattern || '^[0-9]{5}[A-Z0-9]{5}$';
    const regRegex = new RegExp(regPattern, 'i');

    let rawRecords = [];

    if (originalName.endsWith('.csv')) {
      rawRecords = await this.parseCSV(filePath);
    } else if (originalName.endsWith('.xlsx') || originalName.endsWith('.xls')) {
      rawRecords = await this.parseExcel(filePath);
    } else if (originalName.endsWith('.pdf')) {
      rawRecords = await this.parsePDF(filePath);
    } else {
      throw new Error('Unsupported file format. Please upload PDF, XLSX, XLS, or CSV files.');
    }

    if (!rawRecords || rawRecords.length === 0) {
      throw new Error('The uploaded file contains no student records or is empty.');
    }

    // Process and validate records
    return this.validateRecords(rawRecords, regRegex);
  }

  /**
   * Parse CSV file with multi-section and multi-subject support
   */
  static async parseCSV(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return [];

    // Parse header
    const headers = this.parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
    const regIndex = headers.findIndex(h => 
      h.includes('reg') || h.includes('roll') || h.includes('ht') || h.includes('ticket') || h.includes('id')
    );
    const nameIndex = headers.findIndex(h => 
      h.includes('name') || h.includes('student') || h.includes('candidate')
    );
    const secIndex = headers.findIndex(h => h.includes('sec'));
    const deptIndex = headers.findIndex(h => h.includes('dept') || h.includes('department'));
    const yearIndex = headers.findIndex(h => h.includes('year'));
    const semIndex = headers.findIndex(h => h.includes('sem'));
    const subIndex = headers.findIndex(h => h.includes('sub') || h.includes('course'));

    const records = [];
    const startIndex = (regIndex !== -1 && nameIndex !== -1) ? 1 : 0;

    for (let i = startIndex; i < lines.length; i++) {
      const parts = this.parseCSVLine(lines[i]);
      if (parts.length >= 2) {
        let regNo = '';
        let name = '';
        let section = 'A';
        let department = 'Computer Science and Engineering';
        let year = 'IV Year';
        let semester = 'I Semester';
        let subject = '';

        if (regIndex !== -1 && nameIndex !== -1) {
          regNo = parts[regIndex] || '';
          name = parts[nameIndex] || '';
          if (secIndex !== -1 && parts[secIndex]) section = parts[secIndex].trim().toUpperCase();
          if (deptIndex !== -1 && parts[deptIndex]) department = parts[deptIndex].trim();
          if (yearIndex !== -1 && parts[yearIndex]) year = parts[yearIndex].trim();
          if (semIndex !== -1 && parts[semIndex]) semester = parts[semIndex].trim();
          if (subIndex !== -1 && parts[subIndex]) subject = parts[subIndex].trim();
        } else {
          // Fallback: first column is regNo, second is name
          regNo = parts[0] || '';
          name = parts.slice(1).join(' ').trim();
        }

        if (regNo || name) {
          records.push({
            registrationNumber: regNo.trim().toUpperCase(),
            name: name.trim(),
            section,
            department,
            year,
            semester,
            subject,
            rawLine: lines[i],
          });
        }
      }
    }

    return records;
  }

  static parseCSVLine(text) {
    const result = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += char;
      }
    }
    result.push(cur.trim());
    return result;
  }

  /**
   * Parse Excel XLSX / XLS with multi-section detection
   */
  static async parseExcel(filePath) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) return [];

    let headerRowIdx = 1;
    let regColIdx = -1;
    let nameColIdx = -1;
    let secColIdx = -1;
    let deptColIdx = -1;
    let yearColIdx = -1;
    let semColIdx = -1;
    let subColIdx = -1;

    // Scan first 5 rows to locate header columns
    for (let r = 1; r <= Math.min(worksheet.rowCount, 5); r++) {
      const row = worksheet.getRow(r);
      row.eachCell((cell, colNumber) => {
        const val = String(cell.value || '').trim().toLowerCase();
        if (val.includes('reg') || val.includes('roll') || val.includes('ht') || val.includes('hall ticket')) {
          regColIdx = colNumber;
          headerRowIdx = r;
        }
        if (val.includes('name') || val.includes('candidate')) {
          nameColIdx = colNumber;
        }
        if (val.includes('sec')) {
          secColIdx = colNumber;
        }
        if (val.includes('dept')) {
          deptColIdx = colNumber;
        }
        if (val.includes('year')) {
          yearColIdx = colNumber;
        }
        if (val.includes('sem')) {
          semColIdx = colNumber;
        }
        if (val.includes('sub') || val.includes('course')) {
          subColIdx = colNumber;
        }
      });
      if (regColIdx !== -1 && nameColIdx !== -1) break;
    }

    if (regColIdx === -1) regColIdx = 1;
    if (nameColIdx === -1) nameColIdx = 2;

    const records = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRowIdx) return;

      const regNo = String(row.getCell(regColIdx).value || '').trim().toUpperCase();
      const name = String(row.getCell(nameColIdx).value || '').trim();
      const section = secColIdx !== -1 ? String(row.getCell(secColIdx).value || 'A').trim().toUpperCase() : 'A';
      const department = deptColIdx !== -1 ? String(row.getCell(deptColIdx).value || 'Computer Science and Engineering').trim() : 'Computer Science and Engineering';
      const year = yearColIdx !== -1 ? String(row.getCell(yearColIdx).value || 'IV Year').trim() : 'IV Year';
      const semester = semColIdx !== -1 ? String(row.getCell(semColIdx).value || 'I Semester').trim() : 'I Semester';
      const subject = subColIdx !== -1 ? String(row.getCell(subColIdx).value || '').trim() : '';

      if (regNo || name) {
        records.push({
          registrationNumber: regNo,
          name,
          section,
          department,
          year,
          semester,
          subject,
        });
      }
    });

    return records;
  }

  /**
   * Parse PDF text
   */
  static async parsePDF(filePath) {
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(dataBuffer);

    const text = pdfData.text || '';
    if (text.trim().length < 20) {
      throw new Error(
        'Scanned or image-only PDF detected. The file does not contain extractable text. Please use an OCR-processed PDF, XLSX, or CSV file.'
      );
    }

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    const records = [];

    const regExtractorRegex = /\b([0-9]{2}[0-9A-Z]{3}[A-Z0-9]{4,6})\b/i;

    lines.forEach(line => {
      const match = line.match(regExtractorRegex);
      if (match) {
        const regNo = match[1].toUpperCase();
        let remaining = line.replace(match[0], ' ');
        remaining = remaining.replace(/^\s*\d+[\.\)]?\s*/, '');
        const name = remaining.replace(/[,|\t;]+/g, ' ').replace(/\s+/g, ' ').trim();

        records.push({
          registrationNumber: regNo,
          name: name || `Student ${regNo.slice(-3)}`,
          section: 'A',
          department: 'Computer Science and Engineering',
          year: 'IV Year',
          semester: 'I Semester',
        });
      }
    });

    return records;
  }

  /**
   * Validate extracted records with section and department retention
   */
  static validateRecords(rawRecords, regRegex) {
    const seenRegNos = new Map();
    const processed = [];

    rawRecords.forEach(r => {
      const reg = (r.registrationNumber || '').trim().toUpperCase();
      if (reg) {
        seenRegNos.set(reg, (seenRegNos.get(reg) || 0) + 1);
      }
    });

    let validCount = 0;
    let duplicateCount = 0;
    let missingNameCount = 0;
    let invalidRegCount = 0;

    rawRecords.forEach((r, idx) => {
      const reg = (r.registrationNumber || '').trim().toUpperCase();
      const name = (r.name || '').trim();

      const errors = [];

      if (!reg) {
        errors.push('Missing registration number');
        invalidRegCount++;
      } else if (!regRegex.test(reg)) {
        errors.push(`Registration number does not match pattern (${reg})`);
        invalidRegCount++;
      } else if (seenRegNos.get(reg) > 1) {
        errors.push(`Duplicate registration number (${reg})`);
        duplicateCount++;
      }

      if (!name) {
        errors.push('Missing student name');
        missingNameCount++;
      }

      const isValid = errors.length === 0;
      if (isValid) validCount++;

      processed.push({
        tempId: `tmp-${idx + 1}`,
        serialNumber: idx + 1,
        registrationNumber: reg,
        name: name,
        section: (r.section || 'A').toUpperCase(),
        department: r.department || 'Computer Science and Engineering',
        year: r.year || 'IV Year',
        semester: r.semester || 'I Semester',
        subject: r.subject || '',
        isValid,
        errors,
      });
    });

    return {
      records: processed,
      summary: {
        totalExtracted: processed.length,
        validCount,
        invalidCount: processed.length - validCount,
        duplicateCount,
        missingNameCount,
        invalidRegCount,
        canConfirm: validCount > 0 && validCount === processed.length,
      },
    };
  }
}

module.exports = ImportService;
