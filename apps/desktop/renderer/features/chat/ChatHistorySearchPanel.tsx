/**
 * 聊天记录查询面板（desktop）。
 *
 * 在会话详情抽屉里点「查找聊天记录」后切入。复用 desktop 的
 * `MessageList` 渲染命中消息（包含隐藏消息，靠 MessageList 自带的
 * hidden 角标 + dimmed 区分，不再叠加 hiddenFilter）。
 *
 * 查询支持关键词（大小写不敏感，由 core 统一处理）、seq 编号区间
 * （fromSeq/toSeq 闭区间，可只填一端）与 beforeSeq 翻页。搜索基于原始文本，
 * 不套 regex-apply。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ChatMessageDto } from '@shared/ipc-types';
import { ipcMessagesSearch } from '@/ipc/client';
import { MessageList } from './MessageList';

interface ChatHistorySearchPanelProps {
  projectId: string;
  sessionId: string;
  onClose: () => void;
}

const SEARCH_LIMIT = 50;

/** 归一编号输入：空串 / 非数字统一归一为 undefined（该侧不设限）。 */
function normalizeSeqInput(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

export function ChatHistorySearchPanel({
  projectId: _projectId,
  sessionId,
  onClose,
}: ChatHistorySearchPanelProps) {
  const [keyword, setKeyword] = useState('');
  const [fromSeqText, setFromSeqText] = useState('');
  const [toSeqText, setToSeqText] = useState('');

  const [results, setResults] = useState<ChatMessageDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  /** 筛选表单折叠卡片是否展开（默认展开；查询命中后自动收起）。 */
  const [formExpanded, setFormExpanded] = useState(true);
  /** 是否已经发起过一次查询，用来区分「初始空态」与「未命中」。 */
  const [hasSearched, setHasSearched] = useState(false);
  /** 上一批结果是否还有更早的可翻页（命中 LIMIT 视为可能还有）。 */
  const [hasMore, setHasMore] = useState(false);
  /**
   * 请求序号守卫：发请求前自增，响应落地前校验仍是最新序号，否则丢弃。
   * 与按钮互斥（loading || loadingMore）双保险：互斥挡住绝大多数场景，
   * 序号守卫兑住已发出的在途请求——旧 append 晚于新查询到达时不落地。
   */
  const requestSeqRef = useRef(0);

  /** 当前结果集中最小的 seq，用作「加载更早」的 beforeSeq 游标。 */
  const minSeq = useMemo(() => {
    if (results.length === 0) return undefined;
    return results.reduce((acc, m) => {
      return acc == null || m.seq < acc ? m.seq : acc;
    }, undefined as number | undefined);
  }, [results]);

  const runQuery = useCallback(
    async (opts?: { beforeSeq?: number; append?: boolean }) => {
      const fromSeq = normalizeSeqInput(fromSeqText);
      const toSeq = normalizeSeqInput(toSeqText);
      // 倒挂区间不发请求，给行内提示（PRD 验收 #6）。
      if (fromSeq != null && toSeq != null && fromSeq > toSeq) {
        setError('编号区间无效：起始编号不能大于截止编号');
        return;
      }
      const append = opts?.append ?? false;
      const seq = ++requestSeqRef.current;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setResults([]);
      }
      setError(undefined);

      try {
        const result = await ipcMessagesSearch({
          sessionId,
          keyword: keyword.trim() || undefined,
          limit: SEARCH_LIMIT,
          beforeSeq: opts?.beforeSeq,
          fromSeq,
          toSeq,
        });
        // 旧响应晚到（序号已过期）：丢弃，不落地 results/hasMore/表单收起等任何状态。
        if (seq !== requestSeqRef.current) {
          return;
        }
        if (!result.ok) {
          setError(result.error ?? '查询失败');
          if (!append) {
            setHasSearched(true);
          }
          return;
        }
        const batch = result.data;
        setHasMore(batch.length >= SEARCH_LIMIT);
        if (append) {
          setResults((prev) => [...prev, ...batch]);
        } else {
          setResults(batch);
          // 首次查询命中才收起表单：空结果算「未命中」不算成功，倒挂与异常分支不会走到这里。
          if (batch.length > 0) {
            setFormExpanded(false);
          }
          setHasSearched(true);
        }
      } catch (err) {
        // 过期请求的异常同样不进 UI（旧请求的报错不该覆盖新查询的状态）。
        if (seq !== requestSeqRef.current) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        if (!append) {
          setHasSearched(true);
        }
      } finally {
        // loading 标志由各自请求自行复位：互斥下同一时刻只有一条本类请求在途，
        // 过期分支在这里清掉自己占住的标志，不会误伤最新请求。
        if (append) {
          setLoadingMore(false);
        } else {
          setLoading(false);
        }
      }
    },
    [sessionId, keyword, fromSeqText, toSeqText],
  );

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void runQuery();
    },
    [runQuery],
  );

  const onLoadEarlier = useCallback(() => {
    if (minSeq == null) return;
    void runQuery({ beforeSeq: minSeq, append: true });
  }, [minSeq, runQuery]);

  const showEmpty = hasSearched && !loading && results.length === 0;

  // 收起态摘要直接从筛选项 state 派生，不另存一份；输入值在收起卸载表单时不丢。
  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    const trimmedKeyword = keyword.trim();
    if (trimmedKeyword.length > 0) {
      parts.push(`关键词 "${trimmedKeyword}"`);
    }
    const fromSeq = normalizeSeqInput(fromSeqText);
    const toSeq = normalizeSeqInput(toSeqText);
    if (fromSeq != null || toSeq != null) {
      parts.push(`#${fromSeq ?? "起"}–${toSeq ?? "止"}`);
    }
    return parts.length > 0 ? parts.join(" · ") : "未设置筛选条件";
  }, [keyword, fromSeqText, toSeqText]);

  return (
    <div className="chat-history-search" data-session-detail-action="search-history-panel">
      <div className="chat-history-search__head">
        <button
          type="button"
          className="chat-history-search__back"
          data-session-detail-action="search-history-back"
          onClick={onClose}
          aria-label="返回会话详情"
        >
          ‹
        </button>
        <span className="chat-history-search__title">查找聊天记录</span>
      </div>

      <div
        className={`chat-history-search__filter-card${
          formExpanded ? "" : " chat-history-search__filter-card--collapsed"
        }`}
      >
        <button
          type="button"
          className="chat-history-search__filter-toggle"
          data-session-detail-action="search-history-filter-toggle"
          aria-expanded={formExpanded}
          onClick={() => setFormExpanded((v) => !v)}
        >
          <span className="chat-history-search__filter-title">筛选条件</span>
          {!formExpanded ? (
            <span className="chat-history-search__filter-summary">
              {filterSummary}
            </span>
          ) : null}
          <span className="chat-history-search__filter-chevron">
            {formExpanded ? "▼" : "▶"}
          </span>
        </button>
        {formExpanded ? (
          <form className="chat-history-search__form" onSubmit={onSubmit}>
            <div className="chat-history-search__section-label">关键词</div>
            <div className="chat-history-search__input-row">
              <input
                type="text"
                className="chat-history-search__keyword"
                data-session-detail-action="search-history-keyword"
                placeholder="关键词"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
              <button
                type="submit"
                className="chat-history-search__submit"
                data-session-detail-action="search-history-submit"
                disabled={loading || loadingMore}
              >
                {loading ? "查询中…" : "查询"}
              </button>
            </div>
            <div className="chat-history-search__section-label chat-history-search__section-label--with-hint">
              编号区间
              <span className="chat-history-search__section-hint">留空不限</span>
            </div>
            <div className="chat-history-search__input-row">
              <input
                type="text"
                inputMode="numeric"
                className="chat-history-search__seq"
                data-session-detail-action="search-history-from-seq"
                placeholder="从 #"
                value={fromSeqText}
                onChange={(e) => setFromSeqText(e.target.value.replace(/[^0-9]/g, ""))}
              />
              <span className="chat-history-search__seq-dash">–</span>
              <input
                type="text"
                inputMode="numeric"
                className="chat-history-search__seq"
                data-session-detail-action="search-history-to-seq"
                placeholder="到 #"
                value={toSeqText}
                onChange={(e) => setToSeqText(e.target.value.replace(/[^0-9]/g, ""))}
              />
            </div>
          </form>
        ) : null}
      </div>

      {error ? (
        <p className="chat-history-search__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="chat-history-search__results">
        {loading ? (
          <p className="chat-history-search__loading">查询中…</p>
        ) : showEmpty ? (
          <p className="chat-history-search__empty">未找到匹配的聊天记录</p>
        ) : (
          <>
            <MessageList messages={results} chatRichText collapsibleMessageBody />
            {hasMore && results.length > 0 ? (
              <div className="chat-history-search__more">
                <button
                  type="button"
                  className="chat-history-search__more-btn"
                  data-session-detail-action="search-history-load-more"
                  onClick={onLoadEarlier}
                  disabled={loading || loadingMore}
                >
                  {loadingMore ? '加载中…' : '加载更早'}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
