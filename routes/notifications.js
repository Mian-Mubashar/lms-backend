const express = require('express');
const { authenticate } = require('../middleware/auth');
const { Notification } = require('../models');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    const filter = { userId: req.user.id };
    if (req.query.unreadOnly === 'true') filter.read = false;
    const notifications = await Notification.find(filter).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ notifications: notifications.map((n) => ({ ...n, id: n._id.toString(), _id: undefined, userId: n.userId.toString() })) });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/:id/read', async (req, res) => {
  try {
    await Notification.updateOne({ _id: req.params.id, userId: req.user.id }, { $set: { read: true } });
    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.put('/read-all', async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user.id, read: false }, { $set: { read: true } });
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await Notification.deleteOne({ _id: req.params.id, userId: req.user.id });
    res.json({ message: 'Notification deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;

