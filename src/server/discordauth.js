import passport from 'passport';
import Strategy from 'passport-discord';


export default  function() {
  
  // Configure the Facebook strategy for use by Passport.
  //
  // OAuth 2.0-based strategies require a `verify` function which receives the
  // credential (`accessToken`) for accessing the Facebook API on the user's
  // behalf, along with the user's profile.  The function must invoke `cb`
  // with a user object, which will be set at `req.user` in route handlers after
  // authentication.
 
  var scopes = ['identify', 'email', 'guilds', 'guilds.join'];
 
  passport.use(new Strategy({
      clientID: process.env['DISCORD_CLIENT_ID'],
      clientSecret: process.env['DISCORD_CLIENT_SECRET'],
      callbackURL: 'https://tactics-edge.taorankings.com/auth/discord/callback',
      scope: scopes
  },
  function(accessToken, refreshToken, profile, cb) {
      
          return cb(err, profile);
      
  }));
    
  // Configure Passport authenticated session persistence.
  //
  // In order to restore authentication state across HTTP requests, Passport needs
  // to serialize users into and deserialize users out of the session.  In a
  // production-quality application, this would typically be as simple as
  // supplying the user ID when serializing, and querying the user record by ID
  // from the database when deserializing.  However, due to the fact that this
  // example does not have a database, the complete Facebook profile is serialized
  // and deserialized.
  passport.serializeUser(function(user, cb) {
    cb(null, user);
  });

  passport.deserializeUser(function(obj, cb) {
    cb(null, obj);
  });
  
};
