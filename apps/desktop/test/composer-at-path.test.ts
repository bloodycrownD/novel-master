/**
 * T-ATD*：`@路径` 插入、typeahead≤5、门闩以正文扫描为准。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { attachmentScanner } from "@shared/logic/chat";
import { composerAtPath } from "@/features/chat/composer-at-path";
import { composerSendPolicy } from "@/features/chat/composer-send-intent";
import { renderComposerAtPathHighlightHtml } from "@/features/chat/ComposerAtPathInput";

test("T-ATD2: Picker 确认 token 为 @path；目录带尾 /；扫描落库带前导 /", () => {
  const tokens = composerAtPath.tokensFromPickerSelection(["/notes"], ["/a.md"]);
  assert.deepEqual(tokens, ["@/notes/", "@/a.md"]);
  const scanned = attachmentScanner.scanAtPaths(tokens.join(" "));
  assert.equal(scanned.length, 2);
  assert.equal(scanned[0]!.path, "/notes/");
  assert.equal(scanned[0]!.type, "dir");
  assert.equal(scanned[1]!.path, "/a.md");
  assert.ok(scanned.every((a) => a.path!.startsWith("/")));
});

test("T-ATD3: 点选替换为完整 @path", () => {
  const active = composerAtPath.detectQuery("见 @ab", 5);
  assert.ok(active);
  assert.equal(active!.query, "ab");
  const token = composerAtPath.formatToken("/ab.md", false);
  const next = composerAtPath.replaceToken("见 @ab", 5, active!.start, token);
  assert.equal(next.text, "见 @/ab.md ");
  assert.ok(next.text.includes("@/ab.md"));
});

test("findActiveAtQuery: @/a.md 无尾空格为活跃；带尾空格则关闭", () => {
  const bare = "@/a.md";
  assert.ok(composerAtPath.detectQuery(bare, bare.length));
  assert.equal(composerAtPath.detectQuery(bare, bare.length)!.query, "/a.md");
  const withSpace = "@/a.md ";
  assert.equal(composerAtPath.detectQuery(withSpace, withSpace.length), null);
});

test("T-ATD4: 删除正文 @path 后门闩扫描无该 path", () => {
  const withAt = composerSendPolicy.evaluate({
    text: "看 @/a.md",
    canResumeWithoutInput: false,
    hasModel: true,
  });
  assert.equal(withAt.hasSendable, true);
  assert.equal(withAt.attachOnly.length, 0);
  assert.equal(attachmentScanner.scanAtPaths("看 @/a.md").length, 1);

  const without = composerSendPolicy.evaluate({
    text: "",
    canResumeWithoutInput: false,
    hasModel: true,
  });
  assert.equal(without.hasSendable, false);
  assert.equal(without.attachOnly.length, 0);
  assert.equal(attachmentScanner.scanAtPaths("").length, 0);
});

test("T-CR3/门闩: 空输入 → 不可发；attachOnly 恒空", () => {
  const intent = composerSendPolicy.evaluate({
    text: "",
    canResumeWithoutInput: false,
    hasModel: true,
  });
  assert.equal(intent.hasSendable, false);
  assert.equal(intent.sendDisabled, true);
  assert.equal(intent.attachOnly.length, 0);
});

test("Step5: 高亮层 HTML 含 @token class；契约仍为纯字符串 value", () => {
  const text = "见 @/a.md 与补充";
  const html = renderComposerAtPathHighlightHtml(text);
  assert.match(html, /chat-composer__at-token/);
  assert.match(html, /@\/a\.md/);
  assert.equal(typeof text, "string");
  assert.equal(text.includes("<span"), false);
});

test("Step20: `$技能` token 同样高亮，且不与 `@` token 互相吞并", () => {
  const html = renderComposerAtPathHighlightHtml("用 $write-docs 和 @/a.md 孤立 $");
  const spans = html.match(/<span class="chat-composer__at-token">([^<]*)<\/span>/g) ?? [];
  assert.ok(spans.includes('<span class="chat-composer__at-token">$write-docs</span>'));
  assert.ok(spans.includes('<span class="chat-composer__at-token">@/a.md</span>'));
  assert.equal(spans.length, 2);
  // 孤立 `$`（后接空白）不成 token，保持原文
  assert.match(html, /孤立 \$/);
});
