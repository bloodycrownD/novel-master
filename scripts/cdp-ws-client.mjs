// cdp-ws-client.mjs — 最小 WebSocket 客户端（RFC6455 客户端侧，支持自定义 Origin）
// 用途：metro inspector proxy 强制校验 Origin（localhost/127.0.0.1 白名单），
// Node 内置 WebSocket 无法设置 Origin header，故手搓。
// 被 cdp-bg-timer-probe.mjs / cdp-probe-clear.mjs 复用。
import http from 'node:http';
import {randomBytes, createHash} from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function wsConnect(urlStr, {origin} = {}) {
  const url = new URL(urlStr);
  const key = randomBytes(16).toString('base64');
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
        ...(origin ? {Origin: origin} : {}),
      },
    });
    req.on('upgrade', (res, socket) => {
      const expect = createHash('sha1').update(key + GUID).digest('base64');
      if (res.headers['sec-websocket-accept'] !== expect) {
        reject(new Error('bad Sec-WebSocket-Accept'));
        return;
      }
      resolve(makeClient(socket));
    });
    req.on('response', res => reject(new Error('handshake failed: HTTP ' + res.statusCode)));
    req.on('error', reject);
    req.end();
  });
}

function makeClient(socket) {
  const listeners = {message: [], close: []};
  let buf = Buffer.alloc(0);
  let frags = [];

  socket.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      if (masked) off += 4;
      if (buf.length < off + len) return;
      let payload = buf.subarray(off, off + len);
      if (masked) {
        const mask = buf.subarray(off - 4, off);
        payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
      }
      buf = buf.subarray(off + len);
      if (opcode === 0x9) {
        sendFrame(socket, 0xa, payload);
        continue;
      }
      if (opcode === 0x8) {
        listeners.close.forEach(f => f());
        socket.end();
        return;
      }
      if (opcode === 0xa) continue;
      if (opcode === 0x1 || opcode === 0x0) {
        frags.push(payload);
        if (fin) {
          const text = Buffer.concat(frags).toString('utf8');
          frags = [];
          listeners.message.forEach(f => f(text));
        }
      }
    }
  });
  socket.on('close', () => listeners.close.forEach(f => f()));
  socket.on('error', () => {});

  return {
    send(text) {
      sendFrame(socket, 0x1, Buffer.from(text, 'utf8'));
    },
    on(ev, fn) {
      listeners[ev].push(fn);
    },
    close() {
      try {
        sendFrame(socket, 0x8, Buffer.alloc(0));
      } catch {}
      socket.end();
    },
  };
}

function sendFrame(socket, opcode, payload) {
  const mask = randomBytes(4);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode;
  const masked = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
  socket.write(Buffer.concat([header, mask, masked]));
}
