/**
 * Composer chip 判定（迁并双端 T-ATD1 / T-AT1 / T-CHIP1/T-AN1；T-X2-1）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isComposerStatusAttachment,
  partitionComposerChipAttachments,
  type ComposerChipAttachment,
} from "../../src/domain/chat/logic/composer-chip-attachment.js";

function chip(
  partial: ComposerChipAttachment & { readonly path?: string },
): ComposerChipAttachment {
  return { source: partial.source, action: partial.action };
}

describe("isComposerStatusAttachment", () => {
  it("T-AT1: userAttach / attach 不进状态 chip", () => {
    assert.equal(
      isComposerStatusAttachment(
        chip({ source: "attach", action: "userAttach" }),
      ),
      false,
    );
    assert.equal(
      isComposerStatusAttachment(
        chip({ source: "user_ops", action: "userAttach" }),
      ),
      false,
    );
    assert.equal(isComposerStatusAttachment(chip({ source: "attach" })), false);
  });

  it("T-CHIP1/T-AN1: annotate 预览进状态 chip", () => {
    assert.equal(
      isComposerStatusAttachment(
        chip({ source: "user_ops", action: "annotate" }),
      ),
      true,
    );
  });

  it("workplace / user_ops（无 userAttach）为状态 chip", () => {
    assert.equal(
      isComposerStatusAttachment(chip({ source: "workplace" })),
      true,
    );
    assert.equal(
      isComposerStatusAttachment(chip({ source: "user_ops", action: "write" })),
      true,
    );
  });
});

describe("partitionComposerChipAttachments", () => {
  it("T-ATD1: 仅状态 attachments → 仅 status，无 attach 可叉行", () => {
    const items = [
      chip({ source: "workplace" }),
      chip({ source: "user_ops" }),
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

  it("T-ATD1: 混有历史 attach 时 partition 仍可拆出", () => {
    const items = [
      chip({ source: "workplace" }),
      chip({ source: "attach" }),
    ];
    const { status, attach: attachOnly } =
      partitionComposerChipAttachments(items);
    assert.equal(status.length, 1);
    assert.equal(attachOnly.length, 1);
    assert.equal(attachOnly[0]?.source, "attach");
  });

  it("T-X2-1: partition 顺序稳定；userAttach 既不进 status 也不进 attach", () => {
    const items = [
      chip({ source: "workplace" }),
      chip({ source: "user_ops", action: "userAttach" }),
      chip({ source: "attach" }),
      chip({ source: "user_ops", action: "annotate" }),
    ];
    const { status, attach: attachOnly } =
      partitionComposerChipAttachments(items);
    assert.deepEqual(
      status.map((a) => a.action ?? a.source),
      ["workplace", "annotate"],
    );
    assert.deepEqual(
      attachOnly.map((a) => a.source),
      ["attach"],
    );
  });
});
