#!/usr/bin/env node

const { spawnSync } = require('child_process')
const request = require('request');
const fs = require('fs');
const WebSocket = require('ws');
const C = require('constants');
const path = require('path');

const SESSION_DIR = path.resolve(__dirname, './session');

if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR);
}

const map = {};

callSlackMethod('rtm.start', (data) => {
  if (data.ok === false) {
    process.stderr.write(JSON.stringify(data, null, 2) + '\n');

    return;
  }

  const userName = data.self.name;
  const teamName = data.team.name;

  if (!fs.existsSync(`${SESSION_DIR}/${teamName}`)) {
    fs.mkdirSync(`${SESSION_DIR}/${teamName}`);
  }

  map[data.self.id] = data.self.name;
  map[data.team.id] = teamName;

  for (let i = 0; i < data.users.length; i++) {
    map[data.users[i].id] = data.users[i].name;
  }

  const chats = [].concat(
    data.channels,
    data.groups,
    data.ims.map(im => {
      im.name = map[im.user];

      return im;
    }),
  );

  const socket = new WebSocket(data.url);
  const sendBuffer = {};

  for (let i = 0; i < chats.length; i++) {
    setupChat(socket, sendBuffer, teamName, chats[i]);
  }

  socket.on('message', (rawMessage) => {
    let message = JSON.parse(rawMessage);

    if (message.type === 'message') {
      if (message.subtype === 'message_changed') {
        const sub = message.message;

        sub.text = '(*) ' + sub.text;
        sub.channel = message.channel;

        message = sub;
      }

      fs.appendFileSync(
        `${SESSION_DIR}/${teamName}/${map[message.channel]}/out`,
        `${message.ts} <${map[message.user]}> ${message.text}\n`,
      );

      return;
    }

    if (message.type === 'group_joined' || message.type === 'channel_created') {
      setupChat(socket, sendBuffer, teamName, message.channel);

      return;
    }

    if (sendBuffer[message.reply_to] !== undefined && message.ok === true) {
      fs.appendFileSync(
        `${SESSION_DIR}/${teamName}/${map[sendBuffer[message.reply_to]]}/out`,
        `${message.ts} <${userName}> ${message.text}\n`,
      );

      delete sendBuffer[message.reply_to];

      return;
    }

    process.stdout.write(JSON.stringify(message, null, 2));
  });
});

function setupChat(socket, sendBuffer, teamName, chat) {
  map[chat.id] = chat.name;

  if (!fs.existsSync(`${SESSION_DIR}/${teamName}/${chat.name}`)) {
    fs.mkdirSync(`${SESSION_DIR}/${teamName}/${chat.name}`);
    fs.writeFileSync(`${SESSION_DIR}/${teamName}/${chat.name}/out`, '');
    spawnSync('mkfifo',  [`${SESSION_DIR}/${teamName}/${chat.name}/in`]);
  }

  const inFifo = `${SESSION_DIR}/${teamName}/${chat.name}/in`;
  const fd = fs.openSync(inFifo, C.O_RDONLY | C.O_NONBLOCK);

  setInterval(() => {
    const allocSize = 1024;

    fs.read(fd, Buffer.alloc(allocSize), 0, allocSize, null, (error, size, buffer) => {
      if (size > 0) {
        const id = Date.now();

        // remove trailing newlines
        if (size < allocSize) {
          while (size > 0 && buffer[size - 1] === 10) {
            --size;
          }
        }

        const text = buffer.slice(0, size).toString();

        socket.send(JSON.stringify({id, channel: chat.id, type: 'message', text}));

        sendBuffer[String(id)] = chat.id;
      }
    });
  }, 128);
}

function callSlackMethod(apiMethod, callback = (...args) => {}, params = {}) {
  // @Incomplete: replace external library with a simple https call
  request.get(
    {
      url: `https://slack.com/api/${apiMethod}`,
      qs: Object.assign({}, params, {token: process.env.TOKEN}),
      json: true,
    },
    (error, response, data) => {
      if (error !== null) {
        console.log(error);
        return;
      }

      callback(data, response);
    }
  );
}
