/**
 * 聊天记录查询面板（desktop）。
 *
 * 在会话详情抽屉里点「查找聊天记录」后切入。复用 desktop 的
 * `MessageList` 渲染命中消息（包含隐藏消息，靠 MessageList 自带的
 * hidden 角标 + dimmed 区分，不再叠加 hiddenFilter）。
 *
 * 搜索三态用原生 `<button>` 实现 VSCode 风格：精准/正则二选一 + Aa
 * 大小写敏感 toggle；时间范围走两个原生 `<input type="date">`。
 * 搜索基于原始文本，不套 regex-apply。
 */
import { useCallback, useMemo, useState } from 'react';
import type { ChatMessageDto } from '@shared/ipc-types';
import { ipcMessagesSearch } from '@/ipc/client';
import { MessageList } from './MessageList';

interface ChatHistorySearchPanelProps {
  projectId: string;
  sessionId: string;
  onClose: () => void;
}

const SEARCH_LIMIT = 50;

/** 把 `<input type="date">` 的 YYYY-MM-DD 字符串按本地时区解析成 ms。 */
function dateStringToMs(
  value: string,
  endOfDay: boolean,
): number | undefined {
  if (!value) return undefined;
  // 用本地时区构造，避免 UTC 偏移把日期拉到前一天
  const [y, m, d] = value.split('-').map((n) => parseInt(n, 10));
  if (!y || !m || !d) return undefined;
  const base = new Date(y, m - 1, d);
  if (Number.isNaN(base.getTime())) return undefined;
  if (endOfDay) {
    base.setHours(23, 59, 59, 999);
  } else {
    base.setHours(0, 0, 0, 0);
  }
  return base.getTime();
}

export function ChatHistorySearchPanel({
  projectId: _projectId,
  sessionId,
  onClose,
}: ChatHistorySearchPanelProps) {
  const [keyword, setKeyword] = useState('');
  const [mode, setMode] = useState<'literal' | 'regex'>('literal');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [results, setResults] = useState<ChatMessageDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  /** 是否已经发起过一次查询，用来区分「初始空态」与「未命中」。 */
  const [hasSearched, setHasSearched] = useState(false);
  /** 上一批结果是否还有更早的可翻页（命中 LIMIT 视为可能还有）。 */
  const [hasMore, setHasMore] = useState(false);

  /** 当前结果集中最小的 seq，用作「加载更早」的 beforeSeq 游标。 */
  const minSeq = useMemo(() => {
    if (results.length === 0) return undefined;
    return results.reduce((acc, m) => {
      return acc == null || m.seq < acc ? m.seq : acc;
    }, undefined as number | undefined);
  }, [results]);

  const runQuery = useCallback(
    async (opts?: { beforeSeq?: number; append?: boolean }) => {
      const append = opts?.append ?? false;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setResults([]);
      }
      setError(undefined);

      const fromMs = dateStringToMs(fromDate, false);
      const toMs = dateStringToMs(toDate, true);

      try {
        const result = await ipcMessagesSearch({
          sessionId,
          keyword: keyword.trim() || undefined,
          mode,
          caseSensitive,
          fromMs,
          toMs,
          limit: SEARCH_LIMIT,
          beforeSeq: opts?.beforeSeq,
        });
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
          setHasSearched(true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        if (!append) {
          setHasSearched(true);
        }
      } finally {
        if (append) {
          setLoadingMore(false);
        } else {
          setLoading(false);
        }
      }
    },
    [sessionId, keyword, mode, caseSensitive, fromDate, toDate],
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

      <form className="chat-history-search__form" onSubmit={onSubmit}>
        <div className="chat-history-search__input-row">
          <input
            type="text"
            className="chat-history-search__keyword"
            data-session-detail-action="search-history-keyword"
            placeholder="输入关键词，回车搜索"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          {/* VSCode 风格三态切换：精准 / 正则 + Aa 大小写 */}
          <div className="chat-history-search__toggles" role="group" aria-label="搜索选项">
            <button
              type="button"
              className={`chat-history-search__toggle${
                mode === 'literal' ? ' chat-history-search__toggle--active' : ''
              }`}
              data-session-detail-action="search-history-mode-literal"
              aria-pressed={mode === 'literal'}
              title="精准匹配"
              onClick={() => setMode('literal')}
            >
              精准
            </button>
            <button
              type="button"
              className={`chat-history-search__toggle${
                mode === 'regex' ? ' chat-history-search__toggle--active' : ''
              }`}
              data-session-detail-action="search-history-mode-regex"
              aria-pressed={mode === 'regex'}
              title="正则匹配"
              onClick={() => setMode('regex')}
            >
              正则
            </button>
            <button
              type="button"
              className={`chat-history-search__toggle${
                caseSensitive ? ' chat-history-search__toggle--active' : ''
              }`}
              data-session-detail-action="search-history-case"
              aria-pressed={caseSensitive}
              title="区分大小写"
              onClick={() => setCaseSensitive((v) => !v)}
            >
              Aa
            </button>
          </div>
          <button
            type="submit"
            className="chat-history-search__submit"
            data-session-detail-action="search-history-submit"
            disabled={loading}
          >
            {loading ? '查询中…' : '查询'}
          </button>
        </div>

        <div className="chat-history-search__date-row">
          <label className="chat-history-search__date-label">
            起始
            <input
              type="date"
              className="chat-history-search__date"
              data-session-detail-action="search-history-from"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </label>
          <label className="chat-history-search__date-label">
            截止
            <input
              type="date"
              className="chat-history-search__date"
              data-session-detail-action="search-history-to"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </label>
        </div>
      </form>

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
            <MessageList messages={results} chatRichText />
            {hasMore && results.length > 0 ? (
              <div className="chat-history-search__more">
                <button
                  type="button"
                  className="chat-history-search__more-btn"
                  data-session-detail-action="search-history-load-more"
                  onClick={onLoadEarlier}
                  disabled={loadingMore}
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
