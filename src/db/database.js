const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI must be set in environment variables');

let client;
let db;

async function connectDB() {
  if (db) return db;

  client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS:         10000,
  });

  await client.connect();
  db = client.db(process.env.MONGODB_DB_NAME || 'arogya');
  console.log(`✅ Connected to MongoDB — db: ${db.databaseName}`);

  // ── Indexes ─────────────────────────────────────────────────────────────────
  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  await db.collection('users').createIndex({ google_id: 1 }, { sparse: true });

  await db.collection('consultations').createIndex({ user_id: 1 });
  await db.collection('consultations').createIndex({ created_at: -1 });
  await db.collection('consultations').createIndex({ user_id: 1, created_at: -1 });

  // doctors — was missing entirely
  await db.collection('doctors').createIndex({ consultation_id: 1 });

  // TTL index — auto-expire refresh tokens
  await db.collection('refresh_tokens').createIndex({ token: 1 }, { unique: true });
  await db.collection('refresh_tokens').createIndex(
    { expires_at: 1 },
    { expireAfterSeconds: 0 }
  );

  return db;
}

function getDB() {
  if (!db) throw new Error('Database not initialised. Call connectDB() first.');
  return db;
}

async function closeDB() {
  if (client) {
    await client.close();
    db     = null;
    client = null;
    console.log('MongoDB connection closed.');
  }
}

// Graceful shutdown
process.on('SIGINT',  () => closeDB().then(() => process.exit(0)));
process.on('SIGTERM', () => closeDB().then(() => process.exit(0)));

module.exports = { connectDB, getDB, closeDB };
