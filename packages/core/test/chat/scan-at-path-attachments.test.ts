/**
 * T-AT5 / T-AT6：手输 @path 扫描与 path 去重（落库 path 带前导 `/`）。
 * attachmentsFromPaths：显式路径列表 → 合规新写入附件（spec D9/D10，Step 10）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AttachmentPathArgumentError,
  attachmentsFromPaths,
  mergeAttachmentsWithScannedAtPaths,
  scanAtPathAttachments,
} from "../../src/domain/chat/logic/scan-at-path-attachments.js";
import {
  attachmentStorageName,
  messageAttachmentsSchema,
  type MessageAttachment,
} from "../../src/domain/chat/model/message-attachment.schema.js";

describe("scanAtPathAttachments (T-AT5 / T-AT6)", () => {
  it("T-AT5: 正文含手输 @path 且 chips 无该 path → 生成 source:attach（path 带 /）", () => {
    const text = "请看 @notes/a.md 与补充";
    const scanned = scanAtPathAttachments(text);
    assert.equal(scanned.length, 1);
    assert.equal(scanned[0]!.source, "attach");
    assert.equal(scanned[0]!.path, "/notes/a.md");
    assert.match(text, /@notes\/a\.md/);
  });

  it("T-AT5: 合并后 content 仍含 @path token（未剥离）", () => {
    const text = "见 @notes/a.md";
    const chips: MessageAttachment[] = [];
    const merged = mergeAttachmentsWithScannedAtPaths(text, chips);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]!.path, "/notes/a.md");
    assert.ok(text.includes("@notes/a.md"));
  });

  it("T-AT6: chips 已有 path 且正文再写同一 @path → 去重仅一条", () => {
    const text = "再提 @notes/a.md";
    const chips: MessageAttachment[] = [
      {
        name: "a.md",
        source: "attach",
        type: "text",
        content: null,
        path: "notes/a.md",
      },
    ];
    const merged = mergeAttachmentsWithScannedAtPaths(text, chips);
    assert.equal(merged.length, 1);
    // 已有优先，保留原 path 写法
    assert.equal(merged[0]!.path, "notes/a.md");
  });

  it("允许多个不同 path 与中文路径；落库一律带前导 /", () => {
    const text = "见 @docs/说明.md 和 @foo/bar.txt";
    const scanned = scanAtPathAttachments(text);
    assert.equal(scanned.length, 2);
    assert.deepEqual(
      scanned.map((a) => a.path).sort(),
      ["/docs/说明.md", "/foo/bar.txt"],
    );
  });

  it("目录尾 /：type=dir，落库可保留尾 /，seen 去重去尾", () => {
    const scanned = scanAtPathAttachments("树 @notes/ @notes");
    assert.equal(scanned.length, 1);
    assert.equal(scanned[0]!.type, "dir");
    assert.equal(scanned[0]!.path, "/notes/");
  });
});

describe("attachmentsFromPaths（显式路径列表 → 合规新写入附件）", () => {
  it("name === attachmentStorageName(path)、action=userAttach、content=null、source=attach", () => {
    const [first] = attachmentsFromPaths(["notes/a.md"]);
    assert.ok(first);
    assert.equal(first.source, "attach");
    assert.equal(first.path, "/notes/a.md");
    assert.equal(first.name, attachmentStorageName("/notes/a.md"));
    assert.equal(first.name, "/notes/a.md");
    assert.equal(first.action, "userAttach");
    assert.equal(first.content, null);
  });

  it("产出形态可直接过 messageAttachmentsSchema.parse（落库硬 parse 非 safeParse）", () => {
    const built = attachmentsFromPaths([
      "notes/a.md",
      "notes/",
      "pic.png",
      "blob.bin",
    ]);
    // 牙齿的反面：合规形态必须 parse 通过（name 覆写 + action 补齐都在）。
    assert.doesNotThrow(() => messageAttachmentsSchema.parse(built));
  });

  it("牙齿：name 若沿用 basename（不覆写）必被 zod refine 拒绝", () => {
    const [first] = attachmentsFromPaths(["notes/a.md"]);
    assert.ok(first);
    const basenameForm: MessageAttachment = { ...first, name: "a.md" };
    // 带 action 时 name 必须是 attachmentStorageName(path)，basename 形态 100% 抛错。
    assert.throws(() => messageAttachmentsSchema.parse([basenameForm]));
  });

  it("重复路径按 seen key 去重（含相对写法与带前导 / 的同形路径）", () => {
    const built = attachmentsFromPaths([
      "notes/a.md",
      "/notes/a.md",
      "notes/a.md",
      "notes/b.md",
    ]);
    assert.equal(built.length, 2);
    assert.deepEqual(
      built.map((a) => a.path),
      ["/notes/a.md", "/notes/b.md"],
    );
  });

  it("目录 / 图片 / 二进制形态分派保留（type + 落库 path 形态）", () => {
    const built = attachmentsFromPaths(["notes/", "pic.png", "data.bin"]);
    assert.equal(built.length, 3);
    assert.equal(built[0]!.type, "dir");
    assert.equal(built[0]!.path, "/notes/");
    assert.equal(built[0]!.name, "/notes/");
    assert.equal(built[1]!.type, "image");
    assert.equal(built[1]!.path, "/pic.png");
    assert.equal(built[2]!.type, "text");
    assert.equal(built[2]!.path, "/data.bin");
    for (const a of built) {
      assert.equal(a.action, "userAttach");
      assert.equal(a.content, null);
      assert.equal(a.name, attachmentStorageName(a.path));
    }
  });

  it("空串 / 纯空白元素抛 AttachmentPathArgumentError（调用方转 ToolError）", () => {
    assert.throws(
      () => attachmentsFromPaths(["notes/a.md", ""]),
      AttachmentPathArgumentError,
    );
    assert.throws(() => attachmentsFromPaths(["   "]), AttachmentPathArgumentError);
  });

  it("空列表 → 空数组（不抛）", () => {
    assert.deepEqual(attachmentsFromPaths([]), []);
  });
});
