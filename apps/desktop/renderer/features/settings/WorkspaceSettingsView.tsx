import { useCallback, useEffect, useState } from "react";
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
  ipcPreferencesGetSessionFsVersionCheck,
  ipcPreferencesSetLlmStream,
  ipcPreferencesSetSessionFsVersionCheck,
  ipcRegexListPicker,
  ipcRegexSetCurrent,
} from "../../ipc/client";
import { Button } from "../../components/ui/Button";
import { toastSettingsError, toastSettingsSuccess } from "../../utils/settings-feedback";
import { useShellNav } from "../../providers/ShellNavProvider";
import { PickerModal } from "../../components/ui/PickerModal";
import {
  SettingsField,
  SettingsFormSection,
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
  const [regexLabel, setRegexLabel] = useState("不启用");
  const [llmStream, setLlmStream] = useState(true);
  const [chatRichText, setChatRichText] = useState(false);
  const [sessionFsVersionCheck, setSessionFsVersionCheck] = useState(false);
  const [compactionEnabled, setCompactionEnabled] = useState(false);
  const [compactionTokenRatio, setCompactionTokenRatio] = useState("0.8");
  const [compactionVisibleFloor, setCompactionVisibleFloor] = useState("20");
  const [picker, setPicker] = useState<"model" | "agent" | "regex" | null>(null);
  const [modelRows, setModelRows] = useState<Array<{ id: string; label: string }>>([]);
  const [agentRows, setAgentRows] = useState<Array<{ id: string; label: string }>>([]);
  const [regexRows, setRegexRows] = useState<Array<{ id: string; label: string }>>([]);
  const [currentModelId, setCurrentModelId] = useState<string | undefined>();
  const [currentAgentId, setCurrentAgentId] = useState<string | undefined>();
  const [currentRegexId, setCurrentRegexId] = useState<string | undefined>();

  const refresh = useCallback(async () => {
    const [agentRes, modelRes, regexRes, streamRes, richRes, vfsRes, compactionRes] =
      await Promise.all([
        ipcAgentResolveCurrent(),
        ipcModelListPicker(),
        ipcRegexListPicker(),
        ipcPreferencesGetLlmStream(),
        ipcAppUiGet(KEY_CHAT_RICH_TEXT),
        ipcPreferencesGetSessionFsVersionCheck(),
        ipcCompactionConditionsGet(),
      ]);
    if (agentRes.ok) {
      setAgentLabel(agentRes.data.agentName);
      setCurrentAgentId(agentRes.data.agentId);
    }
    if (modelRes.ok) {
      setModelRows(
        modelRes.data.rows.map((r) => ({
          id: r.applicationModelId,
          label: r.label,
        })),
      );
      setCurrentModelId(modelRes.data.currentId);
      const current = modelRes.data.rows.find(
        (r) => r.applicationModelId === modelRes.data.currentId,
      );
      setModelLabel(current?.label ?? modelRes.data.currentId ?? "—");
    }
    if (regexRes.ok) {
      setRegexRows(
        regexRes.data.rows.map((r) => ({ id: r.groupId, label: r.label })),
      );
      setCurrentRegexId(regexRes.data.currentId);
      if (!regexRes.data.currentId) {
        setRegexLabel("不启用");
      } else {
        const row = regexRes.data.rows.find(
          (r) => r.groupId === regexRes.data.currentId,
        );
        setRegexLabel(row?.label ?? "不启用");
      }
    }
    if (streamRes.ok) {
      setLlmStream(streamRes.data);
    }
    if (richRes.ok) {
      setChatRichText(richRes.data === "true");
    }
    if (vfsRes.ok) {
      setSessionFsVersionCheck(vfsRes.data);
    }
    if (compactionRes.ok && compactionRes.data) {
      setCompactionEnabled(compactionRes.data.enabled);
      setCompactionTokenRatio(
        compactionRes.data.tokenRatio != null
          ? String(compactionRes.data.tokenRatio)
          : "",
      );
      setCompactionVisibleFloor(
        compactionRes.data.visibleFloor != null
          ? String(compactionRes.data.visibleFloor)
          : "",
      );
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const openPicker = async (kind: "model" | "agent" | "regex") => {
    if (kind === "model") {
      const res = await ipcModelListPicker();
      if (res.ok) {
        setModelRows(res.data.rows.map((r) => ({ id: r.applicationModelId, label: r.label })));
        setCurrentModelId(res.data.currentId);
      }
    } else if (kind === "agent") {
      const res = await ipcAgentListPicker();
      if (res.ok) {
        setAgentRows(res.data.rows.map((r) => ({ id: r.agentId, label: r.label })));
        setCurrentAgentId(res.data.currentId);
      }
    } else {
      const res = await ipcRegexListPicker();
      if (res.ok) {
        setRegexRows(res.data.rows.map((r) => ({ id: r.groupId, label: r.label })));
        setCurrentRegexId(res.data.currentId);
      }
    }
    setPicker(kind);
  };

  const saveCompaction = async (nextEnabled = compactionEnabled) => {
    const res = await ipcCompactionConditionsSet({
      conditions: {
        schemaVersion: 3,
        enabled: nextEnabled,
        ...(compactionTokenRatio.trim()
          ? { tokenRatio: Number(compactionTokenRatio) }
          : {}),
        ...(compactionVisibleFloor.trim()
          ? { visibleFloor: Number(compactionVisibleFloor) }
          : {}),
      },
    });
    if (res.ok) {
      toastSettingsSuccess("已保存");
    } else {
      toastSettingsError(res.error.message);
    }
  };

  return (
    <SettingsPanel>
      <SettingsSection
        title="默认选择"
        desc="新建会话时使用的工作区默认值，也可在会话底部随时切换。"
      >
        <SettingsRows>
          <SettingsRow
            label="当前模型"
            value={modelLabel}
            onClick={() => void openPicker("model")}
          />
          <SettingsRow
            label="当前 Agent"
            value={agentLabel}
            onClick={() => void openPicker("agent")}
          />
          <SettingsRow
            label="当前正则组"
            value={regexLabel}
            onClick={() => void openPicker("regex")}
          />
        </SettingsRows>
      </SettingsSection>

      <SettingsSection title="聊天偏好" desc="影响消息展示与 LLM 请求行为。">
        <SettingsRows>
          <SettingsSwitchRow
            label="流式输出"
            checked={llmStream}
            onChange={async (next) => {
              setLlmStream(next);
              await ipcPreferencesSetLlmStream(next);
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
          <SettingsSwitchRow
            label="Session FS 版本校验"
            checked={sessionFsVersionCheck}
            onChange={async (next) => {
              setSessionFsVersionCheck(next);
              await ipcPreferencesSetSessionFsVersionCheck(next);
            }}
          />
        </SettingsRows>
      </SettingsSection>

      <SettingsFormSection
        title="压缩条件"
        desc="达到阈值时触发会话压缩。"
      >
        <SettingsSwitchRow
          label="启用自动压缩"
          checked={compactionEnabled}
          onChange={(next) => {
            setCompactionEnabled(next);
            if (!next) {
              void saveCompaction(false);
            }
          }}
        />
        {compactionEnabled ? (
          <div className="settings-field-grid settings-field-grid--with-action">
            <SettingsField label="Token 比例">
              <input
                type="number"
                step="0.01"
                min="0.01"
                max="1"
                value={compactionTokenRatio}
                onChange={(e) => setCompactionTokenRatio(e.target.value)}
              />
            </SettingsField>
            <SettingsField label="可见条数阈值">
              <input
                type="number"
                min="0"
                value={compactionVisibleFloor}
                onChange={(e) => setCompactionVisibleFloor(e.target.value)}
              />
            </SettingsField>
            <div className="settings-field-grid__action">
              <Button variant="primary" onClick={() => void saveCompaction()}>
                保存
              </Button>
            </div>
          </div>
        ) : null}
      </SettingsFormSection>

      <PickerModal
        open={picker === "model"}
        title="选择模型"
        rows={modelRows}
        currentId={currentModelId}
        onClose={() => setPicker(null)}
        onSelect={async (id) => {
          setPicker(null);
          if (!id) return;
          await ipcModelSetCurrent({ applicationModelId: id });
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
      <PickerModal
        open={picker === "regex"}
        title="选择正则组"
        rows={regexRows}
        currentId={currentRegexId}
        allowNone
        onClose={() => setPicker(null)}
        onSelect={async (id) => {
          setPicker(null);
          await ipcRegexSetCurrent({ groupId: id });
          await refresh();
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
