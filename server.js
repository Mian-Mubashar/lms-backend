const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createServer } = require('http');
const net = require('net');
const { Server } = require('socket.io');

// Load environment variables (Vercel injects env; local uses .env.runtime then .env)
dotenv.config({ path: '.env.runtime', override: true });
dotenv.config({ override: false });

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

const isVercel = Boolean(process.env.VERCEL);

// Initialize Express app
const app = express();

let httpServer = null;
let io = null;

if (!isVercel) {
  httpServer = createServer(app);
  io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      methods: ['GET', 'POST']
    }
  });

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

  app.set('io', io);
} else {
  // Serverless: no persistent WebSocket server; no-op for any route that emits
  app.set('io', {
    to: () => ({ emit: () => {} })
  });
}

// Middleware — explicit CORS so browser preflight from any Vercel / local frontend gets headers
app.use(
  cors({
    origin: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 204,
    maxAge: 86400
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Vercel serverless: connect Mongo once per warm instance (mongoose caches connection)
if (isVercel) {
  const ensureMongo = (() => {
    let promise = null;
    return () => {
      if (!promise) {
        promise = new Promise((resolve, reject) => {
          db.connect((err) => (err ? reject(err) : resolve()));
        });
      }
      return promise;
    };
  })();
  app.use((req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    if (
      req.method === 'GET' &&
      (req.path === '/' ||
        req.path === '/favicon.ico' ||
        req.path === '/api/health')
    ) {
      return next();
    }
    ensureMongo()
      .then(() => next())
      .catch((err) => {
        console.error('Database connection failed:', err);
        res.status(503).json({ message: 'Database unavailable', error: err.message });
      });
  });
}

// Serve static files (uploads)
app.use('/uploads', express.static('uploads'));

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

// Root (browser / health probes)
app.get('/', (req, res) => {
  if (isVercel && !db.getMongoUri()) {
    return res.status(200).json({
      status: 'misconfigured',
      service: 'lms-backend',
      message:
        'Set MONGODB_URI (MongoDB Atlas) in Vercel → Settings → Environment Variables, then redeploy.',
      health: '/api/health'
    });
  }
  res.json({ status: 'OK', service: 'lms-backend', health: '/api/health' });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  if (isVercel && !db.getMongoUri()) {
    return res.status(503).json({
      status: 'degraded',
      message: 'LMS API is up but database is not configured (missing MONGODB_URI or MONGO_URI).'
    });
  }
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

if (!isVercel) {
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
}

// Vercel serverless: runtime expects default export to be a **function** OR an **http.Server**.
// Exporting `app` alone fails some checks; `http.createServer(app)` is always recognized as a server.
if (isVercel) {
  const server = createServer(app);
  module.exports = server;
  module.exports.default = server;
  module.exports.app = app;
} else {
  const handler = (req, res) => app(req, res);
  module.exports = handler;
  module.exports.default = handler;
  module.exports.app = app;
}

