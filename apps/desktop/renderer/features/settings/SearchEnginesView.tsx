/**
 * 设置 · 搜索配置列表页（两级结构第一级）：
 * 行清单完全来自 `SearchConfigDto.engines`（core 按 engineOrderV2 归一：六预置 +
 * 自定义实例 + DDG，顺序即串行降级链优先级）。每行 = 名称 + 状态标签 +
 * 启用开关 + ⋮ 菜单（上移/下移调整优先级，自定义引擎另有删除）；点击行进入
 * 单引擎详情页；页首「新建自定义引擎」进详情页 create 模式（复用
 * `searchEngineDetail` viewId + `editingEngineId` 哨兵，不新增 viewId）。
 * 详细说明收进页首「?」按钮的帮助弹窗，页内不再铺长文案（双端同构口径）。
 */
import { useCallback, useEffect, useState } from "react";
import type { IpcResult, SearchConfigDto, SearchEngineStatusDto } from "@shared/ipc-types";
import { ipcSearchDeleteCustomEngine, ipcSearchGetConfig, ipcSearchSetEnabled, ipcSearchSetEngineOrder } from "@/ipc/client";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { Switch } from "@/components/ui/Switch";
import { toastSettingsSuccess } from "@/utils/settings-feedback";
import { settingsTranslator } from "../../i18n/settings";
import type { SettingsNavHandle } from "./settings-nav";
import { NEW_ENGINE_SENTINEL, engineMeta } from "./search-engine-meta";
import { BuiltinEngineTag, SettingsListSection, SettingsPanel, SettingsStatus } from "./settings-ui";

export function SearchEnginesView({ nav }: { nav: SettingsNavHandle }) {
  const [config, setConfig] = useState<SearchConfigDto | null>(null);
  const [menu, setMenu] = useState<{ engineId: string; x: number; y: number } | null>(null);
  /** 排序 / 开关 / 删除在途（行控件整体禁点，避免交错提交）。 */
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [helpOpen, setHelpOpen] = useState(false);
  /** 待确认删除的自定义引擎（null = 无）。 */
  const [deleteTarget, setDeleteTarget] = useState<SearchEngineStatusDto | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    const res = await ipcSearchGetConfig();
    if (res.ok) setConfig(res.data);
    else setError(res.error.message);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runWrite = async (action: () => Promise<IpcResult<void>>, success?: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await action();
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      await reload();
      if (success != null) toastSettingsSuccess(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 上移/下移：与相邻引擎交换后提交完整顺序（动态 id 全集，缺项由 core 读侧补齐）。 */
  const moveEngine = (engine: SearchEngineStatusDto, dir: -1 | 1) => {
    if (config == null) return;
    const order = config.engines.map((engine) => engine.id);
    const index = order.indexOf(engine.id);
    const target = index + dir;
    // 越界双保险：菜单项已禁用，此处再挡一次绕过 UI 的调用
    if (index < 0 || target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    void runWrite(() => ipcSearchSetEngineOrder({ engineOrder: next }));
  };

  // nm-style: keep-local — 删除失败也要收起确认框（错误经页内 SettingsStatus 展示），
  // 共享 busy 互斥态、回读与 toast；内联进 ConfirmModal onConfirm 会拆散收框不变量
  const removeEngine = async (): Promise<void> => {
    if (deleteTarget == null) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await ipcSearchDeleteCustomEngine({ engineId: deleteTarget.id });
      // 失败也收起确认框：错误经页内 SettingsStatus 展示，避免弹窗挡住原因
      setDeleteTarget(null);
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      await reload();
      toastSettingsSuccess(settingsTranslator({ key: "settings.search.toast.deleted.desktop" }));
    } catch (e) {
      setDeleteTarget(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const order = config?.engines.map((engine) => engine.id) ?? [];

  /**
   * 帮助弹窗分段（K-1 事实口径：双端各自 catalog 键；desktop 原有的「测试消耗
   * 配额」段随测试搜索按钮退役一并删除（v3 拍板 A4），现与 mobile 同为四段。
   * i18n-1：译文在组件渲染期求值，接动态 locale 后随语言切换刷新。
   */
  const helpSections: ReadonlyArray<{ title: string; body: string }> = [
    {
      title: settingsTranslator({ key: "settings.search.help.toggle.title" }),
      body: settingsTranslator({ key: "settings.search.help.toggle.body" }),
    },
    {
      title: settingsTranslator({ key: "settings.search.help.priority.title" }),
      body: settingsTranslator({ key: "settings.search.help.priority.body" }),
    },
    {
      title: settingsTranslator({ key: "settings.search.help.custom_engine.title" }),
      body: settingsTranslator({ key: "settings.search.help.custom_engine.body.desktop" }),
    },
    {
      title: settingsTranslator({ key: "settings.search.help.key_security.title" }),
      body: settingsTranslator({ key: "settings.search.help.key_security.body" }),
    },
  ];

  return (
    <SettingsPanel>
      <SettingsListSection
        header={
          <div className="settings-toolbar settings-toolbar--end">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                nav.navState.editingEngineId = NEW_ENGINE_SENTINEL;
                nav.push("searchEngineDetail");
              }}
            >
              {settingsTranslator({ key: "settings.search.list.create_custom" })}
            </Button>
            <button type="button" className="icon-btn" aria-label={settingsTranslator({ key: "settings.search.help.title" })} onClick={() => setHelpOpen(true)}>
              ?
            </button>
          </div>
        }
      >
        {config == null && error == null ? <p className="settings-hint">{settingsTranslator({ key: "settings.search.empty.loading.desktop" })}</p> : null}
        {(config?.engines ?? []).map((engine) => {
          const meta = engineMeta(engine.id);
          return (
            <div key={engine.id} className="settings-list-item-row">
              <button
                type="button"
                className="settings-list-item"
                onClick={() => {
                  nav.navState.editingEngineId = engine.id;
                  nav.push("searchEngineDetail");
                }}
              >
                <span className="settings-list-item__label">
                  {engine.name}
                  {engine.isCustom || meta == null ? null : <span className="settings-row__desc">{meta.desc}</span>}
                </span>
                <span className="settings-list-item__meta">
                  {engine.id === "duckduckgo" ? <BuiltinEngineTag /> : null}
                  {engine.isCustom ? <span className="settings-tag settings-tag--muted">{settingsTranslator({ key: "settings.search.list.tag.custom.desktop" })}</span> : null}
                  {engine.needsKey && !engine.hasKey ? <span className="settings-tag settings-tag--warn">{settingsTranslator({ key: "settings.search.list.tag.key_missing.desktop" })}</span> : null}
                  {engine.needsBaseUrl && engine.baseUrl == null ? (
                    <span className="settings-tag settings-tag--warn">{settingsTranslator({ key: "settings.search.list.tag.base_url_missing.desktop" })}</span>
                  ) : null}
                  {!engine.isCustom && engine.id !== "duckduckgo" && (!engine.needsKey || engine.hasKey) && (!engine.needsBaseUrl || engine.baseUrl != null) ? (
                    <span className="settings-tag settings-tag--ok">{settingsTranslator({ key: "settings.search.list.tag.configured.desktop" })}</span>
                  ) : null}
                </span>
                <span className="settings-list-item__chevron" aria-hidden="true">
                  ›
                </span>
              </button>
              <span className="settings-list-item__switch">
                <Switch
                  checked={engine.enabled}
                  disabled={busy}
                  onChange={(next) => void runWrite(() => ipcSearchSetEnabled({ engineId: engine.id, enabled: next }))}
                  aria-label={settingsTranslator({ key: "settings.search.list.toggle_aria.desktop", params: { name: engine.name } })}
                />
              </span>
              <button
                type="button"
                className="settings-list-item__menu-btn"
                aria-label={settingsTranslator({ key: "settings.search.list.more_menu_aria.desktop", params: { name: engine.name } })}
                onClick={(e) => {
                  if (busy) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  setMenu({
                    engineId: engine.id,
                    x: Math.max(8, rect.left),
                    y: Math.max(8, rect.bottom + 4),
                  });
                }}
              >
                ⋮
              </button>
            </div>
          );
        })}
      </SettingsListSection>
      <SettingsStatus error={error} />
      <ContextMenu
        open={menu != null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={
          menu == null
            ? []
            : [
                {
                  label: settingsTranslator({ key: "settings.search.list.menu.move_up" }),
                  action: "up",
                  disabled: order.indexOf(menu.engineId) === 0 || busy,
                },
                {
                  label: settingsTranslator({ key: "settings.search.list.menu.move_down" }),
                  action: "down",
                  disabled: order.indexOf(menu.engineId) === order.length - 1 || busy,
                },
                ...(config?.engines.find((engine) => engine.id === menu.engineId)?.isCustom === true
                  ? [{ label: settingsTranslator({ key: "settings.search.list.menu.delete" }), action: "delete", danger: true }]
                  : []),
              ]
        }
        onSelect={(action) => {
          const engine = config?.engines.find((item) => item.id === menu?.engineId);
          if (engine == null) return;
          if (action === "up") moveEngine(engine, -1);
          if (action === "down") moveEngine(engine, 1);
          if (action === "delete") setDeleteTarget(engine);
        }}
        onClose={() => setMenu(null)}
      />
      <ConfirmModal
        open={deleteTarget != null}
        title={settingsTranslator({ key: "settings.search.detail.delete_title" })}
        message={settingsTranslator({ key: "settings.search.list.delete_confirm.desktop", params: { name: deleteTarget?.name ?? "" } })}
        confirmLabel={settingsTranslator({ key: "settings.search.list.menu.delete" })}
        danger
        busy={busy}
        onConfirm={() => void removeEngine()}
        onCancel={() => setDeleteTarget(null)}
      />
      {helpOpen ? (
        <div className="text-prompt-overlay" onClick={() => setHelpOpen(false)}>
          <div className="text-prompt-modal text-prompt-modal--wide" role="dialog" aria-modal="true" aria-labelledby="search-help-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="search-help-title" className="text-prompt-modal__title">
              {settingsTranslator({ key: "settings.search.help.title" })}
            </h3>
            {helpSections.map((section) => (
              <p key={section.title} className="settings-hint">
                <strong>{section.title}：</strong>
                {section.body}
              </p>
            ))}
            <div className="confirm-modal__actions">
              <Button variant="primary" onClick={() => setHelpOpen(false)}>
                {settingsTranslator({ key: "settings.search.help.dismiss" })}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </SettingsPanel>
  );
}
