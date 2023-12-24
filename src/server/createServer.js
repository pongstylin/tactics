import http from 'http';
import https from 'https';
import fs from 'fs';

import config from '#config/server.js';

export default app => {
  if (config.local.secure) {
    const options = {
      key: fs.readFileSync('config/localhost-key.pem'),
      cert: fs.readFileSync('config/localhost.pem'),
    };

    return https.createServer(options, app);
  } else {
    return http.createServer(app);
  }
};
