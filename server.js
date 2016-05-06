'use strict';

require('dotenv').config({ silent: true });

const http    = require('http');
const express = require('express');
const bodyParser = require('body-parser');
const session    = require('express-session');
const RedisStore = require('connect-redis')(session);

const app = express();

app.use((req, res, next) => {
  req.data = req.data || {};
  return next();
});

app.use(bodyParser.urlencoded({ extended: true}));
app.use(bodyParser.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  store: new RedisStore({
    url: process.env.REDIS_URL
  }),
  resave: false,
  saveUninitialized: false
}));
app.use(require('./routes'));

app.use((err, req, res, next) => {
  const response = {
    msg: err.message,
    statusCode: err.statusCode
  };
  res.status(err.statusCode || 500).json(response);
});

const port = Number(process.env.PORT || 4000);
const server = http.createServer(app).listen(port, () => {
  let addr = server.address();
  console.log('Listening at port %d', addr.port);
});
