const fs = require('fs');
const MappingJob = require('../models/MappingJob');
const AuditLog = require('../models/AuditLog');
const PdfExtractorService = require('./pdfExtractorService');
const StudentClassificationService = require('./studentClassificationService');
const {
  isSpreadsheetFile,
  parseSpreadsheetMappings,
  detectInconsistentStudentNames,
} = require('./mappingImportService');
const {
  validateAndPrepareMappingItem,
  prefetchContextForMappings,
  persistPreparedMapping,
} = require('./mappingPersistenceService');

const yieldEventLoop = () => new Promise((resolve) => setImmediate(resolve));

function formatJobResponse(jobDoc) {
  if (!jobDoc) return null;
  const obj = typeof jobDoc.toObject === 'function' ? jobDoc.toObject() : jobDoc;
  return {
    jobId: String(obj._id),
    _id: String(obj._id),
    jobType: obj.jobType,
    status: obj.status,
    uploadMode: obj.uploadMode,
    sourceFileName: obj.sourceFileName,
    progress: obj.progress || {
      total: 0,
      completed: 0,
      failed: 0,
      pending: 0,
      percent: 0,
      currentStage: 'Queued',
    },
    isMultiRoster: Boolean(obj.isMultiRoster),
    summary: obj.summary || null,
    mappings: obj.jobType === 'UPLOAD_PREVIEW' ? obj.previewMappings || [] : obj.savedMappings || [],
    previewMappings: obj.previewMappings || [],
    savedMappings: obj.savedMappings || [],
    failedItems: (obj.failedItems || []).map((f) => ({
      index: f.index,
      subjectName: f.subjectName,
      subjectCode: f.subjectCode,
      section: f.section,
      facultyName: f.facultyName,
      error: f.error,
    })),
    reusedCount: obj.reusedCount || 0,
    totalEnrollments: obj.totalEnrollments || 0,
    uniqueStudents: obj.uniqueStudents || 0,
    errorMessage: obj.errorMessage || '',
    createdAt: obj.createdAt,
    startedAt: obj.startedAt,
    completedAt: obj.completedAt,
  };
}

async function processUploadPreviewJob(jobId, { filePath, originalName, uploadMode, body }) {
  try {
    await MappingJob.updateOne(
      { _id: jobId },
      {
        $set: {
          status: 'PROCESSING',
          startedAt: new Date(),
          'progress.currentStage': 'Reading PDF & separating subject rosters',
          'progress.percent': 25,
        },
      }
    );

    let resultPayload = null;
    if (isSpreadsheetFile(filePath, originalName)) {
      const sheetResult = await parseSpreadsheetMappings(filePath, originalName, body || {});
      resultPayload = {
        isMultiRoster: sheetResult.isMultiRoster,
        summary: sheetResult.summary,
        previewMappings: sheetResult.mappings,
      };
    } else if (uploadMode !== 'single') {
      try {
        const multiResult = await PdfExtractorService.extractMultiSubjectRosters(filePath, originalName, body || {});
        if (multiResult && Array.isArray(multiResult.mappings) && multiResult.mappings.length > 0) {
          resultPayload = {
            isMultiRoster: multiResult.isMultiRoster,
            summary: multiResult.summary,
            previewMappings: multiResult.mappings,
          };
        }
      } catch (multiErr) {
        console.warn('[Background Upload Job Multi-Roster Fallback]:', multiErr.message);
      }
    }

    if (!resultPayload) {
      const { facultyName, subjectName, subjectCode, section, academicYear, group } = body || {};
      const targetSection = String(section || 'A1').trim().toUpperCase();
      const singleFile = [{ path: filePath, originalname: originalName }];
      const extractionResult = await PdfExtractorService.extractFromMultipleFiles(singleFile, {
        facultyName: facultyName || '',
        subjectName: subjectName || '',
        subjectCode: subjectCode || '',
        section: targetSection,
        academicYear: academicYear || '2026-2027',
        group: group || 'Group A',
      });

      const students = (extractionResult.records || []).map((r, idx) => {
        const classification = StudentClassificationService.classifyStudent(r.rollNumber);
        return {
          sNo: r.serialNumber || idx + 1,
          registrationNumber: r.rollNumber,
          studentName: r.studentName,
          section: r.section || targetSection,
          subjectName: r.subjectName || subjectName,
          facultyName: r.facultyName || facultyName,
          group: r.group || classification.group || 'Group A',
          year: r.year || classification.year || 'III Year',
        };
      });

      const resolvedSubName = subjectName || extractionResult.meta?.subject || 'General Subject';
      const resolvedFacName = facultyName || extractionResult.meta?.faculty || 'Faculty Member';

      resultPayload = {
        isMultiRoster: false,
        previewMappings: [
          {
            id: 'mapping-1',
            mappingIndex: 1,
            subjectName: resolvedSubName,
            subjectCode: subjectCode || '',
            facultyName: resolvedFacName,
            section: targetSection,
            group: group || 'Group A',
            academicYear: academicYear || '2026-2027',
            studentCount: students.length,
            students,
            isValid: students.length > 0,
            errors: students.length > 0 ? [] : ['No valid student rows extracted.'],
            warnings: [],
          },
        ],
        summary: {
          totalPages: 1,
          totalMappings: 1,
          totalEnrollments: students.length,
          totalStudentEnrollments: students.length,
          totalUniqueStudents: new Set(students.map((s) => s.registrationNumber)).size,
          uniqueStudents: new Set(students.map((s) => s.registrationNumber)).size,
          totalDuplicatesWithinMappings: 0,
          sectionsDetected: [targetSection],
          facultyDetected: [resolvedFacName],
          subjectsDetected: [resolvedSubName],
          sourceFileName: originalName,
        },
      };
    }

    const inconsistentNames = await detectInconsistentStudentNames(resultPayload.previewMappings || []);
    resultPayload.summary = {
      ...(resultPayload.summary || {}),
      inconsistentNamesCount: inconsistentNames.length,
      inconsistentNames,
    };

    const totalExtractedRosters = resultPayload.previewMappings.length;
    await MappingJob.updateOne(
      { _id: jobId },
      {
        $set: {
          status: 'COMPLETED',
          completedAt: new Date(),
          isMultiRoster: Boolean(resultPayload.isMultiRoster),
          summary: resultPayload.summary,
          previewMappings: resultPayload.previewMappings,
          progress: {
            total: totalExtractedRosters || 1,
            completed: totalExtractedRosters || 1,
            failed: 0,
            pending: 0,
            percent: 100,
            currentStage: 'Extraction complete',
          },
        },
      }
    );
  } catch (err) {
    console.error('[MappingJob UPLOAD_PREVIEW Error]:', err);
    await MappingJob.updateOne(
      { _id: jobId },
      {
        $set: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: err.message || 'Failed to extract student rosters from PDF.',
          progress: {
            total: 1,
            completed: 0,
            failed: 1,
            pending: 0,
            percent: 100,
            currentStage: 'Extraction failed',
          },
        },
      }
    );
  } finally {
    try {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {}
  }
}

async function createUploadPreviewJob({ filePath, originalName, uploadMode = 'multi', body = {}, user = null }) {
  const job = await MappingJob.create({
    jobType: 'UPLOAD_PREVIEW',
    status: 'PENDING',
    uploadMode: uploadMode === 'single' ? 'single' : 'multi',
    sourceFileName: originalName || 'Roster.pdf',
    singleOptions: uploadMode === 'single' ? body : null,
    progress: {
      total: 1,
      completed: 0,
      failed: 0,
      pending: 1,
      percent: 5,
      currentStage: 'Queued for PDF parsing',
    },
    createdBy: user?._id,
    createdByName: user?.name || 'Administrator',
  });

  setImmediate(() => {
    processUploadPreviewJob(job._id, {
      filePath,
      originalName,
      uploadMode: uploadMode === 'single' ? 'single' : 'multi',
      body,
    }).catch((err) => console.error('[UploadJob Runner Crash]:', err));
  });

  return job;
}

async function processConfirmBatchJob(jobId, { preparedItems, preValidationFailed = [], replaceExisting = true, user = null, existingSaved = [], baseStats = null }) {
  const totalCount =
    (baseStats?.total || 0) ||
    preparedItems.length + preValidationFailed.length + existingSaved.length;

  const savedMappings = [...existingSaved];
  const failedItems = [...preValidationFailed];
  const uniqueStudentsSet = new Set(baseStats?.uniqueStudentsList || []);
  let totalEnrollments = baseStats?.totalEnrollments || 0;
  let reusedCount = baseStats?.reusedCount || 0;
  const auditLogs = [];

  try {
    await MappingJob.updateOne(
      { _id: jobId },
      {
        $set: {
          status: 'PROCESSING',
          startedAt: new Date(),
          'progress.total': totalCount,
          'progress.pending': Math.max(0, totalCount - savedMappings.length),
          'progress.currentStage': 'Prefetching existing faculty & subject context',
          'progress.percent': Math.max(5, Math.round((savedMappings.length / Math.max(1, totalCount)) * 100)),
        },
      }
    );

    const { existingByKey, facultyUserByName, subjectCodeSet } = await prefetchContextForMappings(preparedItems);

    for (let i = 0; i < preparedItems.length; i++) {
      const vm = preparedItems[i];
      try {
        const resObj = await persistPreparedMapping(vm, {
          replaceExisting,
          user,
          existingByKey,
          facultyUserByName,
          subjectCodeSet,
          deferBulkSync: false,
          auditLogsOut: auditLogs,
        });

        savedMappings.push(resObj.savedSummary);
        if (resObj.reused) reusedCount++;
        totalEnrollments += vm.deduplicatedStudents.length;
        for (const st of vm.deduplicatedStudents) {
          uniqueStudentsSet.add(st.registrationNumber);
        }
      } catch (itemErr) {
        failedItems.push({
          index: vm.index,
          subjectName: vm.cleanSubName,
          subjectCode: vm.cleanSubCode,
          section: vm.cleanSection,
          facultyName: vm.cleanFaculty,
          error: itemErr.message || 'Failed to persist mapping record.',
          mappingSnapshot: {
            facultyName: vm.cleanFaculty,
            subjectName: vm.cleanSubName,
            subjectCode: vm.cleanSubCode,
            section: vm.cleanSection,
            group: vm.cleanGroup,
            academicYear: vm.cleanAcadYear,
            year: vm.cleanYear,
            semester: vm.cleanSemester,
            sourceFileName: vm.sourceFileName,
            students: vm.deduplicatedStudents,
          },
        });
      }

      const processedCount = savedMappings.length + failedItems.length;
      const pendingCount = Math.max(0, totalCount - processedCount);
      const percent = Math.min(99, Math.round((processedCount / Math.max(1, totalCount)) * 100));

      if (i % 2 === 1 || i === preparedItems.length - 1) {
        await MappingJob.updateOne(
          { _id: jobId },
          {
            $set: {
              savedMappings,
              failedItems,
              reusedCount,
              totalEnrollments,
              uniqueStudents: uniqueStudentsSet.size,
              progress: {
                total: totalCount,
                completed: savedMappings.length,
                failed: failedItems.length,
                pending: pendingCount,
                percent,
                currentStage: `Processed ${processedCount}/${totalCount} mappings (${vm.cleanSubCode} ${vm.cleanSection})`,
              },
            },
          }
        );
      }

      await yieldEventLoop();
    }

    if (auditLogs.length > 0) {
      try {
        await AuditLog.insertMany(auditLogs, { ordered: false });
      } catch {}
    }

    const finalStatus =
      failedItems.length === 0
        ? 'COMPLETED'
        : savedMappings.length > 0
          ? 'PARTIAL_FAILED'
          : 'FAILED';

    await MappingJob.updateOne(
      { _id: jobId },
      {
        $set: {
          status: finalStatus,
          completedAt: new Date(),
          savedMappings,
          failedItems,
          reusedCount,
          totalEnrollments,
          uniqueStudents: uniqueStudentsSet.size,
          errorMessage:
            failedItems.length > 0
              ? `${failedItems.length} mapping(s) failed while ${savedMappings.length} succeeded.`
              : '',
          progress: {
            total: totalCount,
            completed: savedMappings.length,
            failed: failedItems.length,
            pending: 0,
            percent: 100,
            currentStage:
              finalStatus === 'COMPLETED'
                ? 'All mappings saved permanently to MongoDB'
                : finalStatus === 'PARTIAL_FAILED'
                  ? `Completed with ${failedItems.length} failed mapping(s) available for retry`
                  : 'Batch mapping failed',
          },
        },
      }
    );
  } catch (err) {
    console.error('[MappingJob CONFIRM_BATCH Error]:', err);
    await MappingJob.updateOne(
      { _id: jobId },
      {
        $set: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: err.message || 'Background batch confirmation failed.',
          progress: {
            total: totalCount,
            completed: savedMappings.length,
            failed: Math.max(failedItems.length, totalCount - savedMappings.length),
            pending: 0,
            percent: 100,
            currentStage: 'Job aborted due to unexpected error',
          },
        },
      }
    );
  }
}

async function createConfirmBatchJob({ mappings, sourceFileName = 'Roster.pdf', replaceExisting = true, user = null }) {
  const preparedItems = [];
  const preValidationFailed = [];

  for (let idx = 0; idx < mappings.length; idx++) {
    const raw = mappings[idx];
    const { errors, prepared } = validateAndPrepareMappingItem(raw, idx, sourceFileName);
    if (errors.length > 0) {
      preValidationFailed.push({
        index: idx,
        subjectName: prepared.cleanSubName || 'Unknown',
        subjectCode: prepared.cleanSubCode || '',
        section: prepared.cleanSection || '',
        facultyName: prepared.cleanFaculty || '',
        error: errors.join(' '),
        mappingSnapshot: raw,
      });
    } else {
      preparedItems.push(prepared);
    }
  }

  if (preparedItems.length === 0) {
    const err = new Error(
      `Batch validation failed: ${preValidationFailed.length} issue(s) detected. No mappings were saved.`
    );
    err.statusCode = 400;
    err.errors = preValidationFailed.map((f) => f.error);
    throw err;
  }

  const job = await MappingJob.create({
    jobType: 'CONFIRM_BATCH',
    status: 'PENDING',
    sourceFileName,
    replaceExisting: Boolean(replaceExisting),
    inputMappings: mappings,
    failedItems: preValidationFailed,
    progress: {
      total: mappings.length,
      completed: 0,
      failed: preValidationFailed.length,
      pending: preparedItems.length,
      percent: 5,
      currentStage: 'Queued for background persistence',
    },
    createdBy: user?._id,
    createdByName: user?.name || 'Administrator',
  });

  setImmediate(() => {
    processConfirmBatchJob(job._id, {
      preparedItems,
      preValidationFailed,
      replaceExisting: Boolean(replaceExisting),
      user,
    }).catch((err) => console.error('[ConfirmJob Runner Crash]:', err));
  });

  return job;
}

async function retryMappingJob(jobId, user = null) {
  const job = await MappingJob.findById(jobId);
  if (!job) {
    const err = new Error('Mapping job not found.');
    err.statusCode = 404;
    throw err;
  }

  if (job.jobType !== 'CONFIRM_BATCH') {
    const err = new Error('Only batch confirmation jobs support partial item retry. Please re-upload the PDF for preview.');
    err.statusCode = 400;
    throw err;
  }

  if (job.status === 'PROCESSING' || job.status === 'PENDING') {
    return job;
  }

  const retryCandidates = Array.isArray(job.failedItems) ? job.failedItems : [];
  if (retryCandidates.length === 0) {
    const err = new Error('This job has no failed items to retry.');
    err.statusCode = 400;
    throw err;
  }

  const preparedRetry = [];
  const stillInvalid = [];

  for (const item of retryCandidates) {
    const raw = item.mappingSnapshot || (Array.isArray(job.inputMappings) ? job.inputMappings[item.index] : null);
    if (!raw) {
      stillInvalid.push({ ...item, error: item.error || 'Mapping payload snapshot unavailable for retry.' });
      continue;
    }
    const { errors, prepared } = validateAndPrepareMappingItem(raw, item.index || 0, job.sourceFileName);
    if (errors.length > 0) {
      stillInvalid.push({ ...item, error: errors.join(' '), mappingSnapshot: raw });
    } else {
      preparedRetry.push(prepared);
    }
  }

  const existingSaved = Array.isArray(job.savedMappings) ? job.savedMappings : [];
  const totalCount = existingSaved.length + preparedRetry.length + stillInvalid.length;

  job.status = 'PENDING';
  job.errorMessage = '';
  job.failedItems = stillInvalid;
  job.progress = {
    total: totalCount,
    completed: existingSaved.length,
    failed: stillInvalid.length,
    pending: preparedRetry.length,
    percent: Math.round((existingSaved.length / Math.max(1, totalCount)) * 100),
    currentStage: `Retrying ${preparedRetry.length} failed mapping(s)`,
  };
  await job.save();

  setImmediate(() => {
    processConfirmBatchJob(job._id, {
      preparedItems: preparedRetry,
      preValidationFailed: stillInvalid,
      replaceExisting: job.replaceExisting !== false,
      user: user || { _id: job.createdBy, name: job.createdByName },
      existingSaved,
      baseStats: {
        total: totalCount,
        totalEnrollments: job.totalEnrollments || 0,
        reusedCount: job.reusedCount || 0,
      },
    }).catch((err) => console.error('[RetryJob Runner Crash]:', err));
  });

  return job;
}

module.exports = {
  formatJobResponse,
  createUploadPreviewJob,
  createConfirmBatchJob,
  retryMappingJob,
};
