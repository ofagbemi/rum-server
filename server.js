'use strict';

require('dotenv').config({ silent: true });

const http    = require('http');
const express = require('express');
const exphbs  = require('express-handlebars');
const bodyParser = require('body-parser');

const app = express();

const hbs = exphbs.create({
  defaultLayout: 'main',
  handlebars: require('handlebars'),
  extname: '.hbs'
});
app.engine('.hbs', hbs.engine);
app.set('view engine', '.hbs');

app.use(bodyParser.urlencoded({ extended: true}));
app.use(bodyParser.json());
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
