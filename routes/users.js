const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const { User } = require('../models');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/users
 * @desc    Get all users (Admin only)
 * @access  Private/Admin
 */
router.get('/', authorize('admin'), async (req, res) => {
  try {
    const { role, search } = req.query;
    const filter = {};

    if (role) {
      filter.role = role;
    }

    if (search) {
      const rx = new RegExp(search, 'i');
      filter.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }];
    }

    const users = await User.find(filter)
      .select('email firstName lastName role avatar createdAt')
      .sort({ createdAt: -1 })
      .lean();
    const mapped = users.map((u) => ({ ...u, id: u._id.toString(), _id: undefined }));
    res.json({ users: mapped });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @route   GET /api/users/:id
 * @desc    Get user by ID
 * @access  Private
 */
router.get('/:id', async (req, res) => {
  try {
    // Users can only view their own profile unless they're admin
    if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const user = await User.findById(req.params.id)
      .select('email firstName lastName role avatar createdAt')
      .lean();
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ user: { ...user, id: user._id.toString(), _id: undefined } });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/**
 * @route   PUT /api/users/:id
 * @desc    Update user
 * @access  Private
 */
router.put('/:id', async (req, res) => {
  try {
    // Users can only update their own profile unless they're admin
    if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { firstName, lastName, avatar } = req.body;
    const updates = {};
    if (firstName) updates.firstName = firstName;
    if (lastName) updates.lastName = lastName;
    if (avatar) updates.avatar = avatar;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }
    const user = await User.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true })
      .select('email firstName lastName role avatar')
      .lean();
    res.json({ message: 'User updated successfully', user: { ...user, id: user._id.toString(), _id: undefined } });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

