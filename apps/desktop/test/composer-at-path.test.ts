/**
 * T-ATD*：`@路径` 插入、typeahead≤5、门闩以正文扫描为准。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { scanAtPathAttachments } from "@shared/logic/chat";
import {
  atPathTokensFromPickerSelection,
  countScannedAtPathAttachments,
  filterAtPathTypeaheadCandidates,
  findActiveAtQuery,
  formatComposerAtPathToken,
  replaceActiveAtWithToken,
} from "@/features/chat/composer-at-path";
import { resolveComposerSendIntent } from "@/features/chat/composer-send-intent";
import { renderComposerAtPathHighlightHtml } from "@/features/chat/ComposerAtPathInput";
import type { MessageAttachmentDto } from "@shared/ipc-types";

function att(
  partial: Partial<MessageAttachmentDto> &
    Pick<MessageAttachmentDto, "source" | "type">,
): MessageAttachmentDto {
  return {
    name: partial.name ?? partial.path ?? "x",
    content: null,
    path: partial.path ?? null,
    ...partial,
  };
}

test("T-ATD2: Picker 确认 token 为 @path；目录带尾 /；扫描落库带前导 /", () => {
  const tokens = atPathTokensFromPickerSelection(["/notes"], ["/a.md"]);
  assert.deepEqual(tokens, ["@/notes/", "@/a.md"]);
  const scanned = scanAtPathAttachments(tokens.join(" "));
  assert.equal(scanned.length, 2);
  assert.equal(scanned[0]!.path, "/notes/");
  assert.equal(scanned[0]!.type, "dir");
  assert.equal(scanned[1]!.path, "/a.md");
  assert.ok(scanned.every((a) => a.path!.startsWith("/")));
});

test("T-ATD3: 手输 @ 搜索列表 ≤5，点选替换为完整 @path", () => {
  const refs = [
    { path: "/a.md", kind: "file" as const },
    { path: "/ab.md", kind: "file" as const },
    { path: "/abc.md", kind: "file" as const },
    { path: "/abcd.md", kind: "file" as const },
    { path: "/abcde.md", kind: "file" as const },
    { path: "/abcdef.md", kind: "file" as const },
  ];
  const hits = filterAtPathTypeaheadCandidates(refs, "a", 5);
  assert.equal(hits.length, 5);

  const active = findActiveAtQuery("见 @ab", 5);
  assert.ok(active);
  assert.equal(active!.query, "ab");
  const token = formatComposerAtPathToken("/ab.md", false);
  const next = replaceActiveAtWithToken("见 @ab", 5, active!.start, token);
  assert.equal(next.text, "见 @/ab.md ");
  assert.ok(next.text.includes("@/ab.md"));
});

test("findActiveAtQuery: @/a.md 无尾空格为活跃；带尾空格则关闭", () => {
  const bare = "@/a.md";
  assert.ok(findActiveAtQuery(bare, bare.length));
  assert.equal(findActiveAtQuery(bare, bare.length)!.query, "/a.md");
  const withSpace = "@/a.md ";
  assert.equal(findActiveAtQuery(withSpace, withSpace.length), null);
});

test("T-ATD4: 删除正文 @path 后门闩扫描无该 path；draft attach 不参与", () => {
  const withAt = resolveComposerSendIntent({
    text: "看 @/a.md",
    attachments: [],
    hasPendingUserOps: false,
    canResumeWithoutInput: false,
    hasModel: true,
  });
  assert.equal(withAt.hasSendable, true);
  assert.equal(withAt.attachOnly.length, 0);
  assert.equal(countScannedAtPathAttachments("看 @/a.md"), 1);

  const without = resolveComposerSendIntent({
    text: "",
    attachments: [
      att({ source: "attach", type: "text", path: "/a.md", name: "a.md" }),
    ],
    hasPendingUserOps: false,
    canResumeWithoutInput: false,
    hasModel: true,
  });
  assert.equal(without.hasSendable, false);
  assert.equal(without.attachOnly.length, 0);
  assert.equal(countScannedAtPathAttachments(""), 0);
});

test("T-ATD2/门闩: 仅状态 workplace 仍可发；attachOnly 恒空", () => {
  const intent = resolveComposerSendIntent({
    text: "",
    attachments: [
      att({ source: "workplace", type: "text", path: "/w.md", name: "w.md" }),
    ],
    hasPendingUserOps: false,
    canResumeWithoutInput: false,
    hasModel: true,
  });
  assert.equal(intent.hasSendable, true);
  assert.equal(intent.attachOnly.length, 0);
  assert.equal(intent.hasWorkplaceDelta, true);
});

test("Step5: 高亮层 HTML 含 @token class；契约仍为纯字符串 value", () => {
  const text = "见 @/a.md 与补充";
  const html = renderComposerAtPathHighlightHtml(text);
  assert.match(html, /chat-composer__at-token/);
  assert.match(html, /@\/a\.md/);
  assert.equal(typeof text, "string");
  assert.equal(text.includes("<span"), false);
});
