'use strict';

const util = require('../lib/util');
const router = require('express').Router();
const firebase = new (require('firebase'))(process.env.FIREBASE_URL);

router.use('/group', require('./group'));
router.use('/user', require('./user'));

/**
 * @api {post} /register
 * Registers new users
 *
 * @apiParam {string} userId - Facebook user id
 * @apiParam {string} accessToken - Facebook access token
 * @apiParam {string} deviceId - Client's device ID
 */
router.post('/register', (req, res) => {

  // grab facebook user id, access token, and client device id
  let fbUserId = util.sanitizeFirebaseRef(req.body.userId);
  let fbAccessToken = req.body.accessToken;
  let deviceId = req.body.deviceId;

  // create a new reference under 'users', set its key to
  // the user id and its values to the access token and
  // device id
  firebase.child(`users/${fbUserId}`).set({
    accessToken: fbAccessToken,
    deviceId: deviceId
  }, (err) => {
    if (err) {
      console.error(err);
      return res.status(500).json(err);
    }
    res.json({
      msg: `Created user '${fbUserId}'`,
      userId: fbUserId
    });
  });
});

module.exports = router;
