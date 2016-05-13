'use strict';

const base32 = require('base32');
const util  = require('../../util');
const firebase = require('../../firebase');

exports.create = function create(params) {
  const inviter = util.sanitizeFirebaseRef(params.inviter);
  const groupId = util.sanitizeFirebaseRef(params.groupId);
  return new Promise((resolve, reject) => {
    const code = generateInviteCode({ inviter: inviter, groupId: groupId });
    firebase.child(`invites/${code}`).set({
      code: code,
      groupId: groupId,
      inviter: inviter
    }, (err) => {
      if (err) return reject(err);
      return resolve(code);
    });
  });
};

exports.get = function get(params) {
  const code = util.sanitizeFirebaseRef(params.code);
  return new Promise((resolve, reject) => {
    firebase.child(`invites/${code}`).once('value', (snapshot) => {
      if (!snapshot.exists()) {
        const err = new Error(`Invitation with code '${code}' could not be found`);
        err.statusCode = 404;
        return reject(err);
      }
      return resolve(snapshot.val());
    }, (err) => reject(err));
  });
};

function generateInviteCode(params) {
  const inviter = params.inviter;
  const groupId = params.groupId;

  // generate ~kinda~ unique code [0-9A-Z]
  return base32.sha1(inviter + groupId).substring(0, 5).toUpperCase();
}
