/**
 * AttachmentDraftChips：状态 chip 文案与拆分；无 attach 可叉行（T-UI1 / T-ATD1）。
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

test("T-UI1: workplace 为 📄/path", () => {
  assert.equal(
    formatAttachmentChipLabel(
      attach({
        source: "workplace",
        type: "text",
        path: "/w.md",
        name: "w.md",
      }),
    ),
    "📄/w.md",
  );
});

test("T-UI1: user_ops 为 action:path（无 icon）", () => {
  assert.equal(
    formatAttachmentChipLabel(
      attach({
        source: "user_ops",
        type: "text",
        path: "/ops.md",
        name: "write:/ops.md",
      }),
    ),
    "write:/ops.md",
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

test("T-UI2: 目录 chip class 无 --dir warning 色类", () => {
  assert.equal(attachmentChipClassName(), "chat-composer__chip");
  assert.equal(attachmentChipClassName().includes("--dir"), false);
});
