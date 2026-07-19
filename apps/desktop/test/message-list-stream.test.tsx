import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageList } from "@/features/chat/MessageList";

/** T-S2：run 全程 uiRunning 时 stream tail「生成中」始终可见。 */
test("T-S2: uiRunning 无 delta 时仍渲染 stream tail 生成中", () => {
  const html = renderToStaticMarkup(
    <MessageList messages={[]} uiRunning />,
  );
  assert.match(html, /chat-message__stream-tail/);
  assert.match(html, /生成中/);
});

test("T-S2: uiRunning 且有 streamingText 时仍渲染生成中", () => {
  const html = renderToStaticMarkup(
    <MessageList
      messages={[]}
      uiRunning
      streamingText="partial reply"
    />,
  );
  assert.match(html, /chat-message__stream-tail/);
  assert.match(html, /生成中/);
  assert.match(html, /partial reply/);
});

test("T-S2: uiRunning=false 时不渲染 stream tail", () => {
  const html = renderToStaticMarkup(
    <MessageList messages={[]} uiRunning={false} />,
  );
  assert.doesNotMatch(html, /chat-message__stream-tail/);
});

test("T-SR3：空正文 + attachments 渲染附件摘要卡", () => {
  // Chip 文案跟 Core 中文映射（mkdir → 建目），勿断言英文 mkdir:/…
  const html = renderToStaticMarkup(
    <MessageList
      messages={[
        {
          id: "u-ops",
          sessionId: "s1",
          seq: 1,
          role: "user",
          hidden: false,
          createdAtMs: 1,
          bodyText: "",
          contentBlocks: [{ type: "text", text: "" }],
          attachments: [
            {
              name: "mkdir:/notes",
              source: "user_ops",
              type: "text",
              content: null,
              path: "/notes",
              action: "mkdir",
            },
          ],
        },
      ]}
    />,
  );
  assert.match(html, /消息附件/);
  assert.match(html, /建目:\/notes/);
  assert.doesNotMatch(html, /暂无消息/);
});
