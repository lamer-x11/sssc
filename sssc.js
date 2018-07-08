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

const inputBufferSize = 1024;
const pingInterval = 30000;
const pongMaxResponseTime = 6000;

const mapIdToName = {};
const mapIdToFd = {};
const mapIdToPresence = {};

const lastMsg = {};
let pongTimeout;

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

  mapIdToName[data.self.id] = data.self.name;
  mapIdToName[data.team.id] = teamName;

  for (let i = 0; i < data.users.length; i++) {
    mapIdToName[data.users[i].id] = data.users[i].name;
  }

  const presenceSubs = [data.self.id];

  const chats = [].concat(
    data.channels,
    data.groups,
    data.ims.map(im => {
      im.name = mapIdToName[im.user];

      if (im.is_open) {
        presenceSubs.push(im.user);
      }

      return im;
    }),
  );

  const socket = new WebSocket(data.url);
  const sendBuffer = {};

  for (let i = 0; i < chats.length; i++) {
    setupChat(socket, sendBuffer, teamName, chats[i]);
  }

  inputProcessInterval = setInterval(() => {
    Object.keys(mapIdToFd).forEach(slackId => {
      const fd = mapIdToFd[slackId];

      fs.read(fd, Buffer.alloc(inputBufferSize), 0, inputBufferSize, null, (error, size, buffer) => {
        if (size > 0) {
          const id = Date.now();

          // remove trailing newlines
          if (size < inputBufferSize) {
            while (size > 0 && buffer[size - 1] === 10) {
              --size;
            }
          }

          const text = buffer.slice(0, size).toString();

          socket.send(JSON.stringify({id, channel: slackId, type: 'message', text}));

          sendBuffer[String(id)] = slackId;
        }
      });
    });
  }, 128);

  socket.on('open', () => {
    console.log('::: connection stablished');

    ping(socket);

    socket.on('pong', () => {
      clearTimeout(pongTimeout);
      ping(socket);
    })
  });

  socket.on('message', (rawMessage) => {
    let message = JSON.parse(rawMessage);

    if (process.env.STDOUT_DUMP !== undefined) {
      process.stdout.write(JSON.stringify(message, null, 2));
    }

    if (message.type === 'hello') {
      socket.send(JSON.stringify({type: 'presence_query', ids: presenceSubs}));
      socket.send(JSON.stringify({type: 'presence_sub', ids: presenceSubs}));
    }

    if (message.type === 'presence_change') {
      mapIdToPresence[message.user] = message.presence;

      fs.writeFileSync(
        `${SESSION_DIR}/${teamName}/user_presence`,
        Object.keys(mapIdToPresence).reduce((agg, id) => {
          agg += `${mapIdToName[id]} ${mapIdToPresence[id]}\n`;

          return agg;
        }, ''),
      );
    }

    if (message.type === 'message') {
      if (message.subtype === 'message_deleted') {
        return;
      }

      if (message.subtype === 'message_changed') {
        const sub = message.message;

        if (lastMsg[sub.user] === sub.text) {
          return;
        }

        sub.text = sub.text;
        sub.channel = message.channel;
        sub.isEdit = true;

        message = sub;
      }

      if (message.text === '' || message.text === undefined) {
        return;
      };

      message.text
        .split('\n')
        .forEach(line => {
          fs.appendFileSync(
            `${SESSION_DIR}/${teamName}/${mapIdToName[message.channel]}/out`,
            `${message.ts} <${mapIdToName[message.user]}> ${message.isEdit ? '(*) ' : ''}${line}\n`,
          );
        });

      lastMsg[message.user] = message.text;

      return;
    }

    if (message.type === 'group_joined' || message.type === 'channel_created') {
      setupChat(socket, sendBuffer, teamName, message.channel);

      return;
    }

    if (sendBuffer[message.reply_to] !== undefined && message.ok === true) {
      fs.appendFileSync(
        `${SESSION_DIR}/${teamName}/${mapIdToName[sendBuffer[message.reply_to]]}/out`,
        `${message.ts} <${userName}> ${message.text}\n`,
      );

      delete sendBuffer[message.reply_to];
      lastMsg[message.user] = message.text;

      return;
    }
  });
});

function setupChat(socket, sendBuffer, teamName, chat) {
  mapIdToName[chat.id] = chat.name;

  if (!fs.existsSync(`${SESSION_DIR}/${teamName}/${chat.name}`)) {
    fs.mkdirSync(`${SESSION_DIR}/${teamName}/${chat.name}`);
    fs.writeFileSync(`${SESSION_DIR}/${teamName}/${chat.name}/out`, '');
    spawnSync('mkfifo',  [`${SESSION_DIR}/${teamName}/${chat.name}/in`]);
  }

  const inFifo = `${SESSION_DIR}/${teamName}/${chat.name}/in`;
  const fd = fs.openSync(inFifo, C.O_RDONLY | C.O_NONBLOCK);

  mapIdToFd[chat.id] = fd;
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

function ping(socket) {
  setTimeout(() => {
    socket.ping();

    pongTimeout = setTimeout(() => {
      console.log('::: ping timeout, shutting down...');

      clearInterval(inputProcessInterval);
      socket.terminate();
      Object.values(mapIdToFd).forEach(fs.closeSync);

      process.exit(1);
    }, pongMaxResponseTime);
  }, pingInterval);
}
