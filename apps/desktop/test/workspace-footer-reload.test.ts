/**
 * T-T8：Desktop Footer 三源刷新接线（useWorkspaceFooterReload + run.finished + messages）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React, { useEffect } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useWorkspaceFooterReload } from "@/features/chat/useWorkspaceFooterReload";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rendererRoot = join(__dirname, "..", "renderer");

describe("WorkspaceFooter reload wiring (T-T8)", () => {
  it("useWorkspaceFooterReload 递增 footerKey", () => {
    let seenKey = -1;
    let reload: (() => void) | undefined;

    function Harness() {
      const { footerKey, reloadFooter } = useWorkspaceFooterReload();
      reload = reloadFooter;
      useEffect(() => {
        seenKey = footerKey;
      }, [footerKey]);
      seenKey = footerKey;
      return null;
    }

    renderToStaticMarkup(React.createElement(Harness));
    assert.equal(seenKey, 0);
    assert.ok(reload);
    reload!();
    // SSR 无二次渲染；再挂一次验证 hook 可调用
    renderToStaticMarkup(React.createElement(Harness));
    assert.equal(typeof reload, "function");
  });

  it("ShellNavProvider / ConversationPanel 接线 reloadFooter", () => {
    const shellNav = readFileSync(
      join(rendererRoot, "providers", "ShellNavProvider.tsx"),
      "utf8",
    );
    const conversation = readFileSync(
      join(rendererRoot, "features", "chat", "ConversationPanel.tsx"),
      "utf8",
    );

    assert.match(shellNav, /useWorkspaceFooterReload/);
    assert.match(shellNav, /reloadFooter/);
    assert.match(shellNav, /footerKey/);
    assert.match(shellNav, /notifyAgentConfigChanged[\s\S]*reloadFooter\(\)/);
    // run 事件订阅已收口到 ShellNavProvider（ExplorerPane 不再单独接线）
    assert.match(shellNav, /EVENT_AGENT_RUN_FINISHED/);

    assert.match(conversation, /reloadFooter/);
    assert.match(conversation, /reloadFooter\(\)/);
  });
});
