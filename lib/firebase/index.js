const firebase = module.exports = new (require('firebase'))(process.env.FIREBASE_URL);
firebase.authWithCustomToken(process.env.FIREBASE_TOKEN, (err, data) => {
  if (err) return console.log('Firebase auth failed', err);
  return console.log('Firebase auth succeeded');
});
