'use strict';

const _ = require('underscore');
const async = require('async');
const util  = require('../../lib/util');
const push  = require('../../lib/push');
const firebase = new (require('firebase'))(process.env.FIREBASE_URL);

const router = require('express').Router();

/**
 * @api {post} /group
 * Creates a new group
 *
 * @apiParam {string} name - Name of the group
 * @apiParam {string} userId - Facebook user ID of group creator
 */
router.post('/', (req, res, next) => {
  const name = req.body.name;

  // TODO: validate user id
  const userId = req.body.userId;

  // create a group with a unique ID
  const groupRef = firebase.child('groups').push();
  const groupId  = groupRef.key();

  // set the value at the unique ID to an object with members
  // 'creator' and 'name'
  groupRef.set({
    id: groupId,
    creator: userId,
    name: name
  }, (err) => {
    if (err) return next(err);

    // after the group is created,
    // 1. create a new array under the group called 'members'
    //    and add the creator to it
    // 2. add the group's id to the user's list of groups
    const parallelFns = [
      function addCreatorToMembers(callback) {
        firebase.child(`groups/${groupId}/members`).push().set({
          userId: userId
        }, (err) => {
          if (err) return callback(err);
          return callback();
        });
      },

      function addGroupToGroups(callback) {
        firebase.child(`users/${userId}/groups`).push().set({
          groupId: groupId
        }, (err) => {
          if (err) return callback(err);
          return callback();
        });
      }
    ];

    async.parallel(parallelFns, (err) => {
      if (err) return next(err);
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
router.put('/:groupId', (req, res, next) => {
  const userId = util.sanitizeFirebaseRef(req.body.userId);
  const groupId = util.sanitizeFirebaseRef(req.params.groupId);

  // make sure that both the group and the user exist before adding
  // the user to the group
  const parallelFns = {
    userId: (callback) => {
      const userRef = firebase.child(`users/${userId}`);
      userRef.once('value', (snapshot) => {
        if (!snapshot.exists()) {
          return callback(new Error(`Couldn't find group ${groupId}`));
        } else {
          return callback(null, userId);
        }
      });
    },

    groupId: (callback) => {
      const groupRef = firebase.child(`groups/${groupId}`);
      groupRef.once('value', (snapshot) => {
        if (!snapshot.exists()) {
          return callback(new Error(`Couldn't find group ${groupId}`));
        } else {
          return callback(null, groupId);
        }
      });
    }
  };

  async.parallel(parallelFns, (err, result) => {
    if (err) return next(err);

    const groupRef = firebase.child(`groups/${groupId}`);

    // if the group exists, add a new member
    // to its list of group members
    groupRef.child('members').push().set({
      userId: userId
    }, (err) => {
      if (err) return next(err);
      return res.json(`Added ${userId} to group ${groupId}`);
    });
  });
});

/**
 * @api {delete} /group/:groupId
 * Deletes a group
 *
 * @apiParam {string} groupId - ID of the group
 */
router.delete('/:groupId', (req, res, next) => {
  const groupId = util.sanitizeFirebaseRef(req.params.groupId);

  const waterfallFns = [
    function deleteGroupRef(callback) {
      firebase.child(`groups/${groupId}/members`).once('value', (membersSnapshot) => {
        firebase.child(`groups/${groupId}`).remove((err) => {
          if (err) return callback(err);
          return callback(null, membersSnapshot.val());
        });
      }, (err) => {
        if (err) return callback(err);
      });
    },

    function deleteUsersGroupRefs(members, callback) {
      const memberIds = [];
      _.each(members, (val) => {
        memberIds.push(val.userId);
      });

      const parallelFns = _.map(memberIds, (memberId) => {
        return (cb) => {
          console.log(groupId);
          firebase.child(`users/${memberId}/groups`)
            .orderByChild('groupId')
            .startAt(groupId)
            .endAt(groupId)
            .limitToFirst(1)
            .once('value', (snapshot) => {
              const key = _.first(_.keys(snapshot.val()));
              snapshot.ref().child(key).remove((err) => {
                if (err) return cb(err);
                return cb();
              });
            }, (err) => cb(err));
        };
      });

      async.parallel(parallelFns, (err) => {
        if (err) return callback(err);
        return callback();
      });
    }
  ];

  async.waterfall(waterfallFns, (err, result) => {
    if (err) return next(err);
    return res.json({
      msg: `Deleted group ${groupId}`
    });
  });
});

/**
 * @api {post} /group/:groupId/task
 * Creates a task and adds it to a group
 *
 * @apiParam {string} groupId - ID of the group
 * @apiParam {string} creator - Facebook user ID of the person who created
 * the task
 * @apiParam {string} [assignedTo] - ID of the user this task was assigned to
 */
router.post('/:groupId/task', (req, res, next) => {
  const groupId = util.sanitizeFirebaseRef(req.params.groupId);
  const creatorId = util.sanitizeFirebaseRef(req.body.creator);
  const assignedTo = req.body.assignedTo ?
    util.sanitizeFirebaseRef(req.body.assignedTo) : null;

  // TODO: store this in such a way that the verb tense can be
  // changed easily (e.g. 'Clean the dishes' --> 'Cleaned the dishes')
  const title = req.body.title;

  const waterfallFns = [
    function loadSnapshot(callback) {
      firebase.child(`/groups/${groupId}`).once(
        'value', (snapshot) => callback(null, snapshot), (err) => callback(err)
      );
    },

    function checkCreator(groupSnapshot, callback) {
      // guarantee that the creator and assignedTo are members of the group
      let c = false;
      let a = assignedTo === null;
      groupSnapshot.child('members').forEach((memberSnapshot) => {
        const memberId = memberSnapshot.child('userId').val();

        if (memberId === creatorId) c = true;
        if (memberId === assignedTo) a = true;

        if (c && a) return callback(null);
      });

      // already called callback
      if (c && a) return;

      const err = new Error(`User ${creatorId} not in group ${groupId}`);
      err.statusCode = 403;
      return callback(err);
    },

    function createTask(callback) {
      const taskRef = firebase.child(`groups/${groupId}/tasks`).push();
      taskRef.set({
        title: title,
        creator: creatorId,
        assignedTo: assignedTo
      }, (err) => {
        if (err) return callback(err);

        const taskId = taskRef.key();
        return callback(null, { taskId: taskId });
      });
    }
  ];

  async.waterfall(waterfallFns, (err, result) => {
    if (err) return next(err);
    return res.json(result);
  });
});

/**
 * @api {post} /group/:groupId/complete/:taskId
 * Marks a task as completed and sends push notifications to the task's
 * group members
 *
 * @apiParam {string} groupId - ID of the group
 * @apiParam {string} taskId - ID of the completed task
 * @apiParam {string} userId - Facebook user ID of the person who completed
 * the task
 */
router.post('/:groupId/complete/:taskId', (req, res, next) => {
  const groupId = util.sanitizeFirebaseRef(req.params.groupId);
  const taskId = util.sanitizeFirebaseRef(req.params.taskId);
  const userId = util.sanitizeFirebaseRef(req.body.userId);

  const waterfallFns = [
    // start by getting each of the members' user IDs
    function getMemberIds(callback) {
      firebase.child(`/groups/${groupId}`).once('value', (snapshot) => {
        const members = [];
        snapshot.child('members').forEach((memberSnapshot) => {
          const member = memberSnapshot.val();
          members.push(member);
        });
        return callback(null, members);

      }, (err) => callback(err) );
    },

    // guarantee that the completer is actually a member
    // of the group
    function checkCompleter(members, callback) {
      if (!_.find(members, (member) => member.userId === userId )) {
        const err = new Error(`User ${userId} is not a member of group ${groupId}`);
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
        if (err) return callback(err);
        return callback(null, users);
      });
    },

    // send completion push notifications out to each user
    // in the group
    function sendPushNotifications(users, callback) {
      const message = `${userId} just completed a task`;
      const parallelFns = _.map(users, (user) => {
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
    if (err)  return next(err);
    return res.json({
      msg: `Successfully marked task '${taskId}' as completed by '${userId}'`
    });
  });
});

module.exports = router;
