/**
 * 工具「生成中」条。
 */
import { h } from 'preact';

export function ToolInvokingBar() {
  return (
    <div className="tool-invoking-bar">
      <span className="tool-invoking-dot" aria-hidden="true" />
      <span className="tool-invoking-label">生成中</span>
    </div>
  );
}
