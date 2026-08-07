import { useCallback, useEffect, useState } from "react";
import {
  ipcAgentRegistryList,
  ipcSubagentNamesGet,
  ipcSubagentNamesSet,
} from "@/ipc/client";
import type { AgentRegistryListItemDto } from "@shared/ipc-types";
import { Button } from "@/components/ui/Button";
import {
  toastSettingsError,
  toastSettingsSuccess,
} from "@/utils/settings-feedback";
import {
  SettingsPanel,
  SettingsSection,
} from "./settings-ui";
import { Switch } from "@/components/ui/Switch";

/**
 * 子智能体名单配置页（全局）。
 *
 * 名单中的 agent 对所有 agent 可见——主 agent 调用 task 工具时，
 * 只能委派给名单中的子 agent。general 作为 built-in 默认成员始终启用，
 * 不可关闭也不可删除（core 注册时兜底合并）。
 */
export function SubagentRosterView() {
  const [agents, setAgents] = useState<AgentRegistryListItemDto[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [savedSnapshot, setSavedSnapshot] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, namesRes] = await Promise.all([
        ipcAgentRegistryList(),
        ipcSubagentNamesGet(),
      ]);
      if (listRes.ok && namesRes.ok) {
        setAgents([...listRes.data]);
        setSelected(new Set(namesRes.data));
        setSavedSnapshot(snapshotKey(namesRes.data));
      } else {
        if (!listRes.ok) toastSettingsError(listRes.error.message);
        if (!namesRes.ok) toastSettingsError(namesRes.error.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = snapshotKey([...selected]) !== savedSnapshot;

  const toggleAgent = useCallback((name: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) {
        next.add(name);
      } else {
        // general 不可取消
        if (name === "general") return prev;
        next.delete(name);
      }
      return next;
    });
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const names = [...selected].sort();
      const res = await ipcSubagentNamesSet({ names });
      if (res.ok) {
        setSavedSnapshot(snapshotKey(names));
        toastSettingsSuccess("已保存子智能体名单");
      } else {
        toastSettingsError(res.error.message);
      }
    } finally {
      setSaving(false);
    }
  }, [selected]);

  if (loading) {
    return (
      <SettingsPanel>
        <p className="settings-list__empty">加载中…</p>
      </SettingsPanel>
    );
  }

  return (
    <SettingsPanel>
      <SettingsSection
        title="子智能体名单"
        desc="名单中的智能体可被所有智能体通过 task 工具调用。general 为内置默认成员，始终启用。"
      >
        <div className="settings-rows">
          {agents.length === 0 ? (
            <p className="settings-list__empty">暂无已注册的智能体</p>
          ) : (
            agents.map((agent) => {
              const isGeneral = agent.name === "general";
              const checked = selected.has(agent.name);
              return (
                <div
                  key={agent.agentId}
                  className="settings-row settings-row--switch"
                >
                  <div className="settings-row__label">
                    <span className="settings-row__title">
                      {agent.name || agent.agentId}
                    </span>
                    {isGeneral && (
                      <span className="settings-tag settings-tag--muted">
                        内置
                      </span>
                    )}
                    {agent.invalid && (
                      <span className="settings-tag settings-tag--warn">
                        配置失效
                      </span>
                    )}
                  </div>
                  <Switch
                    checked={checked}
                    disabled={isGeneral}
                    onChange={(next) => toggleAgent(agent.name, next)}
                  />
                </div>
              );
            })
          )}
        </div>
      </SettingsSection>

      <div className="settings-form__actions">
        <Button
          variant="primary"
          onClick={save}
          disabled={!dirty || saving}
        >
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </SettingsPanel>
  );
}

function snapshotKey(names: readonly string[]): string {
  return [...names].sort().join("\n");
}
