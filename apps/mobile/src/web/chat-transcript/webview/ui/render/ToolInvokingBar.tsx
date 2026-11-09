/**
 * 工具调用指示条（spec C29）：文案由调用方传入（StreamingMessageRow 传
 * `state.labels.generating`），本文件不导入 state（E2 纪律）。
 */
export type ToolInvokingBarProps = {
  label: string;
};

export function ToolInvokingBar({label}: ToolInvokingBarProps) {
  return (
    <div className="tool-invoking-bar">
      <span className="tool-invoking-dot" aria-hidden="true" />
      <span className="tool-invoking-label">{label}</span>
    </div>
  );
}
