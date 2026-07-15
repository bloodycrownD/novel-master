import assert from "node:assert/strict";
import test from "node:test";
import { formatAttachmentChipLabel } from "@/features/chat/AttachmentDraftChips";
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

test("目录 chip（非 workplace）文案为 @${path} 且无空格", () => {
  assert.equal(
    formatAttachmentChipLabel(
      attach({ source: "attach", type: "dir", path: "/555", name: "555" }),
    ),
    "@/555",
  );
});

test("文件 chip 保持 @ ${path}", () => {
  assert.equal(
    formatAttachmentChipLabel(
      attach({ source: "attach", type: "text", path: "/a.md", name: "a.md" }),
    ),
    "@ /a.md",
  );
});

test("workplace chip 保持「工作区」前缀", () => {
  assert.equal(
    formatAttachmentChipLabel(
      attach({
        source: "workplace",
        type: "text",
        path: "/w.md",
        name: "w.md",
      }),
    ),
    "工作区 /w.md",
  );
});
