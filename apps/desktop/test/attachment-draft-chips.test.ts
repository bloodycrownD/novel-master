/**
 * AttachmentDraftChips：状态 chip 文案与拆分；无 attach 可叉行（T-UI1 / T-ATD1 / T-CHIP1）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  attachmentChipClassName,
  formatAttachmentChipLabel,
  isComposerStatusAttachment,
  partitionComposerChipAttachments,
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

test("T-ATD1: 仅状态 attachments → 仅 status，无 attach 可叉行", () => {
  const items = [
    attach({ source: "workplace", type: "text", path: "/w.md" }),
    attach({ source: "user_ops", type: "text", path: "/u.md" }),
  ];
  const { status, attach: attachOnly } =
    partitionComposerChipAttachments(items);
  assert.deepEqual(
    status.map((a) => a.source),
    ["workplace", "user_ops"],
  );
  assert.equal(attachOnly.length, 0);
  assert.ok(status.every(isComposerStatusAttachment));
});

test("T-ATD1: 混有历史 attach 时 partition 仍可拆出，但 UI 不再渲染 attach 行", () => {
  const items = [
    attach({ source: "workplace", type: "text", path: "/w.md" }),
    attach({ source: "attach", type: "text", path: "/a.md" }),
  ];
  const { status, attach: attachOnly } =
    partitionComposerChipAttachments(items);
  assert.equal(status.length, 1);
  assert.equal(attachOnly.length, 1);
  assert.equal(attachOnly[0]?.source, "attach");
});

test("T-AT1: userAttach / attach 不进状态 chip", () => {
  assert.equal(
    isComposerStatusAttachment(
      attach({
        source: "attach",
        type: "text",
        path: "/a.md",
        action: "userAttach",
      }),
    ),
    false,
  );
  assert.equal(
    isComposerStatusAttachment(
      attach({
        source: "user_ops",
        type: "text",
        path: "/a.md",
        action: "userAttach",
      }),
    ),
    false,
  );
});

test("T-CHIP1/T-AN1: annotate 预览进状态 chip（isComposerStatusAttachment）", () => {
  assert.equal(
    isComposerStatusAttachment(
      attach({
        source: "user_ops",
        type: "text",
        path: "/c.md",
        action: "annotate",
      }),
    ),
    true,
  );
});

test("T-UI2: 目录 chip class 无 --dir warning 色类", () => {
  assert.equal(attachmentChipClassName(), "chat-composer__chip");
  assert.equal(attachmentChipClassName().includes("--dir"), false);
});
