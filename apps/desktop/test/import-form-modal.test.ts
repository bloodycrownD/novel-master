/**
 * 导入形式弹窗（ImportFormModal）结构断言（desktop/G-2）。
 *
 * 为什么只有源码断言、没写渲染/点选行为测试：react-test-renderer 下没有 DOM，
 * `<label>` 的「激活行为把 click 转发给内部 input」根本不发生——写「点 label 断言
 * onSelect 被调用一次」的用例在这套环境里恒绿、零保护力。双触发回归的保护因此落在
 * 结构上：**label 上不得有 onClick**，而 onSelect 的唯一触发源是提交按钮。
 *
 * 为什么不用全局 `/onClick/` 正则：同文件里 overlay 的 `onClick={onClose}`、modal 的
 * stopPropagation、取消按钮与提交按钮的 onClick 都是合法 onClick，全局匹配必假红。故按
 * 每个 `<label …>…</label>` 切片后只在切片内查（先例=FileInclusionModal 的干净 label）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const source = readFileSync(
  fileURLToPath(
    new URL(
      "../renderer/features/workspace/ImportFormModal.tsx",
      import.meta.url,
    ),
  ),
  "utf8",
);

/**
 * 按 `<label …>…</label>` 非贪婪切片（一个 label 内部不会再嵌套 label）。
 *
 * 注意切片数是 **1** 不是 3：三个选项由 `IMPORT_FORM_OPTIONS.map` 渲染，源码里只有
 * 一个 `<label>` 字面量。切片数锁 1 是为了护「选项区仍是 map 出来的单一 label 模板」，
 * 顺带挡住有人把三个 label 摊平复制（复制即分叉，onClick 修复会被一处漏改）。
 */
function labelSlices(src: string): string[] {
  return src.match(/<label[\s\S]*?<\/label>/g) ?? [];
}

/** 断言：选项 label 切片内没有 onClick。 */
function assertLabelsHaveNoOnClick(src: string): void {
  const slices = labelSlices(src);
  assert.equal(slices.length, 1, "选项区应仍是 map 出来的单一 label 模板");
  for (const slice of slices) {
    assert.ok(
      !slice.includes("onClick"),
      `label 上不得有 onClick（label 激活会经 input 转发一次 click 再冒泡回来，` +
        `挂在 label 上的 onSelect 会跑两次）：${slice.slice(0, 80)}…`,
    );
  }
}

/**
 * 断言：存在 data-import-form-submit 主按钮，onSelect 的唯一触发源。
 *
 * 必须按 `<Button …>` 属性形态匹配，不能用 `src.includes(...)`：文件头的注释里也提到了
 * 这个锚名，纯 includes 会被注释骗过——把 Button 上的真属性删掉照样绿。
 */
function assertSubmitAnchorExists(src: string): void {
  const openTag = src.match(/<Button[^>]*\bdata-import-form-submit\b[^>]*>/);
  assert.ok(openTag, "缺少 data-import-form-submit 提交按钮锚，E2E 两步流程点不到");
  const tail = src.slice(openTag.index! + openTag[0].length);
  assert.ok(
    tail.includes("onSelect(selected)"),
    "提交按钮应把当前选中项交给 onSelect",
  );
  // onSelect 的调用点只允许出现在提交按钮上（选项区里不得再有调用）
  const fieldsetStart = src.indexOf("<fieldset");
  const fieldsetEnd = src.indexOf("</fieldset>");
  assert.ok(fieldsetStart >= 0 && fieldsetEnd > fieldsetStart, "选项区 fieldset 应存在");
  const optionsBlock = src.slice(fieldsetStart, fieldsetEnd);
  assert.ok(
    !optionsBlock.includes("onSelect"),
    "选项区内不得调用 onSelect（唯一触发源是提交按钮）",
  );
}

describe("ImportFormModal 导入形式弹窗（源码断言）", () => {
  it("选项 label 上不挂 onClick（防 label 激活转发导致 onSelect 双触发）", () => {
    assertLabelsHaveNoOnClick(source);
  });

  it("radio 是受控形态：checked + onChange，不该再有 readOnly", () => {
    assert.ok(
      source.includes("checked={selected === opt.value}"),
      "radio 应是受控的 checked",
    );
    assert.ok(
      source.includes("onChange={() => setSelected(opt.value)}"),
      "radio 应带 onChange 更新选中态（照 FileInclusionModal 形态）",
    );
    assert.ok(
      !source.includes("readOnly"),
      "受控 radio 不该再有 readOnly（否则选项根本选不中）",
    );
  });

  it("存在 data-import-form-submit 主按钮，onSelect 的唯一触发源", () => {
    assertSubmitAnchorExists(source);
  });

  it("三个选项值齐备：value: \"zip\" / \"card\" / \"file\"", () => {
    // data-import-form={opt.value} 是动态属性、源码无 data-import-form="zip" 字面量，
    // 故对选项表的三个 value 字面量做集合断言。
    for (const value of ["zip", "card", "file"]) {
      assert.ok(
        source.includes(`value: "${value}"`),
        `缺少选项值 ${value}`,
      );
    }
  });

  it("打开弹窗时把选中项复位为 zip（防二次打开带上次选中）", () => {
    assert.ok(
      /useEffect\(\(\) => \{[\s\S]*?setSelected\("zip"\);[\s\S]*?\}, \[open, target\]\);/.test(
        source,
      ),
      "应照 FileInclusionModal 的 [open, target] effect 在打开时复位为 zip",
    );
  });

  it("变异自证：删除提交按钮锚，结构断言必红", () => {
    // 必须全量替换：源码里有 3 处提到这个锚名（文件头注释 + 按钮上方注释 + Button 属性），
    // 只替换第一处改的是注释，Button 上的真属性还在，断言本该照绿——那就自证失败了。
    const mutated = source.replaceAll("data-import-form-submit", "data-other");
    assert.notEqual(mutated, source, "变异没生效：未能删除提交锚");
    assert.throws(
      () => assertSubmitAnchorExists(mutated),
      /缺少 data-import-form-submit 提交按钮锚/,
      "删掉提交锚的变异体本该被结构断言拦下",
    );
  });

  it("变异自证：把 label 恢复成 onClick 形态，结构断言必红", () => {
    const mutated = source.replace(
      "data-import-form={opt.value}",
      "data-import-form={opt.value}\n              onClick={() => onSelect(opt.value)}",
    );
    assert.notEqual(mutated, source, "变异没生效：未能在 label 上注入 onClick");
    assert.throws(
      () => assertLabelsHaveNoOnClick(mutated),
      /label 上不得有 onClick/,
      "变异体本该被结构断言拦下",
    );
  });

  it("变异自证：只在注释里提锚、Button 上删掉属性，结构断言仍必红", () => {
    // 上一条变异的所有者陷阱：注释里留着锚名骗 includes。这里只删 Button 的属性行，
    // 注释原封不动——锚名还在源码里，纯 includes 会照绿，必须靠属性形态匹配拦下。
    const mutated = source.replace(
      /\n(\s*)data-import-form-submit\n/,
      "\n$1data-other\n",
    );
    assert.ok(
      mutated.includes("data-import-form-submit"),
      "变异前提：注释里仍留有锚名",
    );
    assert.throws(
      () => assertSubmitAnchorExists(mutated),
      /缺少 data-import-form-submit 提交按钮锚/,
      "属性删了、注释还在，断言仍须拦下",
    );
  });
});
