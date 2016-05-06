'use strict';

const _ = require('underscore');
const api    = require('../../lib/api');
const base32 = require('base32');
const util   = require('../../lib/util');
const router = require('express').Router();
const firebase = new (require('firebase'))(process.env.FIREBASE_URL);

/**
 * @api {get} /invite/:code
 * Retrieves the user ID and group ID that correspond to a previously
 * generated invitation code
 *
 * @apiParam {string} code - Invitation code
 */
router.get('/:code', (req, res, next) => {
  const code = util.sanitizeFirebaseRef(req.params.code);
  api.Invite.get({ code: code }).then((invite) => {
    return res.json(invite);
  }).catch((err) => next(err));
});

/**
 * @api {post} /invite
 * Creates an invitation code and sends it back to the caller
 *
 * @apiParam {string} groupId - Group id
 */
router.post('/', (req, res, next) => {
  const groupId = util.sanitizeFirebaseRef(req.body.groupId);
  const inviter = req.session.userId;

  // verify that the group exists and that the inviter
  // is a member of the group
  api.Group.getMembers({ groupId: groupId }).then((members) => {
    const match = _.find(members, (member) => member.id === inviter);
    if (!match) {
      const err = new Error(`User ${inviter} is not a member of group ${groupId}`);
      err.statusCode = 403;
      return next(err);
    }

    api.Invite.create({ groupId: groupId, inviter: inviter})
      .then((code) => res.json({ code: code }))
      .catch((err) => next(err));
  });
});

module.exports = router;
