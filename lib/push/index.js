'use strict';

let agent = require('../agent');

exports.send = function(params) {
  let deviceId = params.deviceId;
  let category = params.category;
  let message = params.message;
  let sound = 'Hope.aif';

  return new Promise((resolve, reject) => {
    agent.createMessage()
      .device(deviceId)
      .category(category)
      .alert(message)
      .badge(1)
      .sound(sound)
      .send((err) => {
        if (err) { return reject(err); }
        else { return resolve(); }
      });
  });
};
