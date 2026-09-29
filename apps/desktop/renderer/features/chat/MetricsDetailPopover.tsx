/**
 * 指标条用量详情弹窗（metric-detail-sheet Step 3，T-MD4）。
 *
 * 外壳 MetricsDetailPopover：锚定指标条按钮（Tooltip 先例——
 * getBoundingClientRect 定位 + createPortal 挂 body + 外点关闭）；
 * 打开时经 ipcUsageStatsQuery({kind:"sessionDetail"}) 自取会话维度
 * 详情 + 加载态。「上下文占用」行不做新取数——直接渲染父层传入的
 * contextUsageLabel（drawer 同通道 ipcPromptChatTokenLabel 返回的
 * stats.label，main 侧 core formatContextUsageLabel 单源拼好，X1）。
 *
 * 内容拆出纯渲染组件 MetricsDetailPanel 与自取 hook
 * useSessionUsageDetail（node:test 无 DOM，react-test-renderer 渲不了
 * createPortal——与 ContextMenu stub 同理，portal 外壳不进组件测试）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
// X1 门禁：renderer 不 import core，formatTokenCount 走 shared 镜像。
import { formatTokenCount } from "@shared/logic/format-token-count";
import { formatHitRate, hitRate } from "@shared/logic/hit-rate";
import { ipcUsageStatsQuery } from "@/ipc/client";
import type { SessionUsageDetailDto } from "@shared/ipc-types";

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 8;

/** 单行计费口径输入（与 core BILLED_INPUT_SUM_SQL 的单行版一致）。 */
function lastRowBilledInput(last: NonNullable<SessionUsageDetailDto["last"]>): number {
  const hasCacheColumns =
    last.cacheReadTokens != null || last.cacheCreationTokens != null;
  if (!hasCacheColumns) {
    return last.promptTokens;
  }
  // anthropic 的 input_tokens 不含 cache，须加回 cache 双列；其余协议
  // prompt 已含 cached（与统计页口径一致，公式单源随 tl 后续抽 core）。
  return last.provider === "anthropic"
    ? last.promptTokens +
        (last.cacheReadTokens ?? 0) +
        (last.cacheCreationTokens ?? 0)
    : last.promptTokens;
}

/**
 * 会话维度详情自取 hook：mount 即查（弹窗外壳按 open 条件挂载），
 * 竞态守卫（sessionId 切换后旧响应后到不覆盖）。
 */
export function useSessionUsageDetail(
  sessionId: string
): { detail: SessionUsageDetailDto | null; loading: boolean; error: string | null } {
  const [detail, setDetail] = useState<SessionUsageDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    ipcUsageStatsQuery({
      kind: "sessionDetail",
      sessionId,
      // filter 为必填字段：sessionDetail 携带空对象占位（handler 不读）。
      filter: {},
    })
      .then((res) => {
        if (cancelled) {
          return;
        }
        if (res.ok) {
          setDetail(res.data as SessionUsageDetailDto);
          setLoading(false);
        } else {
          setError(res.error.message);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return { detail, loading, error };
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="metrics-detail-popover__section-title">{children}</div>
  );
}

function Row({
  label,
  value,
  testKey,
}: {
  label: string;
  value: string;
  testKey: string;
}) {
  return (
    <div className="metrics-detail-popover__row" data-row={testKey}>
      <span className="metrics-detail-popover__row-label">{label}</span>
      <span className="metrics-detail-popover__row-value">{value}</span>
    </div>
  );
}

/** 两段面板（纯渲染）：最近请求 / 会话累计 + 口径脚注。导出供组件测试直测。 */
export function MetricsDetailPanel({
  detail,
  loading,
  error,
  contextUsageLabel,
}: {
  detail: SessionUsageDetailDto | null;
  loading: boolean;
  error: string | null;
  /** 与 drawer/chip 同源的上下文占用现成读数（不新增取数，P0-2 拍板）。 */
  contextUsageLabel: string | null;
}) {
  if (loading) {
    return (
      <div className="metrics-detail-popover__loading" data-state="loading">
        加载中…
      </div>
    );
  }
  if (error != null) {
    return (
      <div className="metrics-detail-popover__error" data-state="error">
        {error}
      </div>
    );
  }
  const last = detail?.last ?? null;
  return (
    <div className="metrics-detail-popover__content" data-state="ready">
      <div className="metrics-detail-popover__title">用量详情</div>
      <SectionTitle>最近请求</SectionTitle>
      {last == null ? (
        <div className="metrics-detail-popover__empty" data-row="last-empty">
          暂无请求记录
        </div>
      ) : (
        <>
          <Row
            testKey="last-model"
            label="模型"
            value={last.modelName ?? "—"}
          />
          <Row
            testKey="last-input"
            label="输入"
            value={formatTokenCount(last.promptTokens)}
          />
          <Row
            testKey="last-output"
            label="输出"
            value={formatTokenCount(last.completionTokens)}
          />
          <Row
            testKey="last-cache-read"
            label="缓存读取"
            value={
              last.cacheReadTokens == null
                ? "—"
                : formatTokenCount(last.cacheReadTokens)
            }
          />
          <Row
            testKey="last-cache-creation"
            label="缓存写入"
            value={
              last.cacheCreationTokens == null
                ? "—"
                : formatTokenCount(last.cacheCreationTokens)
            }
          />
          <Row
            testKey="last-hit-rate"
            label="缓存命中率"
            value={formatHitRate(
              hitRate(last.cacheReadTokens, lastRowBilledInput(last))
            )}
          />
        </>
      )}
      <SectionTitle>会话累计</SectionTitle>
      <Row
        testKey="totals-visible-messages"
        label="消息数（可见）"
        value={String(detail?.visibleMessageCount ?? 0)}
      />
      <Row
        testKey="totals-tool-use"
        label="工具调用"
        value={String(detail?.toolUseCount ?? 0)}
      />
      <Row
        testKey="context-usage"
        label="上下文占用"
        value={contextUsageLabel ?? "—"}
      />
      <div className="metrics-detail-popover__footnote">
        消息数为可见口径 · 工具调用含已隐藏消息
        <br />
        最近请求为单步真值，与指标条整轮读数不同源
      </div>
    </div>
  );
}

/** 弹窗外壳：定位（锚点下方，视口内钳制）+ 外点关闭 + 数据自取。 */
export function MetricsDetailPopover({
  anchorEl,
  sessionId,
  contextUsageLabel,
  onClose,
}: {
  anchorEl: HTMLElement;
  sessionId: string;
  contextUsageLabel: string | null;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const { detail, loading, error } = useSessionUsageDetail(sessionId);

  // 定位：锚点正下方、与锚点左对齐（右侧越界时钳回视口），Tooltip 先例。
  useLayoutEffect(() => {
    const rect = anchorEl.getBoundingClientRect();
    const top = Math.min(
      rect.bottom + ANCHOR_GAP,
      window.innerHeight - VIEWPORT_MARGIN
    );
    const left = Math.max(VIEWPORT_MARGIN, rect.left);
    setPosition({ top, left });
  }, [anchorEl]);

  // 外点关闭：mousedown 落在面板与锚点之外即回调关闭（capture 捕获阶段判定）。
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        target != null &&
        !panelRef.current?.contains(target) &&
        !anchorEl.contains(target)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onPointerDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
    };
  }, [anchorEl, onClose]);

  // Esc 关闭（键盘可达性，与 menu 类弹层一致）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={panelRef}
      className="metrics-detail-popover"
      role="dialog"
      aria-label="用量详情"
      style={{ top: position.top, left: position.left }}
    >
      <MetricsDetailPanel
        detail={detail}
        loading={loading}
        error={error}
        contextUsageLabel={contextUsageLabel}
      />
    </div>,
    document.body
  );
}
