'use strict';

const _ = require('underscore');
const util = require('../../lib/util');
const async = require('async');
const router = require('express').Router();
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
      firebase.child(`users/${userId}`).once('value', (snapshot) => {
        if (!snapshot.exists()) {
          const err = new Error(`User with ID ${userId} could not be found`);
          err.statusCode = 404;
          return callback(err);
        }
        return callback(null, snapshot.val());
      }, (err) => callback(err));
    },

    groups: (callback) => {
      getGroups(userId)
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
 * @api {get} /user/:userId/groups
 * Retrieves the groups that a given user is a member of
 *
 * @apiParam {string} userId - Facebook user ID
 */
router.get('/:userId/groups', (req, res, next) => {
  const userId = util.sanitizeFirebaseRef(req.params.userId);
  getGroups(userId).then((groups) => {
    return res.json({ groups: groups });
  }).catch((err) => next(err));
});

/**
 * Yields an array of group objects
 *
 * @param {string} userId
 */
function getGroups(userId) {
  return new Promise((resolve, reject) => {
    userId = util.sanitizeFirebaseRef(userId);

    // grab a snapshot of all of the user's groups
    firebase.child(`users/${userId}/groups`).once('value', (snapshot) => {

      // retrieve each individual group in parallel
      const parallelFns = [];
      snapshot.forEach((groupIdSnapshot) => {
        const groupId = groupIdSnapshot.child('groupId').val();
        parallelFns.push((callback) => {
          firebase.child(`groups/${groupId}`).once('value', (snap) => {
            // add id member to each of the groups, since it'll
            // be stored in an array
            return callback(null, snap.val());
          }, (err) => callback(err));
        });
      });

      async.parallel(parallelFns, (err, groups) => {
        if (err) return reject(err);
        return resolve(groups);
      });

    }, (err) => reject(err));
  });
}

module.exports = router;
