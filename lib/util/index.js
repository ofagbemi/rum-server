'use strict';

exports.sanitizeFirebaseRef = (ref) => {
  if (ref === null || ref === undefined)  return ref;

  ref = String(ref);
  return ref.replace(/\//g, '');
};
