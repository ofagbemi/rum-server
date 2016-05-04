'use strict';

const _ = require('underscore');
const async = require('async');
const util  = require('../../util');
const User = require('../User');
const firebase = new (require('firebase'))(process.env.FIREBASE_URL);

exports.get = function get(params) {
  return new Promise((resolve, reject) => {
    const groupId = util.sanitizeFirebaseRef(params.groupId);
    firebase.child(`groups/${groupId}`).once('value', (snapshot) => {
      resolve(snapshot.val());
    }, (err) => reject(err));
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

      function getTask(callback) {
        firebase.child(`groups/${groupId}/tasks/${taskId}`).once('value', (snapshot) => {
          if (!snapshot.exists()) {
            const err = new Error(`Could not find task ${taskId}`);
            err.statusCode = 404;
            return callback(err);
          }
          return callback(null, snapshot.val());
        }, (err) => callback(err));
      },

      function removeTask(task, callback) {
        firebase.child(`groups/${groupId}/tasks/${taskId}`).remove((err) => {
          if (err) return callback(err);
          return callback(null, task);
        });
      }
    ];

    async.waterfall(waterfallFns, (err, task) => {
      if (err) return reject(err);
      return resolve(task);
    });
  });
};
