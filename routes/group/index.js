'use strict';

const _ = require('underscore');
const async = require('async');
const util  = require('../../lib/util');
const push  = require('../../lib/push');
const api   = require('../../lib/api');
const firebase = new (require('firebase'))(process.env.FIREBASE_URL);

const router = require('express').Router();

router.get('/:groupId', (req, res, next) => {
  const groupId = util.sanitizeFirebaseRef(req.params.groupId);

  const parallelFns = {
    group: (callback) => {
      api.Group.get({ groupId: groupId })
        .then((group) => callback(null, group))
        .catch((err) => callback(err));
    },

    members: (callback) => {
      api.Group.getMembers({ groupId: groupId })
        .then((users) => callback(null, users))
        .catch((err) => callback(err));
    }
  };

  async.parallel(parallelFns, (err, result) => {
    if (err) return next (err);

    const response = result.group;
    response.members = result.members;
    res.json(response);
  });
});

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

  api.Group.create({
    creatorId: userId,
    name: name
  }).then((groupId) => {
    return res.json({
      msg: `Created group '${groupId}'`,
      groupId: groupId
    });
  }).catch((err) => next(err));
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
  api.Group.remove({ groupId: groupId }).then(() => {
    return res.json({
      msg: `Deleted group ${groupId}`
    });
  }).catch((err) => next(err));
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

  if (!title) {
    const err = new Error('No title specified');
    err.statusCode = 400;
    return next(err);
  }

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
        const memberId = memberSnapshot.child('id').val();

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
      const taskId  = taskRef.key();
      taskRef.set({
        title: title,
        creator: creatorId,
        assignedTo: assignedTo,
        id: taskId
      }, (err) => {
        if (err) return callback(err);
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
  const completerId = util.sanitizeFirebaseRef(req.body.userId);

  const parallelFns = {
    task: (callback) => {
      api.Group.completeTask({
        groupId: groupId,
        completerId: completerId,
        taskId: taskId
      }).then((task) => callback(null, task))
      .catch((err) => callback(err));
    },

    members: (callback) => {
      api.Group.getMembers({ groupId: groupId })
        .then((members) => callback(null, members))
        .catch((err) => callback(err));
    }
  };

  async.parallel(parallelFns, (err, result) => {
    if (err) return next(err);

    const task = result.task;
    const members = result.members;

    const message = `${completerId} just completed a task: ${task.title}`;
    const fns = _.map(members, (member) => {
      return (callback) => {
        push.send({
          category: 'KudosCategory',
          deviceId: member.deviceId,
          sound: 'Hope.aif',
          message: message,
          set: { userId: member.id, taskId: task.id }
        }).then(() => callback())
        .catch((err) => callback(err));
      };
    });

    async.parallel(fns, (err) => {
      if (err) return next(err);
      return res.json({
        msg: `Successfully marked task '${taskId}' ` +
             `as completed by '${completerId}'`
      });
    });
  });
});

module.exports = router;
