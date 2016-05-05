'use strict';

const _ = require('underscore');
const async = require('async');
const util  = require('../../util');
const User = require('../user');
const firebase = new (require('firebase'))(process.env.FIREBASE_URL);

const DEFAULT_GET_LIMIT = 10;

exports.get = function get(params) {
  return new Promise((resolve, reject) => {
    const groupId = util.sanitizeFirebaseRef(params.groupId);
    firebase.child(`groups/${groupId}`).once('value', (snapshot) => {
      if (!snapshot.exists()) {
        const err = new Error(`Could not find group '${groupId}'`);
        err.statusCode = 404;
        return reject(err);
      }
      resolve(snapshot.val());
    }, (err) => reject(err));
  });
};

/**
 * Retrieves completed tasks for a given group in reverse order of
 * completion
 *
 * @param {string} params.groupId
 * @param {number} params.limit
 */
exports.getCompletedTasks = function getCompletedTasks(params) {
  return _fetchList(params, 'completed');
};

/**
 * Retrieves tasks for a given group in reverse order of creation
 *
 * @param {string} params.groupId
 * @param {number} params.limit
 */
exports.getTasks = function getTasks(params) {
  return _fetchList(params, 'tasks');
};

 /**
  * @param {string} params.groupId
  * @param {number} params.limit
  * @param {string} key - Group member to fetch array for:
  * currently either 'completed' or 'tasks'
  * @returns {Promise}
  */
function _fetchList(params, key) {
  const groupId = util.sanitizeFirebaseRef(params.groupId);
  const limit   = params.limit || DEFAULT_GET_LIMIT;
  return new Promise((resolve, reject) => {
    firebase.child(`groups/${groupId}`).once('value', (snapshot) => {

      // TODO: might not be doing this properly — not sure if its the
      // .val() call that actually pulls down the data from Firebase
      // of if simply requesting the snapshot does. If the former is true,
      // then this should be solid. Otherwise, we may want a more efficient way
      // to determine the group exists.
      if (!snapshot.exists()) {
        const err = new Error(`Could not find group '${groupId}'`);
        err.statusCode = 404;
        return reject(err);
      }

      // get the reference so we can build an ordered
      // query with our limit
      snapshot.child(key).ref()
        .orderByKey()
        .limitToLast(limit)
        .once('value', (tasksSnapshot) => {
          const arr = [];
          tasksSnapshot.forEach((taskSnapshot) => {
            arr.unshift(taskSnapshot.val());
          });
          return resolve(arr);
        }, (err) => reject(err));
    });
  });
}

exports.completeTask = function completeTask(params) {
  const groupId = util.sanitizeFirebaseRef(params.groupId);
  const taskId  = util.sanitizeFirebaseRef(params.taskId);
  const completerId = util.sanitizeFirebaseRef(params.completerId);

  return new Promise((resolve, reject) => {
    const waterfallFns = [
      // start by getting each of the members' user IDs
      function getMemberIds(callback) {
        firebase.child(`groups/${groupId}`).once('value', (snapshot) => {
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
        if (!_.find(members, (member) => member.id === completerId )) {
          const err = new Error(`User ${completerId} is not a member of group ${groupId}`);
          err.statusCode = 403;
          return callback(err);
        } else {
          return callback();
        }
      },

      function moveTask(callback) {
        const taskRef = firebase.child(`groups/${groupId}/tasks/${taskId}`);
        taskRef.once('value', (taskSnapshot) => {
          if (!taskSnapshot.exists()) {
            const err = new Error(`Could not find task ${taskId}`);
            err.statusCode = 404;
            return callback(err);
          }
          const task = taskSnapshot.val();

          // add the task to the group's completed member with
          // a new ID so that we can capture the time of completion
          const completedRef = firebase.child(`groups/${groupId}/completed`).push();
          const completedTask = _.omit(task, 'id');
          completedTask.id = completedRef.key();
          completedRef.set(completedTask, (err) => {
            if (err) return callback(err);
            taskRef.remove((err) => {
              if (err) return callback(err);
              return callback(null, completedTask);
            });
          });
        }, (err) => callback(err));
      },
    ];

    async.waterfall(waterfallFns, (err, task) => {
      if (err) return reject(err);
      return resolve(task);
    });
  });
};

exports.deleteTask = function deleteTask(params) {
  return new Promise((resolve, reject) => {
    const groupId = util.sanitizeFirebaseRef(params.groupId);
    const taskId = util.sanitizeFirebaseRef(params.taskId);

    firebase.child(`groups/${groupId}/tasks/${taskId}`).once('value', (snapshot) => {
      if (!snapshot.exists()) {
        const err = new Error(`Task '${taskId}' could not be found`);
        err.statusCode = 404;
        return reject(err);
      }

      snapshot.ref().remove((err) => {
        if (err) return reject(err);
        return resolve();
      });
    });
  });
};

exports.getMembers = function getMembers(params) {
  return new Promise((resolve, reject) => {
    const groupId = util.sanitizeFirebaseRef(params.groupId);

    firebase.child(`groups/${groupId}`).once('value', (snapshot) => {
      if (!snapshot.exists()) {
        const err = new Error(`Could not find group '${groupId}'`);
        err.statusCode = 404;
        return reject(err);
      }

      const membersSnapshot = snapshot.child('members');
      const parallelFns = [];
      membersSnapshot.forEach((memberSnapshot) => {
        const memberId = memberSnapshot.child('id').val();
        parallelFns.push((callback) => {
          User.get({ userId: memberId })
            .then((user) => callback(null, user))
            .catch((err) => callback(err));
        });
      });
      async.parallel(parallelFns, (err, members) => {
        if (err) return reject(err);
        return resolve(members);
      });
    }, (err) => reject(err));
  });
};

exports.create = function create(params) {
  const creatorId = util.sanitizeFirebaseRef(params.creatorId);
  const name = util.sanitizeFirebaseRef(params.name);

  return new Promise((resolve, reject) => {
    const groupRef = firebase.child('groups').push();
    const groupId  = groupRef.key();

    // set the value at the unique ID to an object with members
    // 'creator' and 'name'
    groupRef.set({
      id: groupId,
      creator: creatorId,
      name: name
    }, (err) => {
      if (err) return reject(err);

      // after the group is created,
      // 1. create a new array under the group called 'members'
      //    and add the creator to it
      // 2. add the group's id to the user's list of groups
      const parallelFns = [
        function addCreatorToMembers(callback) {
          firebase.child(`groups/${groupId}/members`).push().set({
            id: creatorId
          }, (err) => {
            if (err) return callback(err);
            return callback();
          });
        },

        function addGroupToGroups(callback) {
          firebase.child(`users/${creatorId}/groups`).push().set({
            id: groupId
          }, (err) => {
            if (err) return callback(err);
            return callback();
          });
        }
      ];

      async.parallel(parallelFns, (err) => {
        if (err) return reject(err);
        return resolve(groupId);
      });
    });
  });
};

exports.addUserToGroup = function addUserToGroup(params) {
  const userId = util.sanitizeFirebaseRef(params.userId);
  const groupId = util.sanitizeFirebaseRef(params.groupId);

  return new Promise((resolve, reject) => {

    const parallelFns = [
      function checkUserExists(callback) {
        User.exists({ userId: userId }).then((exists) => {
          if (!exists) {
            const err = new Error(`User ${userId} could not be found`);
            err.statusCode = 404;
            return callback(err);
          }
          return callback();
        });
      },

      function checkNotMemberOfGroup(callback) {
        exports.getMembers({ groupId: groupId }).then((members) => {
          const member = _.find(members, (m) => m.id === userId);
          if (member) {
            const err = new Error(`User '${userId}' is already a member of ` +
                                  `group '${groupId}'`);
            err.statusCode = 409; // conflict status code
            return callback(err);
          }
          return callback();
        }, (err) => callback(err));
      }
    ];

    async.parallel(parallelFns, (err) => {
      if (err) return reject(err);

      const fns = [
        function addGroupToUser(callback) {
          User.addGroup({ userId: userId, groupId: groupId })
            .then(() => callback())
            .catch((err) => callback(err));
        },

        function addUserToMembers(callback) {
          // add a new member to the list of group members
          const groupRef = firebase.child(`groups/${groupId}`);
          groupRef.child('members').push().set({ id: userId }, (err) => {
            if (err) return callback(err);
            return callback();
          });
        },
      ];

      async.parallel(fns, (err) => {
        if(err) return reject(err);
        return resolve();
      });
    });
  });
};

exports.exists = function exists(params) {
  const groupId = util.sanitizeFirebaseRef(params.groupId);
  return new Promise((resolve, reject) => {
    firebase.child(`groups/${groupId}`).once('value', (snapshot) => {
      return resolve(snapshot.exists());
    }, (err) => reject(err));
  });
};

exports.remove = function remove(params) {
  return new Promise((resolve, reject) => {
    const groupId = util.sanitizeFirebaseRef(params.groupId);
    const waterfallFns = [
      // start by deleting the reference to this group
      // before we finish, maintain a reference to the members
      // of the group that'll get passed to the next function in the
      // waterfall
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

      // remove this group from each of its members' `groups`
      // variable
      function deleteUsersGroupRefs(members, callback) {
        const memberIds = [];
        _.each(members, (val) => {
          memberIds.push(val.id);
        });

        const parallelFns = _.map(memberIds, (memberId) => {
          return (cb) => {
            User.removeGroup({
              userId: memberId,
              groupId: groupId
            }).then(() => cb())
            .catch((err) => cb(err));
          };
        });

        async.parallel(parallelFns, (err) => {
          if (err) return callback(err);
          return callback();
        });
      }
    ];

    async.waterfall(waterfallFns, (err, result) => {
      if (err) return reject(err);
      return resolve();
    });
  });
};
