const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { Feedback, Course, Enrollment, User } = require('../models');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.courseId) filter.courseId = req.query.courseId;
    if (req.user.role === 'student') filter.studentId = req.user.id;
    const rows = await Feedback.find(filter).sort({ submittedAt: -1 }).lean();
    const courses = await Course.find({ _id: { $in: rows.map((r) => r.courseId) } }).select('title').lean();
    const users = await User.find({ _id: { $in: rows.map((r) => r.studentId) } }).select('firstName lastName').lean();
    const cMap = Object.fromEntries(courses.map((c) => [c._id.toString(), c.title]));
    const uMap = Object.fromEntries(users.map((u) => [u._id.toString(), u]));
    const feedback = rows.map((r) => ({ ...r, id: r._id.toString(), _id: undefined, courseTitle: cMap[r.courseId.toString()] || '', firstName: uMap[r.studentId.toString()]?.firstName || '', lastName: uMap[r.studentId.toString()]?.lastName || '' }));
    res.json({ feedback });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/', authorize('student'), async (req, res) => {
  try {
    const { courseId, rating, comment } = req.body;
    const enrolled = await Enrollment.findOne({ studentId: req.user.id, courseId }).lean();
    if (!enrolled) return res.status(400).json({ message: 'You must be enrolled in this course to submit feedback' });
    const existing = await Feedback.findOne({ courseId, studentId: req.user.id });
    if (existing) {
      existing.rating = rating;
      existing.comment = comment;
      await existing.save();
      return res.json({ message: 'Feedback updated successfully' });
    }
    await Feedback.create({ courseId, studentId: req.user.id, rating, comment });
    res.status(201).json({ message: 'Feedback submitted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

