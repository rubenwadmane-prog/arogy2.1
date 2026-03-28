const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { getDB }      = require('./db/database');
const { verifyToken } = require('./middleware/auth');

router.use(verifyToken);

// ─── GET /api/users/profile ───────────────────────────────────────────────────
router.get('/profile', async (req, res) => {
  try {
    const db   = getDB();
    const rows = await db.collection('consultations')
      .find(
        { user_id: req.user.id },
        { projection: { mode: 1, created_at: 1, _id: 0 } }
      )
      .sort({ created_at: -1 })
      .toArray();

    const totalConsultations = rows.length;
    const onlineCount        = rows.filter(r => r.mode === 'online').length;
    const offlineCount       = rows.filter(r => r.mode === 'offline').length;
    const lastConsultation   = rows.length > 0 ? rows[0].created_at : null;

    res.json({
      user: {
        id:        req.user.id,
        name:      req.user.name,
        email:     req.user.email,
        avatar:    req.user.avatar,
        provider:  req.user.provider,
        createdAt: req.user.created_at,
      },
      stats: { totalConsultations, onlineCount, offlineCount, lastConsultation },
    });
  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ─── PATCH /api/users/profile ─────────────────────────────────────────────────
router.patch('/profile', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim())
      return res.status(400).json({ error: 'Name is required' });

    const db = getDB();
    await db.collection('users').updateOne(
      { id: req.user.id },
      { $set: { name: name.trim(), updated_at: new Date().toISOString() } }
    );
    const updated = await db.collection('users').findOne(
      { id: req.user.id },
      { projection: { _id: 0, password: 0 } }
    );
    res.json({
      user: { id: updated.id, name: updated.name, email: updated.email, avatar: updated.avatar },
    });
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ─── POST /api/users/change-password ─────────────────────────────────────────
router.post('/change-password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ error: 'Both passwords required' });
    if (newPassword.length < 6)
      return res.status(400).json({ error: 'New password must be at least 6 characters' });

    const db   = getDB();
    const user = await db.collection('users').findOne({ id: req.user.id });

    if (!user.password)
      return res.status(400).json({ error: 'Password change not available for Google accounts' });

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(newPassword, 12);
    await db.collection('users').updateOne(
      { id: req.user.id },
      { $set: { password: hash, updated_at: new Date().toISOString() } }
    );
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ─── DELETE /api/users/account ────────────────────────────────────────────────
// Cascade: delete all consultations and doctors too
router.delete('/account', async (req, res) => {
  try {
    const db = getDB();

    // Get consultation IDs for cascade doctor delete
    const consultations = await db.collection('consultations')
      .find({ user_id: req.user.id }, { projection: { id: 1, _id: 0 } })
      .toArray();
    const consultationIds = consultations.map(c => c.id);

    // Delete in order: doctors → consultations → user
    if (consultationIds.length > 0) {
      await db.collection('doctors').deleteMany({ consultation_id: { $in: consultationIds } });
    }
    await db.collection('consultations').deleteMany({ user_id: req.user.id });
    await db.collection('users').deleteOne({ id: req.user.id });

    res.json({ message: 'Account and all data deleted' });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

module.exports = router;
