'use strict';

const api = require('../lib/api');
const util = require('../lib/util');
const async = require('async');
const router = require('express').Router();

const verifyLoggedInMiddleware = api.Login.loggedInMiddleware();

router.use('/group', verifyLoggedInMiddleware, require('./group'));
router.use('/user', verifyLoggedInMiddleware, require('./user'));
router.use('/invite', verifyLoggedInMiddleware, require('./invite'));

/**
 * @api {post} /login
 */
router.post('/login', api.Login.loginMiddleware(), (req, res) => {
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
router.post('/register', api.Login.registerMiddleware(), (req, res) => {
  const userId = req.session.userId;
  return res.json({ msg: `Successfully registered user '${userId}'`});
});

router.post('/logout', (req, res, next) => {
  req.data.userId = req.session.userId;
  return next();
}, api.Login.logoutMiddleware(), (req, res) => {
  const userId = req.body.userId;
  return res.json({ msg: `Successfully logged out user '${userId}'` });
});

module.exports = router;
