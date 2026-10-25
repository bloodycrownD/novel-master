/**
 * Desktop annotate store 薄接线烟测（主测在 core；T-X2-3）。
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { unionComposerStatusWithAnnotate, chatAnnotateDraftStore } from "@/features/chat/chat-annotate-draft";
import type { MessageAttachmentDto } from "@shared/ipc-types";

afterEach(() => {
  chatAnnotateDraftStore.resetForTests();
});

test("接线: Desktop 壳映射 Dto；chip action/path 可用", () => {
  const sessionId = "s-desktop-wire";
  chatAnnotateDraftStore.add(sessionId, {
    id: "a1",
    path: "/wire.md",
    originalText: "x",
    userAnnotation: "y",
  });
  const chips = chatAnnotateDraftStore.chips(sessionId);
  assert.equal(chips.length, 1);
  assert.equal(chips[0]?.action, "annotate");
  assert.equal(chips[0]?.path, "/wire.md");
  assert.equal(chips[0]?.source, "user_ops");

  const projected: MessageAttachmentDto[] = [
    {
      name: "/w.md",
      source: "workplace",
      type: "text",
      content: null,
      path: "/w.md",
      action: "workplaceChange",
    },
  ];
  const merged = unionComposerStatusWithAnnotate(projected, sessionId);
  assert.deepEqual(
    merged.map((a) => `${a.action}:${a.path}`),
    ["workplaceChange:/w.md", "annotate:/wire.md"],
  );
});
