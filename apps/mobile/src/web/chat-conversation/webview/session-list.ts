/**
 * chat-conversation 列表视图：自有下行 handler + UI 渲染（chat-webview-unify 第二阶段 wave-1）。
 *
 * 职责（与 dock.ts 同构的「薄渲染」纪律）：
 * 1. **列表域下行**——`sessionList`（渲染行）与 `viewState`（切 `#app` 的 `data-view`）；
 * 2. **列表域上行**——`listAction` 十一项，全部经入口注入的 `post`（v:2，与 dockAction
 *    同款出口）；业务一律留 RN（open 走状态机、delete 弹原生确认、rename 走既有
 *    prompt、stopRun 走 manager，spec §范围）。批量头的删除/退出（`batchDelete` /
 *    `batchExit`，wave-3）同样只上行意图：确认链与批量态真源都在宿主。
 * 3. **手势识别**——长按（pointerdown 350ms 计时 + pointermove >10px 取消）进批量。
 *    web touch 上没有 RN 的 `onLongPress`，故自实现；语义只有一个（进批量），
 *    不做移动端常见的长按菜单（菜单走 ⋮ 按钮，见上行 `menuOpen`）。
 *
 * **零业务推导**：三徽标判据（生成中/已中断/当前）与「活跃中」meta 后缀全部由 RN 下发的
 * 布尔决定（见 model.ts 的 `SessionListItem`），web 侧唯一自己算的是**相对时间文案**
 * （`formatSessionRelativeTime`，从 `src/utils/format-relative-time.ts` 移植）。
 *
 * 相对时间不引 RN 的那份源码：`@/utils/format-relative-time` 是 RN 侧模块，合成包
 * 只经 `@web/*` 与纯 .ts 共享函数入 bundle（引它会把 RN 依赖拖进产物）。移植版
 * 逐字照抄同一套阈值与文案，故单测直接对着真源断言两边一致。
 *
 * 装配与解绑遵循 dock.ts 的模式：`mount()` 幂等、`pickElements` 未命中**如实返回
 * false**、`unbind` 数组收集 off 函数。
 *
 * es2018 纪律：禁 ES2021+ 运行时 API 与 lookbehind 正则。
 */
import type {BoundPost} from '@web/shared/post';
import type {ConversationListRoute} from './dispatcher';
import type {
  ConversationSessionListPayload,
  ConversationView,
  SessionListItem,
} from './model';

/* ------------------------------------------------------------------ *
 * 手势常量（长按判定）
 * ------------------------------------------------------------------ */

/**
 * 长按触发阈值 350ms。
 *
 * 对齐 RN `Pressable` 的 `delayLongPress` 默认值（500ms 偏慢，Android 上用户读完一行
 * 标题才触发就迟钝了；350ms 是 iOS/Android 侧手感的常见折中）。
 */
export const SESSION_LIST_LONG_PRESS_MS = 350;

/**
 * 长按**取消**的位移阈值 10px。
 *
 * 没有这条，手指按下后的正常微抖动会把长按计时器一直挂着，最后在手指抬起的那一刻
 * 才触发，用户以为点的是那一行、结果进了批量。10px 是「不算抖动」的经验阈值。
 */
export const SESSION_LIST_LONG_PRESS_MOVE_PX = 10;

/* ------------------------------------------------------------------ *
 * 纯判定层（node 环境直测）
 * ------------------------------------------------------------------ */

/**
 * 相对时间文案（移植 `src/utils/format-relative-time.ts` 的 `formatRelativeTimeMs`）。
 *
 * **刻意逐字照抄现网阈值与文案**：列表副标题的读法已经被用户习惯了（「刚刚 / 3 分钟前
 * / 2 小时前 / 5 天前 / 10/1」），web 侧另发明一套（比如加「昨天」）会让同一个列表在
 * 两处显示不同的话。故真源仍是 RN 那一份，本函数是它的移植，单测对真源断言相等。
 */
export function formatSessionRelativeTime(
  ms: number,
  nowMs: number = Date.now(),
): string {
  const delta = Math.max(0, nowMs - ms);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (delta < minute) {
    return '刚刚';
  }
  if (delta < hour) {
    return `${Math.floor(delta / minute)} 分钟前`;
  }
  if (delta < day) {
    return `${Math.floor(delta / hour)} 小时前`;
  }
  if (delta < 7 * day) {
    return `${Math.floor(delta / day)} 天前`;
  }
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 行副标题文案：相对时间 + 「 · 活跃中」后缀。
 *
 * 「活跃中」只挂 `active`（RN 侧 manager 的真实判活），**不挂 `current`**——挂在
 * current 上时它退化成「当前会话」标记、与运行态解耦，收尾后仍显示很久，
 * 用户会把「27 分钟前 · 活跃中」读成 run 卡死（2026-09-30 真机实录 GWT-7）。
 */
export function resolveSessionMetaText(
  item: SessionListItem,
  nowMs: number = Date.now(),
): string {
  const base = formatSessionRelativeTime(item.updatedAtMs, nowMs);
  return item.active ? `${base} · 活跃中` : base;
}

/** 行标题：缺 title 回落 id（现网 `item.title ?? item.id` 的同款口径）。 */
export function resolveSessionTitle(item: SessionListItem): string {
  return item.title != null && item.title !== '' ? item.title : item.id;
}

/**
 * 一行要渲染哪些徽标（顺序固定：生成中 → 已中断 → 当前）。
 *
 * 「当前」徽标在批量态下不渲染——现网判据是 `isCurrent && !sessionBatchActive`。
 * 批量态的语义是「选一批待删的会话」，此时标出「哪个是你正在看的」只会碍事。
 */
export function resolveSessionBadges(
  item: SessionListItem,
  batchMode: boolean,
): Array<{kind: 'generating' | 'interrupted' | 'current'; label: string}> {
  const badges: Array<{
    kind: 'generating' | 'interrupted' | 'current';
    label: string;
  }> = [];
  if (item.active) {
    badges.push({kind: 'generating', label: '生成中'});
  }
  if (item.interrupted) {
    badges.push({kind: 'interrupted', label: '已中断'});
  }
  if (item.current && !batchMode) {
    badges.push({kind: 'current', label: '当前'});
  }
  return badges;
}

/** 空态显隐：零行才显（现网 `FlatList.ListEmptyComponent` 的同款判据）。 */
export function resolveEmptyVisible(sessionCount: number): boolean {
  return sessionCount === 0;
}

/** 批量勾选判定：字段缺省（不在批量态）时恒 false。 */
export function resolveSessionSelected(
  sessionId: string,
  batchSelect: readonly string[] | undefined,
): boolean {
  if (batchSelect == null) {
    return false;
  }
  // 显式循环（老内核风格，与 dispatcher 的 contains 一致，不碰 includes）
  for (let i = 0; i < batchSelect.length; i += 1) {
    if (batchSelect[i] === sessionId) {
      return true;
    }
  }
  return false;
}

/** 点一行的上行动作：批量态 = 勾选，否则 = 打开（现网 `onPress` 的同款二分支）。 */
export function resolveRowPressAction(batchMode: boolean): 'open' | 'batchToggle' {
  return batchMode ? 'batchToggle' : 'open';
}

/** 批量头中段文案（现网 ManageHeader 的 `已选 {selectedCount} 项` 同款）。 */
export function resolveBatchCountText(selectedCount: number): string {
  return `已选 ${selectedCount} 项`;
}

/**
 * 批量头删除钮的禁用判据：零选即禁用（现网 ManageHeader 的
 * `batchActionsDisabled = selectedCount === 0`）。
 *
 * 判据留在 web 侧**纯函数**里而不是只在 DOM 上 toggle：disabled 态可被单测直接
 * 断言，且这份判据与「空选时点了也不该上行」是同一条规则的两种表达。
 */
export function resolveBatchDeleteDisabled(selectedCount: number): boolean {
  return selectedCount === 0;
}

/* ------------------------------------------------------------------ *
 * DOM 层
 * ------------------------------------------------------------------ */

export type ConversationSessionList = {
  /**
   * 装配列表 DOM 与事件（壳元素全命中 = true；`pickElements` 未命中 = false）。
   *
   * 与 dock.mount 同款语义：**必须如实上报 false**。列表视图未装成不该挡住 ready
   * （见 main.ts 的 ready 闸门注释），但必须让 console.error 打出来——否则「列表
   * 永远是空壳」这种问题在真机上没有任何症状可查。
   */
  mount(): boolean;
  /** 消费一条列表域下行。 */
  applyRoute(route: ConversationListRoute): void;
  /** 拆事件绑定（换壳 / 测试复位用）。 */
  unmount(): void;
};

type SessionListElements = {
  readonly app: HTMLElement;
  readonly root: HTMLElement;
  readonly rows: HTMLElement;
  readonly empty: HTMLElement;
  readonly create: HTMLButtonElement;
  /** 批量头整条（wave-3；普通态 hidden）。 */
  readonly batchBar: HTMLElement;
  readonly batchCancel: HTMLButtonElement;
  readonly batchCount: HTMLElement;
  readonly batchDelete: HTMLButtonElement;
  /** 普通态标题（「会话」两字）；批量态隐藏。 */
  readonly title: HTMLElement;
};

function pickElements(): SessionListElements | null {
  const app = document.getElementById('app');
  const root = document.getElementById('session-list');
  const rows = document.getElementById('session-list-rows');
  const empty = document.getElementById('session-list-empty');
  const create = document.getElementById('session-list-create');
  const title = document.getElementById('session-list-title');
  const batchBar = document.getElementById('session-list-batch-bar');
  const batchCancel = document.getElementById('session-list-batch-cancel');
  const batchCount = document.getElementById('session-list-batch-count');
  const batchDelete = document.getElementById('session-list-batch-delete');
  if (
    app == null ||
    root == null ||
    rows == null ||
    empty == null ||
    create == null ||
    title == null ||
    batchBar == null ||
    batchCancel == null ||
    batchCount == null ||
    batchDelete == null
  ) {
    return null;
  }
  return {
    app,
    root,
    rows,
    empty,
    create: create as HTMLButtonElement,
    title,
    batchBar,
    batchCancel: batchCancel as HTMLButtonElement,
    batchCount,
    batchDelete: batchDelete as HTMLButtonElement,
  };
}

export function createConversationSessionList(
  post: BoundPost,
): ConversationSessionList {
  let els: SessionListElements | null = null;
  let unbind: Array<() => void> = [];
  /** 当前批量勾选集合；`undefined` = 不在批量态（与下行的 `batchSelect` 同语义）。 */
  let batchSelect: readonly string[] | undefined;
  /** 长按计时器句柄；null = 当前没有待触发的长按。 */
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  /** 长按计时器当前锚定的行（取消时要知道清谁）。 */
  let longPressRow: HTMLElement | null = null;
  /** pointerdown 落点坐标（位移判定的基准；pointermove 没有它就无从判「是否移动」）。 */
  let longPressPointer: {readonly x: number; readonly y: number} | null = null;
  /**
   * 长按已触发 → 抑制紧随其后的 click。
   *
   * RN 的 `onPress` 与 `onLongPress` 是互斥的：长按成立后抬手**不再**触发 onPress。
   * web 上 pointerup 之后浏览器照样补一条 click，于是「长按进批量」会连带把这一行
   * 打开（长按已经把它勾上了，click 再 open = 直接跳进对话，批量态当场失效）。
   *
   * 抑制只活一个手势：由 pointerdown 复位（见 bindEvents 里的同名赋值）。长按触发后
   * 用户改成**拖动滚动**时浏览器不会派 click，这里存的 true 就没人消费，带着残留
   * 跨到下一次真实点击上——把那一行的 open 吞掉一次（cr2-B-5）。
   */
  let suppressClick = false;

  const emit = (
    kind:
      | 'open'
      | 'create'
      | 'menuOpen'
      | 'longPress'
      | 'batchToggle'
      | 'batchDelete'
      | 'batchExit',
    sessionId?: string,
  ): void => {
    post(
      'listAction',
      sessionId != null ? {kind, sessionId} : {kind},
    );
  };

  /* ---- 渲染 ---- */

  const buildRow = (item: SessionListItem): HTMLElement => {
    const batchMode = batchSelect != null;
    const selected = resolveSessionSelected(item.id, batchSelect);
    const row = document.createElement('div');
    row.className = selected
      ? 'session-row session-row--selected'
      : 'session-row';
    // sessionId 走 data-* 而不是闭包：行是整批 innerHTML 重建的，事件一律委托在
    // rows 容器上（见 bindEvents），回调里靠 closest + data-session-id 反查。
    row.setAttribute('data-session-id', item.id);
    row.setAttribute('data-testid', 'session-row');

    if (batchMode) {
      const check = document.createElement('span');
      check.className = selected
        ? 'session-row__check session-row__check--on'
        : 'session-row__check';
      check.setAttribute('data-testid', 'session-row-check');
      check.textContent = selected ? '✓' : '';
      row.appendChild(check);
    }

    const info = document.createElement('div');
    info.className = 'session-row__info';
    const title = document.createElement('div');
    title.className = 'session-row__title';
    // 走 textContent 而非 innerHTML：会话标题是用户自己起的名字，可能含 `<`、`&`。
    // dock 的 chips 走 escapeHtml 是因为那一段要拼 HTML；这里整棵行都是 createElement
    // 建出来的，没有任何拼串口子，直接 textContent 就不存在转义问题。
    title.textContent = resolveSessionTitle(item);
    const meta = document.createElement('div');
    meta.className = 'session-row__meta';
    meta.textContent = resolveSessionMetaText(item);
    info.appendChild(title);
    info.appendChild(meta);
    row.appendChild(info);

    for (const badge of resolveSessionBadges(item, batchMode)) {
      const el = document.createElement('span');
      el.className = `session-row__badge session-row__badge--${badge.kind}`;
      el.setAttribute('data-testid', `session-row-badge-${badge.kind}`);
      el.textContent = badge.label;
      row.appendChild(el);
    }

    if (!batchMode) {
      // ⋮ 按钮：现网 hitSlop 8 撑开命中区在 CSS 里（.session-row__menu 的 padding），
      // 事件侧靠 stopPropagation + closest 判定「点的是 ⋮ 而不是整行」。
      const menu = document.createElement('button');
      menu.type = 'button';
      menu.className = 'session-row__menu';
      menu.setAttribute('data-testid', 'session-row-menu');
      menu.setAttribute('aria-label', '会话菜单');
      menu.textContent = '⋮';
      row.appendChild(menu);

      const chevron = document.createElement('span');
      chevron.className = 'session-row__chevron';
      chevron.setAttribute('data-testid', 'session-row-chevron');
      chevron.textContent = '›';
      row.appendChild(chevron);
    }
    return row;
  };

  const renderRows = (sessions: readonly SessionListItem[]): void => {
    if (els == null) return;
    els.rows.innerHTML = '';
    for (const item of sessions) {
      els.rows.appendChild(buildRow(item));
    }
    els.empty.hidden = !resolveEmptyVisible(sessions.length);
  };

  /** `viewState` 落点：只改 `#app` 的 `data-view`，CSS 负责显隐（见 chat-conversation.css）。 */
  const applyView = (view: ConversationView): void => {
    if (els == null) return;
    els.app.setAttribute('data-view', view);
  };

  /**
   * 批量头切换（wave-3）。
   *
   * 判据只有一条：**`batchSelect` 字段存在与否**（与行渲染、点行分支同一个真源）。
   * 三段各自的状态：
   * - 批量条 `hidden` = 非批量态（CSS 里 `.session-list__batch-bar[hidden]{display:none}`
   *   显式压过它自己的 `display:flex`，否则 hidden 属性形同虚设）；
   * - 标题 + 新建钮在批量态隐藏——批量态的语义是「处理这一批」，留着「新建会话」
   *   会让用户以为点它是在处理勾选；
   * - 中段文案随勾选数走，删除钮 disabled 判据见 `resolveBatchDeleteDisabled`。
   *
   * 只改这三处属性/文案，**不动节点**：节点是壳里写死的，切换不重建（与
   * renderRows 的整批重建不同——头部重建会让按钮焦点与命中区闪一下）。
   */
  const applyBatchHeader = (selectedCount: number): void => {
    if (els == null) return;
    const batchMode = batchSelect != null;
    els.batchBar.hidden = !batchMode;
    els.create.hidden = batchMode;
    els.title.hidden = batchMode;
    if (!batchMode) {
      // 退出批量态时把删除钮的 disabled 摘掉：留在 disabled 上会让下一次
      // （零选）进批量时按钮看起来「本来就不可用」，掩盖判据本身。
      els.batchDelete.disabled = false;
      return;
    }
    els.batchCount.textContent = resolveBatchCountText(selectedCount);
    els.batchDelete.disabled = resolveBatchDeleteDisabled(selectedCount);
  };

  const applySessionList = (payload: ConversationSessionListPayload): void => {
    if (els == null) return;
    batchSelect = payload.batchSelect;
    applyBatchHeader(
      batchSelect == null ? 0 : batchSelect.length,
    );
    renderRows(payload.sessions);
  };

  /* ---- 长按手势 ---- */

  const cancelLongPress = (): void => {
    if (longPressTimer != null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    longPressRow = null;
    longPressPointer = null;
  };

  const fireLongPress = (row: HTMLElement): void => {
    const sessionId = row.getAttribute('data-session-id');
    if (sessionId == null || sessionId === '') {
      return;
    }
    // 抑制随后那条 click，理由见 suppressClick 字段注释
    suppressClick = true;
    emit('longPress', sessionId);
  };

  /* ---- 装配 ---- */

  const bindEvents = (root: SessionListElements): Array<() => void> => {
    const off: Array<() => void> = [];
    const on = (
      target: EventTarget,
      type: string,
      fn: (event: Event) => void,
    ): void => {
      const listener = fn as EventListener;
      target.addEventListener(type, listener);
      off.push(() => target.removeEventListener(type, listener));
    };

    const rowOf = (event: Event): HTMLElement | null => {
      const target = event.target as HTMLElement | null;
      if (target == null || typeof target.closest !== 'function') {
        return null;
      }
      return target.closest('.session-row');
    };

    // 事件全委托在 rows 容器上：行每次重渲都整批重建，逐行绑事件的 off 列表会随
    // 重渲无限增长（dock 那边是 innerHTML 一次性替换、只绑容器，同款选择）。
    on(root.rows, 'click', event => {
      if (suppressClick) {
        // 长按成立后的那一条 click：吞掉，不当 open 处理
        suppressClick = false;
        return;
      }
      const row = rowOf(event);
      if (row == null) {
        return;
      }
      const target = event.target as HTMLElement | null;
      // ⋮ 优先：现网是 e.stopPropagation()，这里靠 closest 判定等价（不冒泡到行）
      if (target != null && typeof target.closest === 'function') {
        if (target.closest('.session-row__menu') != null) {
          const sessionId = row.getAttribute('data-session-id');
          if (sessionId != null) {
            emit('menuOpen', sessionId);
          }
          return;
        }
      }
      const sessionId = row.getAttribute('data-session-id');
      if (sessionId == null) {
        return;
      }
      emit(resolveRowPressAction(batchSelect != null), sessionId);
    });

    // 长按：pointerdown 起表 350ms，移动 >10px 取消，抬手/打断也取消
    on(root.rows, 'pointerdown', event => {
      const row = rowOf(event);
      if (row == null) {
        return;
      }
      cancelLongPress();
      // 新手势即新意图：旧手势的长按抑制不跨手势存活。长按触发后若用户改拖动滚动，
      // 浏览器不会派 click 来消费它，残留的 true 会把下一次真实点击吞掉（cr2-B-5）。
      suppressClick = false;
      const point = event as {clientX?: number; clientY?: number};
      longPressPointer = {
        x: typeof point.clientX === 'number' ? point.clientX : 0,
        y: typeof point.clientY === 'number' ? point.clientY : 0,
      };
      longPressRow = row;
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        const target = longPressRow;
        longPressRow = null;
        if (target != null) {
          fireLongPress(target);
        }
      }, SESSION_LIST_LONG_PRESS_MS);
    });
    on(root.rows, 'pointermove', event => {
      if (longPressTimer == null || longPressRow == null) {
        return;
      }
      const point = event as {clientX?: number; clientY?: number};
      const x = typeof point.clientX === 'number' ? point.clientX : 0;
      const y = typeof point.clientY === 'number' ? point.clientY : 0;
      const anchor = longPressPointer;
      if (anchor == null) {
        return;
      }
      const moved =
        Math.abs(x - anchor.x) > SESSION_LIST_LONG_PRESS_MOVE_PX ||
        Math.abs(y - anchor.y) > SESSION_LIST_LONG_PRESS_MOVE_PX;
      if (moved) {
        cancelLongPress();
      }
    });
    on(root.rows, 'pointerup', () => cancelLongPress());
    on(root.rows, 'pointercancel', () => cancelLongPress());

    // 新建按钮：唯一不带 sessionId 的上行动作之一
    on(root.create, 'click', () => emit('create'));

    // 批量头两钮（wave-3）：同样不带 sessionId——作用于整个勾选集合。
    // 删除钮的 disabled 由 DOM 属性挡着（原生 button disabled 不派 click），
    // 这里**不再**补一层 if 判空：真被程序化 dispatch 时让宿主自己按零选丢弃，
    // web 侧多写一份判据只会让两处规则各自漂移。
    on(root.batchCancel, 'click', () => emit('batchExit'));
    on(root.batchDelete, 'click', () => emit('batchDelete'));

    return off;
  };

  return {
    mount(): boolean {
      if (els != null) {
        // 幂等：已装配过，算成功（不重复建按钮、不重复绑事件）
        return true;
      }
      const root = pickElements();
      if (root == null) {
        return false;
      }
      els = root;
      unbind = bindEvents(root);
      // 首帧渲染：宿主首条 sessionList 到达前既无行也无空态（rows 本就空、
      // empty 壳里是 hidden），这里只把 data-view 摆到壳的初值 conversation，
      // 免得 viewState 到达前 #app 上的属性缺失、CSS 双视图规则双双不命中。
      applyView('conversation');
      return true;
    },

    applyRoute(route: ConversationListRoute): void {
      if (route.kind === 'sessionList') {
        applySessionList(route.payload);
        return;
      }
      applyView(route.view);
    },

    unmount(): void {
      for (const off of unbind) {
        off();
      }
      unbind = [];
      // 丢掉未触发的长按计时器：换壳后 DOM 全新，残留的计时器会对新行触发一次幽灵长按
      cancelLongPress();
      suppressClick = false;
      batchSelect = undefined;
      els = null;
    },
  };
}
