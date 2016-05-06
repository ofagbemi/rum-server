'use strict';

const api = require('../lib/api');
const util = require('../lib/util');
const async = require('async');
const router = require('express').Router();
const firebase = new (require('firebase'))(process.env.FIREBASE_URL);

const verifyLoggedInMiddleware = api.Login.loggedInMiddleware();

router.use('/group', verifyLoggedInMiddleware, require('./group'));
router.use('/user', verifyLoggedInMiddleware, require('./user'));
router.use('/invite', verifyLoggedInMiddleware, require('./invite'));

router.post('/login', (req, res, next) => {
  const fbUserId = util.sanitizeFirebaseRef(req.body.userId);
  const fbAccessToken = req.body.accessToken;

  const parallelFns = [
    // make sure that the user exists
    function checkUser(callback) {
      api.User.exists({ userId: fbUserId }).then((exists) => {
        if (!exists) {
          const err = new Error(`User ${fbUserId} could not be found`);
          err.statusCode = 404;
          return callback(err);
        }
        return callback();
      }).catch((err) => callback(err));
    },

    // make sure that the access token looks valid
    function checkAccessToken(callback) {
      api.User.verifyAccessToken({
        userId: fbUserId,
        accessToken: fbAccessToken
      }).then((tokenIsValid) => {
        if (!tokenIsValid) {
          const err = new Error(`Invalid access token for user ${fbUserId}`);
          err.statusCode = 403;
          return callback(err);
        }
        return callback();
      }).catch((err) => callback(err));
    }
  ];

  async.parallel(parallelFns, (err) => {
    if (err) return next(err);

    // update the user's access token in the db
    api.User.update({
      userId: fbUserId,
      update: { accessToken: fbAccessToken }
    }).then(() => {
      // once everything checks out, move on to the
      // login middleware
      // set req.data.userId for the login middleware
      req.data.userId = fbUserId;
      return next();
    }).catch((err) => next(err));
  });
}, api.Login.loginMiddleware(), (req, res) => {
  const userId = req.session.userId;
  return res.json({ msg: `Successfully logged in user '${userId}'`});
});

/**
 * @api {post} /register
 * Registers new users
 *
 * @apiParam {string} userId - Facebook user id
 * @apiParam {string} accessToken - Facebook access token
 * @apiParam {string} firstName
 * @apiParam {string} lastName
 * @apiParam {string} photo
 * @apiParam {string} [deviceId] - Client's device ID
 */
router.post('/register', (req, res, next) => {

  // grab facebook user id, access token, and client device id
  const fbUserId = util.sanitizeFirebaseRef(req.body.userId);
  const fbAccessToken = req.body.accessToken;
  const deviceId = req.body.deviceId || null;

  const firstName = req.body.firstName;
  const lastName  = req.body.lastName;
  const fullName  = `${firstName} ${lastName}`;
  const photo = req.body.photo;

  let message = null;
  if(!fbUserId) {
    message = `Must specify valid Facebook user ID \`userId\` - got: '${fbUserId}'`;
  } else if(!fbAccessToken) {
    message = 'Must specify Facebook access token `accessToken`';
  } else if(!firstName) {
    message = 'Must specify a first name `firstName`';
  } else if(!lastName) {
    message = 'Must specify a last name `lastName`';
  } else if(!photo) {
    message = 'Must specify a photo `photo`';
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
