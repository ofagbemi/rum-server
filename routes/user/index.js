'use strict';

const _ = require('underscore');
const util = require('../../lib/util');
const async = require('async');
const router = require('express').Router();
const firebase = new (require('firebase'))(process.env.FIREBASE_URL);

/**
 * @api {get} /user/:userId/groups
 * Retrieves the groups that a given user is a member of
 *
 * @apiParam {string} userId - Facebook user ID
 */
router.get('/:userId/groups', (req, res, next) => {
  const userId = util.sanitizeFirebaseRef(req.params.userId);

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
      if (err) return next(err);
      return res.json(groups);
    });

  }, (err) => next(err));
});

module.exports = router;
