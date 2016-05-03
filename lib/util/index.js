exports.sanitizeFirebaseRef = (ref) => {
  return ref.replace(/\//g, '');
};
