require('dotenv').config({ path: '.env.runtime', override: true });
const mysql = require('mysql2/promise');
const mongoose = require('mongoose');
const {
  User, Course, Enrollment, CourseMaterial, Assignment, AssignmentSubmission, Quiz, QuizQuestion, QuizAttempt, Attendance, Feedback, Notification, PasswordReset
} = require('../models');

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || `mongodb://127.0.0.1:27017/${process.env.MONGO_DB_NAME || 'lms_database'}`;
const mysqlConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'lms_database'
};

const mapById = (docs) => Object.fromEntries(docs.map((d) => [Number(d.legacyId), d._id]));
const safeDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

async function run() {
  await mongoose.connect(mongoUri);
  const conn = await mysql.createConnection(mysqlConfig);
  try {
    const [users] = await conn.query('SELECT * FROM users');
    await User.deleteMany({});
    const userDocs = await User.insertMany(users.map((u) => ({ legacyId: u.id, email: u.email, password: u.password, firstName: u.firstName, lastName: u.lastName, role: u.role, avatar: u.avatar, createdAt: u.createdAt, updatedAt: u.updatedAt })));
    const userMap = mapById(userDocs);

    const [courses] = await conn.query('SELECT * FROM courses');
    await Course.deleteMany({});
    const courseDocs = await Course.insertMany(courses.map((c) => ({ legacyId: c.id, title: c.title, description: c.description, instructorId: userMap[c.instructorId], category: c.category, thumbnail: c.thumbnail, status: c.status, createdAt: c.createdAt, updatedAt: c.updatedAt })));
    const courseMap = mapById(courseDocs);

    const [enrollments] = await conn.query('SELECT * FROM enrollments');
    await Enrollment.deleteMany({});
    const enrollmentDocs = await Enrollment.insertMany(enrollments.map((e) => ({ legacyId: e.id, studentId: userMap[e.studentId], courseId: courseMap[e.courseId], progress: e.progress, completed: !!e.completed, enrolledAt: e.enrolledAt, createdAt: e.createdAt, updatedAt: e.updatedAt })));
    const enrollmentMap = mapById(enrollmentDocs);

    const [materials] = await conn.query('SELECT * FROM course_materials');
    await CourseMaterial.deleteMany({});
    const materialDocs = await CourseMaterial.insertMany(materials.map((m) => ({ legacyId: m.id, courseId: courseMap[m.courseId], title: m.title, filePath: m.filePath, fileType: m.fileType, uploadedAt: m.uploadedAt, createdAt: m.createdAt, updatedAt: m.updatedAt })));
    const materialMap = mapById(materialDocs);

    const [assignments] = await conn.query('SELECT * FROM assignments');
    await Assignment.deleteMany({});
    const assignmentDocs = await Assignment.insertMany(assignments.map((a) => ({ legacyId: a.id, courseId: courseMap[a.courseId], title: a.title, description: a.description, dueDate: safeDate(a.dueDate), maxScore: a.maxScore, createdAt: safeDate(a.createdAt), updatedAt: safeDate(a.updatedAt) })));
    const assignmentMap = mapById(assignmentDocs);

    const [submissions] = await conn.query('SELECT * FROM assignment_submissions');
    await AssignmentSubmission.deleteMany({});
    await AssignmentSubmission.insertMany(submissions.map((s) => ({ legacyId: s.id, assignmentId: assignmentMap[s.assignmentId], studentId: userMap[s.studentId], submissionText: s.submissionText, filePath: s.filePath, submittedAt: safeDate(s.submittedAt), score: s.score, feedback: s.feedback, gradedAt: safeDate(s.gradedAt), createdAt: safeDate(s.createdAt), updatedAt: safeDate(s.updatedAt) })));

    const [quizzes] = await conn.query('SELECT * FROM quizzes');
    await Quiz.deleteMany({});
    const quizDocs = await Quiz.insertMany(quizzes.map((q) => ({ legacyId: q.id, courseId: courseMap[q.courseId], title: q.title, description: q.description, timeLimit: q.timeLimit, maxScore: q.maxScore, createdAt: safeDate(q.createdAt), updatedAt: safeDate(q.updatedAt) })));
    const quizMap = mapById(quizDocs);

    const [questions] = await conn.query('SELECT * FROM quiz_questions');
    await QuizQuestion.deleteMany({});
    await QuizQuestion.insertMany(questions.map((q) => ({ legacyId: q.id, quizId: quizMap[q.quizId], question: q.question, questionType: q.questionType, options: (() => { try { return JSON.parse(q.options || '[]'); } catch (_) { return []; } })(), correctAnswer: q.correctAnswer, points: q.points, createdAt: safeDate(q.createdAt), updatedAt: safeDate(q.updatedAt) })));

    const [attempts] = await conn.query('SELECT * FROM quiz_attempts');
    await QuizAttempt.deleteMany({});
    await QuizAttempt.insertMany(attempts.map((a) => ({ legacyId: a.id, quizId: quizMap[a.quizId], studentId: userMap[a.studentId], answers: (() => { try { return JSON.parse(a.answers || '{}'); } catch (_) { return {}; } })(), score: a.score, completedAt: safeDate(a.completedAt), createdAt: safeDate(a.createdAt), updatedAt: safeDate(a.updatedAt) })));

    const [attendance] = await conn.query('SELECT * FROM attendance');
    await Attendance.deleteMany({});
    await Attendance.insertMany(attendance.map((a) => ({ legacyId: a.id, courseId: courseMap[a.courseId], studentId: userMap[a.studentId], date: a.date, status: a.status, notes: a.notes, markedAt: safeDate(a.createdAt), createdAt: safeDate(a.createdAt), updatedAt: safeDate(a.updatedAt) })));

    const [feedback] = await conn.query('SELECT * FROM feedback');
    await Feedback.deleteMany({});
    await Feedback.insertMany(feedback.map((f) => ({ legacyId: f.id, courseId: courseMap[f.courseId], studentId: userMap[f.studentId], rating: f.rating, comment: f.comment, submittedAt: safeDate(f.submittedAt), createdAt: safeDate(f.createdAt), updatedAt: safeDate(f.updatedAt) })));

    const [notifications] = await conn.query('SELECT * FROM notifications');
    await Notification.deleteMany({});
    await Notification.insertMany(notifications.map((n) => ({ legacyId: n.id, userId: userMap[n.userId], title: n.title, message: n.message, type: n.type, read: !!n.read, createdAt: safeDate(n.createdAt), updatedAt: safeDate(n.updatedAt) })));

    const [resets] = await conn.query('SELECT * FROM password_resets');
    await PasswordReset.deleteMany({});
    await PasswordReset.insertMany(resets.map((r) => ({ legacyId: r.id, email: r.email, resetCode: r.resetCode, expiresAt: safeDate(r.expiresAt) || new Date(), used: !!r.used, createdAt: safeDate(r.createdAt), updatedAt: safeDate(r.updatedAt) })));

    const summary = {
      users: await User.countDocuments(),
      courses: await Course.countDocuments(),
      enrollments: await Enrollment.countDocuments(),
      assignments: await Assignment.countDocuments(),
      quizzes: await Quiz.countDocuments()
    };
    console.log('Migration completed:', summary);
  } finally {
    await conn.end();
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

