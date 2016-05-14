'use strict';

const async = require('async');
const util = require('../../util');
const User = require('../user');
const firebase = require('../../firebase');

const compose = require('compose-middleware').compose;

exports.loginMiddleware = function() {
  return compose([verifyLogin, setSessionCookie]);
};

exports.registerMiddleware = function() {
  return compose([verifyAndRegister, setSessionCookie]);
};

exports.loggedInMiddleware = function() {
  return loggedInMiddleware;
};

exports.logoutMiddleware = function() {
  return logoutMiddleware;
};

function verifyAndRegister(req, res, next) {

  // grab facebook user id, access token, and client device id
  const fbUserId = util.sanitizeFirebaseRef(req.body.userId);
  const fbAccessToken = req.body.accessToken;
  const deviceId = req.body.deviceId || null;

  const firstName = req.body.firstName;
  const lastName  = req.body.lastName;
  const photo = req.body.photo;

  // make sure the user doesn't exist before trying
  // to create their account
  User.exists({ userId: fbUserId }).then((exists) => {
    if (exists) {
      // if the user does exist, then branch off to our
      // login middleware
      return verifyLogin(req, res, next);
    }

    // validate access token before we actually create the user
    User.verifyAccessToken({
      userId: fbUserId, accessToken: fbAccessToken
    }).then((tokenIsValid) => {
      if (!tokenIsValid) {
        const err = new Error(`Invalid access token for user ${fbUserId}`);
        err.statusCode = 403;
        return next(err);
      }
      User.create({
        userId: fbUserId,
        accessToken: fbAccessToken,
        deviceId: deviceId,
        firstName: firstName,
        lastName: lastName,
        photo: photo
      }).then(() => {
        req.data.userId = fbUserId;
        return next();
      }).catch((err) => next(err));
    }).catch((err) => next(err));
  }).catch((err) => next(err));
}

function verifyLogin(req, res, next) {
  const fbUserId = util.sanitizeFirebaseRef(req.body.userId);
  const fbAccessToken = req.body.accessToken;
  const deviceId = req.body.deviceId || null;

  // We want to run these in series to ensure that the client
  // gets back a more informative error -- if the user doesn't
  // exist, then they'll get the 404. If the access token is invalid,
  // they'll get the 403
  const seriesFns = [
    // make sure that the user exists
    function checkUser(callback) {
      User.exists({ userId: fbUserId }).then((exists) => {
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
      User.verifyAccessToken({
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

  async.series(seriesFns, (err) => {
    if (err) return next(err);

    const update = {};
    if (fbAccessToken) update.accessToken = fbAccessToken;
    if (deviceId) update.deviceId = deviceId;

    // update the user's access token in the db
    User.update({
      userId: fbUserId,
      update: update,
    }).then(() => {
      // once everything checks out, move on to the
      // login middleware
      // set req.data.userId for the set cookie middleware
      req.data.userId = fbUserId;
      return next();
    }).catch((err) => next(err));
  });
}

function setSessionCookie(req, res, next) {
  if (req.data && req.data.userId) {
    req.session.userId = req.data.userId;
    return next();
  }
  const err = new Error(`Could not log in user`);
  return next(err);
}

function loggedInMiddleware(req, res, next) {
  if (!req.session.userId) {
    const err = new Error(`User must be logged in to access this resource`);
    err.statusCode = 403;
    return next(err);
  }
  return next();
}

function logoutMiddleware(req, res, next) {
  req.session.destroy();
  return next();
}
