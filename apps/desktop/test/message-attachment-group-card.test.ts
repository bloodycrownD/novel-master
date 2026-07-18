/**
 * MessageAttachmentGroupCard：气泡 attach 文案不得误标「规则 ·」（T-HC5）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { formatMessageAttachmentLabel } from "@/features/chat/MessageAttachmentGroupCard";
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

test("T-HC5: attach 文案为 @path，不含「规则 ·」", () => {
  const label = formatMessageAttachmentLabel(
    attach({
      source: "attach",
      type: "text",
      path: "/ref.md",
      name: "ref.md",
    }),
  );
  assert.equal(label, "@/ref.md");
  assert.ok(!label.includes("规则 ·"));
});

test("T-HC5: attach 目录文案为 @path，不含「规则 ·」", () => {
  const label = formatMessageAttachmentLabel(
    attach({
      source: "attach",
      type: "dir",
      path: "/notes",
      name: "notes",
    }),
  );
  assert.equal(label, "@/notes");
  assert.ok(!label.includes("规则 ·"));
});

test("T-HC5: workplace 仍为「规则 ·」；user_ops 为 name（无「改稿 ·」）", () => {
  assert.equal(
    formatMessageAttachmentLabel(
      attach({
        source: "workplace",
        type: "text",
        path: "/w.md",
        name: "w.md",
      }),
    ),
    "规则 · /w.md",
  );
  assert.equal(
    formatMessageAttachmentLabel(
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
