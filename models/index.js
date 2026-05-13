const mongoose = require('mongoose');

const baseOptions = {
  timestamps: true,
  toJSON: {
    virtuals: true,
    versionKey: false,
    transform: (_, ret) => {
      ret.id = ret._id.toString();
      delete ret._id;
      return ret;
    }
  }
};

const userSchema = new mongoose.Schema({
  legacyId: { type: Number, index: true, sparse: true },
  email: { type: String, required: true, unique: true, index: true },
  password: { type: String, required: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  role: { type: String, enum: ['admin', 'teacher', 'student'], default: 'student', index: true },
  avatar: { type: String, default: null }
}, baseOptions);

const courseSchema = new mongoose.Schema({
  legacyId: { type: Number, index: true, sparse: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  instructorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  category: { type: String, default: '' },
  thumbnail: { type: String, default: null },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true }
}, baseOptions);

const enrollmentSchema = new mongoose.Schema({
  legacyId: { type: Number, index: true, sparse: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  progress: { type: Number, default: 0 },
  completed: { type: Boolean, default: false },
  enrolledAt: { type: Date, default: Date.now }
}, baseOptions);
enrollmentSchema.index({ studentId: 1, courseId: 1 }, { unique: true });

const courseMaterialSchema = new mongoose.Schema({
  legacyId: { type: Number, index: true, sparse: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  title: { type: String, required: true },
  filePath: { type: String, required: true },
  fileType: { type: String, default: '' },
  uploadedAt: { type: Date, default: Date.now }
}, baseOptions);

const assignmentSchema = new mongoose.Schema({
  legacyId: { type: Number, index: true, sparse: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  dueDate: { type: Date, default: null },
  maxScore: { type: Number, default: 100 }
}, baseOptions);

const assignmentSubmissionSchema = new mongoose.Schema({
  legacyId: { type: Number, index: true, sparse: true },
  assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', required: true, index: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  submissionText: { type: String, default: '' },
  filePath: { type: String, default: null },
  submittedAt: { type: Date, default: Date.now },
  score: { type: Number, default: null },
  feedback: { type: String, default: '' },
  gradedAt: { type: Date, default: null }
}, baseOptions);
assignmentSubmissionSchema.index({ assignmentId: 1, studentId: 1 }, { unique: true });

const quizSchema = new mongoose.Schema({
  legacyId: { type: Number, index: true, sparse: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  timeLimit: { type: Number, default: 30 },
  maxScore: { type: Number, default: 100 }
}, baseOptions);

const quizQuestionSchema = new mongoose.Schema({
  legacyId: { type: Number, index: true, sparse: true },
  quizId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', required: true, index: true },
  question: { type: String, required: true },
  questionType: { type: String, enum: ['multiple_choice', 'true_false', 'short_answer'], default: 'multiple_choice' },
  options: { type: [String], default: [] },
  correctAnswer: { type: String, default: '' },
  points: { type: Number, default: 1 }
}, baseOptions);

const quizAttemptSchema = new mongoose.Schema({
  legacyId: { type: Number, index: true, sparse: true },
  quizId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', required: true, index: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  answers: { type: mongoose.Schema.Types.Mixed, default: {} },
  score: { type: Number, default: 0 },
  completedAt: { type: Date, default: Date.now }
}, baseOptions);

const attendanceSchema = new mongoose.Schema({
  legacyId: { type: Number, index: true, sparse: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  date: { type: String, required: true },
  status: { type: String, enum: ['present', 'absent', 'late', 'excused'], default: 'absent' },
  notes: { type: String, default: '' },
  markedAt: { type: Date, default: Date.now }
}, baseOptions);
attendanceSchema.index({ courseId: 1, studentId: 1, date: 1 }, { unique: true });

const feedbackSchema = new mongoose.Schema({
  legacyId: { type: Number, index: true, sparse: true },
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  rating: { type: Number, required: true },
  comment: { type: String, default: '' },
  submittedAt: { type: Date, default: Date.now }
}, baseOptions);
feedbackSchema.index({ courseId: 1, studentId: 1 }, { unique: true });

const notificationSchema = new mongoose.Schema({
  legacyId: { type: Number, index: true, sparse: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, default: 'info' },
  read: { type: Boolean, default: false }
}, baseOptions);

const passwordResetSchema = new mongoose.Schema({
  legacyId: { type: Number, index: true, sparse: true },
  email: { type: String, required: true, index: true },
  resetCode: { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true, index: true },
  used: { type: Boolean, default: false }
}, baseOptions);

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Course = mongoose.models.Course || mongoose.model('Course', courseSchema);
const Enrollment = mongoose.models.Enrollment || mongoose.model('Enrollment', enrollmentSchema);
const CourseMaterial = mongoose.models.CourseMaterial || mongoose.model('CourseMaterial', courseMaterialSchema);
const Assignment = mongoose.models.Assignment || mongoose.model('Assignment', assignmentSchema);
const AssignmentSubmission = mongoose.models.AssignmentSubmission || mongoose.model('AssignmentSubmission', assignmentSubmissionSchema);
const Quiz = mongoose.models.Quiz || mongoose.model('Quiz', quizSchema);
const QuizQuestion = mongoose.models.QuizQuestion || mongoose.model('QuizQuestion', quizQuestionSchema);
const QuizAttempt = mongoose.models.QuizAttempt || mongoose.model('QuizAttempt', quizAttemptSchema);
const Attendance = mongoose.models.Attendance || mongoose.model('Attendance', attendanceSchema);
const Feedback = mongoose.models.Feedback || mongoose.model('Feedback', feedbackSchema);
const Notification = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
const PasswordReset = mongoose.models.PasswordReset || mongoose.model('PasswordReset', passwordResetSchema);

module.exports = {
  mongoose,
  User,
  Course,
  Enrollment,
  CourseMaterial,
  Assignment,
  AssignmentSubmission,
  Quiz,
  QuizQuestion,
  QuizAttempt,
  Attendance,
  Feedback,
  Notification,
  PasswordReset
};
