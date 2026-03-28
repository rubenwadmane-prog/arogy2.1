const passport       = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { v4: uuidv4 } = require('uuid');
const { getDB }      = require('../db/database');

passport.use(
  new GoogleStrategy(
    {
      clientID:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:  process.env.GOOGLE_CALLBACK_URL,
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

        // 1. Already linked via google_id
        let user = await db.collection('users').findOne({ google_id: googleId }, proj);

        if (!user) {
          const byEmail = await db.collection('users').findOne({ email }, proj);

          if (byEmail) {
            // 2. Existing email account — link Google to it
            await db.collection('users').updateOne(
              { id: byEmail.id },
              { $set: { google_id: googleId, avatar, provider: 'google', updated_at: now } }
            );
            user = await db.collection('users').findOne({ id: byEmail.id }, proj);
          } else {
            // 3. Brand new user via Google
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
          // 4. Known Google user — refresh avatar in case it changed
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

// Session only used during OAuth redirect handshake — JWTs take over after
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
