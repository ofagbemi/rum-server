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

/**
 * @api {post} /user/:userId/kudos
 * Gives kudos to a user
 *
 * @apiParam {string} userId - Facebook user ID
 * @apiParam {number} [number=1] - Number of kudos to give to the
 * specified user
 */
router.post('/:userId/kudos', (req, res, next) => {
  const userId = util.sanitizeFirebaseRef(req.params.userId);
  const number = Math.floor(Number(req.body.number)) || 1;
  api.User.giveKudos({ userId: userId, number: number })
    .then((kudos) => res.json({ kudos: kudos }))
    .catch((err) => next(err));
});

module.exports = router;
