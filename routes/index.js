'use strict';

const _ = require('underscore');
const push = require('../lib/push')
const async = require('async');
const router = require('express').Router();
const firebase = new (require('firebase'))(process.env.FIREBASE_URL);

/**
 * @api {post} /register
 * Registers new users
 *
 * @apiParam {string} userId - Facebook user id
 * @apiParam {string} accessToken - Facebook access token
 * @apiParam {string} deviceId - Client's device ID
 */
router.post('/register', (req, res) => {

  // grab facebook user id, access token, and client device id
  let fbUserId = sanitizeFirebaseRef(req.body.userId);
  let fbAccessToken = req.body.accessToken;
  let deviceId = req.body.deviceId;

  // create a new reference under 'users', set its key to
  // the user id and its values to the access token and
  // device id
  firebase.child(`users/${fbUserId}`).set({
    accessToken: fbAccessToken,
    deviceId: deviceId
  }, (err) => {
    if (err) {
      console.error(err);
      return res.status(500).json(err);
    }
    res.json({
      msg: `Created user '${fbUserId}'`,
      userId: fbUserId
    });
  });
});

/**
 * @api {post} /group
 * Creates a new group
 *
 * @apiParam {string} name - Name of the group
 * @apiParam {string} userId - Facebook user ID of group creator
 */
router.post('/group', (req, res) => {
  let name = req.body.name;

  // TODO: validate user id
  let userId = req.body.userId;

  // create a group with a unique ID
  let groupRef = firebase.child('groups').push();

  // set the value at the unique ID to an object with members
  // 'creator' and 'name'
  groupRef.set({
    creator: userId,
    name: name
  }, (err) => {
    if (err) {
      console.error(err);
      return res.status(500).json(err);
    }

    // after the group is created, create a new array
    // under the group called 'members' and add the creator
    // to it
    let groupId  = groupRef.key();
    firebase.child(`groups/${groupId}/members`).push().set({
      userId: userId
    }, (err) => {
      if (err) {
        console.error(`Error adding member '${userId}' to group '${groupId}'`);
        console.error(err);
        return res.status(500).json(err);
      }
      return res.json({
        msg: `Created group '${groupId}'`,
        groupId: groupId
      });
    });
  });
});

/**
 * @api {put} /group/:groupId
 * Adds a person or people to a group
 *
 * @apiParam {string} groupId - ID of the group to add users to
 * @apiParam {string} userId - Facebook user ID of person to add
 * to the group
 */
router.put('/group/:groupId', (req, res) => {
  let userId = sanitizeFirebaseRef(req.body.userId);
  let groupId = sanitizeFirebaseRef(req.params.groupId);

  // make sure that both the group and the user exist before adding
  // the user to the group
  let parallelFns = {
    userId: (callback) => {
      let userRef = firebase.child(`users/${userId}`);
      userRef.once('value', (snapshot) => {
        if (!snapshot.exists()) {
          return callback(new Error(`Couldn't find group ${groupId}`));
        } else {
          return callback(null, userId);
        }
      });
    },

    groupId: (callback) => {
      let groupRef = firebase.child(`groups/${groupId}`);
      groupRef.once('value', (snapshot) => {
        if (!snapshot.exists()) {
          return callback(new Error({
            msg: `Couldn't find group ${groupId}`
          }));
        } else {
          return callback(null, groupId);
        }
      });
    }
  };

  async.parallel(parallelFns, (err, result) => {
    if (err) {
      return res.status(404).json({
        msg: `Could not add member ${userId} to group ${groupId}`
      });
    }

    let groupRef = firebase.child(`groups/${groupId}`);

    // if the group exists, add a new member
    // to its list of group members
    groupRef.child('members').push().set({
      userId: userId
    }, (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json(err);
      }
      return res.json({
        msg: `Added ${userId} to group ${groupId}`
      });
    });
  });
});

/**
 * @api {get} /user:userId
 * Returns a JSON object representing the user with the passed
 * in ID
 *
 * @apiParam {string} userId - Facebook user id
 */
router.get('/user/:userId', (req, res) => {
  let userId = sanitizeFirebaseRef(req.params.userId);

  firebase.child(`users/${userId}`).once('value', (snapshot) => {
    return res.json(snapshot.val());
  }, (err) => {
    return res.status(500).json(err);
  });
});

router.post('/group/:groupId/complete/:taskId', (req, res) => {
  let groupId = sanitizeFirebaseRef(req.params.groupId);
  let taskId = sanitizeFirebaseRef(req.params.taskId);
  let userId = sanitizeFirebaseRef(req.body.userId);

  let waterfallFns = [
    // start by getting each of the members' user IDs
    function getMemberIds(callback) {
      firebase.child(`/groups/${groupId}`).once('value', (snapshot) => {
        let members = [];
        snapshot.child('members').forEach((memberSnapshot) => {
          let member = memberSnapshot.val();
          members.push(member);
        });
        return callback(null, members);

      }, (err) => callback(err) );
    },

    // guarantee that the completer is actually a member
    // of the group
    function checkCompleter(members, callback) {
      if (!_.find(members, (member) => member.userId === userId )) {
        let err = new Error(`User ${userId} is not a member of group ${groupId}`);
        err.statusCode = 403;
        return callback(err);
      } else {
        return callback(null, members);
      }
    },

    // actually retrieve the user objects for each member
    function getMembers(members, callback) {
      let parallelFns = _.map(members, (member) => {
        return (cb) => {
          firebase.child(`users/${userId}`).once('value', (snapshot) => {
            cb(null, snapshot.val());
          }, (err) => cb(err) );
        };
      });

      async.parallel(parallelFns, (err, users) => {
        if (err) { return callback(err); }
        return callback(null, users);
      });
    },

    // send completion push notifications out to each user
    // in the group
    function sendPushNotifications(users, callback) {
      let message = `${userId} just completed a task`;
      let parallelFns = _.map(users, (user) => {
        return (cb) => {
          push.send({
            category: 'KudosCategory',
            deviceId: user.deviceId,
            sound: 'Hope.aif',
            message: message
          }).then(() => {
            return cb();
          }).catch((err) => {
            return cb(err);
          });
        };
      });

      async.parallel(parallelFns, (err) => {
        if (err) { return callback(err); }
        return callback();
      });
    }
  ];

  async.waterfall(waterfallFns, (err) => {
    if (err) {
      return res.status(err.statusCode || 500).json(err);
    } else {
      return res.json({
        msg: `Successfully marked task '${taskId}' as completed by '${userId}'`
      });
    }
  });
});

function sanitizeFirebaseRef(ref) {
  return ref.replace(/\//g, '');
}

module.exports = router;
