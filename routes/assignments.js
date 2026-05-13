const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const multer = require('multer');
const fs = require('fs');
const { Assignment, Course, Enrollment, AssignmentSubmission, User } = require('../models');

const router = express.Router();
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = 'uploads/assignments';
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });
router.use(authenticate);
const map = (a) => ({ ...a.toJSON(), courseId: a.courseId?.toString() });

router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.courseId) filter.courseId = req.query.courseId;
    if (req.user.role === 'student') {
      const courses = await Enrollment.distinct('courseId', { studentId: req.user.id });
      filter.courseId = filter.courseId || { $in: courses };
    }
    const assignments = await Assignment.find(filter).sort({ dueDate: 1 }).lean();
    const courses = await Course.find({ _id: { $in: assignments.map((a) => a.courseId) } }).select('title').lean();
    const courseMap = Object.fromEntries(courses.map((c) => [c._id.toString(), c.title]));
    const out = [];
    for (const a of assignments) {
      const item = { ...a, id: a._id.toString(), _id: undefined, courseTitle: courseMap[a.courseId.toString()] || '' };
      if (req.user.role === 'student') item.submission = await AssignmentSubmission.findOne({ assignmentId: a._id, studentId: req.user.id }).lean();
      out.push(item);
    }
    res.json({ assignments: out });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id).lean();
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' });
    const course = await Course.findById(assignment.courseId).select('title').lean();
    const out = { ...assignment, id: assignment._id.toString(), _id: undefined, courseTitle: course?.title || '' };
    if (req.user.role === 'teacher' || req.user.role === 'admin') {
      const submissions = await AssignmentSubmission.find({ assignmentId: req.params.id }).populate('studentId', 'firstName lastName email').lean();
      out.submissions = submissions.map((s) => ({ ...s, id: s._id.toString(), _id: undefined, firstName: s.studentId?.firstName, lastName: s.studentId?.lastName, email: s.studentId?.email, studentId: s.studentId?._id?.toString() || s.studentId }));
    } else {
      out.submission = await AssignmentSubmission.findOne({ assignmentId: req.params.id, studentId: req.user.id }).lean();
    }
    res.json({ assignment: out });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/', authorize('teacher', 'admin'), async (req, res) => {
  try {
    const { courseId, title, description, dueDate, maxScore } = req.body;
    const course = await Course.findById(courseId).lean();
    if (!course) return res.status(404).json({ message: 'Course not found' });
    if (req.user.role !== 'admin' && course.instructorId.toString() !== req.user.id) return res.status(403).json({ message: 'Access denied' });
    const assignment = await Assignment.create({ courseId, title, description, dueDate, maxScore: maxScore || 100 });
    res.status(201).json({ message: 'Assignment created successfully', assignment: map(assignment) });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/:id', authorize('teacher', 'admin'), async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' });
    const course = await Course.findById(assignment.courseId).lean();
    if (!course) return res.status(404).json({ message: 'Course not found' });
    if (req.user.role !== 'admin' && course.instructorId.toString() !== req.user.id) return res.status(403).json({ message: 'Access denied' });
    ['title', 'description', 'dueDate', 'maxScore'].forEach((k) => { if (req.body[k] !== undefined) assignment[k] = req.body[k]; });
    await assignment.save();
    res.json({ message: 'Assignment updated successfully', assignment: map(assignment) });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.delete('/:id', authorize('teacher', 'admin'), async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id).lean();
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' });
    const course = await Course.findById(assignment.courseId).lean();
    if (req.user.role !== 'admin' && course.instructorId.toString() !== req.user.id) return res.status(403).json({ message: 'Access denied' });
    await AssignmentSubmission.deleteMany({ assignmentId: req.params.id });
    await Assignment.deleteOne({ _id: req.params.id });
    res.json({ message: 'Assignment deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/:id/submit', authorize('student'), upload.single('file'), async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id).lean();
    if (!assignment) return res.status(404).json({ message: 'Assignment not found' });
    const existing = await AssignmentSubmission.findOne({ assignmentId: req.params.id, studentId: req.user.id });
    if (existing) {
      existing.submissionText = req.body.submissionText;
      if (req.file?.path) existing.filePath = req.file.path;
      existing.submittedAt = new Date();
      await existing.save();
      return res.json({ message: 'Submission updated successfully' });
    }
    await AssignmentSubmission.create({ assignmentId: req.params.id, studentId: req.user.id, submissionText: req.body.submissionText, filePath: req.file?.path || null });
    res.status(201).json({ message: 'Assignment submitted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/:id/grade', authorize('teacher', 'admin'), async (req, res) => {
  try {
    const submission = await AssignmentSubmission.findById(req.body.submissionId);
    if (!submission) return res.status(404).json({ message: 'Submission not found' });
    submission.score = req.body.score;
    submission.feedback = req.body.feedback;
    submission.gradedAt = new Date();
    await submission.save();
    res.json({ message: 'Assignment graded successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

