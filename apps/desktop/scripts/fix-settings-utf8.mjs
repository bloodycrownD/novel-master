/**
 * Rewrites settings editor TSX with real UTF-8 (Write tool / bad saves corrupt CJK).
 * Run: node apps/desktop/scripts/fix-settings-utf8.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const agentPath = join(root, "renderer/features/settings/AgentEditorView.tsx");
const eventsPath = join(root, "renderer/features/settings/EventsConfigView.tsx");

/** Decode `\uXXXX` sequences in a fragment (file uses single backslash). */
function decodeUnicodeFragment(text) {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

/** Replace JSX text nodes that contain `\u` escapes with decoded UTF-8. */
function fixJsxUnicodeText(src) {
  return src.replace(/>([^<{]*\\u[0-9a-fA-F]{4}[^<{]*)</g, (full, inner) => {
    const trimmed = inner.trim();
    if (!/\\u[0-9a-fA-F]{4}/.test(trimmed)) {
      return full;
    }
    try {
      return `>${decodeUnicodeFragment(trimmed)}<`;
    } catch {
      return full;
    }
  });
}

/** Restore agent editor from git object and decode JSX unicode text. */
function fixAgentEditor() {
  const raw = execSync("git show d825173:apps/desktop/renderer/features/settings/AgentEditorView.tsx", {
    encoding: "utf8",
  });
  const fixed = fixJsxUnicodeText(raw);
  // String literals like showToast("\u5df2...") compile correctly; decode for file readability.
  const readable = fixed.replace(
    /"((?:[^"\\]|\\.)*)"/g,
    (match, body) => {
      if (!/\\u[0-9a-fA-F]{4}/.test(body)) return match;
      try {
        return `"${decodeUnicodeFragment(body)}"`;
      } catch {
        return match;
      }
    },
  );
  writeFileSync(agentPath, readable, "utf8");
  if (!readFileSync(agentPath, "utf8").includes("加载中")) {
    throw new Error("AgentEditorView still missing 加载中 after fix");
  }
}

/** Events editor: rewrite user strings (mojibake-safe via JS unicode escapes). */
function fixEventsEditor() {
  const t = (s) => s;
  const lines = readFileSync(eventsPath, "utf8");

  // If already valid UTF-8, skip.
  if (lines.includes("动作 ") && lines.includes("事件配置") && !lines.includes("å")) {
    return;
  }

  const content = `import { useCallback, useEffect, useState } from "react";
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
  SettingsSection,
  SettingsStatus,
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
    <div className="config-block-card config-block-card--nested">
      <div className="config-block-card__header">
        <span className="config-block-card__badge">{actionTypeLabel(action.type)}</span>
        <span className="settings-hint">${t("\u52a8\u4f5c")} {index + 1}</span>
        <div className="config-block-card__actions">
          {index > 0 ? (
            <button type="button" className="icon-btn" onClick={() => onMove(-1)} aria-label="${t("\u4e0a\u79fb")}">
              ${t("\u2191")}
            </button>
          ) : null}
          {index < total - 1 ? (
            <button type="button" className="icon-btn" onClick={() => onMove(1)} aria-label="${t("\u4e0b\u79fb")}">
              ${t("\u2193")}
            </button>
          ) : null}
          <button type="button" className="icon-btn" onClick={onDelete} aria-label="${t("\u5220\u9664")}">
            ${t("\u00d7")}
          </button>
        </div>
      </div>
      <p className="settings-hint">{actionTypeHint(action.type)}</p>
      <SettingsField label="${t("\u4f9d\u8d56\uff08DAG\uff09")}">
        <div className="config-dep-chips">
          {availableDependencies.map((dep) => (
            <button
              key={dep}
              type="button"
              className={\`config-dep-chip\${currentDeps.includes(dep) ? " is-active" : ""}\`}
              onClick={() => toggleDep(dep)}
            >
              {actionTypeLabel(dep)}
            </button>
          ))}
        </div>
      </SettingsField>
      {action.type === "hide-message" ? (
        <>
          <SettingsField label="${t("\u8d77\u6df1\u5ea6")}">
            <input
              type="number"
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
          <SettingsField label="${t("\u6b62\u6df1\u5ea6")}">
            <input
              type="number"
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
        </>
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
      showToast("${t("\u81f3\u5c11\u4fdd\u7559\u4e00\u4e2a\u52a8\u4f5c")}");
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
        <span className="config-block-card__badge">${t("\u4e8b\u4ef6")}</span>
        <span className="settings-hint">
          {index + 1} / {total}
        </span>
        <div className="config-block-card__actions">
          {index > 0 ? (
            <button type="button" className="icon-btn" onClick={() => onMove(-1)} aria-label="${t("\u4e0a\u79fb")}">
              ${t("\u2191")}
            </button>
          ) : null}
          {index < total - 1 ? (
            <button type="button" className="icon-btn" onClick={() => onMove(1)} aria-label="${t("\u4e0b\u79fb")}">
              ${t("\u2193")}
            </button>
          ) : null}
          <button type="button" className="icon-btn" onClick={onDelete} aria-label="${t("\u5220\u9664")}">
            ${t("\u00d7")}
          </button>
        </div>
      </div>
      <SettingsField label="${t("\u4e8b\u4ef6")}">
        <strong>{eventTypeLabel(block.eventType)}</strong>
      </SettingsField>
      <p className="settings-hint">{eventTypeHint(block.eventType)}</p>
      <p className="settings-hint">
        ${t("\u0044\u0041\u0047\uff1a\u65e0\u4f9d\u8d56\u52a8\u4f5c\u4f1a\u5e76\u53d1\u6267\u884c\uff1b\u4e0b\u6e38\u9700\u7b49\u5f85\u6240\u6709\u4f9d\u8d56\u6210\u529f\u3002\u4efb\u4e00\u5931\u8d25\u5c06\u7ec8\u6b62\u540e\u7eed\u8c03\u5ea6\u3002")}
      </p>
      <div className="settings-section__actions">
        <span className="settings-section__title">${t("\u52a8\u4f5c")}</span>
        <button
          type="button"
          className="settings-link-btn"
          onClick={() => setAddActionOpen((v) => !v)}
        >
          ${t("\u6dfb\u52a0")}
        </button>
      </div>
      {addActionOpen ? (
        <div className="settings-inline-actions">
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
      <div className="config-block-list">
        {block.actions.map((action, actionIndex) => {
          const availableDependencies = [
            ...new Set(block.actions.map((a) => a.type).filter((t) => t !== action.type)),
          ] as EventActionType[];
          return (
            <ActionBlockEditor
              key={\`\${block.id}-\${actionIndex}\`}
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
  );
}

export function EventsConfigView() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [schemaVersion, setSchemaVersion] = useState<2>(2);
  const [blocks, setBlocks] = useState<EventBlockDraft[]>([]);
  const [status, setStatus] = useState<string | undefined>();
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
        setStatus(res.error.message);
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
      showToast("${t("\u81f3\u5c11\u4fdd\u7559\u4e00\u4e2a\u4e8b\u4ef6")}");
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
      showToast(err);
      setStatus(err);
      return;
    }
    const config: EventsConfig = eventBlocksToConfig(blocks, schemaVersion);
    setSaving(true);
    try {
      const res = await ipcEventsSetConfig({ config });
      if (res.ok) {
        setStatus("${t("\u5df2\u4fdd\u5b58")}");
        showToast("${t("\u5df2\u4fdd\u5b58\u4e8b\u4ef6\u914d\u7f6e")}");
      } else {
        setStatus(res.error.message);
        showToast(res.error.message);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="settings-hint">${t("\u52a0\u8f7d\u4e2d\u2026")}</p>;
  }

  return (
    <SettingsPanel>
      <SettingsFormSection
        title="${t("\u4e8b\u4ef6\u914d\u7f6e")}"
        desc="${t("\u6309\u4e8b\u4ef6\u7f16\u6392\u52a8\u4f5c\u94fe\uff0c\u652f\u6301 DAG\uff1b\u53ef\u4ece YAML \u6587\u4ef6\u5bfc\u5165/\u5bfc\u51fa\u3002")}"
        footer={
          <div className="settings-form-actions settings-form-actions--solo">
            <Button variant="primary" disabled={saving} onClick={() => void save()}>
              {saving ? "${t("\u4fdd\u5b58\u4e2d\u2026")}" : "${t("\u4fdd\u5b58")}"}
            </Button>
            <div className="settings-yaml-links">
              <button
                type="button"
                className="settings-link-btn"
                onClick={() => setConfirmImport(true)}
              >
                ${t("\u5bfc\u5165 YAML")}
              </button>
              <button
                type="button"
                className="settings-link-btn"
                onClick={() =>
                  void ipcEventsExportYaml().then((r) => {
                    if (r.ok && r.data === "saved") showToast("${t("\u5df2\u5bfc\u51fa YAML")}");
                    else if (!r.ok) showToast(r.error.message);
                  })
                }
              >
                ${t("\u5bfc\u51fa YAML")}
              </button>
            </div>
          </div>
        }
      >
        <SettingsSection title="${t("\u4e8b\u4ef6")}">
          <div className="settings-section__actions">
            <button
              type="button"
              className="settings-link-btn"
              onClick={() => setAddEventOpen((v) => !v)}
            >
              ${t("\u6dfb\u52a0\u4e8b\u4ef6")}
            </button>
          </div>
          {addEventOpen ? (
            <div className="settings-inline-actions">
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
        </SettingsSection>
      </SettingsFormSection>
      <SettingsStatus message={status} />
      <ConfirmModal
        open={confirmImport}
        title="${t("\u5bfc\u5165 YAML")}"
        message="${t("\u5c06\u8986\u76d6\u5f53\u524d\u4e8b\u4ef6\u914d\u7f6e\uff0c\u662f\u5426\u7ee7\u7eed\uff1f")}"
        onConfirm={() => {
          setConfirmImport(false);
          void ipcEventsImportYaml().then((r) => {
            if (r.ok && r.data === "imported") {
              void load();
              showToast("${t("\u5df2\u5bfc\u5165 YAML")}");
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
`;

  writeFileSync(eventsPath, content, "utf8");
  if (!readFileSync(eventsPath, "utf8").includes("事件配置")) {
    throw new Error("EventsConfigView still missing 事件配置 after fix");
  }
}

async function main() {
  fixAgentEditor();
  fixEventsEditor();
  console.log("OK: settings UTF-8 fixed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
