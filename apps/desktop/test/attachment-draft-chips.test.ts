/**
 * AttachmentDraftChips：emoji 文案、双条拆分、目录无 warning 色类（T-UI1/T-UI2）。
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

test("T-UI1: attach 目录为 📁/path", () => {
  assert.equal(
    formatAttachmentChipLabel(
      attach({ source: "attach", type: "dir", path: "/555", name: "555" }),
    ),
    "📁/555",
  );
});

test("T-UI1: attach 文件为 📄/path", () => {
  assert.equal(
    formatAttachmentChipLabel(
      attach({ source: "attach", type: "text", path: "/a.md", name: "a.md" }),
    ),
    "📄/a.md",
  );
});

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

test("T-UI1: user_ops 为 ✏️/path", () => {
  assert.equal(
    formatAttachmentChipLabel(
      attach({
        source: "user_ops",
        type: "text",
        path: "/ops.md",
        name: "/ops.md",
      }),
    ),
    "✏️/ops.md",
  );
});

test("T-UI1: 三类并存 → 上条 workplace+user_ops、下条 attach", () => {
  const items = [
    attach({ source: "workplace", type: "text", path: "/w.md" }),
    attach({ source: "user_ops", type: "text", path: "/u.md" }),
    attach({ source: "attach", type: "text", path: "/a.md" }),
  ];
  const { status, attach: attachOnly } =
    partitionComposerChipAttachments(items);
  assert.deepEqual(
    status.map((a) => a.source),
    ["workplace", "user_ops"],
  );
  assert.deepEqual(
    attachOnly.map((a) => a.source),
    ["attach"],
  );
  assert.ok(status.every(isComposerStatusAttachment));
  assert.ok(attachOnly.every((a) => a.source === "attach"));
});

test("T-UI2: 目录 chip class 无 --dir warning 色类", () => {
  assert.equal(attachmentChipClassName(), "chat-composer__chip");
  assert.equal(attachmentChipClassName().includes("--dir"), false);
});
