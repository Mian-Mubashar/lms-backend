const express = require('express');
const { authenticate } = require('../middleware/auth');
const { User, Course, Enrollment, Assignment, AssignmentSubmission, Quiz, QuizAttempt, Feedback } = require('../models');

const router = express.Router();
router.use(authenticate);

router.get('/dashboard', async (req, res) => {
  try {
    const analytics = {};
    if (req.user.role === 'admin') {
      analytics.totalUsers = await User.countDocuments();
      analytics.totalCourses = await Course.countDocuments();
      analytics.totalEnrollments = await Enrollment.countDocuments();
      analytics.activeStudents = (await Enrollment.distinct('studentId')).length;
      analytics.usersByRole = await User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }, { $project: { _id: 0, role: '$_id', count: 1 } }]);
      analytics.coursesByStatus = await Course.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }, { $project: { _id: 0, status: '$_id', count: 1 } }]);
    } else if (req.user.role === 'teacher') {
      const courses = await Course.find({ instructorId: req.user.id }).select('_id title').lean();
      const courseIds = courses.map((c) => c._id);
      analytics.totalCourses = courseIds.length;
      analytics.totalStudents = (await Enrollment.distinct('studentId', { courseId: { $in: courseIds } })).length;
      analytics.totalAssignments = await Assignment.countDocuments({ courseId: { $in: courseIds } });
      analytics.totalQuizzes = await Quiz.countDocuments({ courseId: { $in: courseIds } });
      const assignmentIds = await Assignment.distinct('_id', { courseId: { $in: courseIds } });
      analytics.pendingSubmissions = await AssignmentSubmission.countDocuments({ assignmentId: { $in: assignmentIds }, score: null });
      const perf = await Enrollment.aggregate([{ $match: { courseId: { $in: courseIds } } }, { $group: { _id: '$courseId', enrolledStudents: { $sum: 1 } } }]);
      const ratings = await Feedback.aggregate([{ $match: { courseId: { $in: courseIds } } }, { $group: { _id: '$courseId', avgRating: { $avg: '$rating' } } }]);
      const pMap = Object.fromEntries(perf.map((p) => [p._id.toString(), p.enrolledStudents]));
      const rMap = Object.fromEntries(ratings.map((r) => [r._id.toString(), r.avgRating]));
      analytics.coursePerformance = courses.map((c) => ({ id: c._id.toString(), title: c.title, enrolledStudents: pMap[c._id.toString()] || 0, avgRating: rMap[c._id.toString()] || 0 }));
      analytics.recentActivity = [];
    } else {
      analytics.enrolledCourses = await Enrollment.countDocuments({ studentId: req.user.id });
      analytics.completedCourses = await Enrollment.countDocuments({ studentId: req.user.id, completed: true });
      analytics.submittedAssignments = await AssignmentSubmission.countDocuments({ studentId: req.user.id });
      analytics.quizAttempts = await QuizAttempt.countDocuments({ studentId: req.user.id });
      const scores = await AssignmentSubmission.find({ studentId: req.user.id, score: { $ne: null } }).select('score').lean();
      const quizScores = await QuizAttempt.find({ studentId: req.user.id }).select('score').lean();
      const all = [...scores, ...quizScores].map((s) => Number(s.score) || 0);
      analytics.averageScore = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0;
      const enrollments = await Enrollment.find({ studentId: req.user.id }).populate('courseId', 'title').lean();
      analytics.progressByCourse = enrollments.map((e) => ({ id: e.courseId?._id?.toString(), title: e.courseId?.title || '', progress: e.progress, completed: e.completed }));
    }
    res.json({ analytics });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/course/:id', async (req, res) => {
  try {
    const courseId = req.params.id;
    if (req.user.role === 'student') {
      const enrollment = await Enrollment.findOne({ studentId: req.user.id, courseId }).lean();
      if (!enrollment) return res.status(403).json({ message: 'Access denied' });
      const completedAssignments = await AssignmentSubmission.countDocuments({ studentId: req.user.id, assignmentId: { $in: await Assignment.distinct('_id', { courseId }) } });
      const completedQuizzes = await QuizAttempt.countDocuments({ studentId: req.user.id, quizId: { $in: await Quiz.distinct('_id', { courseId }) } });
      return res.json({ analytics: { enrollment, completedAssignments, completedQuizzes } });
    }
    const totalEnrollments = await Enrollment.countDocuments({ courseId });
    const completedEnrollments = await Enrollment.countDocuments({ courseId, completed: true });
    const avg = await Enrollment.aggregate([{ $match: { courseId } }, { $group: { _id: null, avgProgress: { $avg: '$progress' } } }]);
    const rating = await Feedback.aggregate([{ $match: { courseId } }, { $group: { _id: null, avgRating: { $avg: '$rating' } } }]);
    const assignments = await Assignment.find({ courseId }).select('_id title').lean();
    const stats = [];
    for (const a of assignments) {
      const subs = await AssignmentSubmission.find({ assignmentId: a._id }).select('score').lean();
      const graded = subs.filter((s) => s.score !== null).map((s) => Number(s.score));
      stats.push({ id: a._id.toString(), title: a.title, submissions: subs.length, avgScore: graded.length ? graded.reduce((x, y) => x + y, 0) / graded.length : 0 });
    }
    res.json({ analytics: { totalEnrollments, completedEnrollments, averageProgress: avg[0]?.avgProgress || 0, averageRating: rating[0]?.avgRating || 0, assignmentStats: stats } });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

