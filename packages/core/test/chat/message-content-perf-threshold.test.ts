/**
 * 稳态读性能护栏（T-MP-P0）。
 *
 * 本文件原先的两条正向护栏（尾加载含解压 vs 明文 ×25、单批压缩 vs 明文
 * ×25）随 message-plaintext 迭代退役：它护的是「压缩写路径不该太慢」，
 * 而全库明文化之后压缩写路径已不存在（正向任务 Step 3 整文件删除），
 * 护栏对象本身没了。取而代之的是本文件唯一一条护栏——**明文化对稳态读
 * 是纯收益**，这是该主张唯一的自动证据。
 *
 * 口径：同一 fixture 造两个形态的库（条数/条体量/角色分布完全一致，唯一
 * 差别是存储形态），各跑一次 tail 加载：
 * - 压缩形态基线 = SQL 取压缩字节 + zlib inflate（本迭代之前每次读的真实
 *   代价，**没有进程内解压缓存**——那个消息正文池已随本迭代删除，所以这里
 *   测到的就是纯 inflate 成本，是压缩形态的真实读代价，不被缓存美化）；
 * - 明文形态 = SQL 取明文字节 + JSON.parse。
 * 断言：明文耗时 ≤ 压缩基线 × 1（倍数写死防漂移），另设绝对预算上限
 * （`ABSOLUTE_BUDGET_MS`）兜环境噪声——全量测试并行时两侧会一起被拖慢，
 * 毫秒差本身没有意义，只有相对关系稳定。
 *
 * 倍数取 1 而非更紧的 0.9：SQL 取字节在明文形态是 2-3×，抵消掉 inflate
 * 的节省后净收益有限（消费处矩阵 #1 的口径），个别机器上两侧可能持平。
 * 1 是「不许劣化」这条主张的最强可执行表达——对齐 RULE「性能护栏取
 * 数量级回归线」：卡数量级（不许慢），不卡小数点（不拿环境噪声当回归）。
 * 绝对预算上限保证「压缩基线本身被打扰到极慢」时不会把倍数放大成假绿。
 *
 * 基线构造方式：压缩基线行**不经生产 API**——明文化后 `batchInsert` 只写
 * 明文、正向压缩任务即将删除，已无生产 API 能造压缩行。用 `compressZlib`
 * （`@/domain/vfs/content-store/logic/zlib-codec`）+ 裸
 * `INSERT INTO chat_message` 直造，与生产写路径解耦。
 *
 * @module test/chat/message-content-perf-threshold
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import {
  compressZlib,
  VFS_CONTENT_ENCODING_ZLIB,
} from "../../src/domain/vfs/content-store/logic/zlib-codec.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";

novelMasterTestFixture();

/** 20KB 量级中文正文（对齐重度长会话单条消息体量）。 */
function largeTextBody(): string {
  return `二十KB量级的中文正文样本。${"云舟渡口灯火渐起，少年负剑西行。".repeat(
    512
  )}`;
}

/** tail 加载的条数（对齐原 T-C11 的 40 条 × 20KB）。 */
const ROWS = 40;

/**
 * 绝对预算上限：任一形态的 tail 耗时超过它就失败，不参与倍数比较。
 *
 * 兜的是「压缩基线侧被环境噪声拖到极慢」导致倍数比较失去意义的情形
 * （基线虚高 ⇒ 明文实测耗时轻易落在 ×1 内 ⇒ 护栏假绿）。取 5000ms：
 * 40 条 × 20KB 的空载实测在毫秒量级，5000ms 是三四个数量级的余量，
 * 只有真正卡死/严重换页才会触顶。
 */
const ABSOLUTE_BUDGET_MS = 5000;

/** 明文耗时相对压缩基线的允许倍数（1 = 不许劣化）。 */
const MAX_RATIO = 1;

/**
 * 倍数比较的毫秒下限：`Date.now()` 精度与调度抖动地板。
 *
 * 40 条 × 20KB 的 inflate 空载实测在十几毫秒量级，基线取到 0 的概率极低；
 * 但真取到 0 时「明文 ≤ 0 × 1」会把毫秒精度噪声判成回归（假红）。5ms
 * 远小于实测量级，只用来吸收精度地板，不构成实质放宽。
 */
const RATIO_FLOOR_MS = 5;

/**
 * 两侧夹具共用的 role 序列（T-MP-P0：护栏同构前提）。
 *
 * 压缩基线侧与明文侧必须逐行同 role——role 一旦进读路径（例如按 role
 * 过滤/拼接），两侧不同构就会让护栏的「唯一差别是存储形态」失真，劣化
 * 静默通过。故此处抽成单一函数，两侧都调它，不允许各写一份表达式。
 */
function roleAt(index: number): ChatMessage["role"] {
  return index % 2 === 0 ? "assistant" : "user";
}

/**
 * 裸 INSERT 造一条压缩形态行（不经生产写路径：明文化后无 API 可造）。
 *
 * 形态与生产写侧逐字对齐：content_json 置空串、content_encoding='zlib'、
 * content_blob 为二进制 zlib 字节。role 走与明文侧同一序列（见 roleAt）。
 */
async function insertCompressedRow(args: {
  sessionId: string;
  seq: number;
  blocksJson: string;
  role: ChatMessage["role"];
}): Promise<void> {
  const ctx = getNovelMasterTestContext();
  const blob = compressZlib(new TextEncoder().encode(args.blocksJson));
  await ctx.conn.execute(
    `INSERT INTO chat_message (
       id, session_id, seq, role, content_json, content_encoding, content_blob,
       created_at_ms, hidden
     ) VALUES (?, ?, ?, ?, '', ?, ?, ?, 0)`,
    [
      randomUUID(),
      args.sessionId,
      args.seq,
      args.role,
      VFS_CONTENT_ENCODING_ZLIB,
      blob,
      Date.now() + args.seq,
    ]
  );
}

/** 计时一次 tail 加载（返回消息条数与耗时，供调用方断言内容与耗时）。 */
async function timeTail(
  sessionId: string
): Promise<{ count: number; ms: number }> {
  const repo = new SqliteMessageRepository(getNovelMasterTestContext().conn);
  // 预热一次（JIT / SQLite 页缓存），再计时取稳定值。
  await repo.listBySessionTail(sessionId, ROWS);
  const t0 = Date.now();
  const tail = await repo.listBySessionTail(sessionId, ROWS);
  return { count: tail.length, ms: Date.now() - t0 };
}

describe("稳态读性能护栏（T-MP-P0：明文化对读是纯收益）", () => {
  it(`${ROWS} 条 × 20KB tail 加载：明文形态耗时不劣化于压缩形态基线（含 inflate）`, async () => {
    const ctx = getNovelMasterTestContext();
    const body = largeTextBody();
    const blocksJson = JSON.stringify({ blocks: [{ type: "text", text: body }] });

    // 压缩形态基线库：裸 INSERT 造 40 条压缩行。消息解压池已随本迭代
    // 删除，故每次读都实打实付 inflate——这正是压缩形态的真实读代价。
    const compressedProject = await ctx.projects.create(
      `P-${testIsolationSuffix()}`
    );
    const compressedSession = await ctx.sessions.create(
      compressedProject.id,
      `S-${testIsolationSuffix()}`
    );
    for (let i = 1; i <= ROWS; i++) {
      await insertCompressedRow({
        sessionId: compressedSession.id,
        seq: i,
        blocksJson,
        role: roleAt(i),
      });
    }
    const compressed = await timeTail(compressedSession.id);
    assert.equal(compressed.count, ROWS, "压缩基线库应读到 40 条");

    // 明文形态库：走生产写路径（batchInsert 直写明文）。
    const plainProject = await ctx.projects.create(
      `P-${testIsolationSuffix()}`
    );
    const plainSession = await ctx.sessions.create(
      plainProject.id,
      `S-${testIsolationSuffix()}`
    );
    const messages: ChatMessage[] = [];
    for (let i = 1; i <= ROWS; i++) {
      messages.push({
        id: randomUUID(),
        sessionId: plainSession.id,
        seq: i,
        role: roleAt(i),
        content: textBlocks(body),
        provider: null,
        raw: null,
        createdAtMs: Date.now() + i,
        hidden: false,
      });
    }
    const repo = new SqliteMessageRepository(ctx.conn);
    await repo.batchInsert(messages);
    const plain = await timeTail(plainSession.id);
    assert.equal(plain.count, ROWS, "明文库应读到 40 条");

    // 内容深比对：两侧读回同一份正文，防「护栏量的是一个空/错结果的库」
    // （解压错位 / 空 blocks 必须红——原护栏同款口径）。
    const tail = await repo.listBySessionTail(plainSession.id, ROWS);
    assert.deepEqual(
      tail.map((message) => message.content),
      messages.map((message) => message.content)
    );

    // 绝对预算先行：基线侧被打扰到极慢时倍数不可比，先钉死各自量级。
    assert.ok(
      compressed.ms <= ABSOLUTE_BUDGET_MS,
      `压缩基线 tail 耗时 ${compressed.ms}ms 超绝对预算 ${ABSOLUTE_BUDGET_MS}ms（环境噪声，本护栏失效）`
    );
    assert.ok(
      plain.ms <= ABSOLUTE_BUDGET_MS,
      `明文 tail 耗时 ${plain.ms}ms 超绝对预算 ${ABSOLUTE_BUDGET_MS}ms`
    );

    // 相对护栏：明文不劣化于「同 fixture 压缩形态 + inflate」基线。
    // 地板 5ms 吸收 Date.now() 精度（基线为 0ms 时倍数无意义）。
    const budgetMs = Math.max(compressed.ms * MAX_RATIO, RATIO_FLOOR_MS);
    assert.ok(
      plain.ms <= budgetMs,
      `明文 tail 耗时 ${plain.ms}ms 超过压缩基线 ${compressed.ms}ms 的 ${MAX_RATIO} 倍`
    );
  });
});
