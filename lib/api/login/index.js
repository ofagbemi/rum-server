'use strict';

exports.loginMiddleware = function() {
  return loginMiddleware;
};

exports.loggedInMiddleware = function() {
  return loggedInMiddleware;
};

function loginMiddleware(req, res, next) {
  if (req.data && req.data.userId) {
    req.session.userId = req.data.userId;
    return next();
  }
  const err = new Error(`Could not log in user`);
  return next(err);
}

function loggedInMiddleware(req, res, next) {
  if (!req.session.userId) {
    const err = new Error(`User must be logged in to access this resource`);
    err.statusCode = 403;
    return next(err);
  }
  return next();
}
