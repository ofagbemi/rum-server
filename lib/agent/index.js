'use strict';

const path = require('path');
const pfx = path.join(__dirname, '../../', process.env.CERTS_PATH);

const apnagent = require('apnagent');

let agent = module.exports = new apnagent.Agent();

agent.set('pfx file', pfx);
agent.enable('sandbox');
agent.connect((err) => {
  if (err) {
    if(err.name === 'GatewayAuthorizationError') {
      console.log(`Auth error: ${err.message}`);
    } else {
      throw err;
    }
  }

  let env = agent.enabled('sandbox') ? 'sandbox' : 'production';
  console.log(`apnagent [${env}] gateway connected`);
});
