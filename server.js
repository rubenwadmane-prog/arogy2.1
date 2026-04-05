require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const passport = require('./src/config/passport');
const path = require('path');
const fs = require('fs');
const { connectDB } = require('./src/db/database');

const authRoutes = require('./src/auth');
const consultationRoutes = require('./src/consultations');
const aiRoutes = require('./src/ai');
const userRoutes = require('./src/users');

const app = express();

// ✅ IMPORTANT FOR RAILWAY / PROXY
app.set('trust proxy', 1);

const PORT = process.env.PORT || 5000;

// ✅ SECURITY
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false
}));

// ✅ FIXED CORS (IMPORTANT)
app.use(cors({
  origin: process.env.FRONTEND_URL, // 👈 FIXED
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('*', cors());

// ✅ BODY PARSER
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

// ✅ LOGGER
app.use(morgan('dev'));

// ✅ FIXED SESSION (CRITICAL FOR GOOGLE LOGIN)
app.use(session({
  secret: process.env.SESSION_SECRET || 'arogya_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,              // 👈 FIXED (always true for HTTPS)
    sameSite: 'none',          // 👈 FIXED (important for cross-origin)
    httpOnly: true,
    maxAge: 10 * 60 * 1000
  }
}));

// ✅ PASSPORT
app.use(passport.initialize());
app.use(passport.session());

// ✅ RATE LIMITERS
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// ✅ ROUTES
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/consultations', consultationRoutes);
app.use('/api/ai', aiLimiter, aiRoutes);
app.use('/api/users', userRoutes);

// ✅ HEALTH CHECK
app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', time: new Date().toISOString() })
);

// ✅ SERVE FRONTEND
const frontendDist = path.join(process.cwd(), 'public');
app.use(express.static(frontendDist));

// ✅ CATCH-ALL (KEEP LAST)
app.get('*', (req, res) => {
  const index = path.join(frontendDist, 'index.html');
  if (fs.existsSync(index)) {
    res.sendFile(index);
  } else {
    res.status(404).send('index.html not found in /public');
  }
});

// ✅ ERROR HANDLER
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// ✅ START SERVER
connectDB()
  .then(() => {
    app.listen(PORT, () =>
      console.log(`🩺 Arogya running on port ${PORT}`)
    );
  })
  .catch(err => {
    console.error('MongoDB failed:', err.message);
    process.exit(1);
  });

module.exports = app;