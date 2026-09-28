// cdp-bg-timer-probe.mjs — chrome inspect（CDP）后台 timer 停摆实证探针
// （background-run-continuity spec §4 门禁用）
// 用法：
//   node scripts/cdp-bg-timer-probe.mjs setup <wsUrl>   注入 2s 周期打点，8s 后打印基线
//   node scripts/cdp-bg-timer-probe.mjs read  <wsUrl>   读取累计 tick、尾段时间戳并做间隔分析
// wsUrl 从 metro inspector 列表 http://localhost:8081/json 取目标页的 webSocketDebuggerUrl
// （真机需先 adb reverse tcp:8081 tcp:8081）。
// 设计：两段独立连接——后台期间 CDP 可能断连，每段重连不影响 app 侧 global 状态。
import {wsConnect} from './cdp-ws-client.mjs';

const mode = process.argv[2];
const wsUrl = process.argv[3];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Origin 白名单（metro inspector proxy）：取 ws url 的 host 部分组成 http origin
const origin = new URL(wsUrl.replace(/^ws/, 'http')).origin;

const ws = await wsConnect(wsUrl, {origin});
console.log('[probe] CDP connected, origin =', origin);

let nextId = 1;
const pending = new Map();
ws.on('message', raw => {
  const msg = JSON.parse(raw);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

function send(method, params) {
  const id = nextId++;
  return new Promise(resolve => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({id, method, params}));
  });
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {expression, returnByValue: true});
  if (res.result?.exceptionDetails) {
    throw new Error('eval exception: ' + JSON.stringify(res.result.exceptionDetails));
  }
  return res.result?.result?.value;
}

if (mode === 'setup') {
  const installed = await evaluate(`(() => {
    if (globalThis.__crProbeId) clearInterval(globalThis.__crProbeId);
    globalThis.__crTicks = [];
    globalThis.__crStartedAt = Date.now();
    globalThis.__crProbeId = setInterval(() => {
      globalThis.__crTicks.push(Date.now());
    }, 2000);
    return 'installed@' + globalThis.__crStartedAt;
  })()`);
  console.log('[probe] 注入完成（2s 周期）:', installed);
  await sleep(8000);
  const state = await evaluate(
    `JSON.stringify({len: globalThis.__crTicks.length, now: Date.now(), startedAt: globalThis.__crStartedAt})`,
  );
  console.log('[probe] 前台基线(8s):', state);
  console.log('[probe] SETUP-OK');
} else if (mode === 'read') {
  const state = await evaluate(
    `JSON.stringify({
      len: globalThis.__crTicks.length,
      now: Date.now(),
      startedAt: globalThis.__crStartedAt,
      all: globalThis.__crTicks || [],
    })`,
  );
  const parsed = JSON.parse(state);
  const spanS = (parsed.now - parsed.startedAt) / 1000;
  console.log(`[probe] 自注入以来 ${spanS.toFixed(1)}s，累计 ticks=${parsed.len}（满速应约 ${Math.round(spanS / 2)}）`);
  const all = [parsed.startedAt, ...parsed.all];
  const gaps = [];
  for (let i = 1; i < all.length; i++) {
    gaps.push((all[i] - all[i - 1]) / 1000);
  }
  const maxGap = gaps.length ? Math.max(...gaps) : 0;
  const maxGapIdx = gaps.indexOf(maxGap);
  const gapLabel = maxGapIdx >= 0 ? new Date(all[maxGapIdx]).toISOString() : 'n/a';
  console.log(`[probe] 最大相邻间隔 = ${maxGap.toFixed(1)}s（起始于 ${gapLabel}）`);
  console.log(`[probe] 尾段 6 个间隔(s): ${gaps.slice(-6).map(g => g.toFixed(1)).join(', ')}`);
  console.log('[probe] READ-OK');
  console.log('===== 判读指引 =====');
  console.log('若最大间隔 ≈ 后台时长（45s+）→ 后台 timer 停摆实证成立');
  console.log('若最大间隔 ≈ 2s（周期本身）→ 后台 timer 未停摆（否定假设）');
} else {
  console.error('用法: node scripts/cdp-bg-timer-probe.mjs <setup|read> <wsUrl>');
  process.exit(1);
}

ws.close();
process.exit(0);
