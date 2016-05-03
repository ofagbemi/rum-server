'use strict';

const qs = require('querystring');
const async = require('async');
const util = require('../../lib/util');
const googl = require('goo.gl');
const router = require('express').Router();
const firebase = new (require('firebase'))(process.env.FIREBASE_URL);

/**
 * @api {get} /invite
 * Loads invitation page for a user and group
 *
 * @apiParam {string} groupId - Group id
 * @apiParam {string} inviter - Facebook user ID
 */
router.get('/', (req, res, next) => {
  const groupId = util.sanitizeFirebaseRef(req.query.groupId);
  const inviterId = util.sanitizeFirebaseRef(req.query.inviter);

  validateInvitation(inviterId, groupId).then((result) => {
    const group = result.group;
    const inviter = result.inviter;

    res.render('invitation', {
      group: group,
      inviter: inviter
    });
  }).catch((err) => {
    return next(err);
  });
});

/**
 * @api {post} /invite
 * Creates an invitation link sends it back to the caller
 *
 * @apiParam {string} groupId - Group id
 * @apiParam {string} inviter - Facebook user ID
 */
router.post('/', (req, res, next) => {
  const groupId = util.sanitizeFirebaseRef(req.body.groupId);
  const inviter = util.sanitizeFirebaseRef(req.body.inviter);

  validateInvitation(inviter, groupId).then(() => {
    // build the url, then shorten it
    const url = `${process.env.APP_URL}/invite?` + qs.stringify({
      groupId: groupId,
      inviter: inviter
    });
    googl.setKey(process.env.GOOGLE_API_KEY);
    googl.shorten(url).then((shortUrl) => {
      return res.json({
        url: shortUrl
      });
    }).catch((err) => next(err));
  }).catch((err) => next(err));
});

function validateInvitation(inviter, groupId) {
  return new Promise((resolve, reject) => {
    // guarantee that both group and inviter exist
    const parallelFns = {
      inviter: function checkInviter(callback) {
        firebase.child(`/users/${inviter}`).once('value', (snapshot) => {
          if (!snapshot.exists()) {
            const err = new Error(`User ${inviter} does not exist`);
            err.statusCode = 404;
            return callback(err);
          }
          return callback(null, snapshot.val());
        });
      },

      group: function checkGroup(callback) {
        firebase.child(`/groups/${groupId}`).once('value', (snapshot) => {
          if (!snapshot.exists()) {
            const err = new Error(`User ${inviter} does not exist`);
            err.statusCode = 404;
            return callback(err);
          }

          // make sure that the inviter is a member of the group
          let found = false;
          snapshot.child('members').forEach((memberSnapshot) => {
            if (memberSnapshot.child('userId').val() === inviter) {
              found = true;
              return callback(null, snapshot.val());
            }
          });

          if (!found) {
            const err = new Error(`User ${inviter} is not a member of group ${groupId}`);
            err.statusCode = 403;
            return callback(err);
          }
        });
      }
    };

    async.parallel(parallelFns, (err, result) => {
      if (err) return reject(err);
      return resolve(result);
    });
  });
}

module.exports = router;
