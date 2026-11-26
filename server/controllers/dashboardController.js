const Exam = require('../models/Exam');
const Student = require('../models/Student');
const StudentEnrollment = require('../models/StudentEnrollment');
const Classroom = require('../models/Classroom');
const Allocation = require('../models/Allocation');
const FacultyMapping = require('../models/FacultyMapping');

// @desc    Get Admin Dashboard metrics and recent exams
// @route   GET /api/dashboard/stats
// @access  Private
exports.getDashboardStats = async (req, res) => {
  try {
    const activeRoomFilter = { isActive: { $ne: false } };
    const [
      totalStudents,
      totalEnrollments,
      examMetricsAgg,
      totalAllocations,
      activeClassrooms,
      recentExams,
      sectionMappings,
    ] = await Promise.all([
      Student.countDocuments({ examId: { $exists: false } }),
      StudentEnrollment.countDocuments(),
      Exam.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        {
          $group: {
            _id: null,
            groupAExams: { $sum: { $cond: [{ $eq: ['$group', 'Group A'] }, 1, 0] } },
            groupBExams: { $sum: { $cond: [{ $eq: ['$group', 'Group B'] }, 1, 0] } },
            pendingApprovals: {
              $sum: { $cond: [{ $eq: ['$approvalStatus', 'PENDING_REVIEW'] }, 1, 0] },
            },
            publishedExams: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $not: [{ $in: ['$status', ['COMPLETED', 'CANCELLED']] }] },
                      {
                        $or: [
                          { $eq: ['$visibilityStatus', 'PUBLISHED'] },
                          { $in: ['$status', ['PUBLISHED', 'ONGOING']] },
                        ],
                      },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
      Allocation.countDocuments({ isCurrent: true }),
      Classroom.find(activeRoomFilter)
        .select('name roomNumber totalCapacity availableCapacity')
        .sort({ roomNumber: 1 })
        .lean(),
      Exam.find({ isDeleted: { $ne: true } })
        .select('examName subjectName subjectCode examDate startTime endTime session group section studentCount status approvalStatus visibilityStatus classroomId currentAllocationId createdAt')
        .populate('classroomId', 'name roomNumber totalCapacity')
        .populate('currentAllocationId', 'version status publishedAt setDistribution')
        .sort({ createdAt: -1 })
        .limit(6)
        .lean(),
      FacultyMapping.aggregate([
        { $match: { isCurrent: true } },
        {
          $group: {
            _id: { $toUpper: '$section' },
            count: {
              $sum: {
                $cond: [
                  { $gt: [{ $size: { $ifNull: ['$students', []] } }, 0] },
                  { $size: { $ifNull: ['$students', []] } },
                  { $ifNull: ['$studentCount', 0] },
                ],
              },
            },
          },
        },
      ]),
    ]);

    const examMetrics = examMetricsAgg[0] || {};
    const groupAExams = examMetrics.groupAExams || 0;
    const groupBExams = examMetrics.groupBExams || 0;
    const pendingApprovals = examMetrics.pendingApprovals || 0;
    const publishedExams = examMetrics.publishedExams || 0;
    const totalClassrooms = activeClassrooms.length;

    // Section-wise allocations count
    const sectionCounts = { A1: 0, A2: 0, A3: 0, A4: 0, A5: 0, A6: 0 };
    sectionMappings.forEach((m) => {
      if (m._id && sectionCounts[m._id] !== undefined) {
        sectionCounts[m._id] += m.count || 0;
      }
    });

    const totalExaminations = groupAExams + groupBExams;

    res.status(200).json({
      success: true,
      data: {
        totalStudents,
        totalEnrollments,
        totalExaminations,
        groupAExaminations: groupAExams,
        groupBExaminations: groupBExams,
        pendingApprovals,
        publishedExaminations: publishedExams,
        totalAllocations,
        totalClassrooms,
        sectionWiseAllocations: sectionCounts,
        classroomUtilization: activeClassrooms.map((c) => ({
          roomNumber: c.roomNumber,
          name: c.name,
          capacity: c.totalCapacity || 72,
          status: 'Active',
        })),
        recentExams,
      },
    });
  } catch (error) {
    const { sendControllerError } = require('../utils/controllerError');
    return sendControllerError(res, error, 'Dashboard Stats Error', 'Unable to load dashboard statistics.');
  }
};
