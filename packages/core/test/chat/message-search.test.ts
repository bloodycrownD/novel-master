/**
 * 聊天记录查询 core 基座单元测试（T-CS1 ~ T-CS20）。
 *
 * 同时覆盖仓储层 `SqliteMessageRepository.searchMessages`（含扫描上限 +
 * keyset 续扫）和 service 层 `DefaultMessageService.searchMessages`
 * （透传 + 防御性重筛与截断）。
 *
 * @module test/chat/message-search
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import type { TdbcConnection } from "../../src/infra/tdbc/ports/connection.port.js";
import type { Row } from "../../src/infra/tdbc/types.js";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import type { ChatMessage, MessageContent } from "../../src/domain/chat/model/message.js";
import type { ContentBlock } from "../../src/domain/chat/model/content-block.js";
import { messageMatchesKeyword } from "../../src/domain/chat/content/message-content-match.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

/** 构造一条手造 ChatMessage，createdAtMs/seq/role/content/hidden 可控。 */
function makeMessage(args: {
  sessionId: string;
  seq: number;
  role: string;
  content: MessageContent;
  createdAtMs: number;
  hidden?: boolean;
}): ChatMessage {
  return {
    id: randomUUID(),
    sessionId: args.sessionId,
    seq: args.seq,
    role: args.role,
    content: args.content,
    provider: null,
    raw: null,
    createdAtMs: args.createdAtMs,
    hidden: args.hidden ?? false,
  };
}

/** 多块构造：传入 ContentBlock 数组。 */
function blocksContent(...blocks: ContentBlock[]): MessageContent {
  return { blocks };
}

/** 取一个新的会话用于测试。 */
async function newSession(): Promise<{ sessionId: string; repo: SqliteMessageRepository; createdAtMs: number }> {
  const ctx = getNovelMasterTestContext();
  const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
  const session = await ctx.sessions.create(project.id, `S-${testIsolationSuffix()}`);
  return {
    sessionId: session.id,
    repo: new SqliteMessageRepository(ctx.conn),
    createdAtMs: Date.now(),
  };
}

/**
 * 探针连接（ic-08 验收用）：包装真实连接，记录每次 query 返回的行数——
 * 用来断言 keyword 搜索的每段 SQL 下发行数不超过扫描上限（scanLimit），
 * 全量下发的旧实现下该断言必红。
 */
class QueryRowProbe implements TdbcConnection {
  /** 每次 query 返回的行数，按下发顺序记录。 */
  readonly rowCounts: number[] = [];

  constructor(private readonly inner: TdbcConnection) {}

  query<T extends Row = Row>(
    sql: string,
    parameters?: readonly unknown[]
  ): Promise<T[]> {
    return this.inner.query<T>(sql, parameters).then((rows) => {
      this.rowCounts.push(rows.length);
      return rows;
    });
  }

  execute(sql: string, parameters?: readonly unknown[]) {
    return this.inner.execute(sql, parameters);
  }

  batch(
    sql: string,
    parametersList: readonly (readonly unknown[])[]
  ) {
    return this.inner.batch(sql, parametersList);
  }

  transaction<T>(fn: (tx: TdbcConnection) => Promise<T>) {
    return this.inner.transaction(fn);
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}

/** 批量造 seq 1..n 的 user 消息数组（命中集合外的正文不含 keyword）。 */
function makeSeqMessages(
  sessionId: string,
  count: number,
  hitSeqs: ReadonlySet<number>,
  keyword: string,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let i = 1; i <= count; i++) {
    const text = hitSeqs.has(i) ? `第 ${i} 层藏有${keyword}` : `m-${i}`;
    messages.push(
      makeMessage({
        sessionId,
        seq: i,
        role: "user",
        createdAtMs: i,
        content: textBlocks(text),
      }),
    );
  }
  return messages;
}

describe("聊天记录查询 core 基座", () => {
  describe("messageMatchesKeyword 纯函数", () => {
    it("T-CS2 辅助：只匹配 user/assistant 的 TextBlock，其他块类型忽略", () => {
      const msg: ChatMessage = makeMessage({
        sessionId: "x",
        seq: 1,
        role: "user",
        createdAtMs: 0,
        content: blocksContent(
          { type: "thinking", text: "魔法不应该被搜到" },
          { type: "text", text: "今天天气不错" },
        ),
      });
      assert.equal(messageMatchesKeyword(msg, "魔法"), false);
      assert.equal(messageMatchesKeyword(msg, "天气"), true);
    });

    it("非 user/assistant 角色（system/tool）直接返回 false", () => {
      const msg: ChatMessage = makeMessage({
        sessionId: "x",
        seq: 1,
        role: "system",
        createdAtMs: 0,
        content: textBlocks("魔法"),
      });
      assert.equal(messageMatchesKeyword(msg, "魔法"), false);
    });

    it("大小写不敏感匹配", () => {
      const msg: ChatMessage = makeMessage({
        sessionId: "x",
        seq: 1,
        role: "user",
        createdAtMs: 0,
        content: textBlocks("Hello World"),
      });
      assert.equal(messageMatchesKeyword(msg, "hello"), true);
      assert.equal(messageMatchesKeyword(msg, "WORLD"), true);
    });
  });

  describe("T-CS1：精准匹配命中，按 seq DESC 排序", () => {
    it("仓储层只返回 TextBlock.text 含关键词的 user/assistant 消息", async () => {
      const { sessionId, repo } = await newSession();
      await repo.insert(
        makeMessage({
          sessionId,
          seq: 1,
          role: "user",
          createdAtMs: 1,
          content: textBlocks("讲讲魔法"),
        }),
      );
      await repo.insert(
        makeMessage({
          sessionId,
          seq: 2,
          role: "assistant",
          createdAtMs: 2,
          content: textBlocks("这是一个普通回答"),
        }),
      );
      await repo.insert(
        makeMessage({
          sessionId,
          seq: 3,
          role: "user",
          createdAtMs: 3,
          content: textBlocks("再说点魔法设定"),
        }),
      );

      const result = await repo.searchMessages(sessionId, {
        keyword: "魔法",
        limit: 50,
      });
      assert.deepEqual(
        result.map((m) => m.seq),
        [3, 1],
      );
    });
  });

  describe("T-CS2：tool_result / thinking 含 keyword 但 TextBlock 不含的不被召回", () => {
    it("仓储内存精筛召回后 service 防御性重筛，过滤掉无 TextBlock 命中的行", async () => {
      const ctx = getNovelMasterTestContext();
      const { sessionId, repo } = await newSession();
      // assistant 消息：thinking 块含 keyword，text 块不含
      await repo.insert(
        makeMessage({
          sessionId,
          seq: 1,
          role: "assistant",
          createdAtMs: 1,
          content: blocksContent(
            { type: "thinking", text: "我需要回忆魔法基础" },
            { type: "text", text: "这是一段普通回答" },
          ),
        }),
      );
      // tool_result 块含 keyword 的消息
      await repo.insert(
        makeMessage({
          sessionId,
          seq: 2,
          role: "user",
          createdAtMs: 2,
          content: blocksContent(
            {
              type: "tool_result",
              toolUseId: "tu1",
              content: "魔法结果",
            },
            { type: "text", text: "完全无关的文本" },
          ),
        }),
      );
      // 真正命中的 user TextBlock
      await repo.insert(
        makeMessage({
          sessionId,
          seq: 3,
          role: "user",
          createdAtMs: 3,
          content: textBlocks("魔法确实很有趣"),
        }),
      );

      const result = await ctx.messages.searchMessages(sessionId, {
        keyword: "魔法",
        limit: 50,
      });
      assert.deepEqual(
        result.map((m) => m.seq),
        [3],
      );
    });
  });

  describe("T-CS6：始终包含隐藏消息", () => {
    it("keyword 为空时返回含 hidden 的全部消息", async () => {
      const ctx = getNovelMasterTestContext();
      const { sessionId, repo } = await newSession();
      // seq 1-3 hidden，4-5 visible
      for (let i = 1; i <= 5; i++) {
        await repo.insert(
          makeMessage({
            sessionId,
            seq: i,
            role: i <= 3 ? "user" : "assistant",
            createdAtMs: i,
            hidden: i <= 3,
            content: textBlocks(`msg-${i}`),
          }),
        );
      }

      const result = await ctx.messages.searchMessages(sessionId, {
        keyword: "",
        limit: 50,
      });
      assert.equal(result.length, 5);
      // 验证 hidden 消息确实被包含
      assert.equal(result.filter((m) => m.hidden).length, 3);
    });
  });

  describe("T-CS8：翻页（limit + beforeSeq）", () => {
    it("limit 20 beforeSeq 50 → seq 49-30；再 beforeSeq 30 → seq 29-20", async () => {
      const { sessionId, repo } = await newSession();
      for (let i = 1; i <= 100; i++) {
        await repo.insert(
          makeMessage({
            sessionId,
            seq: i,
            role: "user",
            createdAtMs: i,
            content: textBlocks(`m-${i}`),
          }),
        );
      }

      const page1 = await repo.searchMessages(sessionId, {
        keyword: "",
        limit: 20,
        beforeSeq: 50,
      });
      assert.equal(page1.length, 20);
      assert.deepEqual(
        [page1[0]!.seq, page1[page1.length - 1]!.seq],
        [49, 30],
      );

      const page2 = await repo.searchMessages(sessionId, {
        keyword: "",
        limit: 20,
        beforeSeq: 30,
      });
      // seq < 30 共 29 条，limit 20 取 seq 29..10。
      assert.equal(page2.length, 20);
      assert.deepEqual(
        [page2[0]!.seq, page2[page2.length - 1]!.seq],
        [29, 10],
      );
    });
  });

  describe("T-CS9：字面匹配（keyword 含 % _ \\ 按字面匹配，无 LIKE 通配）", () => {
    it("keyword 含 % _ \\ 时按字面精确匹配，不通配", async () => {
      const ctx = getNovelMasterTestContext();
      const { sessionId, repo } = await newSession();
      // 一条含字面量 % 的消息
      await repo.insert(
        makeMessage({
          sessionId,
          seq: 1,
          role: "user",
          createdAtMs: 1,
          content: textBlocks("进度 50% 完成"),
        }),
      );
      // 一条不含 % 但若 % 被当通配符会被错误召回的消息
      await repo.insert(
        makeMessage({
          sessionId,
          seq: 2,
          role: "user",
          createdAtMs: 2,
          content: textBlocks("这是一段普通文字"),
        }),
      );

      const result = await ctx.messages.searchMessages(sessionId, {
        keyword: "50%",
        limit: 50,
      });
      assert.deepEqual(
        result.map((m) => m.seq),
        [1],
      );

      // keyword 含下划线 _：只匹配字面含 a_b 的消息
      await repo.insert(
        makeMessage({
          sessionId,
          seq: 3,
          role: "user",
          createdAtMs: 3,
          content: textBlocks("var a_b = 1"),
        }),
      );
      await repo.insert(
        makeMessage({
          sessionId,
          seq: 4,
          role: "user",
          createdAtMs: 4,
          content: textBlocks("axb 下划线通配陷阱"),
        }),
      );
      const under = await ctx.messages.searchMessages(sessionId, {
        keyword: "a_b",
        limit: 50,
      });
      assert.deepEqual(
        under.map((m) => m.seq),
        [3],
      );

      // keyword 含反斜杠时按字面匹配（内存 includes 语义，无 LIKE 通配概念），
      // 不会当作通配符匹配全表（返回空而非误召回无关行）。
      await repo.insert(
        makeMessage({
          sessionId,
          seq: 5,
          role: "user",
          createdAtMs: 5,
          content: textBlocks("完全无关的文本 xyz"),
        }),
      );
      const slash = await ctx.messages.searchMessages(sessionId, {
        keyword: "C:\\NoSuchPath",
        limit: 50,
      });
      assert.deepEqual(slash, []);
    });
  });

  describe("T-CS10：keyword 为空不做关键词过滤、不加 role 过滤", () => {
    it("返回含 system 角色在内的全部消息", async () => {
      const ctx = getNovelMasterTestContext();
      const { sessionId, repo } = await newSession();
      await repo.insert(
        makeMessage({
          sessionId,
          seq: 1,
          role: "system",
          createdAtMs: 1,
          content: textBlocks("system prompt"),
        }),
      );
      await repo.insert(
        makeMessage({
          sessionId,
          seq: 2,
          role: "user",
          createdAtMs: 2,
          content: textBlocks("user msg"),
        }),
      );
      await repo.insert(
        makeMessage({
          sessionId,
          seq: 3,
          role: "assistant",
          createdAtMs: 3,
          content: textBlocks("assistant msg"),
        }),
      );

      const result = await ctx.messages.searchMessages(sessionId, {
        keyword: "",
        limit: 50,
      });
      assert.deepEqual(
        result.map((m) => m.role),
        ["assistant", "user", "system"],
      );
    });

    it("keyword 为 undefined 时同样不过滤", async () => {
      const ctx = getNovelMasterTestContext();
      const { sessionId, repo } = await newSession();
      await repo.insert(
        makeMessage({
          sessionId,
          seq: 1,
          role: "system",
          createdAtMs: 1,
          content: textBlocks("s"),
        }),
      );
      const result = await ctx.messages.searchMessages(sessionId, {
        limit: 50,
      });
      assert.equal(result.length, 1);
    });
  });

  describe("T-CS11：fromSeq/toSeq 闭区间过滤，倒序返回", () => {
    it("区间 40-60 只返回 seq 40..60（含边界），按 seq DESC", async () => {
      const { sessionId, repo } = await newSession();
      for (let i = 1; i <= 100; i++) {
        await repo.insert(
          makeMessage({
            sessionId,
            seq: i,
            role: "user",
            createdAtMs: i,
            content: textBlocks(`m-${i}`),
          }),
        );
      }

      const result = await repo.searchMessages(sessionId, {
        keyword: "",
        limit: 50,
        fromSeq: 40,
        toSeq: 60,
      });
      assert.equal(result.length, 21);
      assert.equal(result[0]!.seq, 60);
      assert.equal(result[result.length - 1]!.seq, 40);
    });
  });

  describe("T-CS12：仅 fromSeq 返回 seq >= fromSeq", () => {
    it("fromSeq=80 返回 seq 80..100，倒序", async () => {
      const { sessionId, repo } = await newSession();
      for (let i = 1; i <= 100; i++) {
        await repo.insert(
          makeMessage({
            sessionId,
            seq: i,
            role: "user",
            createdAtMs: i,
            content: textBlocks(`m-${i}`),
          }),
        );
      }

      const result = await repo.searchMessages(sessionId, {
        keyword: "",
        limit: 50,
        fromSeq: 80,
      });
      assert.equal(result.length, 21);
      assert.equal(result[0]!.seq, 100);
      assert.equal(result[result.length - 1]!.seq, 80);
    });
  });

  describe("T-CS13：仅 toSeq 返回 seq <= toSeq", () => {
    it("toSeq=20 返回 seq 1..20，倒序", async () => {
      const { sessionId, repo } = await newSession();
      for (let i = 1; i <= 100; i++) {
        await repo.insert(
          makeMessage({
            sessionId,
            seq: i,
            role: "user",
            createdAtMs: i,
            content: textBlocks(`m-${i}`),
          }),
        );
      }

      const result = await repo.searchMessages(sessionId, {
        keyword: "",
        limit: 50,
        toSeq: 20,
      });
      assert.equal(result.length, 20);
      assert.equal(result[0]!.seq, 20);
      assert.equal(result[result.length - 1]!.seq, 1);
    });
  });

  describe("T-CS14：倒挂区间返回空数组不报错", () => {
    it("fromSeq=60 > toSeq=40 时返回空", async () => {
      const { sessionId, repo } = await newSession();
      for (let i = 1; i <= 100; i++) {
        await repo.insert(
          makeMessage({
            sessionId,
            seq: i,
            role: "user",
            createdAtMs: i,
            content: textBlocks(`m-${i}`),
          }),
        );
      }

      const result = await repo.searchMessages(sessionId, {
        keyword: "",
        limit: 50,
        fromSeq: 60,
        toSeq: 40,
      });
      assert.deepEqual(result, []);
    });
  });

  describe("T-CS15：keyword 与区间组合取交集", () => {
    it("keyword=灵石 且区间 10-50 只返回区间内命中关键词的消息", async () => {
      const { sessionId, repo } = await newSession();
      const seqs = [5, 15, 25, 35, 55];
      for (const seq of seqs) {
        await repo.insert(
          makeMessage({
            sessionId,
            seq,
            role: "user",
            createdAtMs: seq,
            content: textBlocks(`灵石矿脉在第 ${seq} 层`),
          }),
        );
      }
      // 一条区间内但不含关键词的消息，验证取交集而非并集。
      await repo.insert(
        makeMessage({
          sessionId,
          seq: 30,
          role: "user",
          createdAtMs: 30,
          content: textBlocks("区间内的普通消息"),
        }),
      );

      const result = await repo.searchMessages(sessionId, {
        keyword: "灵石",
        limit: 50,
        fromSeq: 10,
        toSeq: 50,
      });
      assert.deepEqual(
        result.map((m) => m.seq),
        [35, 25, 15],
      );
    });
  });

  describe("T-CS16：区间内含单条删除空洞时正确返回现存消息", () => {
    it("区间 25-35 中 seq 30 已删除时返回 10 条（25-29、31-35）", async () => {
      const { sessionId, repo } = await newSession();
      for (let i = 25; i <= 35; i++) {
        const msg = makeMessage({
          sessionId,
          seq: i,
          role: "user",
          createdAtMs: i,
          content: textBlocks(`m-${i}`),
        });
        await repo.insert(msg);
        if (i === 30) {
          await repo.delete(msg.id);
        }
      }

      const result = await repo.searchMessages(sessionId, {
        keyword: "",
        limit: 50,
        fromSeq: 25,
        toSeq: 35,
      });
      assert.equal(result.length, 10);
      assert.equal(
        result.some((m) => m.seq === 30),
        false,
      );
      assert.deepEqual(
        result.map((m) => m.seq),
        [35, 34, 33, 32, 31, 29, 28, 27, 26, 25],
      );
    });
  });

  describe("T-CS17：命中数 > limit 时恰返回 limit 条（最新 limit 条降序）", () => {
    it("100 条命中 keyword、limit 10 → 恰返回 seq 99..90", async () => {
      const { sessionId, repo } = await newSession();
      const messages = makeSeqMessages(
        sessionId,
        100,
        new Set(Array.from({ length: 100 }, (_, i) => i + 1)),
        "玄铁",
      );
      await repo.batchInsert(messages);

      const result = await repo.searchMessages(sessionId, {
        keyword: "玄铁",
        limit: 10,
      });
      // 新语义：keyword 命中数 > limit 时返回恰 limit 条（最新 10 条，seq DESC）。
      // seq 1..100 的最新 10 条是 100..91。旧实现（SQL 先 LIMIT 再精筛）
      // 在该场景语义不同，此处钉住新口径。
      assert.equal(result.length, 10);
      assert.deepEqual(
        result.map((m) => m.seq),
        Array.from({ length: 10 }, (_, i) => 100 - i),
      );
    });
  });

  describe("T-CS18：扫描上限——2000 行会话 keyword 搜索每段 SQL 下发 ≤ scanLimit", () => {
    it("命中稀疏时逐段续扫扫完全部行，每次 query 行数 ≤ 200", async () => {
      const ctx = getNovelMasterTestContext();
      const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
      const session = await ctx.sessions.create(project.id, `S-${testIsolationSuffix()}`);
      const probe = new QueryRowProbe(ctx.conn);
      const repo = new SqliteMessageRepository(probe);
      // 2000 行、全库只有 3 条命中（seq 5 / 1005 / 1995），limit 10 →
      // scanLimit = max(10*20, 200) = 200：必须穷尽全部 2000 行（10 段拉满
      // + 1 段空）才允许返回不足 limit 的结果——红线是召回不得小于全量精筛。
      await repo.batchInsert(
        makeSeqMessages(session.id, 2000, new Set([5, 1005, 1995]), "星髓")
      );

      const result = await repo.searchMessages(session.id, {
        keyword: "星髓",
        limit: 10,
      });
      assert.deepEqual(
        result.map((m) => m.seq),
        [1995, 1005, 5],
      );
      // 10 段各拉满 200 行 + 第 11 段 0 行（扫尽出口）。
      assert.equal(probe.rowCounts.length, 11);
      // 探针核心断言：任何一段 SQL 下发行数都不超过扫描上限——
      // 全量下发的旧实现（一次 query 2000 行）在此必红。
      assert.ok(
        probe.rowCounts.every((n) => n <= 200),
        `每段下发 ≤ 200，实际 ${JSON.stringify(probe.rowCounts)}`,
      );
      assert.deepEqual(
        probe.rowCounts.slice(0, 10),
        Array.from({ length: 10 }, () => 200),
      );
    });
  });

  describe("T-CS19：keyset 续扫——本段命中不足 limit 时续扫凑满（含 beforeSeq 边界）", () => {
    it("450 行命中分散在 5 个 seq，limit 5 → 跨段凑满恰 5 条；beforeSeq 250 → 扫完返回 3 条", async () => {
      const { sessionId, repo } = await newSession();
      // 命中 seq {400, 300, 200, 100, 50}，scanLimit = 200：
      // 段1 [450..251] 命中 2 条 < 5 且拉满 → 续扫；段2 [250..51] 累计 4 < 5
      // 且拉满 → 续扫；段3 [50..1] 凑满第 5 条。
      await repo.batchInsert(
        makeSeqMessages(sessionId, 450, new Set([50, 100, 200, 300, 400]), "玄冰")
      );

      const full = await repo.searchMessages(sessionId, {
        keyword: "玄冰",
        limit: 5,
      });
      assert.equal(full.length, 5);
      assert.deepEqual(
        full.map((m) => m.seq),
        [400, 300, 200, 100, 50],
      );

      // beforeSeq 边界：第一段从 seq < 250 起扫（200 行拉满），第二段
      // [49..1] 49 行扫尽——命中只有 3 条（200/100/50），扫完后允许返回
      // 不足 limit 的结果，且恰为该范围内最新的命中。
      const paged = await repo.searchMessages(sessionId, {
        keyword: "玄冰",
        limit: 5,
        beforeSeq: 250,
      });
      assert.deepEqual(
        paged.map((m) => m.seq),
        [200, 100, 50],
      );
    });
  });

  describe("T-CS20：yieldFn 分片让步——batchInsert 构造与搜索行解析均按片让步", () => {
    it("batchInsert 500 条让步 ≥2 次；450 行多段搜索让步 ≥2 次", async () => {
      const ctx = getNovelMasterTestContext();
      const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
      const session = await ctx.sessions.create(project.id, `S-${testIsolationSuffix()}`);
      let insertYields = 0;
      let searchYields = 0;
      const mode = { search: false };
      const repo = new SqliteMessageRepository(ctx.conn, async () => {
        if (mode.search) {
          searchYields++;
        } else {
          insertYields++;
        }
      });
      // batchInsert 500 条：构造分片 200/200/100 → 片间让步 2 次。
      await repo.batchInsert(
        makeSeqMessages(session.id, 500, new Set([50, 100, 200, 300, 400]), "月华")
      );
      assert.ok(
        insertYields >= 2,
        `batchInsert 构造分片让步 ≥2 次，实际 ${insertYields}`,
      );

      // 搜索 450 行：mapRows 每段 200 行 → 4 片 3 让步 × 多段 → 让步 ≥2 次。
      mode.search = true;
      const result = await repo.searchMessages(session.id, {
        keyword: "月华",
        limit: 5,
      });
      assert.deepEqual(
        result.map((m) => m.seq),
        [400, 300, 200, 100, 50],
      );
      assert.ok(
        searchYields >= 2,
        `搜索行解析分片让步 ≥2 次，实际 ${searchYields}`,
      );
    });
  });
});
