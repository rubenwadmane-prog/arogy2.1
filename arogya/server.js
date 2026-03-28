require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');
const session   = require('express-session');
const rateLimit = require('express-rate-limit');
const passport  = require('./src/config/passport');
const path      = require('path');
const { connectDB } = require('./src/db/database');

// ─── Routes ───────────────────────────────────────────────────────────────────
const authRoutes         = require('./src/auth');
const consultationRoutes = require('./src/consultations');
const aiRoutes           = require('./src/ai');
const userRoutes         = require('./src/users');

const app  = express();
const PORT = process.env.PORT || 5000;

// ─── Security ─────────────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy:     false,
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:5000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // allow requests with no origin (e.g. mobile apps, curl, Railway health checks)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Logging ──────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// ─── Session (only for OAuth redirect handshake, not app-wide auth) ───────────
app.use(session({
  secret:            process.env.SESSION_SECRET || 'arogya_fallback_secret',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge:   10 * 60 * 1000, // 10 min — only needed during OAuth flow
  },
}));

// ─── Passport ─────────────────────────────────────────────────────────────────
app.use(passport.initialize());
app.use(passport.session());

// ─── Rate limiting ────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000, // 15 minutes
  max:             20,
  message:         { error: 'Too many auth attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders:   false,
});

const aiLimiter = rateLimit({
  windowMs:        60 * 1000, // 1 minute
  max:             10,
  message:         { error: 'Too many AI requests, please slow down' },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ─── API routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',          authLimiter, authRoutes);
app.use('/api/consultations', consultationRoutes);
app.use('/api/ai',            aiLimiter,   aiRoutes);
app.use('/api/users',         userRoutes);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status:  'ok',
    service: 'Arogya API',
    version: '1.0.0',
    time:    new Date().toISOString(),
    db:      'mongodb',
  });
});

// ─── Serve frontend static files ──────────────────────────────────────────────
const frontendDist = path.join(__dirname, '../public');
app.use(express.static(frontendDist));

// SPA fallback — serve index.html for any non-API route
app.get('*', (req, res) => {
  const fs        = require('fs');
  const indexFile = path.join(frontendDist, 'index.html');
  if (fs.existsSync(indexFile)) {
    res.sendFile(indexFile);
  } else {
    res.status(404).json({ error: 'Frontend not built yet' });
  }
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ─── Start — connect DB first, then listen ────────────────────────────────────
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`
  ┌─────────────────────────────────────────────┐
  │  🩺  Arogya API                              │
  │  Port   : ${PORT}                                │
  │  Mode   : ${process.env.NODE_ENV || 'development'}                    │
  │  Health : http://localhost:${PORT}/api/health  │
  └─────────────────────────────────────────────┘
      `);
    });
  })
  .catch(err => {
    console.error('❌ Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });

module.exports = app;
