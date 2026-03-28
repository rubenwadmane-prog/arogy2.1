const router   = require('express').Router();
const bcrypt   = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const passport = require('./config/passport');
const { getDB } = require('./db/database');
const { generateAccessToken, verifyToken } = require('./middleware/auth');

function safeUser(u) {
  return {
    id:        u.id,
    name:      u.name,
    email:     u.email,
    avatar:    u.avatar,
    provider:  u.provider,
    createdAt: u.created_at,
  };
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ error: 'name, email and password are required' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const db       = getDB();
    const emailKey = email.toLowerCase().trim();
    const existing = await db.collection('users').findOne({ email: emailKey });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 12);
    const id   = uuidv4();
    const now  = new Date().toISOString();

    const user = {
      id,
      name:       name.trim(),
      email:      emailKey,
      password:   hash,
      provider:   'local',
      avatar:     null,
      google_id:  null,
      created_at: now,
      updated_at: now,
    };
    await db.collection('users').insertOne(user);

    const token = generateAccessToken(user);
    res.status(201).json({ token, user: safeUser(user) });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'email and password are required' });

    const db   = getDB();
    const user = await db.collection('users').findOne({ email: email.toLowerCase().trim() });
    if (!user || !user.password)
      return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = generateAccessToken(user);
    res.json({ token, user: safeUser(user) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', verifyToken, (req, res) => {
  res.json({ user: safeUser(req.user) });
});

// ─── GET /api/auth/google ─────────────────────────────────────────────────────
router.get('/google',
  passport.authenticate('google', {
    scope:  ['profile', 'email'],
    prompt: 'select_account',
  })
);

// ─── GET /api/auth/google/callback ────────────────────────────────────────────
router.get('/google/callback',
  passport.authenticate('google', {
    failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:3000'}?error=google_failed`,
    session: false,
  }),
  (req, res) => {
    const token       = generateAccessToken(req.user);
    const frontendURL = process.env.FRONTEND_URL || 'http://localhost:3000';
    // Token passed in URL — frontend reads it, stores in localStorage, removes from URL
    res.redirect(`${frontendURL}?token=${token}&name=${encodeURIComponent(req.user.name)}`);
  }
);

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
// JWT is stateless — client just deletes the token; server just confirms
router.post('/logout', (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;
