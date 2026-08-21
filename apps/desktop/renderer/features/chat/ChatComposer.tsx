import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  EffectiveSkillDto,
  MessageAttachmentDto,
  WorkplaceListRowDto,
} from "@shared/ipc-types";
import { useAutoResizeTextarea } from "@/hooks/useAutoResizeTextarea";
import { handleMultilineSubmitKeyDown } from "@/utils/textarea-enter-shortcuts";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  ipcAgentRun,
  ipcPreferencesGetLlmStream,
  ipcPromptAgentMeta,
  ipcSessionsProjectComposerStatus,
  ipcSkillsEffective,
  ipcWorkplaceBuildListRows,
  onComposerAttachmentsSuggest,
  onUserMessageAppended,
  vfsScope,
} from "@/ipc/client";
import { useShellNav } from "@/providers/ShellNavProvider";
import { ComposerStatusChips } from "./AttachmentDraftChips";
import { AtPathTypeahead } from "./AtPathTypeahead";
import { ComposerAtPathInput } from "./ComposerAtPathInput";
import {
  type AtPathRef,
  filterAtPathTypeaheadCandidates,
  findActiveAtQuery,
  replaceActiveAtWithToken,
} from "./composer-at-path";
import {
  clearChatAnnotateDrafts,
  hasChatAnnotateDrafts,
  listChatAnnotateDrafts,
  subscribeChatAnnotateDraft,
  unionComposerStatusWithAnnotate,
} from "./chat-annotate-draft";
import {
  shouldClearComposerBodyAfterAgentStarted,
  shouldClearComposerBodyOnUserMessageAppended,
} from "./composer-body-clear";
import { resolveComposerSendIntent } from "./composer-send-intent";
import { FileReferencePicker } from "./FileReferencePicker";
import { SkillTypeahead } from "./SkillTypeahead";
import { SkillPicker } from "@/features/skills/SkillPicker";

interface ChatComposerProps {
  projectId: string;
  sessionId: string;
  value: string;
  onChange: (text: string) => void;
  attachments: readonly MessageAttachmentDto[];
  onAttachmentsChange: (attachments: MessageAttachmentDto[]) => void;
  running: boolean;
  /** 末条为 user 时可空发续跑。 */
  canResumeWithoutInput: boolean;
  /** 末条为 plain user 文本时禁用输入。 */
  lastMessageIsPlainUserText: boolean;
  /** 受控内联错误（由 ConversationPanel 提升状态）。 */
  error?: string;
  /** 内联错误变更回调；未传入时回退到组件内 local state。 */
  onErrorChange?: (msg: string | undefined) => void;
  beginUiRun: () => void;
  abortUiRun: () => void;
  onStreamReset: () => void;
  onMessagesChanged: () => void | Promise<void>;
  /** 打开会话操作菜单；由父级定位并渲染菜单。 */
  onOpenSessionActions?: (anchor: HTMLElement) => void;
}

function rowsToAtPathRefs(rows: readonly WorkplaceListRowDto[]): AtPathRef[] {
  return rows
    .filter((r) => r.path !== "/")
    .map((r) => ({
      path: r.path,
      kind: r.kind === "dir" ? ("dir" as const) : ("file" as const),
    }));
}

export function ChatComposer({
  projectId,
  sessionId,
  value,
  onChange,
  attachments,
  onAttachmentsChange,
  running,
  canResumeWithoutInput,
  lastMessageIsPlainUserText,
  error: controlledError,
  onErrorChange,
  beginUiRun,
  abortUiRun,
  onStreamReset,
  onMessagesChanged,
  onOpenSessionActions,
}: ChatComposerProps) {
  const { agentConfigRevision } = useShellNav();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [localError, setLocalError] = useState<string | undefined>();
  const [hasModel, setHasModel] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [typeaheadRows, setTypeaheadRows] = useState<WorkplaceListRowDto[]>([]);
  const [skillRows, setSkillRows] = useState<EffectiveSkillDto[]>([]);

  const checkModel = useCallback(async () => {
    const result = await ipcPromptAgentMeta({ projectId, sessionId });
    if (result.ok) {
      setHasModel(
        result.data.modelLabel !== "未选择模型" && result.data.modelLabel !== "—",
      );
    }
  }, [projectId, sessionId]);

  useEffect(() => {
    void checkModel();
  }, [checkModel, sessionId, agentConfigRevision]);

  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;

  useEffect(() => {
    return onComposerAttachmentsSuggest(payload => {
      if (payload.sessionId !== sessionId) {
        return;
      }
      onAttachmentsChange(
        unionComposerStatusWithAnnotate(payload.attachments, sessionId),
      );
    });
  }, [sessionId, onAttachmentsChange]);

  // annotate store 变更时重合并状态条（删光 path → chip 消失等）
  useEffect(() => {
    return subscribeChatAnnotateDraft((changedSessionId) => {
      if (changedSessionId !== sessionId) {
        return;
      }
      onAttachmentsChange(
        unionComposerStatusWithAnnotate(
          attachmentsRef.current.filter((a) => a.action !== "annotate"),
          sessionId,
        ),
      );
    });
  }, [sessionId, onAttachmentsChange]);

  // 仅 append 成功推送后清 annotate + 正文（禁止 started:true 清；B4 对齐 Mobile）。
  // annotate：发送后 main 已清 store；此处清 chip 即可（禁止 renderer 直接写 store）。
  // 始终按 payload.sessionId 清 annotate store，避免切会话后漏清、再回来重带旧批注。
  useEffect(() => {
    return onUserMessageAppended((payload) => {
      clearChatAnnotateDrafts(payload.sessionId);
      if (
        !shouldClearComposerBodyOnUserMessageAppended(
          payload.sessionId,
          sessionId,
        )
      ) {
        return;
      }
      onChange("");
      // projected 一并清空（发送后 chip 空）；annotate store 已清，无需再 ∪
      onAttachmentsChange([]);
    });
  }, [sessionId, onAttachmentsChange, onChange]);

  useAutoResizeTextarea(textareaRef, value, 200);

  const activeAt = useMemo(
    () => findActiveAtQuery(value, cursor),
    [value, cursor],
  );

  // `$技能名` 手输查询：与 `@` 共用参数化 trigger，空白边界天然互斥
  const activeSkill = useMemo(
    () => findActiveAtQuery(value, cursor, "$"),
    [value, cursor],
  );

  useEffect(() => {
    if (activeAt == null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const result = await ipcWorkplaceBuildListRows(
        vfsScope("session", projectId, sessionId),
      );
      if (cancelled || !result.ok) {
        return;
      }
      setTypeaheadRows(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeAt != null, projectId, sessionId]);

  // 技能候选走 IPC effective（合并视图），不走工作区浏览器
  useEffect(() => {
    if (activeSkill == null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const result = await ipcSkillsEffective({ projectId });
      if (cancelled || !result.ok) {
        return;
      }
      setSkillRows(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSkill != null, projectId]);

  const typeaheadCandidates = useMemo(() => {
    if (activeAt == null) {
      return [];
    }
    return filterAtPathTypeaheadCandidates(
      rowsToAtPathRefs(typeaheadRows),
      activeAt.query,
      5,
    );
  }, [activeAt, typeaheadRows]);

  // 名称/描述模糊匹配，最多 5 条；无效技能不出现（手打 token 由 hydrate 容错）
  const skillTypeaheadCandidates = useMemo(() => {
    if (activeSkill == null) {
      return [];
    }
    const q = activeSkill.query.toLowerCase();
    return skillRows
      .filter((s) => s.valid)
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.description ?? "").toLowerCase().includes(q),
      )
      .slice(0, 5);
  }, [activeSkill, skillRows]);

  const isControlled = onErrorChange != null;
  const displayError = isControlled ? controlledError : localError;

  const reportError = useCallback(
    (msg: string | undefined) => {
      if (onErrorChange) {
        onErrorChange(msg);
      } else {
        setLocalError(msg);
      }
    },
    [onErrorChange],
  );

  const insertTokensIntoComposer = useCallback(
    (tokens: readonly string[]) => {
      if (tokens.length === 0) {
        return;
      }
      const el = textareaRef.current;
      const selStart = el?.selectionStart ?? value.length;
      const selEnd = el?.selectionEnd ?? selStart;
      // 有未完成 @…/$… 时从 trigger 起替换到光标，避免残留半截查询
      const activeTokenQuery = activeAt ?? activeSkill;
      const replaceStart = activeTokenQuery != null ? activeTokenQuery.start : selStart;
      const replaceEnd = activeTokenQuery != null ? selStart : selEnd;
      const before = value.slice(0, replaceStart);
      const after = value.slice(replaceEnd);
      const gapBefore =
        before.length === 0 || /\s$/.test(before) ? "" : " ";
      const joined = tokens.join(" ");
      // 对齐 replaceActiveAtWithToken：after 为空或非空白开头时补尾空格
      const gapAfter =
        after.length === 0 || !/^\s/.test(after) ? " " : "";
      const inserted = `${gapBefore}${joined}${gapAfter}`;
      const next = `${before}${inserted}${after}`;
      onChange(next);
      const nextCursor = before.length + inserted.length;
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta != null) {
          ta.focus();
          ta.setSelectionRange(nextCursor, nextCursor);
          setCursor(nextCursor);
        }
      });
    },
    [activeAt, activeSkill, onChange, value],
  );

  const applyTypeaheadToken = useCallback(
    (token: string) => {
      if (activeAt == null) {
        return;
      }
      const next = replaceActiveAtWithToken(
        value,
        cursor,
        activeAt.start,
        token,
      );
      onChange(next.text);
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta != null) {
          ta.focus();
          ta.setSelectionRange(next.cursor, next.cursor);
          setCursor(next.cursor);
        }
      });
    },
    [activeAt, cursor, onChange, value],
  );

  // 点选技能建议：插 `$技能名` token 并补尾空格
  const applySkillToken = useCallback(
    (name: string) => {
      if (activeSkill == null) {
        return;
      }
      const next = replaceActiveAtWithToken(
        value,
        cursor,
        activeSkill.start,
        `$${name}`,
      );
      onChange(next.text);
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta != null) {
          ta.focus();
          ta.setSelectionRange(next.cursor, next.cursor);
          setCursor(next.cursor);
        }
      });
    },
    [activeSkill, cursor, onChange, value],
  );

  const runAgent = useCallback(
    async (content: string, allowResumeWithoutInput: boolean) => {
      const modelCheck = await ipcPromptAgentMeta({ projectId, sessionId });
      if (
        modelCheck.ok &&
        (modelCheck.data.modelLabel === "未选择模型" ||
          modelCheck.data.modelLabel === "—")
      ) {
        reportError("请先配置模型");
        return false;
      }

      reportError(undefined);
      onStreamReset();
      beginUiRun();

      // workplace 走常驻前缀 S0 注入，不构造附件；文件引用由 Core 扫描正文 `@path` 生成 attach
      // B4：禁止 started:true 清正文/projected；append 推送后再清（对齐 Mobile）
      // annotate：禁止在 started 清 store；reproject 时 ∪ store 保留至 append
      const annotateDrafts = listChatAnnotateDrafts(sessionId);

      const streamResult = await ipcPreferencesGetLlmStream();
      const stream = streamResult.ok ? streamResult.data : true;
      const result = await ipcAgentRun({
        projectId,
        sessionId,
        userContent: content,
        stream,
        allowResumeWithoutInput,
        annotateDrafts:
          annotateDrafts.length > 0 ? annotateDrafts : undefined,
      });

      if (!result.ok) {
        reportError(result.error.message);
        abortUiRun();
        return false;
      }

      // B4：started 不清正文（契约由 shouldClearComposerBodyAfterAgentStarted 钉死）
      if (shouldClearComposerBodyAfterAgentStarted()) {
        onChange("");
      }

      await onMessagesChanged();
      const statusRes = await ipcSessionsProjectComposerStatus({ sessionId });
      if (statusRes.ok) {
        // 用 live ref：若 append 已晚清 attachments，避免 stale previous 写回
        onAttachmentsChange(
          unionComposerStatusWithAnnotate(statusRes.data, sessionId),
        );
      }
      return true;
    },
    [
      abortUiRun,
      beginUiRun,
      onMessagesChanged,
      onStreamReset,
      projectId,
      reportError,
      sessionId,
      onChange,
      onAttachmentsChange,
    ],
  );

  const send = async () => {
    if (running) {
      abortUiRun();
      return;
    }

    const intent = resolveComposerSendIntent({
      text: value,
      attachments,
      canResumeWithoutInput,
      hasAnnotateDrafts: hasChatAnnotateDrafts(sessionId),
      hasModel,
      running,
    });
    const content = value.trim();
    const { hasSendable, allowResumeWithoutInput } = intent;
    if (!hasSendable && !allowResumeWithoutInput) {
      return;
    }

    if (content && lastMessageIsPlainUserText) {
      return;
    }

    await runAgent(content, allowResumeWithoutInput);
  };

  const inputDisabled =
    (!hasModel && !running) || lastMessageIsPlainUserText;
  const sendDisabled = resolveComposerSendIntent({
    text: value,
    attachments,
    canResumeWithoutInput,
    hasAnnotateDrafts: hasChatAnnotateDrafts(sessionId),
    hasModel,
    running,
  }).sendDisabled;

  const inputPlaceholder = hasModel
    ? "输入消息…（Ctrl+Enter 发送）"
    : "请先配置模型（设置 → Provider）";

  return (
    <>
      {displayError ? (
        <p className="chat-composer__error">{displayError}</p>
      ) : null}
      <div className="chat-composer" id="chat-composer">
        <div className="chat-composer__box">
          {/* 状态 chip 在输入框内顶部：不可叉；无文件引用 attach chip */}
          <ComposerStatusChips
            attachments={attachments}
            disabled={inputDisabled}
          />
          <div className="chat-composer__input-wrap">
            <AtPathTypeahead
              open={activeAt != null && !inputDisabled}
              candidates={typeaheadCandidates}
              onSelect={applyTypeaheadToken}
            />
            <SkillTypeahead
              open={activeSkill != null && !inputDisabled}
              candidates={skillTypeaheadCandidates}
              onSelect={applySkillToken}
            />
            <ComposerAtPathInput
              textareaRef={textareaRef}
              value={value}
              onChange={onChange}
              onSelectChange={setCursor}
              disabled={inputDisabled}
              placeholder={inputPlaceholder}
              aria-label="消息输入"
              onKeyDown={(e) => {
                handleMultilineSubmitKeyDown(
                  e,
                  () => void send(),
                  { disabled: sendDisabled },
                );
              }}
            />
          </div>
          <div className="chat-composer__toolbar">
            <Tooltip content="更多选项">
              <button
                type="button"
                className="chat-composer__more"
                data-action="open-session-actions"
                aria-label="更多选项"
                aria-haspopup="menu"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenSessionActions?.(e.currentTarget);
                }}
              >
                ⋯
              </button>
            </Tooltip>
            <div className="chat-composer__toolbar-spacer" />
            <Tooltip content="引用文件">
              <button
                type="button"
                className="chat-composer__at"
                aria-label="引用文件"
                disabled={inputDisabled}
                onClick={() => setPickerOpen(true)}
              >
                @
              </button>
            </Tooltip>
            <Tooltip content="引用技能">
              <button
                type="button"
                className="chat-composer__at"
                aria-label="引用技能"
                disabled={inputDisabled}
                onClick={() => setSkillPickerOpen(true)}
              >
                $
              </button>
            </Tooltip>
            <Tooltip content={running ? "停止" : "发送"}>
              <button
                type="button"
                className="chat-composer__send"
                disabled={sendDisabled}
                aria-label={running ? "停止" : "发送"}
                onClick={() => void send()}
              >
                {running ? "■" : "↑"}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
      <FileReferencePicker
        open={pickerOpen}
        projectId={projectId}
        sessionId={sessionId}
        onClose={() => setPickerOpen(false)}
        onConfirm={(tokens) => {
          insertTokensIntoComposer(tokens);
        }}
      />
      <SkillPicker
        open={skillPickerOpen}
        projectId={projectId}
        onClose={() => setSkillPickerOpen(false)}
        onConfirm={(tokens) => {
          insertTokensIntoComposer(tokens);
        }}
      />
    </>
  );
}
