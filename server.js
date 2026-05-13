const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createServer } = require('http');
const net = require('net');
const { Server } = require('socket.io');

// Load environment variables
dotenv.config({ path: '.env.runtime', override: true });

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const courseRoutes = require('./routes/courses');
const assignmentRoutes = require('./routes/assignments');
const quizRoutes = require('./routes/quizzes');
const attendanceRoutes = require('./routes/attendance');
const feedbackRoutes = require('./routes/feedback');
const aiRoutes = require('./routes/ai');
const analyticsRoutes = require('./routes/analytics');
const notificationRoutes = require('./routes/notifications');

// Import database connection
const db = require('./config/database');

// Initialize Express app
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (uploads)
app.use('/uploads', express.static('uploads'));

// Socket.IO for real-time notifications
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join-room', (userId) => {
    socket.join(`user-${userId}`);
    console.log(`User ${userId} joined their room`);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Make io available to routes
app.set('io', io);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/quizzes', quizRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/notifications', notificationRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'LMS API is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    message: err.message || 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Database connection and server start
const PORT = Number(process.env.PORT) || 5000;
const MAX_PORT_RETRIES = 10;

const checkPortAvailable = (port) => {
  return new Promise((resolve) => {
    const tester = net.createServer();

    tester.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(false);
      }
    });

    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });

    tester.listen(port);
  });
};

const findAvailablePort = async (startPort, maxRetries) => {
  for (let offset = 0; offset <= maxRetries; offset += 1) {
    const candidate = startPort + offset;
    const available = await checkPortAvailable(candidate);
    if (available) {
      return candidate;
    }
    if (offset < maxRetries) {
      console.warn(`Port ${candidate} is busy, trying ${candidate + 1}...`);
    }
  }

  throw new Error(`No free port found between ${startPort} and ${startPort + maxRetries}`);
};

db.connect((err) => {
  if (err) {
    console.error('Database connection failed:', err);
    process.exit(1);
  }
  console.log('Database connected successfully');

  findAvailablePort(PORT, MAX_PORT_RETRIES)
    .then((availablePort) => {
      httpServer.listen(availablePort, () => {
        console.log(`Server running on port ${availablePort}`);
        console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      });
    })
    .catch((error) => {
      console.error('Server failed to start:', error.message);
      process.exit(1);
    });
});

module.exports = { app, io };

