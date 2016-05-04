'use strict';

const _ = require('underscore');
const async = require('async');
const util  = require('../../util');
const Group = require('../group');
const firebase = new (require('firebase'))(process.env.FIREBASE_URL);

exports.get = function(params) {
  return new Promise((resolve, reject) => {
    const userId = util.sanitizeFirebaseRef(params.userId);
    firebase.child(`users/${userId}`).once('value', (snapshot) => {
      if (!snapshot.exists()) {
        const err = new Error(`User with ID ${userId} could not be found`);
        err.statusCode = 404;
        return reject(err);
      }
      return resolve(snapshot.val());
    });
  });
};

// TODO: add 404 condition
exports.getGroups = function(params) {
  const userId = util.sanitizeFirebaseRef(params.userId);
  return new Promise((resolve, reject) => {
    firebase.child(`users/${userId}/groups`).once('value', (snapshot) => {
      const parallelFns = [];
      snapshot.forEach((groupSnapshot) => {
        const groupId = groupSnapshot.child('id').val();
        parallelFns.push((callback) => {
          Group.get({groupId: groupId})
            .then((group) => callback(null, group))
            .catch((err) => callback(err));
        });
      });

      async.parallel(parallelFns, (err, groups) => {
        if (err) return reject(err);
        return resolve(groups);
      });
    }, (err) => reject(err));
  });
};

exports.removeGroup = function(params) {
  return new Promise((resolve, reject) => {
    const userId = util.sanitizeFirebaseRef(params.userId);
    const groupId = util.sanitizeFirebaseRef(params.groupId);

    firebase.child(`users/${userId}/groups`)
      .orderByChild('id')
      .startAt(groupId)
      .endAt(groupId)
      .limitToFirst(1)
      .once('value', (snapshot) => {
        const key = _.first(_.keys(snapshot.val()));
        snapshot.ref().child(key).remove((err) => {
          if (err) return reject(err);
          return resolve();
        });
      }, (err) => reject(err));
  });
};
