'use strict';

const _ = require('underscore');
const qs = require('querystring');
const async = require('async');
const util  = require('../../util');
const Group = require('../group');
const request = require('request');
const firebase = new (require('firebase'))(process.env.FIREBASE_URL);

const facebookDebugTokenEndpoint = 'https://graph.facebook.com/debug_token';

function get404(params) {
  const userId = params.userId;
  const err = new Error(`User with ID ${userId} could not be found`);
  err.statusCode = 404;
  return err;
}

/**
 * Checks that a provided access token is valid for a given
 * user ID
 *
 * @param {string} params.accessToken
 * @param {string} params.userId
 *
 * Returns a Promise that resolves with `true` if the token is
 * valid and `false` otherwise
 */
exports.verifyAccessToken = function verifyAccessToken(params) {
  const accessToken = params.accessToken;
  const userId = params.userId;

  return new Promise((resolve, reject) => {
    const query = qs.stringify({
      input_token: accessToken,
      access_token: `${process.env.FB_APP_ID}|${process.env.FB_APP_SECRET}`
    });

    const url = `${facebookDebugTokenEndpoint}/?${query}`;
    request.get(url, (err, response, body) => {
      if (err) return reject(err);

      // don't crash the server if something goes wrong
      let json = null;
      let jsonError = null;
      try {
        json = JSON.parse(body);
      } catch (e) { err = jsonError; }

      if (!json) return reject(jsonError);

      return resolve(userId === json.data.user_id);
    });
  });
};

exports.get = function(params) {
  return new Promise((resolve, reject) => {
    const userId = util.sanitizeFirebaseRef(params.userId);
    firebase.child(`users/${userId}`).once('value', (snapshot) => {
      if (!snapshot.exists()) {
        return reject(get404({ userId: userId }));
      }
      return resolve(snapshot.val());
    });
  });
};

exports.giveKudos = function(params) {
  return new Promise((resolve, reject) => {
    const userId = util.sanitizeFirebaseRef(params.userId);
    const kudos = Math.floor(Number(params.number)) || 1;

    firebase.child(`users/${userId}`).once('value', (snapshot) => {
      if (!snapshot.exists()) {
        return reject(get404({ userId: userId }));
      }
      snapshot.ref().child('kudos').transaction((current) => {
        return (current || 0) + kudos;
      }, (err, committed, kudosSnapshot) => {
        if (err) return reject(err);
        return resolve(kudosSnapshot.val());
      });
    });
  });
};

exports.getGroups = function(params) {
  const userId = util.sanitizeFirebaseRef(params.userId);
  return new Promise((resolve, reject) => {
    firebase.child(`users/${userId}`).once('value', (snapshot) => {
      if (!snapshot.exists()) {
        return reject(get404({ userId: userId }));
      }

      const groupsSnapshot = snapshot.child('groups');
      const parallelFns = [];
      groupsSnapshot.forEach((groupSnapshot) => {
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

exports.create = function(params) {
  return new Promise((resolve, reject) => {
    const userId = params.userId;
    const accessToken = params.accessToken;
    const deviceId = params.deviceId || null;
    const firstName = params.firstName;
    const lastName = params.lastName;
    const fullName = `${firstName} ${lastName}`;
    const photo = params.photo;

    let message = null;
    if(!userId) {
      message = `Must specify valid Facebook user ID \`userId\` - got: '${userId}'`;
    } else if(!accessToken) {
      message = 'Must specify Facebook access token `accessToken`';
    } else if(!firstName) {
      message = 'Must specify a first name `firstName`';
    } else if(!lastName) {
      message = 'Must specify a last name `lastName`';
    } else if(!photo) {
      message = 'Must specify a photo `photo`';
    }

    if (message) {
      const err = new Error(message);
      err.statusCode = 400;
      return reject(err);
    }

    firebase.child(`users/${userId}`).set({
      id: userId,
      accessToken: accessToken,
      deviceId: deviceId,
      firstName: firstName,
      lastName: lastName,
      fullName: fullName,
      photo: photo
    }, (err) => {
      if (err) return reject(err);
      return resolve();
    });
  });
};

exports.update = function(params) {
  const userId = util.sanitizeFirebaseRef(params.userId);
  const update = params.update || {};
  return new Promise((resolve, reject) => {
    firebase.child(`users/${userId}`).update(update, (err) => {
      if (err) return reject(err);
      return resolve();
    });
  });
};

exports.addGroup = function(params) {
  return new Promise((resolve, reject) => {
    const userId = util.sanitizeFirebaseRef(params.userId);
    const groupId = util.sanitizeFirebaseRef(params.groupId);

    firebase.child(`users/${userId}`).once('value', (userSnapshot) => {
      if (!userSnapshot.exists()) return reject(get404({ userId: userId }));
      const groupsRef = userSnapshot.child('groups').ref();
      groupsRef.push().set({
        id: groupId
      }, (err) => {
        if (err) return reject(err);
        return resolve();
      });
    });
  });
};

exports.exists = function(params) {
  const userId = util.sanitizeFirebaseRef(params.userId);
  return new Promise((resolve, reject) => {
    firebase.child(`users/${userId}`).once('value', (snapshot) => {
      return resolve(snapshot.exists());
    }, (err) => reject(err));
  });
};
