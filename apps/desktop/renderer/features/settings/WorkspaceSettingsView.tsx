import { useCallback, useEffect, useRef, useState } from "react";
import {
  ipcAgentListPicker,
  ipcAgentResolveCurrent,
  ipcAgentSetCurrent,
  ipcAppUiGet,
  ipcAppUiSet,
  ipcCompactionConditionsGet,
  ipcCompactionConditionsSet,
  ipcModelListPicker,
  ipcModelSetCurrent,
  ipcPreferencesGetLlmStream,
  ipcPreferencesGetSubagentStream,
  ipcPreferencesGetThinkingContext,
  ipcPreferencesSetLlmStream,
  ipcPreferencesSetSubagentStream,
  ipcPreferencesSetThinkingContext,
} from "@/ipc/client";

import { toastSettingsError, toastSettingsSuccess } from "@/utils/settings-feedback";
import { useShellNav } from "@/providers/ShellNavProvider";
import { PickerModal } from "@/components/ui/PickerModal";
import { Switch } from "@/components/ui/Switch";

import {
  SettingsField,
  SettingsPanel,
  SettingsRow,
  SettingsRows,
  SettingsSection,
  SettingsSwitchRow,
} from "./settings-ui";

const KEY_CHAT_RICH_TEXT = "chatRichText";

export function WorkspaceSettingsView() {
  const { notifyAgentConfigChanged } = useShellNav();
  const [modelLabel, setModelLabel] = useState("—");
  const [agentLabel, setAgentLabel] = useState("—");
  const [llmStream, setLlmStream] = useState(true);
  const [subagentStream, setSubagentStream] = useState(true);
  const [thinkingContext, setThinkingContext] = useState(true);
  const [chatRichText, setChatRichText] = useState(true);
  const [compactionEnabled, setCompactionEnabled] = useState(false);
  const [compactionTokenRatio, setCompactionTokenRatio] = useState("0.8");
  // hideStartDepth 默认值 6，对齐 core 的 DEFAULT_HIDE_START_DEPTH
  const [compactionHideStartDepth, setCompactionHideStartDepth] = useState("6");
  const [picker, setPicker] = useState<"model" | "agent" | null>(null);
  const [modelRows, setModelRows] = useState<Array<{ id: string; label: string }>>([]);
  const [agentRows, setAgentRows] = useState<Array<{ id: string; label: string }>>([]);
  const [currentModelId, setCurrentModelId] = useState<string | undefined>();
  const [currentAgentId, setCurrentAgentId] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    const [
      agentRes,
      modelRes,
      streamRes,
      richRes,
      compactionRes,
      thinkingRes,
      subagentStreamRes,
    ] = await Promise.all([
      ipcAgentResolveCurrent(),
      ipcModelListPicker(),
      ipcPreferencesGetLlmStream(),
      ipcAppUiGet(KEY_CHAT_RICH_TEXT),
      ipcCompactionConditionsGet(),
      ipcPreferencesGetThinkingContext(),
      ipcPreferencesGetSubagentStream(),
    ]);
    if (agentRes.ok) {
      setAgentLabel(agentRes.data.agentName);
      setCurrentAgentId(agentRes.data.agentId);
    }
    if (modelRes.ok) {
      setModelRows(
        modelRes.data.rows.map((r) => ({
          id: r.savedModelId,
          label: r.label,
        })),
      );
      setCurrentModelId(modelRes.data.currentId);
      const current = modelRes.data.rows.find(
        (r) => r.savedModelId === modelRes.data.currentId,
      );
      setModelLabel(current?.label ?? modelRes.data.currentId ?? "—");
    }
    if (streamRes.ok) {
      setLlmStream(streamRes.data);
    }
    if (subagentStreamRes.ok) {
      setSubagentStream(subagentStreamRes.data);
    }
    if (thinkingRes.ok) {
      setThinkingContext(thinkingRes.data);
    }
    if (richRes.ok) {
      setChatRichText(
        richRes.data != null ? richRes.data !== "false" : true,
      );
    }
    if (compactionRes.ok && compactionRes.data) {
      setCompactionEnabled(compactionRes.data.enabled);
      setCompactionTokenRatio(
        compactionRes.data.tokenRatio != null
          ? String(compactionRes.data.tokenRatio)
          : "",
      );
      setCompactionHideStartDepth(
        compactionRes.data.hideStartDepth != null
          ? String(compactionRes.data.hideStartDepth)
          : "6",
      );
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const openPicker = async (kind: "model" | "agent") => {
    if (kind === "model") {
      const res = await ipcModelListPicker();
      if (res.ok) {
        setModelRows(res.data.rows.map((r) => ({ id: r.savedModelId, label: r.label })));
        setCurrentModelId(res.data.currentId);
      }
    } else {
      const res = await ipcAgentListPicker();
      if (res.ok) {
        setAgentRows(res.data.rows.map((r) => ({ id: r.agentId, label: r.label })));
        setCurrentAgentId(res.data.currentId);
      }
    }
    setPicker(kind);
  };

  /**
   * 保存压缩条件。
   * ⚠️ 本函数**必须只读入参，禁止读任何 state**：
   * 防抖定时器捕获的是击键那一帧的闭包，读 state 只会拿到「本次击键之前」的值，
   * 导致最后一次输入永远丢失。草稿值统一由 compactionDraftRef 提供。
   */
  const saveCompaction = useCallback(
    async (nextEnabled: boolean, tokenRatio: string, hideStartDepth: string) => {
      const res = await ipcCompactionConditionsSet({
        conditions: {
          schemaVersion: 4,
          enabled: nextEnabled,
          ...(tokenRatio.trim() ? { tokenRatio: Number(tokenRatio) } : {}),
          ...(hideStartDepth.trim()
            ? { hideStartDepth: Number(hideStartDepth) }
            : {}),
        },
      });
      if (res.ok) {
        toastSettingsSuccess("已保存");
      } else {
        toastSettingsError(res.error.message);
      }
    },
    [],
  );

  // 压缩条件的最新草稿，供防抖定时器读取（避免闭包捕获上一帧值）。
  // 600ms 窗口远大于 effect 时延，时序上没有窗口；若将来把防抖窗口缩到 0ms，必须重评此处。
  const compactionDraftRef = useRef({
    enabled: compactionEnabled,
    tokenRatio: compactionTokenRatio,
    hideStartDepth: compactionHideStartDepth,
  });
  useEffect(() => {
    compactionDraftRef.current = {
      enabled: compactionEnabled,
      tokenRatio: compactionTokenRatio,
      hideStartDepth: compactionHideStartDepth,
    };
  }, [compactionEnabled, compactionTokenRatio, compactionHideStartDepth]);

  // 防抖保存：hideStartDepth / tokenRatio 改动后 600ms 自动保存
  const compactionSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleCompactionSave = useCallback(() => {
    if (compactionSaveTimer.current != null) {
      clearTimeout(compactionSaveTimer.current);
    }
    compactionSaveTimer.current = setTimeout(() => {
      const draft = compactionDraftRef.current;
      void saveCompaction(draft.enabled, draft.tokenRatio, draft.hideStartDepth);
    }, 600);
  }, [saveCompaction]);

  // 组件卸载时清掉定时器，避免泄漏
  useEffect(() => {
    return () => {
      if (compactionSaveTimer.current != null) {
        clearTimeout(compactionSaveTimer.current);
      }
    };
  }, []);

  return (
    <SettingsPanel>
      <SettingsSection
        title="默认选择"
        desc="新建会话时使用的工作区默认值，也可在会话底部随时切换。"
      >
        <SettingsRows>
          <SettingsRow
            label="当前大模型"
            value={modelLabel}
            onClick={() => void openPicker("model")}
          />
          <SettingsRow
            label="当前智能体"
            value={agentLabel}
            onClick={() => void openPicker("agent")}
          />
        </SettingsRows>
      </SettingsSection>

      <SettingsSection
        title="聊天偏好"
        desc="影响消息展示与 LLM 请求行为。达到阈值时触发会话压缩；隐藏起始深度对自动和手动压缩均生效。"
      >
        <SettingsRows>
          <SettingsSwitchRow
            label="父会话流式"
            desc="主对话的实时输出；关闭后回复完成后一次性显示"
            checked={llmStream}
            onChange={async (next) => {
              setLlmStream(next);
              await ipcPreferencesSetLlmStream(next);
            }}
          />
          <SettingsSwitchRow
            label="子会话流式"
            desc="子智能体会话的实时输出；关闭后回复完成后一次性显示"
            checked={subagentStream}
            onChange={async (next) => {
              setSubagentStream(next);
              await ipcPreferencesSetSubagentStream(next);
            }}
          />
          <SettingsSwitchRow
            label="思考提示词"
            desc="开启后，模型的思考内容进入后续提示词，关闭则不进入。"
            checked={thinkingContext}
            onChange={async (next) => {
              setThinkingContext(next);
              await ipcPreferencesSetThinkingContext(next);
            }}
          />
          <SettingsSwitchRow
            label="富文本消息"
            checked={chatRichText}
            onChange={async (next) => {
              setChatRichText(next);
              await ipcAppUiSet(KEY_CHAT_RICH_TEXT, next ? "true" : "false");
            }}
          />
        </SettingsRows>

        <div className="compaction-card">
          <SettingsField label="隐藏起始深度" row>
            <input
              type="number"
              min="0"
              value={compactionHideStartDepth}
              onChange={(e) => {
                setCompactionHideStartDepth(e.target.value);
                scheduleCompactionSave();
              }}
            />
          </SettingsField>
          <SettingsField label="启用自动压缩" row>
            <Switch
              checked={compactionEnabled}
              onChange={(next) => {
                setCompactionEnabled(next);
                void saveCompaction(
                  next,
                  compactionTokenRatio,
                  compactionHideStartDepth,
                );
              }}
            />
          </SettingsField>
          {compactionEnabled ? (
            <SettingsField label="Token 比例" row>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max="1"
                value={compactionTokenRatio}
                onChange={(e) => {
                  setCompactionTokenRatio(e.target.value);
                  scheduleCompactionSave();
                }}
              />
            </SettingsField>
          ) : null}
        </div>
      </SettingsSection>

      <PickerModal
        open={picker === "model"}
        title="选择模型"
        rows={modelRows}
        currentId={currentModelId}
        onClose={() => setPicker(null)}
        onSelect={async (id) => {
          setPicker(null);
          if (!id) return;
          await ipcModelSetCurrent({ savedModelId: id });
          await refresh();
          notifyAgentConfigChanged();
        }}
      />
      <PickerModal
        open={picker === "agent"}
        title="选择 Agent"
        rows={agentRows}
        currentId={currentAgentId}
        onClose={() => setPicker(null)}
        onSelect={async (id) => {
          setPicker(null);
          if (!id) return;
          await ipcAgentSetCurrent({ agentId: id });
          await refresh();
          notifyAgentConfigChanged();
        }}
      />
    </SettingsPanel>
  );
}

export function usePickerData() {
  const openModelPicker = useCallback(async () => {
    const res = await ipcModelListPicker();
    return res.ok ? res.data : null;
  }, []);
  const openAgentPicker = useCallback(async () => {
    const res = await ipcAgentListPicker();
    return res.ok ? res.data : null;
  }, []);
  return { openModelPicker, openAgentPicker };
}
