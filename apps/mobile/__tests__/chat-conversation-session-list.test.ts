/**
 * chat-conversation 列表视图单测（T-CSL 系列 · chat-webview-unify 第二阶段 wave-1）。
 *
 * 两层断言：
 * 1. **纯判定层**（node 直测）：相对时间文案 / meta 后缀 / 标题回落 / 徽标集合 /
 *    空态 / 勾选判定 / 点行动作；
 * 2. **DOM 层**：照 dock.test.ts 的 FakeElement 桩底座，跑**真** session-list 模块，
 *    断言 mount 幂等与失败上报、sessionList 渲染、viewState 切 data-view，
 *    以及五种上行 listAction 的 kind/sessionId 与长按取消手势。
 *
 * 环境：RN jest preset 是 node、无 jsdom（本仓既有约定，见 dock.test 头注），
 * 故自带极小 DOM 桩——不引 jest-environment-jsdom（会把 RN preset 顶掉）。
 */
import {formatRelativeTimeMs} from '@/utils/format-relative-time';
import {
  SESSION_LIST_LONG_PRESS_MOVE_PX,
  SESSION_LIST_LONG_PRESS_MS,
  createConversationSessionList,
  formatSessionRelativeTime,
  resolveBatchCountText,
  resolveBatchDeleteDisabled,
  resolveEmptyVisible,
  resolveRowPressAction,
  resolveSessionBadges,
  resolveSessionMetaText,
  resolveSessionSelected,
  resolveSessionTitle,
  type ConversationSessionList,
} from '@web/chat-conversation/webview/session-list';
import type {
  ConversationSessionListPayload,
  SessionListItem,
} from '@web/chat-conversation/webview/model';

/* ------------------------------------------------------------------ *
 * 极小 DOM 桩（底座照 chat-conversation-dock.test.ts，裁到本文件用得到的成员）
 * ------------------------------------------------------------------ */

type AnyFn = (event?: unknown) => void;

class FakeStyle {
  readonly props: Record<string, string> = {};
  setProperty(name: string, value: string): void {
    this.props[name] = value;
  }
  getPropertyValue(name: string): string {
    return this.props[name] ?? '';
  }
}

class FakeClassList {
  constructor(private readonly owner: FakeElement) {}
  private list(): string[] {
    return this.owner.className.split(/\s+/).filter(Boolean);
  }
  private write(next: string[]): void {
    this.owner.className = next.join(' ');
  }
  add(name: string): void {
    const next = this.list();
    if (next.indexOf(name) < 0) next.push(name);
    this.write(next);
  }
  remove(name: string): void {
    this.write(this.list().filter(item => item !== name));
  }
  contains(name: string): boolean {
    return this.list().indexOf(name) >= 0;
  }
}

class FakeElement {
  tagName: string;
  id = '';
  className = '';
  readonly style = new FakeStyle();
  readonly classList = new FakeClassList(this);
  readonly attributes: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  listeners: Array<{type: string; fn: AnyFn}> = [];
  hidden = false;
  textContent = '';
  disabled = false;
  type = '';
  private html = '';

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get innerHTML(): string {
    return this.html;
  }

  /**
   * 本模块只用 innerHTML 做**清空**（`rows.innerHTML = ''`），行一律走
   * createElement/appendChild 真建节点——所以这里不需要像 dock 那样反查解析 HTML。
   */
  set innerHTML(value: string) {
    this.html = value;
    this.children = [];
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name === 'id') this.id = value;
  }
  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }
  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  remove(): void {
    const parent = this.parentNode;
    if (parent == null) return;
    parent.children = parent.children.filter(item => item !== this);
    this.parentNode = null;
  }
  addEventListener(type: string, fn: AnyFn): void {
    this.listeners.push({type, fn});
  }
  removeEventListener(type: string, fn: AnyFn): void {
    this.listeners = this.listeners.filter(
      item => item.type !== type || item.fn !== fn,
    );
  }
  dispatch(type: string, event?: unknown): void {
    const given = (event ?? {}) as {target?: unknown};
    const payload = {...given, target: given.target ?? this};
    for (const item of this.listeners.filter(l => l.type === type)) {
      item.fn(payload);
    }
  }
  countListeners(type: string): number {
    return this.listeners.filter(item => item.type === type).length;
  }

  descendants(): FakeElement[] {
    const out: FakeElement[] = [];
    for (const child of this.children) {
      out.push(child, ...child.descendants());
    }
    return out;
  }
  matches(selector: string): boolean {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.'))
      return this.classList.contains(selector.slice(1));
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector: string): FakeElement[] {
    return this.descendants().filter(node => node.matches(selector));
  }
  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  closest(selector: string): FakeElement | null {
    let node: FakeElement | null = this;
    while (node != null) {
      if (node.matches(selector)) return node;
      node = node.parentNode;
    }
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * 测试台
 * ------------------------------------------------------------------ */

type PostedMessage = {
  v: number;
  type: string;
  payload: Record<string, unknown>;
};

const g = globalThis as unknown as Record<string, unknown>;
const originalDocument = g.document;

let fakeDocument: FakeElement & {
  documentElement: FakeElement;
  activeElement: FakeElement | null;
  createElement: (tag: string) => FakeElement;
  getElementById: (id: string) => FakeElement | null;
  querySelector: (selector: string) => FakeElement | null;
  querySelectorAll: (selector: string) => FakeElement[];
};

let posted: PostedMessage[];

function el(id: string): FakeElement {
  const node = fakeDocument.getElementById(id);
  if (node == null) throw new Error(`列表壳缺少 #${id}`);
  return node;
}

function rows(): FakeElement[] {
  return el('session-list-rows').querySelectorAll('.session-row');
}

function rowByIndex(index: number): FakeElement {
  const all = rows();
  if (all[index] == null) throw new Error(`第 ${index} 行不存在`);
  return all[index];
}

/** 建出与 index.html 同形的列表壳（#app + 列表视图 header/rows/empty）。 */
function buildShell(): void {
  const app = fakeDocument.createElement('div');
  app.id = 'app';
  app.setAttribute('data-view', 'conversation');
  const list = fakeDocument.createElement('div');
  list.id = 'session-list';
  const header = fakeDocument.createElement('div');
  header.id = 'session-list-header';
  const title = fakeDocument.createElement('div');
  title.id = 'session-list-title';
  const create = fakeDocument.createElement('button');
  create.id = 'session-list-create';
  // 批量头三段（wave-3）：整条默认 hidden，与 index.html 的初值一致
  const batchBar = fakeDocument.createElement('div');
  batchBar.id = 'session-list-batch-bar';
  batchBar.hidden = true;
  const batchCancel = fakeDocument.createElement('button');
  batchCancel.id = 'session-list-batch-cancel';
  const batchCount = fakeDocument.createElement('div');
  batchCount.id = 'session-list-batch-count';
  const batchDelete = fakeDocument.createElement('button');
  batchDelete.id = 'session-list-batch-delete';
  const rowsHost = fakeDocument.createElement('div');
  rowsHost.id = 'session-list-rows';
  const empty = fakeDocument.createElement('div');
  empty.id = 'session-list-empty';
  empty.hidden = true;

  batchBar.appendChild(batchCancel);
  batchBar.appendChild(batchCount);
  batchBar.appendChild(batchDelete);
  header.appendChild(title);
  header.appendChild(create);
  header.appendChild(batchBar);
  list.appendChild(header);
  list.appendChild(rowsHost);
  list.appendChild(empty);
  app.appendChild(list);
  fakeDocument.appendChild(app);
}

function session(
  patch: Partial<SessionListItem> = {},
): SessionListItem {
  return {
    id: 's1',
    title: '会话一',
    updatedAtMs: 1_000,
    active: false,
    interrupted: false,
    current: false,
    ...patch,
  };
}

function payload(
  sessions: readonly SessionListItem[],
  batchSelect?: readonly string[],
): ConversationSessionListPayload {
  return batchSelect != null ? {sessions, batchSelect} : {sessions};
}

function actions(): Array<{kind: string; sessionId?: string}> {
  return posted
    .filter(msg => msg.type === 'listAction')
    .map(msg => ({
      kind: String(msg.payload.kind),
      ...(msg.payload.sessionId != null
        ? {sessionId: String(msg.payload.sessionId)}
        : {}),
    }));
}

function newList(): ConversationSessionList {
  return createConversationSessionList((type, payloadValue) =>
    posted.push({v: 2, type, payload: payloadValue ?? {}}),
  );
}

/* ------------------------------------------------------------------ *
 * 纯判定层
 * ------------------------------------------------------------------ */

describe('列表纯判定（T-CSL）', () => {
  const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);

  it('T-CSL-01：相对时间与 RN 真源 formatRelativeTimeMs 逐档相等（不是手抄一份）', () => {
    // 断言从 RN 真源 import，而不是在测试里手抄阈值与文案：手抄的那份一旦与
    // format-relative-time.ts 分叉，本条就退化成「移植版 vs 硬编码」，恒真且永不报警
    // （与 dock 段 chips 那条的同款教训）。
    const cases: Array<[number, number]> = [
      [NOW, NOW - 10_000], // 刚刚
      [NOW, NOW - 5 * 60_000], // 分钟
      [NOW, NOW - 3 * 3_600_000], // 小时
      [NOW, NOW - 2 * 86_400_000], // 天
      [NOW, NOW - 30 * 86_400_000], // M/D
    ];
    for (const [now, ms] of cases) {
      expect(formatSessionRelativeTime(ms, now)).toBe(
        formatRelativeTimeMs(ms, now),
      );
    }
    // 未来时间不得出负数（「-1 分钟前」）
    expect(formatSessionRelativeTime(NOW + 60_000, NOW)).toBe('刚刚');
  });

  it('T-CSL-02：meta 文案 = 相对时间 +「 · 活跃中」（后缀只挂 active 不挂 current）', () => {
    expect(resolveSessionMetaText(session({updatedAtMs: NOW}), NOW)).toBe(
      '刚刚',
    );
    expect(
      resolveSessionMetaText(session({updatedAtMs: NOW, active: true}), NOW),
    ).toBe('刚刚 · 活跃中');
    // current 不带后缀（挂上去就退化成「当前会话」标记，收尾后仍显示——GWT-7）
    expect(
      resolveSessionMetaText(session({updatedAtMs: NOW, current: true}), NOW),
    ).toBe('刚刚');
  });

  it('T-CSL-03：标题缺省回落 id', () => {
    expect(resolveSessionTitle(session({title: '写代码'}))).toBe('写代码');
    expect(resolveSessionTitle(session({title: '', id: 's9'}))).toBe('s9');
    // 字段整个缺省（宿主没给 title）也要回落 id
    expect(
      resolveSessionTitle({
        id: 's9',
        updatedAtMs: 0,
        active: false,
        interrupted: false,
        current: false,
      }),
    ).toBe('s9');
  });

  it('T-CSL-04：三徽标判据（生成中/已中断/当前；批量态不渲染「当前」）', () => {
    const all = session({active: true, interrupted: true, current: true});
    expect(resolveSessionBadges(all, false)).toEqual([
      {kind: 'generating', label: '生成中'},
      {kind: 'interrupted', label: '已中断'},
      {kind: 'current', label: '当前'},
    ]);
    // 批量态：只剩运行/中断两枚（现网判据 isCurrent && !sessionBatchActive）
    expect(resolveSessionBadges(all, true)).toEqual([
      {kind: 'generating', label: '生成中'},
      {kind: 'interrupted', label: '已中断'},
    ]);
    expect(resolveSessionBadges(session(), false)).toEqual([]);
  });

  it('T-CSL-05：空态 / 勾选 / 点行动作三判据', () => {
    expect(resolveEmptyVisible(0)).toBe(true);
    expect(resolveEmptyVisible(1)).toBe(false);
    // batchSelect 缺省 = 不在批量态 → 恒未勾选（与 model.ts 的可选字段同语义）
    expect(resolveSessionSelected('s1', undefined)).toBe(false);
    expect(resolveSessionSelected('s1', [])).toBe(false);
    expect(resolveSessionSelected('s1', ['s1'])).toBe(true);
    expect(resolveRowPressAction(true)).toBe('batchToggle');
    expect(resolveRowPressAction(false)).toBe('open');
  });

  it('T-CSL-05b：批量头文案与删除禁用判据（抄现网 ManageHeader batchCenter）', () => {
    expect(resolveBatchCountText(0)).toBe('已选 0 项');
    expect(resolveBatchCountText(3)).toBe('已选 3 项');
    // 零选即禁用（现网 batchActionsDisabled = selectedCount === 0）
    expect(resolveBatchDeleteDisabled(0)).toBe(true);
    expect(resolveBatchDeleteDisabled(1)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * DOM 层
 * ------------------------------------------------------------------ */

describe('mountSessionList（装配 · T-CSL）', () => {
  it('T-CSL-06：mount 幂等；壳未命中如实报 false 且不抛', () => {
    const list = newList();
    expect(list.mount()).toBe(true);
    // 幂等：重复 mount 不重复绑事件（否则一次点击派两条 listAction）
    expect(list.mount()).toBe(true);
    expect(el('session-list-rows').countListeners('click')).toBe(1);
    expect(el('session-list-create').countListeners('click')).toBe(1);
    list.unmount();

    for (const id of [
      'session-list',
      'session-list-rows',
      'session-list-empty',
      'session-list-create',
      'session-list-batch-bar',
      'session-list-batch-cancel',
      'session-list-batch-count',
      'session-list-batch-delete',
    ]) {
      fakeDocument.querySelector(`#${id}`)?.remove();
    }
    const broken = newList();
    expect(broken.mount()).toBe(false);
    expect(() => {
      broken.applyRoute({kind: 'sessionList', payload: payload([session()])});
      broken.applyRoute({kind: 'viewState', view: 'list'});
    }).not.toThrow();
    broken.unmount();
  });

  it('T-CSL-07：首帧把 data-view 摆到 conversation（viewState 到达前不空档）', () => {
    const list = newList();
    list.mount();
    expect(el('app').getAttribute('data-view')).toBe('conversation');
    list.unmount();
  });
});

describe('sessionList 渲染（T-CSL）', () => {
  it('T-CSL-08：行数 / 标题 / meta / 三徽标逐条落到 DOM', () => {
    const list = newList();
    list.mount();
    list.applyRoute({
      kind: 'sessionList',
      payload: payload([
        session({id: 's1', title: '写代码', updatedAtMs: 0}),
        session({
          id: 's2',
          title: '改 bug',
          updatedAtMs: 0,
          active: true,
          interrupted: true,
          current: true,
        }),
      ]),
    });

    expect(rows()).toHaveLength(2);
    expect(rowByIndex(0).getAttribute('data-session-id')).toBe('s1');
    expect(rowByIndex(0).querySelector('.session-row__title')?.textContent).toBe(
      '写代码',
    );
    // active 行三枚徽标齐；非 active 行一枚都没有
    const first = rowByIndex(0).querySelectorAll('.session-row__badge');
    expect(first).toHaveLength(0);
    const second = rowByIndex(1).querySelectorAll('.session-row__badge');
    expect(second.map(node => node.className)).toEqual([
      'session-row__badge session-row__badge--generating',
      'session-row__badge session-row__badge--interrupted',
      'session-row__badge session-row__badge--current',
    ]);
    expect(second.map(node => node.textContent)).toEqual([
      '生成中',
      '已中断',
      '当前',
    ]);
    // 「活跃中」后缀只落在 active 行
    expect(
      rowByIndex(1).querySelector('.session-row__meta')?.textContent,
    ).toContain(' · 活跃中');
    // 非批量态才有 ⋮ 与 ›
    expect(rowByIndex(0).querySelector('.session-row__menu')).not.toBeNull();
    expect(rowByIndex(0).querySelector('.session-row__chevron')).not.toBeNull();
    expect(rowByIndex(0).querySelector('.session-row__check')).toBeNull();
    list.unmount();
  });

  it('T-CSL-09：空列表显空态；非空隐藏（ListEmptyComponent 同款判据）', () => {
    const list = newList();
    list.mount();
    list.applyRoute({kind: 'sessionList', payload: payload([])});
    expect(rows()).toHaveLength(0);
    expect(el('session-list-empty').hidden).toBe(false);

    list.applyRoute({kind: 'sessionList', payload: payload([session()])});
    expect(el('session-list-empty').hidden).toBe(true);
    list.unmount();
  });

  it('T-CSL-10：批量态渲染勾选框、藏 ⋮/›/「当前」徽标，并按 batchSelect 上勾', () => {
    const list = newList();
    list.mount();
    list.applyRoute({
      kind: 'sessionList',
      payload: payload(
        [
          session({id: 's1'}),
          session({id: 's2', current: true}),
        ],
        ['s2'],
      ),
    });

    const first = rowByIndex(0);
    const second = rowByIndex(1);
    expect(first.querySelector('.session-row__check')?.className).not.toContain(
      'session-row__check--on',
    );
    expect(second.querySelector('.session-row__check')?.className).toContain(
      'session-row__check--on',
    );
    expect(second.querySelector('.session-row__check')?.textContent).toBe('✓');
    // 勾选态加粗主色描边（现网 borderColor:primary + borderWidth:2）
    expect(second.className).toContain('session-row--selected');
    expect(first.className).not.toContain('session-row--selected');
    // 批量态：⋮ / › / 「当前」徽标全部不渲染
    expect(second.querySelector('.session-row__menu')).toBeNull();
    expect(second.querySelector('.session-row__chevron')).toBeNull();
    expect(
      second.querySelectorAll('.session-row__badge--current'),
    ).toHaveLength(0);
    list.unmount();
  });

  it('T-CSL-11：再下发一次 sessionList 整批重建（不留上一批的行）', () => {
    const list = newList();
    list.mount();
    list.applyRoute({
      kind: 'sessionList',
      payload: payload([session({id: 's1'}), session({id: 's2'})]),
    });
    expect(rows()).toHaveLength(2);
    list.applyRoute({kind: 'sessionList', payload: payload([session({id: 's3'})])});
    expect(rows().map(row => row.getAttribute('data-session-id'))).toEqual([
      's3',
    ]);
    list.unmount();
  });
});

describe('批量头切换（wave-3 · T-CSL）', () => {
  it('T-CSL-18：非批量态显标题+新建、藏批量条；进批量态整行切换', () => {
    const list = newList();
    list.mount();

    // 首帧（无 sessionList 下达）批量条 hidden，标题/新建可见
    expect(el('session-list-batch-bar').hidden).toBe(true);
    expect(el('session-list-title').hidden).toBe(false);
    expect(el('session-list-create').hidden).toBe(false);

    list.applyRoute({
      kind: 'sessionList',
      payload: payload([session({id: 's1'}), session({id: 's2'})], ['s1']),
    });
    expect(el('session-list-batch-bar').hidden).toBe(false);
    // 批量态藏标题与新建（留着「新建会话」会被读成「处理勾选」）
    expect(el('session-list-title').hidden).toBe(true);
    expect(el('session-list-create').hidden).toBe(true);
    expect(el('session-list-batch-count').textContent).toBe('已选 1 项');
    expect(el('session-list-batch-delete').disabled).toBe(false);

    // 退出批量 → 恢复普通态，且删除钮的 disabled 被摘掉（不能留脏状态）
    list.applyRoute({
      kind: 'sessionList',
      payload: payload([session({id: 's1'}), session({id: 's2'})]),
    });
    expect(el('session-list-batch-bar').hidden).toBe(true);
    expect(el('session-list-title').hidden).toBe(false);
    expect(el('session-list-create').hidden).toBe(false);
    expect(el('session-list-batch-delete').disabled).toBe(false);
    list.unmount();
  });

  it('T-CSL-19：零选进批量态：计数「已选 0 项」且删除钮 disabled', () => {
    const list = newList();
    list.mount();
    list.applyRoute({kind: 'sessionList', payload: payload([session()], [])});
    expect(el('session-list-batch-bar').hidden).toBe(false);
    expect(el('session-list-batch-count').textContent).toBe('已选 0 项');
    expect(el('session-list-batch-delete').disabled).toBe(true);
    list.unmount();
  });

  it('T-CSL-20：批量头两钮上行 batchDelete / batchExit（不带 sessionId）', () => {
    const list = newList();
    list.mount();
    list.applyRoute({
      kind: 'sessionList',
      payload: payload([session({id: 's1'}), session({id: 's2'})], ['s1']),
    });

    el('session-list-batch-delete').dispatch('click');
    el('session-list-batch-cancel').dispatch('click');

    // 同 create：作用于整个勾选集合，没有「哪一行」可言 → 不带 sessionId
    expect(actions()).toEqual([{kind: 'batchDelete'}, {kind: 'batchExit'}]);
    expect(posted.every(msg => msg.v === 2)).toBe(true);
    list.unmount();
  });
});

describe('viewState 切视图（T-CSL）', () => {
  it('T-CSL-12：applyViewState 只改 #app 的 data-view（显隐由 CSS 承担）', () => {
    const list = newList();
    list.mount();

    list.applyRoute({kind: 'viewState', view: 'list'});
    expect(el('app').getAttribute('data-view')).toBe('list');
    // 列表视图不碰对话域节点：转录滚动区与 dock 的存在性/内容原样
    expect(el('app').querySelector('#scroller')).toBeNull();
    expect(el('session-list').hidden).toBe(false);

    list.applyRoute({kind: 'viewState', view: 'conversation'});
    expect(el('app').getAttribute('data-view')).toBe('conversation');
    list.unmount();
  });
});

describe('listAction 上行（v:2 · T-CSL）', () => {
  it('T-CSL-13：点行 open / 点 ⋮ menuOpen / 点新建 create（kind+sessionId 齐）', () => {
    const list = newList();
    list.mount();
    list.applyRoute({
      kind: 'sessionList',
      payload: payload([session({id: 's1'}), session({id: 's2'})]),
    });

    // 点行正文 → open（带 sessionId）
    el('session-list-rows').dispatch('click', {
      target: rowByIndex(1).querySelector('.session-row__title'),
    });
    // 点 ⋮ → menuOpen（**不是** open；closest 命中 ⋮ 就不当整行）
    el('session-list-rows').dispatch('click', {
      target: rowByIndex(0).querySelector('.session-row__menu'),
    });
    // 新建 → create（**不带** sessionId）
    el('session-list-create').dispatch('click');

    expect(actions()).toEqual([
      {kind: 'open', sessionId: 's2'},
      {kind: 'menuOpen', sessionId: 's1'},
      {kind: 'create'},
    ]);
    // 全部走 v:2 出口（与 dockAction 同款）
    expect(posted.every(msg => msg.v === 2)).toBe(true);
    list.unmount();
  });

  it('T-CSL-14：批量态点行改派 batchToggle（不再 open）', () => {
    const list = newList();
    list.mount();
    list.applyRoute({
      kind: 'sessionList',
      payload: payload([session({id: 's1'})], []),
    });
    el('session-list-rows').dispatch('click', {
      target: rowByIndex(0).querySelector('.session-row__title'),
    });
    expect(actions()).toEqual([{kind: 'batchToggle', sessionId: 's1'}]);

    // 退出批量（batchSelect 缺省）后点行恢复 open
    list.applyRoute({kind: 'sessionList', payload: payload([session({id: 's1'})])});
    el('session-list-rows').dispatch('click', {
      target: rowByIndex(0).querySelector('.session-row__title'),
    });
    expect(actions()).toEqual([
      {kind: 'batchToggle', sessionId: 's1'},
      {kind: 'open', sessionId: 's1'},
    ]);
    list.unmount();
  });

  it('T-CSL-15：长按 350ms 触发 longPress，并吞掉紧随其后的 click', () => {
    jest.useFakeTimers();
    try {
      const list = newList();
      list.mount();
      list.applyRoute({
        kind: 'sessionList',
        payload: payload([session({id: 's1'})]),
      });

      el('session-list-rows').dispatch('pointerdown', {
        target: rowByIndex(0),
        clientX: 10,
        clientY: 20,
      });
      // 计时未到不得触发
      jest.advanceTimersByTime(SESSION_LIST_LONG_PRESS_MS - 1);
      expect(actions()).toEqual([]);
      jest.advanceTimersByTime(1);
      expect(actions()).toEqual([{kind: 'longPress', sessionId: 's1'}]);

      // 抬手后的那条 click 必须被吞：否则长按进批量会连带把这一行打开
      el('session-list-rows').dispatch('click', {
        target: rowByIndex(0).querySelector('.session-row__title'),
      });
      expect(actions()).toEqual([{kind: 'longPress', sessionId: 's1'}]);

      // 吞掉的是**紧随其后的那一条**：再点一次就正常派 open
      el('session-list-rows').dispatch('click', {
        target: rowByIndex(0).querySelector('.session-row__title'),
      });
      expect(actions()).toEqual([
        {kind: 'longPress', sessionId: 's1'},
        {kind: 'open', sessionId: 's1'},
      ]);
      list.unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it('T-CSL-16：pointermove 超 10px 取消长按（移动不当长按）', () => {
    jest.useFakeTimers();
    try {
      const list = newList();
      list.mount();
      list.applyRoute({
        kind: 'sessionList',
        payload: payload([session({id: 's1'})]),
      });

      el('session-list-rows').dispatch('pointerdown', {
        target: rowByIndex(0),
        clientX: 10,
        clientY: 20,
      });
      // 恰好等于阈值（不取消）：判据是「超过」不是「达到」
      el('session-list-rows').dispatch('pointermove', {
        clientX: 10 + SESSION_LIST_LONG_PRESS_MOVE_PX,
        clientY: 20,
      });
      jest.advanceTimersByTime(SESSION_LIST_LONG_PRESS_MS);
      expect(actions()).toEqual([{kind: 'longPress', sessionId: 's1'}]);

      // 重新起表后大幅移动 → 取消（本段内不得再有任何上行）
      const before = posted.length;
      el('session-list-rows').dispatch('pointerdown', {
        target: rowByIndex(0),
        clientX: 10,
        clientY: 20,
      });
      el('session-list-rows').dispatch('pointermove', {
        clientX: 10,
        clientY: 20 + SESSION_LIST_LONG_PRESS_MOVE_PX + 1,
      });
      jest.advanceTimersByTime(SESSION_LIST_LONG_PRESS_MS * 2);
      expect(posted.length).toBe(before);
      list.unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it('T-CSL-17：抬手 / pointercancel 取消长按；unmount 后不再触发（无幽灵长按）', () => {
    jest.useFakeTimers();
    try {
      const list = newList();
      list.mount();
      list.applyRoute({
        kind: 'sessionList',
        payload: payload([session({id: 's1'})]),
      });

      el('session-list-rows').dispatch('pointerdown', {
        target: rowByIndex(0),
        clientX: 0,
        clientY: 0,
      });
      el('session-list-rows').dispatch('pointerup', {});
      jest.advanceTimersByTime(SESSION_LIST_LONG_PRESS_MS * 2);
      expect(actions()).toEqual([]);

      el('session-list-rows').dispatch('pointerdown', {
        target: rowByIndex(0),
        clientX: 0,
        clientY: 0,
      });
      el('session-list-rows').dispatch('pointercancel', {});
      jest.advanceTimersByTime(SESSION_LIST_LONG_PRESS_MS * 2);
      expect(actions()).toEqual([]);

      // unmount 必须掐掉未触发的计时器：换壳后 DOM 全新，残留计时器会对新行触发一次
      el('session-list-rows').dispatch('pointerdown', {
        target: rowByIndex(0),
        clientX: 0,
        clientY: 0,
      });
      list.unmount();
      jest.advanceTimersByTime(SESSION_LIST_LONG_PRESS_MS * 2);
      expect(actions()).toEqual([]);
      // 解绑后连 click 都不再上行
      el('session-list-create').dispatch('click');
      expect(actions()).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });
});

beforeEach(() => {
  posted = [];
  const doc = new FakeElement('#document');
  doc.documentElement = new FakeElement('html');
  doc.activeElement = null;
  doc.createElement = (tag: string) => new FakeElement(tag);
  doc.getElementById = (id: string) => doc.querySelector(`#${id}`);
  doc.querySelector = (selector: string) =>
    doc.descendants().find(n => n.matches(selector)) ?? null;
  doc.querySelectorAll = (selector: string) =>
    doc.descendants().filter(n => n.matches(selector));
  fakeDocument = doc as unknown as typeof fakeDocument;
  g.document = fakeDocument;
  buildShell();
});

afterEach(() => {
  g.document = originalDocument;
});
