const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { authenticate, authorize } = require('../middleware/auth');
const { User } = require('../models');

const router = express.Router();

const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadPath = 'uploads/avatars';
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    cb(null, `avatar-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
      return;
    }
    cb(new Error('Only image files are allowed'));
  }
});

const mapUser = (user) => ({
  ...user,
  id: user._id.toString(),
  _id: undefined
});

const deleteAvatarFile = (avatarPath) => {
  if (!avatarPath || /^https?:\/\//i.test(avatarPath)) return;
  const normalized = avatarPath.replace(/\\/g, '/');
  const fullPath = path.join(process.cwd(), normalized);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
};

router.use(authenticate);

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
    res.json({ users: users.map(mapUser) });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.post('/:id/avatar', (req, res, next) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || 'Invalid image upload' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No image uploaded' });
    }

    const existing = await User.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (existing.avatar) {
      deleteAvatarFile(existing.avatar);
    }

    const avatarPath = req.file.path.replace(/\\/g, '/');
    existing.avatar = avatarPath;
    await existing.save();

    res.json({
      message: 'Profile photo updated',
      user: mapUser(existing.toObject())
    });
  } catch (error) {
    console.error('Upload avatar error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.delete('/:id/avatar', async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.avatar) {
      deleteAvatarFile(user.avatar);
      user.avatar = null;
      await user.save();
    }

    res.json({
      message: 'Profile photo removed',
      user: mapUser(user.toObject())
    });
  } catch (error) {
    console.error('Remove avatar error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const user = await User.findById(req.params.id)
      .select('email firstName lastName role avatar createdAt')
      .lean();
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ user: mapUser(user) });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.id !== req.params.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { firstName, lastName, avatar } = req.body;
    const updates = {};

    if (firstName !== undefined) {
      const trimmed = String(firstName).trim();
      if (!trimmed) {
        return res.status(400).json({ message: 'First name is required' });
      }
      updates.firstName = trimmed;
    }

    if (lastName !== undefined) {
      const trimmed = String(lastName).trim();
      if (!trimmed) {
        return res.status(400).json({ message: 'Last name is required' });
      }
      updates.lastName = trimmed;
    }

    if (avatar !== undefined) {
      updates.avatar = avatar || null;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    const user = await User.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true })
      .select('email firstName lastName role avatar')
      .lean();

    res.json({ message: 'User updated successfully', user: mapUser(user) });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;
