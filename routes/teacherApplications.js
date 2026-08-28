const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticate, authorize } = require('../middleware/auth');
const { User, TeacherApplication, Notification } = require('../models');

const router = express.Router();

const mapApplication = (doc) => {
  const a = doc.toObject ? doc.toObject() : doc;
  const user = a.userId && typeof a.userId === 'object'
    ? {
        id: a.userId._id.toString(),
        firstName: a.userId.firstName,
        lastName: a.userId.lastName,
        email: a.userId.email,
        role: a.userId.role
      }
    : null;

  return {
    id: a._id.toString(),
    userId: user?.id || (a.userId?.toString?.() ?? a.userId),
    user,
    message: a.message || '',
    status: a.status,
    adminNote: a.adminNote || '',
    reviewedAt: a.reviewedAt,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt
  };
};

const notifyAdmins = async (title, message) => {
  const admins = await User.find({ role: 'admin' }).select('_id').lean();
  if (!admins.length) return;
  await Notification.insertMany(
    admins.map((admin) => ({
      userId: admin._id,
      title,
      message,
      type: 'info'
    }))
  );
};

router.use(authenticate);

router.get('/me', async (req, res) => {
  try {
    const application = await TeacherApplication.findOne({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ application: application ? mapApplication(application) : null });
  } catch (error) {
    console.error('Get my teacher application error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/', [
  body('message').optional().trim().isLength({ max: 1000 })
], async (req, res) => {
  try {
    if (req.user.role !== 'student') {
      return res.status(400).json({ message: 'Only students can apply to become a teacher' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const pending = await TeacherApplication.findOne({
      userId: req.user.id,
      status: 'pending'
    }).lean();

    if (pending) {
      return res.status(400).json({ message: 'You already have a pending teacher application' });
    }

    const { message = '' } = req.body;
    const application = await TeacherApplication.create({
      userId: req.user.id,
      message: message.trim()
    });

    await notifyAdmins(
      'New teacher application',
      `${req.user.firstName} ${req.user.lastName} (${req.user.email}) applied to become a teacher.`
    );

    res.status(201).json({
      message: 'Teacher application submitted. Admin will review it soon.',
      application: mapApplication(application)
    });
  } catch (error) {
    console.error('Create teacher application error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/', authorize('admin'), async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) {
      filter.status = req.query.status;
    }

    const applications = await TeacherApplication.find(filter)
      .populate('userId', 'firstName lastName email role createdAt')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ applications: applications.map(mapApplication) });
  } catch (error) {
    console.error('List teacher applications error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/:id/approve', authorize('admin'), async (req, res) => {
  try {
    const application = await TeacherApplication.findById(req.params.id).populate(
      'userId',
      'firstName lastName email role'
    );

    if (!application) {
      return res.status(404).json({ message: 'Application not found' });
    }

    if (application.status !== 'pending') {
      return res.status(400).json({ message: 'This application was already reviewed' });
    }

    const applicant = application.userId;
    if (!applicant || applicant.role !== 'student') {
      return res.status(400).json({ message: 'Applicant is no longer eligible' });
    }

    applicant.role = 'teacher';
    await applicant.save();

    application.status = 'approved';
    application.reviewedBy = req.user.id;
    application.reviewedAt = new Date();
    application.adminNote = (req.body.adminNote || '').trim();
    await application.save();

    await Notification.create({
      userId: applicant._id,
      title: 'Teacher application approved',
      message: 'Your teacher application was approved. Log out and sign in again to access the full teacher dashboard.',
      type: 'success'
    });

    res.json({
      message: 'Teacher application approved',
      application: mapApplication(application)
    });
  } catch (error) {
    console.error('Approve teacher application error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/:id/reject', authorize('admin'), [
  body('adminNote').optional().trim().isLength({ max: 500 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const application = await TeacherApplication.findById(req.params.id).populate(
      'userId',
      'firstName lastName email role'
    );

    if (!application) {
      return res.status(404).json({ message: 'Application not found' });
    }

    if (application.status !== 'pending') {
      return res.status(400).json({ message: 'This application was already reviewed' });
    }

    application.status = 'rejected';
    application.reviewedBy = req.user.id;
    application.reviewedAt = new Date();
    application.adminNote = (req.body.adminNote || '').trim();
    await application.save();

    if (application.userId) {
      await Notification.create({
        userId: application.userId._id,
        title: 'Teacher application rejected',
        message: application.adminNote
          ? `Your teacher application was rejected. Note: ${application.adminNote}`
          : 'Your teacher application was rejected.',
        type: 'warning'
      });
    }

    res.json({
      message: 'Teacher application rejected',
      application: mapApplication(application)
    });
  } catch (error) {
    console.error('Reject teacher application error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
