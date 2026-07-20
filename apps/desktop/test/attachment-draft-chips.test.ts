/**
 * AttachmentDraftChips：状态 chip 文案与壳层 class（判定/partition 见 core T-X2-1）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  attachmentChipClassName,
  formatAttachmentChipLabel,
} from "@/features/chat/AttachmentDraftChips";
import type { MessageAttachmentDto } from "@shared/ipc-types";

function attach(
  partial: Partial<MessageAttachmentDto> &
    Pick<MessageAttachmentDto, "type" | "source">,
): MessageAttachmentDto {
  return {
    name: partial.name ?? partial.path ?? "x",
    content: null,
    path: partial.path ?? null,
    ...partial,
  };
}

test("T-UI1/T-CHIP1: workplace 为「规则:/path」", () => {
  assert.equal(
    formatAttachmentChipLabel(
      attach({
        source: "workplace",
        type: "text",
        path: "/w.md",
        name: "w.md",
      }),
    ),
    "规则:/w.md",
  );
});

test("T-UI1/T-CHIP1: workplace 目录为「规则:/dir」（无 emoji /「规则 ·」）", () => {
  assert.equal(
    formatAttachmentChipLabel(
      attach({
        source: "workplace",
        type: "dir",
        path: "/notes",
        name: "notes",
      }),
    ),
    "规则:/notes",
  );
});

test("T-UI1/T-CHIP1: user_ops 有 action 时为中文二字:path", () => {
  assert.equal(
    formatAttachmentChipLabel(
      attach({
        source: "user_ops",
        type: "text",
        path: "/ops.md",
        name: "/ops.md",
        action: "write",
      }),
    ),
    "创建:/ops.md",
  );
});

test("T-CHIP1: annotate 预览为「批注:/path」", () => {
  assert.equal(
    formatAttachmentChipLabel(
      attach({
        source: "user_ops",
        type: "text",
        path: "/c.md",
        name: "/c.md",
        action: "annotate",
      }),
    ),
    "批注:/c.md",
  );
});

test("T-CHIP1: rename 为「重命:<to>」", () => {
  assert.equal(
    formatAttachmentChipLabel(
      attach({
        source: "user_ops",
        type: "text",
        path: "/to.md",
        name: "/to.md",
        action: "rename",
      }),
    ),
    "重命:/to.md",
  );
});

test("T-UI2: 目录 chip class 无 --dir warning 色类", () => {
  assert.equal(attachmentChipClassName(), "chat-composer__chip");
  assert.equal(attachmentChipClassName().includes("--dir"), false);
});
