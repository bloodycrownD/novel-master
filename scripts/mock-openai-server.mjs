#!/usr/bin/env node
/**
 * mock-openai-server.mjs —— 零依赖的 OpenAI 兼容 mock 服务器（单文件，Node 18+）
 *
 * 用途：移动端 LLM 请求链路的 bug 复现取证，以及后续 e2e 测试的固定后端。
 * 依赖：仅 Node 内置模块（http / url / crypto；--log-file 落盘另用内置 fs 追加写入），
 *       不安装任何 npm 包，仓库根直接 `node scripts/mock-openai-server.mjs` 即可运行。
 *
 * 端点：
 *   GET  /v1/models            返回固定模型列表（mock-fast / mock-slow / mock-dead）
 *   POST /v1/chat/completions  stream:true 走 SSE，false 走普通 JSON
 *
 * 按模型名编排行为（复现取证的核心）：
 *   mock-fast  高速喷流（固定 2ms/chunk，喷完 --total-tokens 为止）
 *   mock-slow  慢速正常（--interval-ms 每 chunk 间隔）
 *   mock-dead  第 --hang-after N 次请求起挂死：收到请求永不响应，保持连接
 *   其它模型名按 mock-slow 的速率正常响应（日志标注 unknown），方便对照
 *
 * SSE 形态忠实对齐 OpenAI：
 *   - 每个事件形如 `data: {json}\n\n`，逐 chunk 定时下发
 *   - 首个 chunk 带 delta.role，中间 chunk 带固定中文语料切出的 delta.content，
 *     尾 chunk 带 finish_reason:"stop"，最后发一个 usage 字段、choices 为空数组的
 *     chunk（对齐 stream_options.include_usage 的行为，这里无条件发送便于取证）
 *     再发 `data: [DONE]`
 *   - 响应头固定 Content-Type: text/event-stream
 *
 * 日志（判别器核心）：stdout 全量输出；--log-file 可选同步落盘。
 *   - 请求级：时间戳 + 连接 id（自增）+ 请求序号 + 模型名 + stream 与否 +
 *     请求体字节数 + Authorization 前缀
 *   - socket 级：连接建立（含远程地址）/关闭/错误；keep-alive 复用表现为
 *     同一连接 id 上出现第二个请求序号
 *
 * 用法示例：
 *   node scripts/mock-openai-server.mjs
 *   node scripts/mock-openai-server.mjs --port 8787 --interval-ms 200 --total-tokens 64
 *   node scripts/mock-openai-server.mjs --hang-after 2 --no-keepalive --log-file mock.log
 *
 * 移动端接入（取证链路）：
 *   adb reverse tcp:8787 tcp:8787
 *   应用内添加服务商：Base URL http://127.0.0.1:8787/v1，API Key 任意
 *   「拉取模型」后选 mock-fast / mock-slow / mock-dead 观察不同行为
 */

import http from 'node:http';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------- CLI 参数 --

const USAGE = `用法: node scripts/mock-openai-server.mjs [选项]

选项:
  --port <n>            监听端口，默认 8787
  --interval-ms <n>     每个 SSE chunk 的下发间隔（mock-slow / 默认模型），默认 80
  --tokens-per-chunk <n> 每个 chunk 携带的令牌数（中文一字一令牌），默认 4
  --total-tokens <n>    一次回复的总令牌数，默认 256
  --hang-after <n>      mock-dead 第 n 次请求起挂死（收请求不响应保持连接），默认 1
  --no-keepalive        响应带 Connection: close，供对照连接复用实验
  --log-file <path>     日志同步追加写入该文件（可选）
  -h, --help            显示本帮助

模型行为:
  mock-fast   固定 2ms/chunk 高速喷完长文
  mock-slow   按 --interval-ms 慢速正常回包
  mock-dead   第 --hang-after 次请求起挂死（保持连接、永不响应）
  其它模型名  按 --interval-ms 正常回包（日志标注 unknown）`;

const cli = {
  port: 8787,
  intervalMs: 80,
  tokensPerChunk: 4,
  totalTokens: 256,
  hangAfter: 1,
  keepAlive: true,
  logFile: null,
};

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  // 取值型参数统一在这里读下一个 token；越界时给出明确报错
  const value = () => {
    if (i + 1 >= argv.length) {
      console.error(`参数 ${a} 缺少取值`);
      process.exit(1);
    }
    return argv[++i];
  };
  switch (a) {
    case '--port': cli.port = Number(value()); break;
    case '--interval-ms': cli.intervalMs = Number(value()); break;
    case '--tokens-per-chunk': cli.tokensPerChunk = Number(value()); break;
    case '--total-tokens': cli.totalTokens = Number(value()); break;
    case '--hang-after': cli.hangAfter = Number(value()); break;
    case '--log-file': cli.logFile = String(value()); break;
    case '--no-keepalive': cli.keepAlive = false; break;
    case '-h': case '--help': console.log(USAGE); process.exit(0); break;
    default:
      console.error(`未知参数: ${a}\n`);
      console.log(USAGE);
      process.exit(1);
  }
}

for (const [k, v] of [['port', cli.port], ['interval-ms', cli.intervalMs],
  ['tokens-per-chunk', cli.tokensPerChunk], ['total-tokens', cli.totalTokens],
  ['hang-after', cli.hangAfter]]) {
  if (!Number.isFinite(v) || v <= 0) {
    console.error(`参数 --${k} 需要正整数，当前为 ${v}`);
    process.exit(1);
  }
}

// ------------------------------------------------------------------ 日志 --

/** 日志行统一带 ISO 时间戳；同时写 stdout 与可选 --log-file（追加写入） */
function log(line) {
  const entry = `[${new Date().toISOString()}] ${line}`;
  console.log(entry);
  if (cli.logFile) fs.appendFileSync(cli.logFile, entry + '\n');
}

/** Authorization 头只记前 16 个字符，够判别来源又不泄漏完整密钥 */
function authPrefix(req) {
  const h = req.headers.authorization;
  if (!h) return 'auth=(无)';
  return h.length > 16 ? `auth="${h.slice(0, 16)}…"` : `auth="${h}"`;
}

// ---------------------------------------------------------------- 语料/模型 --

// 固定中文语料：一段可重复的长文本，按 --tokens-per-chunk 切片循环取用
const CORPUS =
  '夜色沉下去的时候，写作的人还醒着。窗外的路灯把影子拉得很长，屏幕上的光标一闪一闪，' +
  '像在等一句话落笔。他想起白天走过的巷子，石板路上的青苔、屋檐下躲雨的猫、还有那碗没喝完的汤面，' +
  '热气曾经糊住过眼镜片。故事里的人也在赶路，从一场雨走进另一场雨，口袋里揣着没有寄出的信。' +
  '写到这里他停下来，给自己续了半杯水，键盘声在安静的房间里显得格外清楚。句子有时候不听话，要反复哄，' +
  '像猫；有时候又自己排着队来，拦都拦不住。他不着急了，好故事和夜路一样，走到深处自然有灯。';

/** 把语料重复铺满 totalTokens 个字，再按 tokensPerChunk 切成 chunk 数组 */
function buildChunks(totalTokens, tokensPerChunk) {
  const full = CORPUS.repeat(Math.ceil(totalTokens / CORPUS.length)).slice(0, totalTokens);
  const chunks = [];
  for (let i = 0; i < full.length; i += tokensPerChunk) {
    chunks.push(full.slice(i, i + tokensPerChunk));
  }
  return chunks;
}

// 模型行为表：intervalMs 为 null 表示沿用全局 --interval-ms
const MODELS = {
  'mock-fast': { intervalMs: 2 },
  'mock-slow': { intervalMs: null },
  'mock-dead': { hang: true },
};

const MODELS_PAYLOAD = {
  object: 'list',
  data: Object.keys(MODELS).map((id) => ({
    id,
    object: 'model',
    created: 1700000000,
    owned_by: 'mock',
  })),
};

// ------------------------------------------------------------------ 状态 --

let connSeq = 0;   // 连接 id：socket 建立时自增，keep-alive 复用就看它
let reqSeq = 0;    // 请求序号：每个进入的 HTTP 请求自增
let deadHits = 0;  // mock-dead 的请求计数，--hang-after 以此判定挂死

// ---------------------------------------------------------------- 处理器 --

/** 读取完整请求体（上限 2MB 防呆），Resolve 为 Buffer */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        reject(Object.assign(new Error('请求体超过 2MB 上限'), { code: 413 }));
        req.destroy();
        return;
      }
      parts.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

/** 组一条 chat/completions 流式 chunk（对齐 OpenAI 的 chat.completion.chunk 结构） */
function chunkPayload(id, created, model, delta, finishReason, usage = null) {
  return {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    usage, // 中间 chunk 为 null，最后一个 usage chunk 才带数值
  };
}

/** SSE 流式回复：首 chunk 带 role，中间按速率喷语料，尾 chunk stop，最后 usage + [DONE] */
function respondStream(req, res, model, intervalMs, promptTokens, ctxLine) {
  const chunks = buildChunks(cli.totalTokens, cli.tokensPerChunk);
  const completionTokens = chunks.reduce((n, c) => n + c.length, 0);
  const id = 'chatcmpl-' + randomUUID().replace(/-/g, '').slice(0, 24);
  const created = Math.floor(Date.now() / 1000);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': cli.keepAlive ? 'keep-alive' : 'close',
    'X-Mock-Model': model,
  });
  // 每条事件严格 `data: {json}\n\n`，不用 res.write 之外的封装，形态看得见
  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  log(`${ctxLine} -> SSE 共 ${chunks.length} chunk，间隔 ${intervalMs}ms`);

  let step = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
  };

  const timer = setInterval(() => {
    // 客户端提前断开（取证时常见的 app 超时/取消）也要在日志里留下痕迹
    if (res.destroyed || res.writableEnded) {
      finish();
      log(`${ctxLine} !! 客户端提前断开，流在第 ${step} 步中止`);
      return;
    }
    if (step === 0) {
      send(chunkPayload(id, created, model, { role: 'assistant', content: '' }, null));
    } else if (step <= chunks.length) {
      send(chunkPayload(id, created, model, { content: chunks[step - 1] }, null));
    } else if (step === chunks.length + 1) {
      send(chunkPayload(id, created, model, {}, 'stop'));
    } else {
      // 对齐 stream_options.include_usage：choices 为空数组、usage 带数值，随后 [DONE]
      send({
        id, object: 'chat.completion.chunk', created, model,
        choices: [],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      });
      res.write('data: [DONE]\n\n');
      finish();
      log(`${ctxLine} <- SSE 完成，completion_tokens=${completionTokens}`);
      res.end();
      return;
    }
    step++;
  }, intervalMs);

  // 响应流关闭（连接断开）时停掉定时器，避免向已关闭的 socket 写数据
  res.on('close', () => {
    if (!finished) {
      finish();
      log(`${ctxLine} !! 响应流关闭（未自然结束，第 ${step} 步）`);
    }
  });
}

/** 非流式回复：一次性给完整 JSON */
function respondJson(res, model, promptTokens, ctxLine) {
  const content = buildChunks(cli.totalTokens, cli.tokensPerChunk).join('');
  const body = {
    id: 'chatcmpl-' + randomUUID().replace(/-/g, '').slice(0, 24),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: content.length,
      total_tokens: promptTokens + content.length,
    },
  };
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Connection': cli.keepAlive ? 'keep-alive' : 'close',
    'X-Mock-Model': model,
  });
  res.end(buf);
  log(`${ctxLine} <- JSON 完成，completion_tokens=${content.length}`);
}

/** 粗估 prompt 令牌数：messages 各条 content 的字符数总和（取证够用，不求精确） */
function estimatePromptTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((n, m) =>
    n + (typeof m?.content === 'string' ? m.content.length : JSON.stringify(m?.content ?? '').length), 0);
}

/** POST /v1/chat/completions 主逻辑：解析 -> 按模型编排 -> 流式/非流式 */
async function handleChat(req, res, ctxLine) {
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    log(`${ctxLine} !! 读取请求体失败: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(err.code === 413 ? 413 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: err.message } }));
    }
    return;
  }

  let parsed = null;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    // 请求体不是合法 JSON：对取证很重要，原文前 120 字符记进日志再回 400
    const preview = body.toString('utf8').replace(/\s+/g, ' ').slice(0, 120);
    log(`${ctxLine} !! 请求体不是合法 JSON bytes=${body.length} preview="${preview}"`);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'request body is not valid JSON' } }));
    return;
  }

  const model = typeof parsed.model === 'string' ? parsed.model : '(missing-model)';
  const stream = parsed.stream === true;
  const promptTokens = estimatePromptTokens(parsed.messages);
  const msgCount = Array.isArray(parsed.messages) ? parsed.messages.length : 0;
  const includeUsage = parsed?.stream_options?.include_usage === true;
  log(`${ctxLine} model=${model} stream=${stream} bytes=${body.length} messages=${msgCount} ` +
      `prompt_tokens≈${promptTokens} ${authPrefix(req)} include_usage=${includeUsage}`);

  // ---- mock-dead：第 --hang-after 次请求起挂死（收请求、不响应、保持连接） ----
  if (model === 'mock-dead') {
    deadHits++;
    if (deadHits >= cli.hangAfter) {
      log(`${ctxLine} HANG model=mock-dead 第 ${deadHits} 次请求（--hang-after=${cli.hangAfter}），` +
          `保持连接不响应`);
      // 不 writeHead / 不 end：连接保持，直到客户端自己断开
      res.on('close', () => log(`${ctxLine} HANG 结束：挂死连接被客户端关闭`));
      return;
    }
    log(`${ctxLine} model=mock-dead 第 ${deadHits} 次请求未到 --hang-after=${cli.hangAfter}，正常回包`);
  }

  const behavior = MODELS[model];
  const intervalMs = behavior?.intervalMs ?? cli.intervalMs;
  if (!behavior) log(`${ctxLine} 注意：未知模型 ${model}，按 --interval-ms=${cli.intervalMs} 正常回包`);

  if (stream) {
    respondStream(req, res, model, intervalMs, promptTokens, ctxLine);
  } else {
    respondJson(res, model, promptTokens, ctxLine);
  }
}

// ------------------------------------------------------------------ 服务器 --

const server = http.createServer((req, res) => {
  const connId = req.socket._mockConnId ?? '?';
  const reqId = ++reqSeq;
  const ctxLine = `conn#${connId} req#${reqId} ${req.method} ${req.url}`;

  // 只认 /v1 前缀；其余一律 404（也记日志，方便确认 app 有没有打偏路径）
  if (req.url.split('?')[0] === '/v1/models' && req.method === 'GET') {
    log(`${ctxLine} <- 模型列表 ${Object.keys(MODELS).join(',')}`);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Connection': cli.keepAlive ? 'keep-alive' : 'close',
    });
    res.end(JSON.stringify(MODELS_PAYLOAD));
    return;
  }

  if (req.url.split('?')[0] === '/v1/chat/completions') {
    if (req.method !== 'POST') {
      log(`${ctxLine} !! 方法不允许`);
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
      res.end(JSON.stringify({ error: { message: 'method not allowed' } }));
      return;
    }
    handleChat(req, res, ctxLine).catch((err) => {
      log(`${ctxLine} !! 处理异常: ${err?.stack ?? err}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'internal mock error' } }));
      }
    });
    return;
  }

  log(`${ctxLine} !! 404`);
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: `no route: ${req.method} ${req.url}` } }));
});

// socket 级事件：连接建立/关闭/错误全记录；keep-alive 复用 = 同一 conn# 出现第二个 req#
server.on('connection', (socket) => {
  const connId = ++connSeq;
  socket._mockConnId = connId;
  log(`conn#${connId} 建立 remote=${socket.remoteAddress}:${socket.remotePort}`);
  socket.on('close', () => log(`conn#${connId} 关闭`));
  socket.on('error', (err) => log(`conn#${connId} 错误 ${err.code ?? err.message}`));
});

// 拉长 keep-alive 空闲超时（Node 默认 5s），取证时 app 两次请求间隔略久也能看到复用
server.keepAliveTimeout = 60_000;
// 未知路由吞掉，不让单个坏请求打死服务器进程
server.on('clientError', (err, socket) => {
  log(`clientError ${err.code ?? err.message}`);
  socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});

server.listen(cli.port, '127.0.0.1', () => {
  log(`mock OpenAI 服务器已启动 http://127.0.0.1:${cli.port}/v1`);
  log(`配置: interval-ms=${cli.intervalMs} tokens-per-chunk=${cli.tokensPerChunk} ` +
      `total-tokens=${cli.totalTokens} hang-after=${cli.hangAfter} ` +
      `keepalive=${cli.keepAlive}${cli.logFile ? ` log-file=${cli.logFile}` : ''}`);
  log(`模型: mock-fast(2ms/chunk) mock-slow(${cli.intervalMs}ms/chunk) ` +
      `mock-dead(第${cli.hangAfter}次起挂死)`);
});

// Ctrl+C 优雅退出：停收新连接，把在途日志收个尾
process.on('SIGINT', () => {
  log('收到 SIGINT，服务器关闭');
  server.close(() => process.exit(0));
  // 兜底：1s 后仍有关不掉的连接（比如挂死中的）就强制退出
  setTimeout(() => process.exit(0), 1000).unref();
});
