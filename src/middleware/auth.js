const jwt = require('jsonwebtoken');
const { getDB } = require('../db/database');

// ─── ENV VALIDATION ───────────────────────────────────────────────────────────
if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET is missing in environment variables');
  process.exit(1);
}

/**
 * Middleware: require a valid JWT
 */
async function verifyToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    // ❌ No token
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    // ✅ Extract token safely
    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized: Token missing' });
    }

    // ✅ Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const db = getDB();

    // 🔍 Check user exists
    const user = await db.collection('users').findOne(
      { id: decoded.id },
      { projection: { _id: 0, password: 0 } }
    );

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: User not found' });
    }

    // ✅ Attach user to request
    req.user = user;

    next();

  } catch (err) {
    console.error('JWT Error:', err.message);

    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expired',
        code: 'TOKEN_EXPIRED',
      });
    }

    return res.status(401).json({
      error: 'Unauthorized: Invalid token',
    });
  }
}

/**
 * Generate JWT token
 */
function generateAccessToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    }
  );
}

module.exports = {
  verifyToken,
  generateAccessToken,
};
