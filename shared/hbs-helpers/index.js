'use strict';

exports.head = (options) => {
  this._extend_head = options.fn(this);
  return null;
};
