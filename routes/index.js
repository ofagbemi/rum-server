'use strict';

const util = require('../lib/util');
const router = require('express').Router();
const firebase = new (require('firebase'))(process.env.FIREBASE_URL);

router.use('/group', require('./group'));
router.use('/user', require('./user'));

router.use('/invite', require('./invite'));

/**
 * @api {post} /register
 * Registers new users
 *
 * @apiParam {string} userId - Facebook user id
 * @apiParam {string} accessToken - Facebook access token
 * @apiParam {string} deviceId - Client's device ID
 */
router.post('/register', (req, res, next) => {

  // grab facebook user id, access token, and client device id
  const fbUserId = util.sanitizeFirebaseRef(req.body.userId);
  const fbAccessToken = req.body.accessToken;
  const deviceId = req.body.deviceId;

  const firstName = req.body.firstName;
  const lastName  = req.body.lastName;
  const fullName  = `${firstName} ${lastName}`;
  const photo = req.body.photo;

  let message = null;
  if(!fbUserId) {
    message = `Must specify valid Facebook user ID - got: '${fbUserId}'`;
  } else if(!fbAccessToken) {
    message = 'Must specify Facebook access token';
  } else if(!deviceId) {
    message = 'Must specify device ID';
  } else if(!firstName) {
    message = 'Must specify a first name';
  } else if(!lastName) {
    message = 'Must specify a last name';
  } else if(!photo) {
    message = 'Must specify a photo';
  }

  if (message) {
    const err = new Error(message);
    err.statusCode = 400;
    return next(err);
  }

  // create a new reference under 'users', set its key to
  // the user id and its values to the access token and
  // device id
  firebase.child(`users/${fbUserId}`).set({
    id: fbUserId,
    accessToken: fbAccessToken,
    deviceId: deviceId,
    firstName: firstName,
    lastName: lastName,
    fullName: fullName,
    photo: photo
  }, (err) => {
    if (err) return next(err);
    res.json({
      msg: `Created user '${fbUserId}'`,
      userId: fbUserId
    });
  });
});

module.exports = router;
