'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createTopicflowRouter } = require('./topicflow-app');

const app = express();
const PORT = Number(process.env.PORT || 3004);

app.use(cors());
app.use('/topicflow', createTopicflowRouter());

app.get('/', (req, res) => res.redirect('/topicflow'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`TopicFlow listening on http://0.0.0.0:${PORT}`);
});
