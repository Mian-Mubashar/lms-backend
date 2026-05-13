const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { Quiz, QuizQuestion, QuizAttempt, Course, Enrollment } = require('../models');

const router = express.Router();
router.use(authenticate);
const parseOptions = (options) => (Array.isArray(options) ? options : []);

router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.courseId) filter.courseId = req.query.courseId;
    if (req.user.role === 'student') {
      const ids = await Enrollment.distinct('courseId', { studentId: req.user.id });
      filter.courseId = filter.courseId || { $in: ids };
    }
    const quizzes = await Quiz.find(filter).sort({ createdAt: -1 }).lean();
    const courses = await Course.find({ _id: { $in: quizzes.map((q) => q.courseId) } }).select('title').lean();
    const courseMap = Object.fromEntries(courses.map((c) => [c._id.toString(), c.title]));
    const out = [];
    for (const quiz of quizzes) {
      const row = { ...quiz, id: quiz._id.toString(), _id: undefined, courseTitle: courseMap[quiz.courseId.toString()] || '' };
      if (req.user.role === 'student') row.lastAttempt = await QuizAttempt.findOne({ quizId: quiz._id, studentId: req.user.id }).sort({ completedAt: -1 }).lean();
      out.push(row);
    }
    res.json({ quizzes: out });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id).lean();
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });
    const course = await Course.findById(quiz.courseId).select('title').lean();
    const questions = await QuizQuestion.find({ quizId: req.params.id }).lean();
    const payload = { ...quiz, id: quiz._id.toString(), _id: undefined, courseTitle: course?.title || '' };
    payload.questions = questions.map((q) => ({
      id: q._id.toString(),
      question: q.question,
      questionType: q.questionType,
      options: parseOptions(q.options),
      points: q.points,
      ...(req.user.role === 'student' ? {} : { correctAnswer: q.correctAnswer })
    }));
    res.json({ quiz: payload });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/', authorize('teacher', 'admin'), async (req, res) => {
  try {
    const { courseId, title, description, timeLimit, maxScore, questions } = req.body;
    const course = await Course.findById(courseId).lean();
    if (!course) return res.status(404).json({ message: 'Course not found' });
    if (req.user.role !== 'admin' && course.instructorId.toString() !== req.user.id) return res.status(403).json({ message: 'Access denied' });
    const quiz = await Quiz.create({ courseId, title, description, timeLimit: timeLimit || 30, maxScore: maxScore || 100 });
    if (Array.isArray(questions) && questions.length) {
      await QuizQuestion.insertMany(questions.map((q) => ({
        quizId: quiz._id,
        question: q.question,
        questionType: q.questionType || 'multiple_choice',
        options: parseOptions(q.options),
        correctAnswer: q.correctAnswer,
        points: q.points || 1
      })));
    }
    res.status(201).json({ message: 'Quiz created successfully', quiz: { ...quiz.toJSON(), courseId: quiz.courseId.toString() } });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/:id', authorize('teacher', 'admin'), async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });
    const course = await Course.findById(quiz.courseId).lean();
    if (!course) return res.status(404).json({ message: 'Course not found' });
    if (req.user.role !== 'admin' && course.instructorId.toString() !== req.user.id) return res.status(403).json({ message: 'Access denied' });
    ['title', 'description', 'timeLimit', 'maxScore'].forEach((k) => { if (req.body[k] !== undefined) quiz[k] = req.body[k]; });
    await quiz.save();
    if (Array.isArray(req.body.questions) && req.body.questions.length > 0) {
      await QuizQuestion.deleteMany({ quizId: req.params.id });
      await QuizQuestion.insertMany(req.body.questions.map((q) => ({
        quizId: req.params.id,
        question: q.question,
        questionType: q.questionType || 'multiple_choice',
        options: parseOptions(q.options),
        correctAnswer: q.correctAnswer,
        points: q.points || 1
      })));
    }
    res.json({ message: 'Quiz updated successfully', quiz: { ...quiz.toJSON(), courseId: quiz.courseId.toString() } });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.delete('/:id', authorize('teacher', 'admin'), async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id).lean();
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });
    const course = await Course.findById(quiz.courseId).lean();
    if (req.user.role !== 'admin' && course.instructorId.toString() !== req.user.id) return res.status(403).json({ message: 'Access denied' });
    await QuizQuestion.deleteMany({ quizId: req.params.id });
    await QuizAttempt.deleteMany({ quizId: req.params.id });
    await Quiz.deleteOne({ _id: req.params.id });
    res.json({ message: 'Quiz deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/:id/submit', authorize('student'), async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id).lean();
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });
    const answers = req.body.answers || {};
    const questions = await QuizQuestion.find({ quizId: req.params.id }).lean();
    let score = 0;
    const evaluation = {};
    for (const q of questions) {
      const key = q._id.toString();
      const userAnswer = answers[key];
      const isCorrect = userAnswer === q.correctAnswer;
      if (isCorrect) score += q.points;
      evaluation[key] = { correct: isCorrect, userAnswer, correctAnswer: q.correctAnswer, points: isCorrect ? q.points : 0 };
    }
    await QuizAttempt.create({ quizId: req.params.id, studentId: req.user.id, answers, score });
    res.json({ message: 'Quiz submitted successfully', score, maxScore: quiz.maxScore, evaluation });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

