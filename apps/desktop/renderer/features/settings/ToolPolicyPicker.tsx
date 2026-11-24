import { useEffect, useMemo, useState } from "react";
import { AgentToolCatalog, type AgentToolCatalogMcpTool } from "@shared/config-forms/agent";
import { coreT } from "@shared/logic/core-i18n";
import { BatchCheckbox } from "@/components/batch/BatchCheckbox";

type Props = {
    selected: readonly string[];
    onChange: (selected: string[]) => void;
    /** 页面打开时刻的 MCP 工具快照；缺省 = 未配置，mcp 分组只显示提示占位（不参与勾选与计数）。 */
    mcpTools?: readonly AgentToolCatalogMcpTool[];
};

/**
 * 工具白名单/黑名单选择器：trigger 按钮 + 模态弹层多选。
 *
 * 改造前是搜索框 + 列表 inline 常驻，与 mobile 一样占满表单空间。
 * 现在改为折叠 trigger（显示「已选工具（N/总数）」+ ▼），点击弹出
 * `.picker-modal` 样式的弹层（复用 desktop 现有模态外壳），内含搜索 + 多选 + 确定/取消。
 * 多选草稿存在组件内 Set，点确定才提交回 onChange 并关闭。
 */
export function ToolPolicyPicker({ selected, onChange, mcpTools }: Props) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<readonly string[]>(selected);
    const [query, setQuery] = useState("");

    // draft 仅在弹层从关闭翻到打开时用 selected 初始化一次。
    // nm-style: keep-local — useEffect 的 effect 回调带 deps 时必须多行；单行化需改运行语义
    const prevOpenRef = useMemo(() => ({ value: false }), []);
    useEffect(() => {
        if (open && !prevOpenRef.value) {
            setDraft(selected);
            setQuery("");
        }
        prevOpenRef.value = open;
    }, [open, selected, prevOpenRef]);

    const draftSet = useMemo(() => new Set(draft), [draft]);

    // 页面打开时刻的 catalog 快照：mcp 分组由注入的 prop 同步组装（spec §九，不接 Promise）
    const entries = useMemo(() => AgentToolCatalog.get({ mcpTools: () => mcpTools ?? [] }).flatMap((group) => group.entries), [mcpTools]);
    const total = entries.filter((entry) => !entry.placeholder).length;

    // nm-style: keep-local — useMemo 的回调带 deps 时必须多行；单行化需改运行语义
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (q === "") {
            return entries;
        }
        return entries.filter((item) => item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q));
    }, [entries, query]);

    const toggle = (name: string) => {
        if (draftSet.has(name)) {
            setDraft(draft.filter((n) => n !== name));
        } else {
            setDraft([...draft, name]);
        }
    };

    const close = () => setOpen(false);

    return (
        <>
            <button
                type="button"
                className="tool-policy-picker__trigger"
                onClick={() => setOpen(true)}
            >
                <span className="tool-policy-picker__trigger-label">
                    {selected.length === 0
                        ? coreT({key: "ui.agent.no_tools_selected", params: {total}})
                        : selected.length >= total
                        ? coreT({key: "ui.agent.all_tools_selected", params: {total}})
                        : coreT({key: "ui.agent.selected_tools_aria", params: {selected: selected.length, total}})}
                </span>
                <span className="tool-policy-picker__trigger-caret" aria-hidden>
                    ▼
                </span>
            </button>
            {open ? (
                <div className="picker-modal" role="dialog" aria-modal="true">
                    <div className="picker-modal__backdrop" onClick={close} />
                    <div className="picker-modal__panel tool-policy-picker__panel">
                        <h3 className="picker-modal__title">{coreT({key: "ui.agent.select_tools"})}</h3>
                        <div className="tool-policy-picker__panel-body">
                            <input
                                type="search"
                                className="tool-policy-picker__search"
                                placeholder={coreT({key: "ui.agent.search_tools_placeholder"})}
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                            />
                            <ul className="picker-modal__list tool-policy-picker__modal-list">
                                {filtered.map((item) => {
                                    if (item.placeholder) {
                                        return (
                                            <li key={item.name}>
                                                <div className="picker-modal__item tool-policy-picker__modal-row tool-policy-picker__placeholder">
                                                    <span className="tool-policy-picker__desc">
                                                        {item.description}
                                                    </span>
                                                </div>
                                            </li>
                                        );
                                    }
                                    const checked = draftSet.has(item.name);
                                    return (
                                        <li key={item.name}>
                                            <button
                                                type="button"
                                                className={`picker-modal__item tool-policy-picker__modal-row${
                          checked ? " is-selected" : ""
                        }`}
                                                onClick={() => toggle(item.name)}
                                            >
                                                <BatchCheckbox
                                                    checked={checked}
                                                    onToggle={() => toggle(item.name)}
                                                />
                                                <span className="tool-policy-picker__name">
                                                    {item.name}
                                                </span>
                                                <span className="tool-policy-picker__desc">
                                                    {item.description}
                                                </span>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                        <div className="tool-policy-picker__modal-actions">
                            <button
                                type="button"
                                className="tool-policy-picker__modal-cancel"
                                onClick={close}
                            >
                                {coreT({key: "ui.common.cancel"})}
                            </button>
                            <button
                                type="button"
                                className="tool-policy-picker__modal-confirm"
                                onClick={() => {
                                    onChange([...draft]);
                                    close();
                                }}
                            >
                                {coreT({key: "ui.common.confirm"})}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </>
    );
}
