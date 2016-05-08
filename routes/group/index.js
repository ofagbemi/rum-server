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
 */
router.post('/', (req, res, next) => {
  const name = req.body.name;
  const userId = req.session.userId;

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
  const groupId = util.sanitizeFirebaseRef(req.params.groupId);
  const userId  = req.session.userId;

  api.Group.addUserToGroup({ userId: userId, groupId: groupId})
    .then(() => res.json({
      msg: `Successfully added user '${userId}' to group '${groupId}'`
    })).catch((err) => next(err));
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
 * @apiParam {string} title - Title to give the task
 * @apiParam {string} [assignedTo] - ID of the user this task was assigned to
 */
router.post('/:groupId/task', (req, res, next) => {
  const groupId = util.sanitizeFirebaseRef(req.params.groupId);
  const creatorId = req.session.userId;
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

        // cut out early
        if (c && a) return true;
      });

      if (c && a) return callback();

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

router.put('/:groupId/task/:taskId', (req, res, next) => {
  const groupId = util.sanitizeFirebaseRef(req.params.groupId);
  const taskId  = util.sanitizeFirebaseRef(req.params.taskId);

  const update = req.body || {};
  api.Group.updateTask({ taskId: taskId, groupId: groupId, update: update })
    .then(() => res.json({ msg: `Updated task '${taskId}' in group '${groupId}'` }))
    .catch((err) => next(err));
});

/**
 * @api {delete} /group/:groupId/task/:taskId
 * Delete a given task
 *
 * @apiParam {string} groupId
 * @apiParam {string} taskId
 */
router.delete('/:groupId/task/:taskId', (req, res, next) => {
  const groupId = util.sanitizeFirebaseRef(req.params.groupId);
  const taskId  = util.sanitizeFirebaseRef(req.params.taskId);

  api.Group.deleteTask({ taskId: taskId, groupId: groupId })
    .then(() => res.json({ msg: `Deleted task '${taskId}' in group '${groupId}'` }))
    .catch((err) => next(err));
});

/**
 * @api {get} /group/:groupId/completed
 * Retrieves an array of completed tasks
 *
 * @apiParam {string} groupId
 * @apiParam {number} limit
 */
router.get('/:groupId/completed', (req, res, next) => {
  const groupId = util.sanitizeFirebaseRef(req.params.groupId);
  const limit   = parseInt(req.query.limit) || null;

  api.Group.getCompletedTasks({ groupId: groupId, limit: limit })
    .then((data) => res.json(data))
    .catch((err) => next(err));
});

/**
 * @api {get} /group/:groupId/task
 * Retrieves an array of incomplete tasks
 *
 * @apiParam {string} groupId
 * @apiParam {number} limit
 */
router.get('/:groupId/task', (req, res, next) => {
  const groupId = util.sanitizeFirebaseRef(req.params.groupId);
  const limit   = parseInt(req.query.limit) || null;

  api.Group.getTasks({ groupId: groupId, limit: limit })
    .then((data) => res.json(data))
    .catch((err) => next(err));
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
    const completer = _.find(result.members, (m) => m.id === completerId);
    const message = `${completer.firstName} just completed a task: ${task.title}`;
    const fns = _.map(members, (member) => {
      return (callback) => {
        if (!member.deviceId) return callback();

        push.send({
          category: 'KudosCategory',
          deviceId: member.deviceId,
          sound: 'Hope.aif',
          message: message,
          set: { userId: completerId, taskId: task.id }
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
