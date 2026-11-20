/**
 * 转录渲染层文案（spec §2.2.8 / C30；p27 R6 第 0 片扩 ui.* 域）。
 *
 * 宿主经 `init.labels` 下发 core i18n catalog 的 4 个 `label.transcript.*` 文案
 * 与 `ui.transcript.*` 文案 map；缺省（旧宿主 / 未下发）回退本文件的默认中文
 * 常量。纯常量 + 纯类型，零依赖。
 */

/** 渲染层文案四元组 + ui.* map（与宿主 `TranscriptLabels` 同形）。 */
export type TranscriptLabels = {
  /** 生成中（等待首字 / 流式进行中指示条）。 */
  generating: string;
  /** 思考过程（thinking 折叠标题）。 */
  thinking: string;
  /** 暂无消息（空态）。 */
  empty: string;
  /** 加载更早消息（顶部分页按钮）。 */
  loadOlder: string;
  /** ui.* 域文案 map（dotted key → 文案；值可含 {param} 模板，由消费方插值）。 */
  ui: Readonly<Record<string, string>>;
};

/** ui.* 域缺省文案（老宿主 / `init.labels.ui` 缺省兜底；与 core catalog zh 逐字一致，宿主下发逐键覆盖）。 */
export const DEFAULT_UI_LABELS: Readonly<Record<string, string>> = {
  'ui.transcript.menu.edit': '编辑',
  'ui.transcript.menu.copy': '复制',
  'ui.transcript.menu.set_floor': '置位',
  'ui.transcript.menu.fork': '分叉',
  'ui.transcript.menu.rollback': '回滚',
  'ui.transcript.tool_result_title': '工具结果',
  'ui.transcript.tool_status.success': '成功',
  'ui.transcript.tool_status.error': '失败',
  'ui.transcript.tool_status.pending': '执行中',
  'ui.transcript.tool_status.interrupted': '已中断',
  'ui.transcript.tool_group_title': '工具调用 ({count})',
  'ui.transcript.open_hint': '点击查看 · {kind}',
  'ui.transcript.open_kind.subagent': '子会话',
  'ui.transcript.open_kind.skill': '技能',
  'ui.transcript.open_kind.result': '结果',
  'ui.transcript.open_kind.workspace': '聊天工作区',
  'ui.transcript.role.user': '用户',
  'ui.transcript.role.assistant': '助手',
  'ui.transcript.message_actions': '消息操作',
  'ui.transcript.attach_group_title': '消息附件 ({count})',
  'ui.transcript.attach_src.workspace': '工作区',
  'ui.transcript.attach_src.dir': '目录',
  'ui.transcript.attach_src.file': '文件',
};

/** 默认文案（老宿主 / `init.labels` 缺省兜底；当前中文常量）。 */
export const DEFAULT_LABELS: TranscriptLabels = {
  generating: '生成中',
  thinking: '思考过程',
  empty: '暂无消息',
  loadOlder: '加载更早消息',
  ui: DEFAULT_UI_LABELS,
};

export namespace Labels {
  /** 单键最小占位：缺键/非字符串一律回退默认。 */
  function labelOr(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.length > 0 ? value : fallback;
  }

  // nm-style: keep-public — web 侧 labels 缺省回退唯一入口（旧宿主/init 缺省兼容）；
  // 内联会把四键默认文案回退埋进 bridge 的 init 分支，测试也无法直测回退表。
  /**
   * 下发载荷 → 渲染层文案（C30）：四键只校验非空字符串，ui map 逐键过滤非空
   * 字符串后覆盖 `DEFAULT_UI_LABELS` 兜底；非法/缺省回退默认中文；不认识的
   * 字段忽略（旧宿主多下发的键天然兼容）。
   */
  export function resolve(payload: unknown): TranscriptLabels {
    const p = (payload ?? {}) as Partial<Record<keyof TranscriptLabels, unknown>>;
    const rawUi = typeof p.ui === 'object' && p.ui !== null && !Array.isArray(p.ui) ? (p.ui as Record<string, unknown>) : {};
    const uiLabels: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawUi)) {
      if (typeof value === 'string' && value.length > 0) uiLabels[key] = value;
    }
    return {
      generating: labelOr(p.generating, DEFAULT_LABELS.generating),
      thinking: labelOr(p.thinking, DEFAULT_LABELS.thinking),
      empty: labelOr(p.empty, DEFAULT_LABELS.empty),
      loadOlder: labelOr(p.loadOlder, DEFAULT_LABELS.loadOlder),
      ui: {...DEFAULT_UI_LABELS, ...uiLabels},
    };
  }
}
