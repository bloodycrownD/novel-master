// cdp-probe-clear.mjs — 清理 cdp-bg-timer-probe.mjs 注入的实验打点
// 用法：node scripts/cdp-probe-clear.mjs <wsUrl>
import {wsConnect} from './cdp-ws-client.mjs';
const wsUrl = process.argv[2];
const ws = await wsConnect(wsUrl, {origin: new URL(wsUrl.replace(/^ws/, 'http')).origin});
let id = 1;
const pending = new Map();
ws.on('message', raw => {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
const send = (method, params) =>
  new Promise(r => {
    const i = id++;
    pending.set(i, r);
    ws.send(JSON.stringify({id: i, method, params}));
  });
const res = await send('Runtime.evaluate', {
  expression: `(() => {
    if (globalThis.__crProbeId) { clearInterval(globalThis.__crProbeId); globalThis.__crProbeId = null; }
    return 'cleared, ticks=' + (globalThis.__crTicks || []).length;
  })()`,
  returnByValue: true,
});
console.log('[clear]', JSON.stringify(res.result?.result?.value));
ws.close();
process.exit(0);
