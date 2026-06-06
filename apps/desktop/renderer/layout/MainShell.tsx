import type { RefObject } from "react";
import { ChatRail } from "./ChatRail";
import { ExplorerPane } from "./ExplorerPane";
import { PreviewPane } from "./PreviewPane";

interface MainShellProps {
  workspaceRef: RefObject<HTMLDivElement | null>;
}

export function MainShell({ workspaceRef }: MainShellProps) {
  return (
    <div className="workspace" ref={workspaceRef}>
        <PreviewPane />

        <div
          className="column-splitter"
          id="splitter-preview-explorer"
          data-splitter="preview-explorer"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整预览区与工作区宽度"
          tabIndex={0}
        />

        <ExplorerPane />

        <div
          className="column-splitter"
          id="splitter-explorer-chat"
          data-splitter="explorer-chat"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整工作区与聊天区宽度"
          tabIndex={0}
        />

        <ChatRail />
    </div>
  );
}
