/**
 * MessageAttachmentGroupCard：气泡与 Composer 同口径；attach 为 @path（T-HC5 / T-CHIP2）。
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

test("T-HC5/T-CHIP2/T-CR8: workplace 为「规则:/path」；user_ops 为中文二字:path", () => {
  assert.equal(
    formatMessageAttachmentLabel(
      attach({
        source: "workplace",
        type: "text",
        path: "/w.md",
        name: "w.md",
      }),
    ),
    "规则:/w.md",
  );
  assert.equal(
    formatMessageAttachmentLabel(
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
  assert.ok(
    !formatMessageAttachmentLabel(
      attach({
        source: "workplace",
        type: "text",
        path: "/w.md",
      }),
    ).includes("规则 ·"),
  );
});

test("T-CHIP2: annotate 气泡为「批注:/path」", () => {
  assert.equal(
    formatMessageAttachmentLabel(
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
