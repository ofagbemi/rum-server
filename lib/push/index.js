'use strict';

const _ = require('underscore');
const agent = require('../agent');

exports.send = function(params) {
  let deviceId = params.deviceId;
  let category = params.category;
  let message = params.message;
  let set = params.set || {};
  let sound = 'Hope.aif';

  return new Promise((resolve, reject) => {
    const msg = agent.createMessage()
      .device(deviceId)
      .category(category)
      .alert(message)
      .badge(1)
      .sound(sound);

    _.each(set, (value, key) => {
      msg.set(key, value);
    });

    msg.send((err) => {
      if (err) { return reject(err); }
      else { return resolve(); }
    });
  });
};
