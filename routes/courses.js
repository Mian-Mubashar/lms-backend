const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const multer = require('multer');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { Course, User, Enrollment, CourseMaterial, Assignment, AssignmentSubmission, Quiz, QuizAttempt } = require('../models');

const router = express.Router();
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = 'uploads/courses';
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });
router.use(authenticate);

const mapCourse = (c, extra = {}) => ({ ...c.toJSON(), instructorId: c.instructorId?.toString(), ...extra });

router.get('/', async (req, res) => {
  try {
    const { status, category, search, instructorId } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (search) filter.$or = [{ title: new RegExp(search, 'i') }, { description: new RegExp(search, 'i') }];
    if (instructorId) filter.instructorId = instructorId;
    if (req.user.role === 'student') filter.status = 'published';

    const courses = await Course.find(filter).sort({ createdAt: -1 }).populate('instructorId', 'firstName lastName');
    const courseIds = courses.map((c) => c._id);
    const enrollmentAgg = await Enrollment.aggregate([{ $match: { courseId: { $in: courseIds } } }, { $group: { _id: '$courseId', count: { $sum: 1 } } }]);
    const enrollmentMap = Object.fromEntries(enrollmentAgg.map((r) => [r._id.toString(), r.count]));
    const myEnrollments = req.user.role === 'student' ? await Enrollment.find({ studentId: req.user.id, courseId: { $in: courseIds } }).lean() : [];
    const myMap = Object.fromEntries(myEnrollments.map((e) => [e.courseId.toString(), e]));

    const out = courses.map((c) => mapCourse(c, {
      instructorFirstName: c.instructorId?.firstName || '',
      instructorLastName: c.instructorId?.lastName || '',
      enrollmentCount: enrollmentMap[c._id.toString()] || 0,
      ...(req.user.role === 'student' ? { isEnrolled: !!myMap[c._id.toString()], enrollment: myMap[c._id.toString()] || null } : {})
    }));
    res.json({ courses: out });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/:id/students', authorize('teacher', 'admin'), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).lean();
    if (!course) return res.status(404).json({ message: 'Course not found' });
    if (req.user.role !== 'admin' && course.instructorId.toString() !== req.user.id) return res.status(403).json({ message: 'Access denied' });

    const enrollments = await Enrollment.find({ courseId: req.params.id }).populate('studentId', 'firstName lastName email');
    let students = enrollments.map((e) => ({ id: e.studentId._id.toString(), firstName: e.studentId.firstName, lastName: e.studentId.lastName, email: e.studentId.email }));
    if (students.length === 0) {
      const all = await User.find({ role: 'student' }).select('firstName lastName email').sort({ firstName: 1, lastName: 1 }).lean();
      students = all.map((s) => ({ id: s._id.toString(), firstName: s.firstName, lastName: s.lastName, email: s.email }));
    }
    res.json({ students });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/:id/certificate/status', authorize('student'), async (req, res) => {
  try {
    const courseId = req.params.id;
    const studentId = req.user.id;
    const enrollment = await Enrollment.findOne({ studentId, courseId });
    if (!enrollment) return res.status(403).json({ message: 'You are not enrolled in this course' });

    const assignments = await Assignment.find({ courseId }).select('_id').lean();
    const assignmentIds = assignments.map((a) => a._id);
    const quizzes = await Quiz.find({ courseId }).select('_id').lean();
    const quizIds = quizzes.map((q) => q._id);
    const completedAssignments = assignmentIds.length ? await AssignmentSubmission.distinct('assignmentId', { studentId, assignmentId: { $in: assignmentIds } }).then((r) => r.length) : 0;
    const completedQuizzes = quizIds.length ? await QuizAttempt.distinct('quizId', { studentId, quizId: { $in: quizIds } }).then((r) => r.length) : 0;
    const totalAssignments = assignmentIds.length;
    const totalQuizzes = quizIds.length;
    const totalRequired = totalAssignments + totalQuizzes;
    const totalCompleted = completedAssignments + completedQuizzes;
    const progress = totalRequired > 0 ? Math.round((totalCompleted / totalRequired) * 100) : 0;
    const eligible = totalRequired > 0 && completedAssignments >= totalAssignments && completedQuizzes >= totalQuizzes;
    enrollment.progress = progress;
    enrollment.completed = eligible;
    await enrollment.save();
    res.json({ eligible, progress, summary: { completedAssignments, totalAssignments, completedQuizzes, totalQuizzes } });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/:id/certificate/download', authorize('student'), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).populate('instructorId', 'firstName lastName');
    if (!course) return res.status(404).json({ message: 'Course not found' });
    const enrollment = await Enrollment.findOne({ studentId: req.user.id, courseId: req.params.id });
    if (!enrollment || !enrollment.completed) return res.status(400).json({ message: 'Complete all quizzes and assignments to unlock certificate' });
    const fileName = `certificate-${String(course.title || 'course').replace(/\s+/g, '-').toLowerCase()}.pdf`;
    const certificateId = `LMS-${course.id}-${req.user.id}-${new Date().getFullYear()}`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);
    doc.rect(25, 25, doc.page.width - 50, doc.page.height - 50).lineWidth(4).stroke('#0ea5e9');
    doc.fontSize(34).fillColor('#0f172a').text('Certificate of Completion', 0, 120, { align: 'center' });
    doc.fontSize(30).text(`${req.user.firstName} ${req.user.lastName}`, 0, 230, { align: 'center', underline: true });
    doc.fontSize(22).fillColor('#0369a1').text(course.title, 60, 320, { align: 'center', width: doc.page.width - 120 });
    doc.fontSize(12).fillColor('#334155').text(`Instructor: ${course.instructorId?.firstName || ''} ${course.instructorId?.lastName || ''}`, 70, 420, { align: 'left' }).text(`Certificate ID: ${certificateId}`, 70, 460, { align: 'left' });
    doc.end();
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).populate('instructorId', 'firstName lastName');
    if (!course) return res.status(404).json({ message: 'Course not found' });
    if (req.user.role === 'student' && course.status !== 'published') return res.status(403).json({ message: 'Course not available' });
    const materials = await CourseMaterial.find({ courseId: req.params.id }).lean();
    const out = mapCourse(course, {
      instructorFirstName: course.instructorId?.firstName || '',
      instructorLastName: course.instructorId?.lastName || '',
      materials: materials.map((m) => ({ ...m, id: m._id.toString(), _id: undefined }))
    });
    if (req.user.role === 'student') out.isEnrolled = !!(await Enrollment.findOne({ studentId: req.user.id, courseId: req.params.id }).lean());
    res.json({ course: out });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/', authorize('teacher', 'admin'), upload.single('thumbnail'), async (req, res) => {
  try {
    const { title, description, category, status = 'draft' } = req.body;
    const course = await Course.create({ title, description, instructorId: req.user.id, category, status, thumbnail: req.file ? req.file.path : null });
    res.status(201).json({ message: 'Course created successfully', course: mapCourse(course) });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/:id', authorize('teacher', 'admin'), upload.single('thumbnail'), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ message: 'Course not found' });
    if (req.user.role !== 'admin' && course.instructorId.toString() !== req.user.id) return res.status(403).json({ message: 'Access denied' });
    ['title', 'description', 'category', 'status'].forEach((k) => { if (req.body[k]) course[k] = req.body[k]; });
    if (req.file) course.thumbnail = req.file.path;
    await course.save();
    res.json({ message: 'Course updated successfully', course: mapCourse(course) });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/:id/enroll', authorize('student'), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).lean();
    if (!course) return res.status(404).json({ message: 'Course not found' });
    if (course.status !== 'published') return res.status(400).json({ message: 'Course is not available for enrollment' });
    const existing = await Enrollment.findOne({ studentId: req.user.id, courseId: req.params.id }).lean();
    if (existing) return res.status(400).json({ message: 'Already enrolled in this course' });
    await Enrollment.create({ studentId: req.user.id, courseId: req.params.id });
    res.json({ message: 'Enrolled successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/:id/materials', authorize('teacher', 'admin'), upload.single('file'), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).lean();
    if (!course) return res.status(404).json({ message: 'Course not found' });
    if (req.user.role !== 'admin' && course.instructorId.toString() !== req.user.id) return res.status(403).json({ message: 'Access denied' });
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const material = await CourseMaterial.create({ courseId: req.params.id, title: req.body.title || req.file.originalname, filePath: req.file.path, fileType: req.file.mimetype });
    res.status(201).json({ message: 'Material uploaded successfully', materialId: material._id.toString() });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

