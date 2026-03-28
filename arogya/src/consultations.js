const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./db/database');
const { verifyToken } = require('./middleware/auth');

router.use(verifyToken);

// ─── POST /api/consultations ──────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const {
      symptoms, mode, summary, conditions,
      specialist, urgency, aiResponse, doctors,
      location,
    } = req.body;

    if (!symptoms || !mode)
      return res.status(400).json({ error: 'symptoms and mode are required' });

    const db  = getDB();
    const id  = uuidv4();
    const now = new Date().toISOString();

    const consultation = {
      id,
      user_id:     req.user.id,
      symptoms,
      mode,
      summary:     summary    || null,
      conditions:  Array.isArray(conditions) ? conditions : [],
      specialist:  specialist || null,
      urgency:     urgency    || null,
      ai_response: aiResponse || null,
      location:    location   || null,   // {lat, lng, city} stored for history display
      created_at:  now,
    };

    await db.collection('consultations').insertOne(consultation);

    // Save doctor suggestions if online mode returned them
    if (Array.isArray(doctors) && doctors.length > 0) {
      const doctorDocs = doctors.map(d => ({
        id:              uuidv4(),
        consultation_id: id,
        user_id:         req.user.id,   // redundant but useful for cascade queries
        name:            d.name,
        specialisation:  d.spec || d.specialisation,
        hospital:        d.hospital,
        distance:        d.distance,
        rating:          d.rating,
        type:            d.type,        // 'nearby' | 'best'
      }));
      await db.collection('doctors').insertMany(doctorDocs);
    }

    res.status(201).json({ consultation: formatConsultation(consultation) });
  } catch (err) {
    console.error('Save consultation error:', err);
    res.status(500).json({ error: 'Failed to save consultation' });
  }
});

// ─── GET /api/consultations ───────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const db    = getDB();
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;

    const filter = { user_id: req.user.id };
    const total  = await db.collection('consultations').countDocuments(filter);
    const rows   = await db.collection('consultations')
      .find(filter, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    res.json({
      consultations: rows.map(formatConsultation),
      pagination:    { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('List consultations error:', err);
    res.status(500).json({ error: 'Failed to fetch consultations' });
  }
});

// ─── GET /api/consultations/:id ───────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const db = getDB();
    const consultation = await db.collection('consultations').findOne(
      { id: req.params.id, user_id: req.user.id },
      { projection: { _id: 0 } }
    );
    if (!consultation) return res.status(404).json({ error: 'Consultation not found' });

    const doctors = await db.collection('doctors')
      .find({ consultation_id: req.params.id }, { projection: { _id: 0 } })
      .toArray();

    res.json({ consultation: { ...formatConsultation(consultation), doctors } });
  } catch (err) {
    console.error('Get consultation error:', err);
    res.status(500).json({ error: 'Failed to fetch consultation' });
  }
});

// ─── DELETE /api/consultations/:id ───────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const db     = getDB();
    const result = await db.collection('consultations').deleteOne({
      id:      req.params.id,
      user_id: req.user.id,   // ensures users can only delete their own
    });
    if (result.deletedCount === 0)
      return res.status(404).json({ error: 'Consultation not found' });

    // Cascade — remove associated doctors
    await db.collection('doctors').deleteMany({ consultation_id: req.params.id });
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    console.error('Delete consultation error:', err);
    res.status(500).json({ error: 'Failed to delete consultation' });
  }
});

// ─── DELETE /api/consultations  (clear all for user) ─────────────────────────
router.delete('/', async (req, res) => {
  try {
    const db = getDB();

    // Get all consultation IDs first for cascade
    const ids = await db.collection('consultations')
      .find({ user_id: req.user.id }, { projection: { id: 1, _id: 0 } })
      .toArray();
    const idList = ids.map(c => c.id);

    await db.collection('consultations').deleteMany({ user_id: req.user.id });
    if (idList.length > 0) {
      await db.collection('doctors').deleteMany({ consultation_id: { $in: idList } });
    }

    res.json({ message: 'All consultations cleared', count: idList.length });
  } catch (err) {
    console.error('Clear consultations error:', err);
    res.status(500).json({ error: 'Failed to clear consultations' });
  }
});

// ─── Helper ───────────────────────────────────────────────────────────────────
function formatConsultation(c) {
  return {
    id:         c.id,
    symptoms:   c.symptoms,
    mode:       c.mode,
    summary:    c.summary,
    conditions: c.conditions || [],
    specialist: c.specialist,
    urgency:    c.urgency,
    location:   c.location || null,
    aiResponse: c.ai_response || null,
    createdAt:  c.created_at,
  };
}

module.exports = router;
