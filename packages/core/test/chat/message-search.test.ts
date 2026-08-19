/**
 * 聊天记录查询 core 基座单元测试（T-CS1 ~ T-CS10）。
 *
 * 同时覆盖仓储层 `SqliteMessageRepository.searchMessages` 和 service 层
 * `DefaultMessageService.searchMessages`（透传 + 内存精筛）。
 *
 * @module test/chat/message-search
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { SqliteMessageRepository } from "../../src/domain/chat/repositories/impl/sqlite-message.repository.js";
import type { ChatMessage, MessageContent } from "../../src/domain/chat/model/message.js";
import type { ContentBlock } from "../../src/domain/chat/model/content-block.js";
import {
  escapeLikePattern,
  messageMatchesKeyword,
} from "../../src/domain/chat/content/message-content-match.js";
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

describe("聊天记录查询 core 基座", () => {
  describe("escapeLikePattern", () => {
    it("转义 \\ % _ 三个 LIKE 元字符", () => {
      assert.equal(escapeLikePattern("a%c_d\\z"), "a\\%c\\_d\\\\z");
      assert.equal(escapeLikePattern("普通文字"), "普通文字");
    });
  });

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
    it("仓储 LIKE 召回后 service 精筛过滤掉无 TextBlock 命中的行", async () => {
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

  describe("T-CS9：LIKE 转义（keyword 含 % _ \\ 不触发通配）", () => {
    it("精准模式 keyword 含 LIKE 元字符时精确匹配，不通配", async () => {
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

      // 反斜杠转义由 escapeLikePattern 单元测试覆盖；此处额外验证 keyword 含反斜杠
      // 不会当作 LIKE 通配符匹配全表（返回空而非误召回无关行）。
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
});
