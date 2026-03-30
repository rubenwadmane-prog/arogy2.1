const passport       = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { v4: uuidv4 } = require('uuid');
const { getDB }      = require('../db/database');

// 🔥 ADD THIS LINE (fallback + debug)
const CALLBACK_URL =
  process.env.GOOGLE_CALLBACK_URL ||
  "https://arogy21-production.up.railway.app/api/auth/google/callback";

console.log("Using Google Callback URL:", CALLBACK_URL);

passport.use(
  new GoogleStrategy(
    {
      clientID:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:  CALLBACK_URL, // ✅ use safe variable
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const googleId = profile.id;
        const email    = profile.emails?.[0]?.value?.toLowerCase();
        const name     = profile.displayName || profile.name?.givenName || 'User';
        const avatar   = profile.photos?.[0]?.value;

        if (!email) return done(new Error('No email returned from Google'), null);

        const db  = getDB();
        const now = new Date().toISOString();
        const proj = { projection: { _id: 0, password: 0 } };

        let user = await db.collection('users').findOne({ google_id: googleId }, proj);

        if (!user) {
          const byEmail = await db.collection('users').findOne({ email }, proj);

          if (byEmail) {
            await db.collection('users').updateOne(
              { id: byEmail.id },
              { $set: { google_id: googleId, avatar, provider: 'google', updated_at: now } }
            );
            user = await db.collection('users').findOne({ id: byEmail.id }, proj);
          } else {
            const id = uuidv4();
            const newUser = {
              id,
              name,
              email,
              google_id: googleId,
              avatar,
              provider:   'google',
              password:   null,
              created_at: now,
              updated_at: now,
            };
            await db.collection('users').insertOne(newUser);
            user = await db.collection('users').findOne({ id }, proj);
          }
        } else {
          await db.collection('users').updateOne(
            { id: user.id },
            { $set: { avatar, updated_at: now } }
          );
          user = await db.collection('users').findOne({ id: user.id }, proj);
        }

        return done(null, user);
      } catch (err) {
        console.error('Google OAuth error:', err);
        return done(err, null);
      }
    }
  )
);

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
  try {
    const db   = getDB();
    const user = await db.collection('users').findOne(
      { id },
      { projection: { _id: 0, password: 0 } }
    );
    done(null, user || false);
  } catch (err) {
    done(err, false);
  }
});

module.exports = passport;
