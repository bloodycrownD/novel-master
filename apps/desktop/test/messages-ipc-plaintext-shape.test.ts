/**
 * T-MP-P0b：messages 列表 IPC DTO 形态断言——content 恒为明文文本。
 *
 * **为什么要有这条**：chat_message 的存储形态在明文化迭代里收敛为单形态
 * ——新行直写 `content_json` 明文、压缩两列恒 NULL，存量压缩行已由反向
 * 搬运任务全部解回明文（V1' 退役确认：真实库谓词归零 + KKV
 * decompressDone 已置）。读路径（readRowContent）随之收口为纯明文 parse，
 * 任何读到的正文在 DTO 边界上必须是**明文**，绝不能把压缩字节 / raw blob
 * 形态泄漏进 IPC——否则 renderer 会拿到一坨二进制、或按 base64 误解码。
 * 这条断言就是钉死这个边界的牙齿：走 IPC 后逐字段核对 bodyText /
 * contentBlocks 全文等值。
 *
 * 附带钉死 DTO 里不存在任何承载原始 blob 的键（`contentEncoding` /
 * `contentBlob` / `encoding` / `blob`）——字段层面的形态泄漏同样要挡。
 *
 * @module test/messages-ipc-plaintext-shape
 */
import assert from "node:assert/strict";
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

  it("明文行经 IPC 后 bodyText / contentBlocks 逐字节等于原文", async () => {
    const rt = await getDesktopRuntime();
    const firstBody = `明文化正文 · 压缩形态只存在于存储层：${"中文与标点、emoji 🎯 混排。".repeat(30)}`;
    const secondBody = `第二条正文 · ${"逐字节等值校验。".repeat(40)}`;

    // 两条明文行：走生产写路径（append）。
    await rt.messages.append(sessionId, "user", textBlocks(firstBody));
    await rt.messages.append(sessionId, "assistant", textBlocks(secondBody));

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

    const firstRow = list.find((m) => m.seq === 1)!;
    const secondRow = list.find((m) => m.seq === 2)!;
    assert.ok(firstRow && secondRow, "两条明文行都必须在列");
    assert.equal(
      firstRow.bodyText,
      firstBody,
      "第一条的 bodyText 必须逐字节等值",
    );
    assert.equal(
      secondRow.bodyText,
      secondBody,
      "第二条的 bodyText 必须逐字节等值",
    );
    const secondTextBlock = secondRow.contentBlocks.find(
      (b) => b.type === "text",
    );
    assert.ok(secondTextBlock && secondTextBlock.type === "text");
    assert.equal(
      secondTextBlock.text,
      secondBody,
      "第二条的 text 块 content 必须逐字节等值",
    );
  });
});
