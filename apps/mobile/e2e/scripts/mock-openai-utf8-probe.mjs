// UTF-8 字节伤害探针 mock（openai 协议，:9753）。
// 模式（消息内容带 mode=X 触发，默认模式 A）：
//   A：5 字节/5ms 碎片流（无 8192 边界，已验证：防御有效）
//   B：网关解坏形态——文本直接嵌替换符（已验证：穿透，UI 出乱码）
//   C：200KB 连续中文大流量（跨 ~25 个 RN 原生层 8192 read buffer 边界）
//      + 三组定向对齐：红(E7 BA A2) 分别在 8189/8190/8191 偏移起排，
//      使其 3 字节横跨原生层 read buffer 边界的不同切位。
//
// 运行：node e2e/scripts/mock-openai-utf8-probe.mjs
// 手机侧：adb reverse tcp:9753 tcp:9753，用「测试」服务商发消息。

import http from 'node:http';
import {readFileSync} from 'node:fs';

const REPLAY_PATH = 'D:/tmp/replay-text.txt';

const PORT = 9753;
const BYTES_PER_WRITE = 5;
const DELAY_MS = 5;

// 默认 REPLY 已换成「历史出过问题的原文」回放（replay-text.txt）——普通消息即触发回放落库
const REPLY = (() => {
    try { return readFileSync('D:/tmp/replay-text.txt', 'utf8'); } catch { return '历史回放文本缺失'; }
})();
const _orig_reply = [
    '清晨的山谷里有一层薄薄的雾气，沿着溪水慢慢往上游漂浮。',
    '石阶两侧的蕨类植物沾满露水，脚步经过时会有细小的水珠滚落。',
    '远处的山脊线在雾气后面若隐若现，像一幅没有干透的水墨画。',
    '风从谷口吹进来，带着松针和湿泥土的气味，把雾气搅出几个漩涡。',
    '一只灰蓝色的鸟从低处的灌木里飞起来，掠过溪面，往更高处的林线去了。',
    '阳光穿过雾层之后变得很柔和，落在石头上是一层淡淡的暖色。',
    '溪水在转弯的地方撞出一小片白色的水花，声音不大但一直都在。',
    '路边的野花开得很散，蓝的黄的，一段路能遇到三四种不同的形状。',
    '越往上走雾气越薄，回头看的时候，来时的石阶已经隐进了白色里。',
    '山顶的风明显大了一些，吹得人的外套猎猎作响，也把云层撕开了口子。',
    '从口子里看下去，整条山谷的轮廓一次清楚了起来，溪水变成一条细线。',
    '站在这里能同时看见日出前后的两种光线，一种在山上，一种在谷底。',
].join('\n\n');

const PARA = '夜风从山谷深处吹上来，带着松针与湿泥土的气味，雾气沿着石阶缓缓上浮，远处的山脊在月光下显出一层淡淡的银色轮廓。';

function sseChunk(text) {
    return `data: ${JSON.stringify({ id: 'chatcmpl-utf8probe', object: 'chat.completion.chunk', model: 'utf8-probe', choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`;
}

const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url.includes('/chat/completions')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'utf8-probe: only POST /v1/chat/completions' }));
        return;
    }
    const bodyChunks = [];
    req.on('data', (c) => bodyChunks.push(c));
    req.on('end', () => {
        const bodyText = Buffer.concat(bodyChunks).toString('utf8');
        // 判据只看「最后一条 user 消息」——openai 协议每轮带全部历史，
        // 全文 includes 会被历史里的旧 modeX 消息污染（实测 E/F/G 三轮全走 E）。
        let lastUser = '';
        try {
            const body = JSON.parse(bodyText);
            const msgs = body?.messages ?? [];
            for (let i = msgs.length - 1; i >= 0; i--) {
                if (msgs[i]?.role === 'user') { lastUser = String(msgs[i].content ?? ''); break; }
            }
        } catch { /* 解析失败退回全文 */ lastUser = bodyText; }
        // 大小写不敏感（adb input text 打不出大写字母，真机注入用小写 modeg 即可触发）
        const probeTag = lastUser.toLowerCase();
        const isModeB = probeTag.includes('modeb');
        const isModeC = probeTag.includes('modec');
        const isModeD = probeTag.includes('moded');
        const isModeE = probeTag.includes('modee');
        const isModeF = probeTag.includes('modef');
        const isModeG = probeTag.includes('modeg');
        if (isModeB) console.log('[utf8-probe] mode B: gateway-corrupted text (FFFD chars embedded)');
        if (isModeC) console.log('[utf8-probe] mode C: 200KB mass + 8192-boundary aligned cuts');
        if (isModeD) console.log('[utf8-probe] mode D: historical replay (original text that previously corrupted)');
        if (isModeE) console.log('[utf8-probe] mode E: malformed bytes injected between frames (block-boundary orphan continuation)');
        if (isModeF) console.log('[utf8-probe] mode F: malformed bytes ONLY at frame gaps (JSON intact) — isolate native-layer block-drop vs frame-drop');
        if (isModeG) console.log('[utf8-probe] mode G: malformed bytes INSIDE JSON string values (decoding-layer reach test)');

        let source = REPLY;
        if (isModeD) {
            try {
                source = readFileSync(REPLAY_PATH, 'utf8');
                console.log(`[utf8-probe] mode D: replay ${Buffer.byteLength(source, 'utf8')} bytes of previously-corrupted text`);
            } catch (e) {
                console.log(`[utf8-probe] mode D: replay file missing (${e.message}), fallback A`);
            }
        } else if (isModeB) {
            source = REPLY.replaceAll('一', '￼￼');
        } else if (isModeC) {
            // 真实 delta 形态：与真实智谱流同节奏——每 delta 2~8 字符（随机）、
            // 总量 ~5KB（与真实会话输出同量级）、随机中文内容。
            // delta 边界随机落在多字节字符上的概率与真实流一致。
            let s = '';
            const words = '山雾溪风林石露光鸟水花路云月夜谷针泥色影线声息树草雨雪河流天青白黑前后高低远近深浅快慢';
            while (Buffer.byteLength(s, 'utf8') < 5000) s += words[Math.floor(Math.random() * words.length)];
            source = s + '\n' + REPLY;
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        });
        // 模式 C：真实 delta 形态——每 delta 2~8 字符随机切分；A/B 保持 60 字符段
        let deltas;
        let writeSize, gapMs;
        if (isModeC) {
            deltas = [];
            let i = 0;
            while (i < source.length) {
                const n = 2 + Math.floor(Math.random() * 7);
                deltas.push(source.slice(i, i + n));
                i += n;
            }
            writeSize = BYTES_PER_WRITE;
            gapMs = 3; // ~2-8 字/3ms，接近真实 token 到达节奏（时间压缩 10 倍）
        } else {
            deltas = source.match(/[\s\S]{1,60}/g) ?? [source];
            writeSize = BYTES_PER_WRITE;
            gapMs = DELAY_MS;
        }
        const frames = [
            sseChunk(''),
            ...deltas.map((d) => sseChunk(d)),
            `data: ${JSON.stringify({ id: 'chatcmpl-utf8probe', object: 'chat.completion.chunk', model: 'utf8-probe', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
            'data: [DONE]\n\n',
        ];
        const whole = Buffer.from(frames.join(''), 'utf8');
        // 模式 E：在 SSE 字节流的「帧间缝隙」插入畸形字节——模拟上游网关逐块转发时
        // 把多字节字符切断（第一段尾落在上一块、孤立 continuation 开头落在下一块）。
        // 畸形字节位于原生层 decodeNext 的输入边界附近时：
        //   WHATWG 语义（omz/Node）→ 1 个 FFFD，文本继续，不丢字节；
        //   ProgressiveStringDecoder（RN 原生层，待验证）→ 若回退逻辑只处理尾部截断，
        //   块首畸形会导致整块静默丢弃或 remainder 误标 → UI 缺字/错位。
        let injected = whole;
        if (isModeE) {
            const parts = [];
            const step = 240; // 每 ~240 字节插一对畸形字节（前导尾 + continuation 头）
            for (let i = 0; i < whole.length; i += step) {
                parts.push(whole.subarray(i, Math.min(i + step, whole.length)));
                parts.push(Buffer.from([0xe7]));        // 孤立前导字节（3字节中文的首字节）
                parts.push(Buffer.from([0xba, 0xa2]));  // 孤立 continuation 对
            }
            injected = Buffer.concat(parts);
            console.log(`[utf8-probe] mode E: injected ${(injected.length - whole.length)} malformed bytes into ${whole.length}-byte stream`);
        } else if (isModeF) {
            // 帧缝隙注入：畸形字节只插在「帧结束 \n\n 之后、下一帧 data: 之前」，
            // 所有 JSON 帧保持完整。若合法内容仍缺失 → 原生层整块丢弃实锤；
            // 若零缺失 → mode E 的缺失只是 JSON 被砸坏的正常丢帧代价。
            const parts = [];
            for (const f of frames) {
                parts.push(Buffer.from(f, 'utf8'));
                parts.push(Buffer.from([0xe7, 0xba, 0xa2])); // 孤立「红」的字节三件套
                parts.push(Buffer.from([0xf0, 0x9f]));       // 孤立 4 字节 emoji 前缀
            }
            injected = Buffer.concat(parts);
            console.log(`[utf8-probe] mode F: injected ${(injected.length - whole.length)} malformed bytes at frame gaps only (${frames.length} gaps), JSON intact`);
        } else if (isModeG) {
            // JSON 字符串内部注入：畸形字节插进每帧 content 值的文本中部（远离结构字符）。
            // 判别：
            //   原生层 WHATWG 容错 → 畸形字节变 FFFD 字符（JSON 合法）→ content 带 FFFD 入库
            //     = 历史「2×FFFD」形态复现；
            //   原生层丢块/错位 → JSON 破坏 → 整帧丢弃 = 无声缺失（mode E/F 已见形态）。
            // 逐帧构造：content 字符串按字节切开，中部插入「前段尾 E7 + 后段头 BA A2」。
            const MB = Buffer.from([0xe7, 0xba, 0xa2]); // 「红」的 3 字节，拆用
            const out = [];
            let injectedCount = 0;
            for (const f of frames) {
                const fb = Buffer.from(f, 'utf8');
                // 找 content 值："content":" 后的字符串区中部
                const key = Buffer.from('"content":"', 'utf8');
                const ki = fb.indexOf(key);
                if (ki < 0) { out.push(fb); continue; }
                const strStart = ki + key.length;
                // 找字符串结尾（未转义引号）——简化：从 strStart 往后找第一个 `","` 或 `"}`
                const rest = fb.subarray(strStart);
                const endRel = rest.indexOf('","') >= 0 && (rest.indexOf('","') < rest.indexOf('"}') || rest.indexOf('"}') < 0) ? rest.indexOf('","') : rest.indexOf('"}');
                const strEnd = strStart + (endRel >= 0 ? endRel : rest.length);
                if (strEnd - strStart < 8) { out.push(fb); continue; }
                const mid = strStart + Math.floor((strEnd - strStart) / 2);
                out.push(fb.subarray(0, mid), MB.subarray(1), fb.subarray(mid)); // 孤立 BA A2（前导已切走）= 历史 2×FFFD 形态
                injectedCount++;
            }
            injected = Buffer.concat(out);
            console.log(`[utf8-probe] mode G: injected malformed bytes inside ${injectedCount} JSON string values`);
        }
        const streamBuf = injected;
        let offset = 0;
        const pump = () => {
            if (offset >= streamBuf.length) {
                res.end();
                console.log(`[utf8-probe] stream done: ${streamBuf.length} bytes in ${Math.ceil(streamBuf.length / writeSize)} writes`);
                return;
            }
            const slice = streamBuf.subarray(offset, offset + writeSize);
            offset += slice.length;
            res.write(slice);
            setTimeout(pump, gapMs);
        };
        pump();
    });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[utf8-probe] listening on http://127.0.0.1:${PORT}/v1/chat/completions`);
    console.log(`[utf8-probe] modes: modeA fragments | modeB corrupt chars | modeC real-delta | modeD historical replay`);
});
