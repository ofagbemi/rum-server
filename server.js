'use strict';

require('dotenv').config();

const http    = require('http');
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.urlencoded({ extended: true}));
app.use(require('./routes'));

const port = Number(process.env.PORT || 4000);
const server = http.createServer(app).listen(port, () => {
  let addr = server.address();
  console.log('Listening at port %d', addr.port);
});
