/**
 * e2e 专用 mock Anthropic provider（宿主回环 :9753）。
 *
 * 为什么需要它：无真模型环境下（模拟器无外网），run 每次都以 ProviderError /
 * 网络超时失败（实测 ~7s），且 console.error 弹 LogBox 抢走整棵 a11y 树——
 * rollback e2e 测的全是 run 失败的副作用而非回滚本身（2026-10-02 用户拍板
 * 改 mock）。本服务对 POST /v1/messages 返回一段**最小合法 SSE 流**（一个
 * text block + end_turn），让 run 干净地成功结束：
 * assistant 回复「mock-reply」入流、aria-label 回「发送」、零 LogBox。
 *
 * 配套（见 tool-turn-session.sql 末尾）：
 * - llm_provider 里 anthropic（builtin_key）的 base_url 改指
 *   http://127.0.0.1:9753，设备侧经 `adb reverse tcp:9753 tcp:9753` 到宿主；
 * - fixture 会话断言不受影响：getMessageIds 只数 user 行，mock 的 assistant
 *   回复入流不参与 T-E1 的 `ids.length === 3` 断言。
 *
 * 运行：node e2e/scripts/mock-anthropic-provider.mjs（与 Metro/relay 同为
 * e2e 环境的宿主侧依赖；Ctrl+C 退出）。
 */
import http from 'node:http';

const PORT = 9753;

function sse(res, event, obj) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(obj)}\n\n`);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.includes('/v1/messages')) {
    res.writeHead(404, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({error: 'e2e mock: only POST /v1/messages'}));
    return;
  }
  // 吃掉请求体（不发也行，但保持连接干净）。
  req.on('data', () => {});
  req.on('end', () => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    });
    sse(res, 'message_start', {
      type: 'message_start',
      message: {
        id: 'msg_e2e_mock',
        type: 'message',
        role: 'assistant',
        model: 'e2e-mock-model',
        content: [],
        stop_reason: null,
        usage: {input_tokens: 12, output_tokens: 1},
      },
    });
    sse(res, 'content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: {type: 'text', text: ''},
    });
    sse(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: {type: 'text_delta', text: 'mock-reply'},
    });
    sse(res, 'content_block_stop', {type: 'content_block_stop', index: 0});
    sse(res, 'message_delta', {
      type: 'message_delta',
      delta: {stop_reason: 'end_turn'},
      usage: {output_tokens: 3},
    });
    sse(res, 'message_stop', {type: 'message_stop'});
    res.end();
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[e2e-mock-provider] listening on http://127.0.0.1:${PORT}/v1/messages (SSE)`);
});
