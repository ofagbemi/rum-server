'use strict';

const _ = require('underscore');
const util = require('../../lib/util');
const async = require('async');
const router = require('express').Router();
const api   = require('../../lib/api');
const firebase = new (require('firebase'))(process.env.FIREBASE_URL);

/**
 * @api {get} /user/:userId
 * Retrieves a given user
 *
 * @apiParam {string} userId - Facebook user ID
 */
router.get('/:userId', (req, res, next) => {
  const userId = util.sanitizeFirebaseRef(req.params.userId);

  const parallelFns = {
    user: (callback) => {
      api.User.get({ userId: userId })
        .then((user) => callback(null, user))
        .catch((err) => callback(err));
    },

    groups: (callback) => {
      api.User.getGroups({userId: userId})
        .then((groups) => callback(null, groups))
        .catch((err) => callback(err));
    }
  };

  async.parallel(parallelFns, (err, result) => {
    if (err) return next(err);

    const response = result.user;
    response.groups = result.groups;
    return res.json(response);
  });
});

module.exports = router;
