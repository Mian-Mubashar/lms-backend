const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { Attendance, Course, User } = require('../models');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.courseId) filter.courseId = req.query.courseId;
    if (req.query.studentId) filter.studentId = req.query.studentId;
    if (req.query.date) filter.date = req.query.date;
    if (req.user.role === 'student') filter.studentId = req.user.id;
    const rows = await Attendance.find(filter).sort({ date: -1 }).lean();
    const courses = await Course.find({ _id: { $in: rows.map((r) => r.courseId) } }).select('title').lean();
    const users = await User.find({ _id: { $in: rows.map((r) => r.studentId) } }).select('firstName lastName email').lean();
    const cMap = Object.fromEntries(courses.map((c) => [c._id.toString(), c.title]));
    const uMap = Object.fromEntries(users.map((u) => [u._id.toString(), u]));
    const attendance = rows.map((r) => ({ ...r, id: r._id.toString(), _id: undefined, courseTitle: cMap[r.courseId.toString()] || '', firstName: uMap[r.studentId.toString()]?.firstName || '', lastName: uMap[r.studentId.toString()]?.lastName || '', email: uMap[r.studentId.toString()]?.email || '' }));
    res.json({ attendance });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/', authorize('teacher', 'admin'), async (req, res) => {
  try {
    const { courseId, studentId, date, status, notes } = req.body;
    const course = await Course.findById(courseId).lean();
    if (!course) return res.status(404).json({ message: 'Course not found' });
    if (req.user.role !== 'admin' && course.instructorId.toString() !== req.user.id) return res.status(403).json({ message: 'Access denied' });
    const existing = await Attendance.findOne({ courseId, studentId, date });
    if (existing) {
      existing.status = status;
      existing.notes = notes;
      await existing.save();
      return res.json({ message: 'Attendance updated successfully' });
    }
    await Attendance.create({ courseId, studentId, date, status, notes });
    res.status(201).json({ message: 'Attendance marked successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/bulk', authorize('teacher', 'admin'), async (req, res) => {
  try {
    const { courseId, date, attendanceRecords } = req.body;
    const course = await Course.findById(courseId).lean();
    if (!course) return res.status(404).json({ message: 'Course not found' });
    if (req.user.role !== 'admin' && course.instructorId.toString() !== req.user.id) return res.status(403).json({ message: 'Access denied' });
    for (const record of attendanceRecords) {
      await Attendance.updateOne({ courseId, studentId: record.studentId, date }, { $set: { status: record.status, notes: record.notes || null } }, { upsert: true });
    }
    res.json({ message: 'Bulk attendance marked successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

