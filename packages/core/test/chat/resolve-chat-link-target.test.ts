/**
 * resolveChatLinkTarget 单测（T-L1）：真机六形态样本 + scheme/协议相对/
 * 非法序列/大写 HTTP/盘符等边界用例。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chatLinkNotFoundMessage,
  elideChatLinkPath,
  isHttpUrl,
  resolveChatLinkTarget,
} from "../../src/domain/chat/logic/resolve-chat-link-target.js";

describe("resolveChatLinkTarget (T-L1)", () => {
  it("真机形态①：相对路径 → 补前导 / 归一化", () => {
    assert.equal(resolveChatLinkTarget("notes/a.md"), "/notes/a.md");
  });

  it("真机形态②：绝对路径 → 原样归一化", () => {
    assert.equal(resolveChatLinkTarget("/notes/a.md"), "/notes/a.md");
  });

  it("真机形态③：纯锚点 → null（webview 侧放行滚动，不进路由）", () => {
    assert.equal(resolveChatLinkTarget("#section-heading"), null);
  });

  it("真机形态④：不存在文件路径也返回归一化逻辑路径（存在性由宿主探测）", () => {
    assert.equal(resolveChatLinkTarget("missing/deep/file.md"), "/missing/deep/file.md");
  });

  it("真机形态⑤：中文 URL 编码 href → 解码后归一化", () => {
    assert.equal(
      resolveChatLinkTarget("%E7%AC%94%E8%AE%B0/%E5%A4%A7%E7%BA%B2.md"),
      "/笔记/大纲.md"
    );
  });

  it("真机形态⑥：协议相对地址 //host/path → null", () => {
    assert.equal(resolveChatLinkTarget("//example.com/x.md"), null);
  });

  it("锚点 + 路径混合：剥 fragment 后归一化", () => {
    assert.equal(resolveChatLinkTarget("notes/a.md#heading"), "/notes/a.md");
    assert.equal(resolveChatLinkTarget("/notes/a.md#"), "/notes/a.md");
  });

  it("中文路径未编码原样输入也能识别", () => {
    assert.equal(resolveChatLinkTarget("笔记/大纲.md"), "/笔记/大纲.md");
  });

  it("编码的中文锚点：纯锚点仍为 null", () => {
    assert.equal(resolveChatLinkTarget("#%E6%A0%87%E9%A2%98"), null);
  });

  it("http(s)/mailto scheme → null（交给外跳链路）", () => {
    assert.equal(resolveChatLinkTarget("https://example.com/a.md"), null);
    assert.equal(resolveChatLinkTarget("http://example.com"), null);
    assert.equal(resolveChatLinkTarget("mailto:someone@example.com"), null);
  });

  it("HTTP:// 大写 scheme → null（正则带 i 标志）", () => {
    assert.equal(resolveChatLinkTarget("HTTP://EXAMPLE.COM/x.md"), null);
    assert.equal(resolveChatLinkTarget("HTTPS://Example.com"), null);
  });

  it("C:/x 盘符形态 → null（单字母 + 冒号命中 scheme）", () => {
    assert.equal(resolveChatLinkTarget("C:/Users/a.md"), null);
    assert.equal(resolveChatLinkTarget("c:\\Users\\a.md"), null);
  });

  it("非法百分号序列 → 解码抛错返回 null", () => {
    assert.equal(resolveChatLinkTarget("%E4%ZZ%80"), null);
    assert.equal(resolveChatLinkTarget("a%.md"), null);
  });

  it("空 href / 空白 / 纯 # → null", () => {
    assert.equal(resolveChatLinkTarget(""), null);
    assert.equal(resolveChatLinkTarget("   "), null);
    assert.equal(resolveChatLinkTarget("#"), null);
  });

  it("相对段 `.`/`..` 归一化；`..` 越根 → null", () => {
    assert.equal(resolveChatLinkTarget("./notes/../b.md"), "/b.md");
    assert.equal(resolveChatLinkTarget("../../escape.md"), null);
  });
});

describe("isHttpUrl（MF-4 三端单源）", () => {
  it("http/https（含大写）→ true；其余形态 → false", () => {
    assert.equal(isHttpUrl("http://a.com/x"), true);
    assert.equal(isHttpUrl("https://a.com"), true);
    assert.equal(isHttpUrl("HTTP://A.com"), true);
    assert.equal(isHttpUrl("HTTPS://Example.com"), true);
    // 非 http(s)：工作区路径、锚点、mailto、盘符、协议相对、空串均非外跳
    assert.equal(isHttpUrl("/notes/a.md"), false);
    assert.equal(isHttpUrl("#foo"), false);
    assert.equal(isHttpUrl("mailto:a@b.com"), false);
    assert.equal(isHttpUrl("C:/x"), false);
    assert.equal(isHttpUrl("//host/p"), false);
    assert.equal(isHttpUrl(""), false);
  });
});

describe('chatLinkNotFoundMessage / elideChatLinkPath', () => {
  it('浅路径（两段内）与未超长度门槛的短路径不省略', () => {
    assert.equal(chatLinkNotFoundMessage('/测试/不存在的文件.md'), '/测试/不存在的文件.md 不存在');
    assert.equal(chatLinkNotFoundMessage('/x.md'), '/x.md 不存在');
    // 短而深（3 段但整体 ≤20 字符）：完整显示，不丢中间段
    assert.equal(elideChatLinkPath('/a/b/c/x.md'), '/a/b/c/x.md');
  });

  it('超长深层路径保留首段 + ... + 文件名', () => {
    assert.equal(
      elideChatLinkPath('/测试/1/1/1/1/1/1/1/1/1/s/sds/c/ds/x/不存在的文件.md'),
      '/测试.../不存在的文件.md',
    );
    // 长而浅（3 段但总长 >20）：省略中间段
    assert.equal(
      chatLinkNotFoundMessage('/notes/2026/report-final-draft.md'),
      '/notes.../report-final-draft.md 不存在',
    );
  });

  it('边界：纯 / 与尾斜杠原样、超长文件名单段不截断', () => {
    assert.equal(elideChatLinkPath('/'), '/');
    assert.equal(elideChatLinkPath('/a/b/'), '/a/b/');
    const longName = `/${'x'.repeat(60)}.md`;
    assert.equal(elideChatLinkPath(longName), longName);
  });
});
