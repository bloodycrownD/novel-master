import { useCallback, useEffect, useState } from "react";
import type { EventActionNode, EventActionType, EventsConfig } from "@novel-master/core";
import {
  ACTION_ADD_OPTIONS,
  DEFAULT_EVENTS_CONFIG,
  EVENT_ADD_OPTIONS,
  actionTypeHint,
  actionTypeLabel,
  configToEventBlocks,
  createDefaultAction,
  defaultDagForEvent,
  eventBlocksToConfig,
  eventTypeHint,
  eventTypeLabel,
  newEventBlockId,
  validateEventConfigBlocks,
  type EventBlockDraft,
} from "@novel-master/core/config-forms/events";
import { Button } from "../../components/ui/Button";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import { showToast } from "../../components/ui/show-toast";
import { toastSettingsError, toastSettingsSuccess } from "../../utils/settings-feedback";
import {
  ipcEventsExportYaml,
  ipcEventsGetConfig,
  ipcEventsImportYaml,
  ipcEventsSetConfig,
} from "../../ipc/client";
import { parseOptionalDepthInput } from "../../services/regex-test.service";
import {
  SettingsField,
  SettingsFormSection,
  SettingsPanel,
} from "./settings-ui";

function ActionBlockEditor({
  action,
  index,
  total,
  availableDependencies,
  onChange,
  onDelete,
  onMove,
}: {
  action: EventActionNode;
  index: number;
  total: number;
  availableDependencies: readonly EventActionType[];
  onChange: (action: EventActionNode) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const currentDeps = action.dependency ?? [];

  const toggleDep = (dep: EventActionType) => {
    const next = currentDeps.includes(dep)
      ? currentDeps.filter((d) => d !== dep)
      : [...currentDeps, dep];
    onChange({ ...action, dependency: next.length > 0 ? next : undefined });
  };

  return (
    <div className="config-block-card config-block-card--action">
      <div className="config-block-card__header">
        <span className="config-block-card__badge">{actionTypeLabel(action.type)}</span>
        <span className="config-block-card__meta">动作 {index + 1}</span>
        <div className="config-block-card__actions">
          {index > 0 ? (
            <button type="button" className="icon-btn" onClick={() => onMove(-1)} aria-label="上移">
              ↑
            </button>
          ) : null}
          {index < total - 1 ? (
            <button type="button" className="icon-btn" onClick={() => onMove(1)} aria-label="下移">
              ↓
            </button>
          ) : null}
          <button type="button" className="icon-btn" onClick={onDelete} aria-label="删除">
            ×
          </button>
        </div>
      </div>
      <div className="config-block-card__body">
        <p className="config-block-card__hint">{actionTypeHint(action.type)}</p>
        <SettingsField label="依赖（DAG）">
          <div className="config-dep-chips">
            {availableDependencies.map((dep) => (
              <button
                key={dep}
                type="button"
                className={`config-dep-chip${currentDeps.includes(dep) ? " is-active" : ""}`}
                onClick={() => toggleDep(dep)}
              >
                {actionTypeLabel(dep)}
              </button>
            ))}
          </div>
        </SettingsField>
        {action.type === "hide-message" ? (
          <div className="settings-field-grid">
            <SettingsField label="起深度">
              <input
                type="number"
                className="settings-field__input--compact"
                placeholder="可选"
                value={action.params.startDepth ?? ""}
                onChange={(e) =>
                  onChange({
                    ...action,
                    params: {
                      ...action.params,
                      startDepth: parseOptionalDepthInput(e.target.value) ?? undefined,
                    },
                  })
                }
              />
            </SettingsField>
            <SettingsField label="止深度">
              <input
                type="number"
                className="settings-field__input--compact"
                placeholder="可选"
                value={action.params.endDepth ?? ""}
                onChange={(e) =>
                  onChange({
                    ...action,
                    params: {
                      ...action.params,
                      endDepth: parseOptionalDepthInput(e.target.value) ?? undefined,
                    },
                  })
                }
              />
            </SettingsField>
          </div>
        ) : null}
        {action.type === "run-agent" ? (
          <SettingsField label="Agent ID">
            <input
              value={"agentId" in action.params ? String(action.params.agentId) : ""}
              onChange={(e) =>
                onChange({ ...action, params: { agentId: e.target.value.trim() } })
              }
            />
          </SettingsField>
        ) : null}
      </div>
    </div>
  );
}

function EventBlockEditor({
  block,
  index,
  total,
  onChange,
  onDelete,
  onMove,
  onAddAction,
}: {
  block: EventBlockDraft;
  index: number;
  total: number;
  onChange: (patch: Partial<EventBlockDraft>) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  onAddAction: (type: EventActionType) => void;
}) {
  const [addActionOpen, setAddActionOpen] = useState(false);

  const updateAction = (actionIndex: number, action: EventActionNode) => {
    onChange({ actions: block.actions.map((a, i) => (i === actionIndex ? action : a)) });
  };

  const deleteAction = (actionIndex: number) => {
    if (block.actions.length <= 1) {
      showToast("至少保留一个动作");
      return;
    }
    onChange({ actions: block.actions.filter((_, i) => i !== actionIndex) });
  };

  const moveAction = (actionIndex: number, dir: -1 | 1) => {
    const target = actionIndex + dir;
    if (target < 0 || target >= block.actions.length) return;
    const actions = [...block.actions];
    const tmp = actions[target]!;
    actions[target] = actions[actionIndex]!;
    actions[actionIndex] = tmp;
    onChange({ actions });
  };

  return (
    <div className="config-block-card config-block-card--event">
      <div className="config-block-card__header">
        <span className="config-block-card__badge">事件</span>
        <span className="config-block-card__meta">
          {eventTypeLabel(block.eventType)} · {index + 1}/{total}
        </span>
        <div className="config-block-card__actions">
          {index > 0 ? (
            <button type="button" className="icon-btn" onClick={() => onMove(-1)} aria-label="上移">
              ↑
            </button>
          ) : null}
          {index < total - 1 ? (
            <button type="button" className="icon-btn" onClick={() => onMove(1)} aria-label="下移">
              ↓
            </button>
          ) : null}
          <button type="button" className="icon-btn" onClick={onDelete} aria-label="删除">
            ×
          </button>
        </div>
      </div>
      <div className="config-block-card__body">
        <p className="config-block-card__hint">{eventTypeHint(block.eventType)}</p>
        <p className="config-block-card__hint config-block-card__hint--subtle">
          DAG：无依赖动作会并发执行；下游需等待所有依赖成功。任一失败将终止后续调度。
        </p>
        <div className="config-block-card__section-head">
          <span className="config-block-card__section-label">动作</span>
          <button
            type="button"
            className="settings-link-btn"
            onClick={() => setAddActionOpen((v) => !v)}
          >
            添加
          </button>
        </div>
        {addActionOpen ? (
          <div className="config-inline-actions">
            {ACTION_ADD_OPTIONS.map((opt) => (
              <Button
                key={opt.type}
                variant="secondary"
                onClick={() => {
                  onAddAction(opt.type);
                  setAddActionOpen(false);
                }}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="config-block-list config-block-list--nested">
          {block.actions.map((action, actionIndex) => {
            const availableDependencies = [
              ...new Set(block.actions.map((a) => a.type).filter((t) => t !== action.type)),
            ] as EventActionType[];
            return (
              <ActionBlockEditor
                key={`${block.id}-${actionIndex}`}
                action={action}
                index={actionIndex}
                total={block.actions.length}
                availableDependencies={availableDependencies}
                onChange={(a) => updateAction(actionIndex, a)}
                onDelete={() => deleteAction(actionIndex)}
                onMove={(dir) => moveAction(actionIndex, dir)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function EventsConfigView() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [schemaVersion, setSchemaVersion] = useState<2>(2);
  const [blocks, setBlocks] = useState<EventBlockDraft[]>([]);
  const [addEventOpen, setAddEventOpen] = useState(false);
  const [confirmImport, setConfirmImport] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ipcEventsGetConfig();
      if (res.ok) {
        setSchemaVersion(res.data.schemaVersion);
        setBlocks(configToEventBlocks(res.data));
      } else {
        setSchemaVersion(DEFAULT_EVENTS_CONFIG.schemaVersion);
        setBlocks(configToEventBlocks(DEFAULT_EVENTS_CONFIG));
        toastSettingsError(res.error.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateBlock = (id: string, patch: Partial<EventBlockDraft>) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const deleteBlock = (id: string) => {
    if (blocks.length <= 1) {
      showToast("至少保留一个事件");
      return;
    }
    setBlocks((prev) => prev.filter((b) => b.id !== id));
  };

  const moveBlock = (id: string, dir: -1 | 1) => {
    setBlocks((prev) => {
      const index = prev.findIndex((b) => b.id === id);
      if (index < 0) return prev;
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[target]!;
      next[target] = next[index]!;
      next[index] = tmp;
      return next;
    });
  };

  const addEvent = (eventType: string) => {
    const trimmed = eventType.trim();
    setBlocks((prev) => [
      ...prev,
      {
        id: newEventBlockId(),
        eventType: trimmed,
        actions: [...defaultDagForEvent(trimmed)],
      },
    ]);
    setAddEventOpen(false);
  };

  const addAction = (eventId: string, type: EventActionType) => {
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === eventId ? { ...b, actions: [...b.actions, createDefaultAction(type)] } : b,
      ),
    );
  };

  const save = async () => {
    const err = validateEventConfigBlocks(blocks);
    if (err != null) {
      toastSettingsError(err);
      return;
    }
    const config: EventsConfig = eventBlocksToConfig(blocks, schemaVersion);
    setSaving(true);
    try {
      const res = await ipcEventsSetConfig({ config });
      if (res.ok) {
        toastSettingsSuccess("已保存事件配置");
      } else {
        toastSettingsError(res.error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="settings-hint">加载中…</p>;
  }

  return (
    <SettingsPanel>
      <SettingsFormSection
        title="事件配置"
        desc="按事件编排动作链，支持 DAG；可从 YAML 文件导入/导出。"
        toolbar={
          <div className="settings-yaml-links">
            <Button variant="secondary" onClick={() => setConfirmImport(true)}>
              导入 YAML
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                void ipcEventsExportYaml().then((r) => {
                  if (r.ok && r.data === "saved") showToast("已导出 YAML");
                  else if (!r.ok) showToast(r.error.message);
                })
              }
            >
              导出 YAML
            </Button>
          </div>
        }
        footer={
          <Button variant="primary" disabled={saving} onClick={() => void save()}>
            {saving ? "保存中…" : "保存"}
          </Button>
        }
      >
        <div className="config-events-toolbar">
          <span className="config-events-toolbar__label">事件链</span>
          <button
            type="button"
            className="settings-link-btn"
            onClick={() => setAddEventOpen((v) => !v)}
          >
            添加事件
          </button>
        </div>
        {addEventOpen ? (
          <div className="config-inline-actions">
            {EVENT_ADD_OPTIONS.map((opt) => (
              <Button key={opt.eventType} variant="secondary" onClick={() => addEvent(opt.eventType)}>
                {opt.label}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="config-block-list">
          {blocks.map((block, index) => (
            <EventBlockEditor
              key={block.id}
              block={block}
              index={index}
              total={blocks.length}
              onChange={(patch) => updateBlock(block.id, patch)}
              onDelete={() => deleteBlock(block.id)}
              onMove={(dir) => moveBlock(block.id, dir)}
              onAddAction={(type) => addAction(block.id, type)}
            />
          ))}
        </div>
      </SettingsFormSection>
      <ConfirmModal
        open={confirmImport}
        title="导入 YAML"
        message="将覆盖当前事件配置，是否继续？"
        onConfirm={() => {
          setConfirmImport(false);
          void ipcEventsImportYaml().then((r) => {
            if (r.ok && r.data === "imported") {
              void load();
              showToast("已导入 YAML");
            } else if (!r.ok) {
              showToast(r.error.message);
            }
          });
        }}
        onCancel={() => setConfirmImport(false)}
      />
    </SettingsPanel>
  );
}
