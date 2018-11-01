const express = require('express');
const app = express();
const port = 2000;

app.use(express.static('static'));

app.listen(port, () => {
  console.log('Tactics now running at URL: http://localhost:'+port);
  console.log('');
});
