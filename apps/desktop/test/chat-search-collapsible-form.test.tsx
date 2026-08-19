/**
 * T-CF5：ChatHistorySearchPanel 源码契约——filter-card 折叠表单与摘要逻辑存在，
 *        且 ipcMessagesSearch / MessageList / 未找到匹配的聊天记录 三个被
 *        session-detail-drawer.test.ts 正则锁定的字符串原样保留。
 * T-CF6：MessageList 传 collapsibleMessageBody 时长文本渲染带 clamp 类、短消息不带；
 *        不传时零变化（与 message-list-stream.test.tsx 同风格 renderToStaticMarkup 断言）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatMessageDto } from "@shared/ipc-types";
import { MessageList } from "@/features/chat/MessageList";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rendererRoot = join(__dirname, "..", "renderer");

function readPanel(): string {
  return readFileSync(
    join(rendererRoot, "features", "chat", "ChatHistorySearchPanel.tsx"),
    "utf8",
  );
}

describe("ChatHistorySearchPanel 折叠表单 (T-CF5)", () => {
  it("源码：filter-card 折叠（button 切换 + 条件渲染）+ 成功自动收起 + 摘要", () => {
    const src = readPanel();
    // 折叠卡片容器与切换按钮（不用受控 details）
    assert.match(src, /chat-history-search__filter-card/);
    assert.match(src, /chat-history-search__filter-toggle/);
    assert.doesNotMatch(src, /<details/);
    // 展开态条件渲染表单
    assert.match(src, /\{formExpanded \? \(\s*<form/);
    // 查询命中自动收起（首次且非 append 且有结果）
    assert.match(src, /batch\.length > 0[\s\S]*?setFormExpanded\(false\)/);
    assert.match(src, /if \(append\)/);
    // 收起态摘要从筛选项 state 派生
    assert.match(src, /未设置筛选条件/);
    assert.match(src, /filterSummary/);
  });

  it("源码：三个被 session-detail-drawer.test.ts 锁定的字符串原样保留", () => {
    const src = readPanel();
    assert.match(src, /ipcMessagesSearch/);
    assert.match(src, /MessageList/);
    assert.match(src, /未找到匹配的聊天记录/);
  });
});

/** 构造最小可用 ChatMessageDto（contentBlocks 只放一个 TextBlock）。 */
function makeMessage(
  overrides: Partial<ChatMessageDto> & { id: string; text: string },
): ChatMessageDto {
  return {
    sessionId: "s1",
    seq: 1,
    role: "user",
    hidden: false,
    createdAtMs: 1,
    contentBlocks: [{ type: "text", text: overrides.text }],
    ...overrides,
  } as ChatMessageDto;
}

describe("MessageList 长消息折叠 (T-CF6)", () => {
  const longText = "这是一段很长的文本".repeat(30);
  const shortText = "短消息";

  it("传 collapsibleMessageBody 时：长文本带 clamp 类，短消息不带", () => {
    const html = renderToStaticMarkup(
      <MessageList
        messages={[
          makeMessage({ id: "m-long", text: longText }),
          makeMessage({ id: "m-short", text: shortText }),
        ]}
        collapsibleMessageBody
      />,
    );
    // 长文本消息体被 clamp wrapper 包裹（默认折叠态）
    assert.match(html, /chat-message__body-clamp(?!--expanded)/);
    // 短消息不进 wrapper（不带 clamp 类）
    const shortStart = html.indexOf(shortText);
    assert.ok(shortStart >= 0);
    const beforeShort = html.slice(Math.max(0, shortStart - 200), shortStart);
    assert.doesNotMatch(beforeShort, /chat-message__body-clamp/);
    // 两条消息正文都渲染出来了
    assert.match(html, new RegExp(longText));
    assert.match(html, new RegExp(shortText));
  });

  it("含换行的消息也视为长文本（与 mobile 静态溢出规则一致）", () => {
    const html = renderToStaticMarkup(
      <MessageList
        messages={[makeMessage({ id: "m-newline", text: "第一行\n第二行" })]}
        collapsibleMessageBody
      />,
    );
    assert.match(html, /chat-message__body-clamp(?!--expanded)/);
  });

  it("不传 collapsibleMessageBody 时零变化（无 clamp wrapper）", () => {
    const html = renderToStaticMarkup(
      <MessageList
        messages={[makeMessage({ id: "m-long", text: longText })]}
      />,
    );
    assert.doesNotMatch(html, /chat-message__body-clamp/);
    assert.match(html, new RegExp(longText));
  });
});
