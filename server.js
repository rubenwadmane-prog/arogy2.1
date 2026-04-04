require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');
const session   = require('express-session');
const rateLimit = require('express-rate-limit');
const passport  = require('./src/config/passport');
const path      = require('path');
const fs        = require('fs');
const { connectDB } = require('./src/db/database');

const authRoutes         = require('./src/auth');
const consultationRoutes = require('./src/consultations');
const aiRoutes           = require('./src/ai');
const userRoutes         = require('./src/users');

const app  = express();

// ✅ IMPORTANT FIX FOR RAILWAY / PROXY
app.set('trust proxy', 1);

const PORT = process.env.PORT || 5000;

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));
app.options('*', cors());

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'arogya_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 10 * 60 * 1000
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// ✅ IMPROVED RATE LIMITERS
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

app.use('/api/auth',          authLimiter, authRoutes);
app.use('/api/consultations', consultationRoutes);
app.use('/api/ai',            aiLimiter, aiRoutes);
app.use('/api/users',         userRoutes);

app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', time: new Date().toISOString() })
);

// Serve frontend
const frontendDist = path.join(process.cwd(), 'public');
app.use(express.static(frontendDist));

app.get('*', (req, res) => {
  const index = path.join(frontendDist, 'index.html');
  fs.existsSync(index)
    ? res.sendFile(index)
    : res.status(404).send('index.html not found in /public');
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// Start server
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
