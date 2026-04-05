const passport       = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { v4: uuidv4 } = require('uuid');
const { getDB }      = require('../db/database');

// ─── ENV VALIDATION ───────────────────────────────────────────────────────────
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.error('❌ Google OAuth ENV variables missing');
  process.exit(1);
}

// ─── CALLBACK URL ─────────────────────────────────────────────────────────────
const CALLBACK_URL =
  process.env.GOOGLE_CALLBACK_URL ||
  "https://arogy21-production.up.railway.app/api/auth/google/callback";

console.log("✅ Using Google Callback URL:", CALLBACK_URL);

// ─── GOOGLE STRATEGY ──────────────────────────────────────────────────────────
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const googleId = profile.id;
        const email    = profile.emails?.[0]?.value?.toLowerCase();
        const name     =
          profile.displayName ||
          profile.name?.givenName ||
          'User';
        const avatar   = profile.photos?.[0]?.value || null;

        if (!email) {
          return done(new Error('No email returned from Google'), null);
        }

        const db  = getDB();
        const now = new Date().toISOString();

        const users = db.collection('users');

        // 🔍 Check by Google ID
        let user = await users.findOne(
          { google_id: googleId },
          { projection: { _id: 0, password: 0 } }
        );

        if (!user) {
          // 🔍 Check if email already exists
          const existingUser = await users.findOne({ email });

          if (existingUser) {
            // 🔗 Link Google account
            await users.updateOne(
              { id: existingUser.id },
              {
                $set: {
                  google_id: googleId,
                  avatar,
                  provider: 'google',
                  updated_at: now,
                },
              }
            );

            user = await users.findOne(
              { id: existingUser.id },
              { projection: { _id: 0, password: 0 } }
            );

          } else {
            // 🆕 Create new user
            const id = uuidv4();

            const newUser = {
              id,
              name,
              email,
              google_id: googleId,
              avatar,
              provider: 'google',
              password: null,
              created_at: now,
              updated_at: now,
            };

            await users.insertOne(newUser);

            user = await users.findOne(
              { id },
              { projection: { _id: 0, password: 0 } }
            );
          }
        } else {
          // 🔄 Update existing user
          await users.updateOne(
            { id: user.id },
            {
              $set: {
                avatar,
                updated_at: now,
              },
            }
          );

          user = await users.findOne(
            { id: user.id },
            { projection: { _id: 0, password: 0 } }
          );
        }

        return done(null, user);

      } catch (err) {
        console.error('❌ Google OAuth error:', err);
        return done(err, null);
      }
    }
  )
);

// ─── SESSION HANDLING ─────────────────────────────────────────────────────────
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const db = getDB();

    const user = await db.collection('users').findOne(
      { id },
      { projection: { _id: 0, password: 0 } }
    );

    done(null, user || false);

  } catch (err) {
    console.error('❌ Deserialize error:', err);
    done(err, false);
  }
});

module.exports = passport;
