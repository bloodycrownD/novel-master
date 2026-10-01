/**
 * T-MP-P0b：messages 列表 IPC DTO 形态断言——content 恒为明文文本。
 *
 * **为什么要有这条**：chat_message 的存储形态在明文化迭代里分两极——新行
 * 直写 `content_json` 明文、压缩两列恒 NULL；存量压缩行在迁移期由后台
 * 反向任务解压回明文。读路径双形态（压缩行永远合法）意味着**任何**读到的
 * 正文在 DTO 边界上必须是**解码后的明文**，绝不能把压缩字节 / raw blob
 * 形态泄漏进 IPC——否则 renderer 会拿到一坨二进制、或按 base64 误解码。
 * 这条断言就是钉死这个边界的牙齿：造一条**存量压缩行**（迁移期最恶劣的
 * 形态），走 IPC 后逐字段核对 bodyText / contentBlocks 全文等值。
 *
 * 附带钉死 DTO 里不存在任何承载原始 blob 的键（`contentEncoding` /
 * `contentBlob` / `encoding` / `blob`）——字段层面的形态泄漏同样要挡。
 *
 * @module test/messages-ipc-plaintext-shape
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { after, before, describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { handleMessagesList } from "../src/main/ipc/handlers/messages.js";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import { handleAgentRegistryCreateBlank } from "../src/main/ipc/handlers/agent-registry.js";
import { handleAgentSetCurrent } from "../src/main/ipc/handlers/agent.js";
import { handleSessionsCreate } from "../src/main/ipc/handlers/sessions.js";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import type { ChatMessageDto, ContentBlockDto } from "../shared/ipc-types.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

/** DTO 里**不允许**出现的存储形态键（防止未来把 blob 形态塞进 IPC）。 */
const FORBIDDEN_KEYS = [
  "contentEncoding",
  "contentBlob",
  "encoding",
  "blob",
  "contentBlobBase64",
  "compressed",
];

function assertNoStorageFormLeak(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoStorageFormLeak(item, `${path}[${i}]`));
    return;
  }
  if (value == null || typeof value !== "object") {
    // 叶子：压缩字节绝不能以字符串/字节形态出现在 DTO 里。
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
      assert.fail(`${path} 泄漏了二进制存储形态`);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    assert.ok(
      !FORBIDDEN_KEYS.includes(key),
      `${path}.${key} 是存储形态字段，不得进入 IPC DTO`,
    );
    assertNoStorageFormLeak(child, `${path}.${key}`);
  }
}

describe("messages 列表 DTO 恒为明文（T-MP-P0b）", () => {
  let tempDir: string;
  let projectId: string;
  let sessionId: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-ipc-plaintext-"));
    const project = await handleProjectsCreate({ name: "ipc-plaintext" });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    projectId = project.data.id;
    const blank = await handleAgentRegistryCreateBlank();
    assert.equal(blank.ok, true);
    if (blank.ok) {
      await handleAgentSetCurrent({ agentId: blank.data.agentId });
    }
    const session = await handleSessionsCreate({
      projectId,
      title: "ipc-plaintext",
    });
    assert.equal(session.ok, true);
    if (!session.ok) {
      return;
    }
    sessionId = session.data.id;
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("存量压缩行经 IPC 后 bodyText / contentBlocks 逐字节等于明文", async () => {
    const rt = await getDesktopRuntime();
    const bodyText = `明文化正文 · 压缩形态只存在于存储层：${"中文与标点、emoji 🎯 混排。".repeat(30)}`;

    // 1) 明文行：走生产写路径（append）。
    await rt.messages.append(sessionId, "user", textBlocks(bodyText));

    // 2) 存量压缩行：不经生产写路径（deflateSync + 裸 INSERT），
    //    模拟迁移期尚未被反向任务搬运的那批行——最恶劣的存储形态。
    const compressedBody = `存量压缩行 · ${"解码后应逐字节等值。".repeat(40)}`;
    const content = textBlocks(compressedBody);
    const blob = deflateSync(
      Buffer.from(JSON.stringify(content), "utf8"),
    );
    await rt.conn.execute(
      `INSERT INTO chat_message (
         id, session_id, seq, role, content_json, content_encoding,
         content_blob, created_at_ms, hidden
       ) VALUES (?, ?, ?, 'assistant', '', 'zlib', ?, ?, 0)`,
      [randomUUID(), sessionId, 2, blob, Date.now()],
    );

    const res = await handleMessagesList({ sessionId });
    assert.equal(
      res.ok,
      true,
      res.ok ? undefined : `handleMessagesList 失败：${res.error.message}`,
    );
    if (!res.ok) {
      return;
    }
    const list = res.data as ChatMessageDto[];
    assert.ok(list.length >= 2, "两条消息都应被列出");

    // 逐条形态核验：bodyText 与 text 块的 text 必须是明文原文。
    for (const dto of list) {
      assertNoStorageFormLeak(dto, `message(${dto.seq})`);
      assert.equal(typeof dto.bodyText, "string");
      // bodyText 不得含任何二进制残留的可打印替身（zlib 头 0x78 0x9c）。
      assert.ok(
        !dto.bodyText.includes("x\u009c"),
        `message(${dto.seq}) bodyText 疑似压缩字节泄漏`,
      );
      for (const block of dto.contentBlocks as readonly ContentBlockDto[]) {
        if (block.type === "text") {
          assert.equal(typeof block.text, "string");
          assert.ok(
            !block.text.includes("x\u009c"),
            `message(${dto.seq}) text 块疑似压缩字节泄漏`,
          );
        }
      }
    }

    const plaintextRow = list.find((m) => m.seq === 1)!;
    const compressedRow = list.find((m) => m.seq === 2)!;
    assert.ok(plaintextRow && compressedRow, "明文行与压缩行都必须在列");
    assert.equal(
      plaintextRow.bodyText,
      bodyText,
      "明文行的 bodyText 必须逐字节等值",
    );
    assert.equal(
      compressedRow.bodyText,
      compressedBody,
      "存量压缩行的 bodyText 必须是解码后的明文，不得是压缩字节",
    );
    const compressedTextBlock = compressedRow.contentBlocks.find(
      (b) => b.type === "text",
    );
    assert.ok(compressedTextBlock && compressedTextBlock.type === "text");
    assert.equal(
      compressedTextBlock.text,
      compressedBody,
      "存量压缩行的 text 块 content 必须是解码后的明文",
    );
  });
});