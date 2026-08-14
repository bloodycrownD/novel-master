import { useEffect, useMemo, useState } from "react";
import { BUILTIN_TOOL_CATALOG } from "@shared/logic/config-forms-agent";
import { BatchCheckbox } from "@/components/batch/BatchCheckbox";

type Props = {
  selected: readonly string[];
  onChange: (selected: string[]) => void;
};

const TOTAL = BUILTIN_TOOL_CATALOG.length;

function buildTriggerLabel(selected: readonly string[]): string {
  if (selected.length === 0) {
    return `未选择工具（0/${TOTAL}）`;
  }
  if (selected.length >= TOTAL) {
    return `全部工具（${TOTAL}/${TOTAL}）`;
  }
  return `已选工具（${selected.length}/${TOTAL}）`;
}

/**
 * 工具白名单/黑名单选择器：trigger 按钮 + 模态弹层多选。
 *
 * 改造前是搜索框 + 列表 inline 常驻，与 mobile 一样占满表单空间。
 * 现在改为折叠 trigger（显示「已选工具（N/总数）」+ ▼），点击弹出
 * `.picker-modal` 样式的弹层（复用 desktop 现有模态外壳），内含搜索 + 多选 + 确定/取消。
 * 多选草稿存在组件内 Set，点确定才提交回 onChange 并关闭。
 */
export function ToolPolicyPicker({ selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<readonly string[]>(selected);
  const [query, setQuery] = useState("");

  // draft 仅在弹层从关闭翻到打开时用 selected 初始化一次。
  const prevOpenRef = useMemo(() => ({ value: false }), []);
  useEffect(() => {
    if (open && !prevOpenRef.value) {
      setDraft(selected);
      setQuery("");
    }
    prevOpenRef.value = open;
  }, [open, selected, prevOpenRef]);

  const draftSet = useMemo(() => new Set(draft), [draft]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") {
      return BUILTIN_TOOL_CATALOG;
    }
    return BUILTIN_TOOL_CATALOG.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q),
    );
  }, [query]);

  const toggle = (name: string) => {
    if (draftSet.has(name)) {
      setDraft(draft.filter((n) => n !== name));
    } else {
      setDraft([...draft, name]);
    }
  };

  const close = () => setOpen(false);
  const confirm = () => {
    onChange([...draft]);
    close();
  };

  const triggerLabel = buildTriggerLabel(selected);

  return (
    <>
      <button
        type="button"
        className="tool-policy-picker__trigger"
        onClick={() => setOpen(true)}
      >
        <span className="tool-policy-picker__trigger-label">
          {triggerLabel}
        </span>
        <span className="tool-policy-picker__trigger-caret" aria-hidden>
          ▼
        </span>
      </button>
      {open ? (
        <div className="picker-modal" role="dialog" aria-modal="true">
          <div className="picker-modal__backdrop" onClick={close} />
          <div className="picker-modal__panel tool-policy-picker__panel">
            <h3 className="picker-modal__title">选择工具</h3>
            <div className="tool-policy-picker__panel-body">
              <input
                type="search"
                className="tool-policy-picker__search"
                placeholder="搜索工具…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <ul className="picker-modal__list tool-policy-picker__modal-list">
                {filtered.map((item) => {
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
                取消
              </button>
              <button
                type="button"
                className="tool-policy-picker__modal-confirm"
                onClick={confirm}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
