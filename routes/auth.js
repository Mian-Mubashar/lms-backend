const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticate } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
const { User, PasswordReset, TeacherApplication, Notification } = require('../models');
const { isEmailConfigured, sendPasswordResetEmail } = require('../lib/email');

const router = express.Router();
PasswordReset.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {});

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('firstName').trim().notEmpty(),
  body('lastName').trim().notEmpty(),
  body('role').optional().isIn(['student', 'teacher'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, firstName, lastName, role: requestedRole = 'student' } = req.body;
    const role = 'student';
    let teacherApplicationPending = false;

    // Check if user exists
    const existingUser = await User.findOne({ email }).lean();
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user (public signup is always student)
    const user = await User.create({ email, password: hashedPassword, firstName, lastName, role });
    const userId = user._id.toString();

    if (requestedRole === 'teacher') {
      await TeacherApplication.create({
        userId: user._id,
        message: 'Teacher account requested during signup.'
      });
      teacherApplicationPending = true;

      const admins = await User.find({ role: 'admin' }).select('_id').lean();
      if (admins.length) {
        await Notification.insertMany(
          admins.map((admin) => ({
            userId: admin._id,
            title: 'New teacher application',
            message: `${firstName} ${lastName} (${email}) signed up as a teacher and needs approval.`,
            type: 'info'
          }))
        );
      }
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId, email, role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    res.status(201).json({
      message: teacherApplicationPending
        ? 'Account created. Your teacher request was sent to admin for approval.'
        : 'User registered successfully',
      token,
      teacherApplicationPending,
      user: {
        id: userId.toString(),
        email,
        firstName,
        lastName,
        role
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @route   POST /api/auth/login
 * @desc    Login user
 * @access  Public
 */
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id.toString(), email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id.toString(),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        avatar: user.avatar
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @route   GET /api/auth/me
 * @desc    Get current user
 * @access  Private
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).lean();
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      user: {
        id: user._id.toString(),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        avatar: user.avatar,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Request password reset code
 * @access  Public
 */
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email } = req.body;
    const normalizedEmail = String(email).trim().toLowerCase();

    const user = await User.findOne({ email: normalizedEmail }).lean();
    if (!user) {
      return res.status(404).json({
        message: 'No account found with this email. Please use the email you registered with.',
        emailSent: false
      });
    }

    if (!isEmailConfigured()) {
      console.error('Forgot password: set SMTP_USER/SMTP_PASSWORD in backend .env');
      return res.status(503).json({
        message: 'We could not send the reset email right now. Please try again in a few minutes or contact support.',
        emailSent: false
      });
    }

    const resetCode = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await PasswordReset.findOneAndUpdate(
      { email: normalizedEmail },
      { email: normalizedEmail, resetCode, expiresAt, used: false },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const payload = {
      to: normalizedEmail,
      resetCode,
      firstName: user.firstName || 'User'
    };

    res.json({
      message: 'Reset code sent! It usually arrives within 1 minute. Check inbox and spam.',
      emailSent: true
    });

    sendPasswordResetEmail(payload).catch(async (error) => {
      await PasswordReset.deleteMany({ email: normalizedEmail });
      console.error('Password reset email failed:', error.message);
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @route   POST /api/auth/reset-password
 * @desc    Reset password with code
 * @access  Public
 */
router.post('/reset-password', [
  body('email').isEmail().normalizeEmail(),
  body('code').trim().isLength({ min: 4 }),
  body('newPassword').isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, code, newPassword } = req.body;
    const normalizedEmail = String(email).trim().toLowerCase();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(400).json({ message: 'Invalid reset request' });
    }

    const reset = await PasswordReset.findOne({
      email: normalizedEmail,
      resetCode: code,
      used: false,
      expiresAt: { $gte: new Date() }
    }).sort({ createdAt: -1 });
    if (!reset) {
      return res.status(400).json({ message: 'Invalid or expired reset code' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();
    reset.used = true;
    await reset.save();

    res.json({ message: 'Password reset successful. Please sign in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

