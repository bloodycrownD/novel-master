/**
 * chat-transcript web runtime 的最小 DOM harness（spec §9.1 / P1-9/P1-13）。
 *
 * 仓库没有 jsdom（不新增依赖）：本文件只实现 runtime 实际用到的子集——
 * `getElementById / querySelector / querySelectorAll / createElement /
 * appendChild / insertAdjacentHTML / innerHTML / textContent / classList /
 * setAttribute / firstChild / offsetTop / offsetHeight`，并用
 * **body 写入调用计数 + 节点对象引用**验证 reseed 次数与节点身份。
 *
 * 文本口径：plain 下 `body.textContent === row.text`（转义 HTML 在 getter 里解码）；
 * rich 下用唯一明文 marker 计数或 `innerHTML === 期望 seed html`。
 */

export type FakeClassList = {
  add(name: string): void;
  remove(name: string): void;
  contains(name: string): boolean;
};

export type FakeElement = {
  tagName: string;
  id: string;
  className: string;
  classList: FakeClassList;
  parentNode: FakeElement | null;
  children: FakeElement[];
  /** body 写入计数：innerHTML/textContent 赋值、insertAdjacentHTML、appendChild 各 +1。 */
  writeCount: number;
  offsetTop: number;
  offsetHeight: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  appendChild(child: FakeElement): FakeElement;
  insertAdjacentHTML(position: string, html: string): void;
  readonly firstChild: FakeElement | null;
  innerHTML: string;
  textContent: string;
  querySelector(selector: string): FakeElement | null;
  querySelectorAll(selector: string): FakeElement[];
};

function decodeEntities(html: string): string {
  return html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 解析单段选择器：`.class` / `[attr]` / `[attr="value"]` / `#id` / `tag`。 */
function matchesSelector(el: FakeElement, selector: string): boolean {
  const sel = selector.trim();
  if (sel.startsWith('.')) {
    return el.classList.contains(sel.slice(1));
  }
  if (sel.startsWith('#')) {
    return el.id === sel.slice(1);
  }
  if (sel.startsWith('[')) {
    const inner = sel.slice(1, -1);
    const eq = inner.indexOf('=');
    if (eq < 0) {
      return el.getAttribute(inner) != null;
    }
    const name = inner.slice(0, eq);
    let value = inner.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return el.getAttribute(name) === value;
  }
  return el.tagName.toLowerCase() === sel.toLowerCase();
}

class FakeDomElement implements FakeElement {
  tagName: string;
  id = '';
  className = '';
  parentNode: FakeElement | null = null;
  children: FakeElement[] = [];
  writeCount = 0;
  offsetTop = 0;
  offsetHeight = 0;
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;
  private attributes: Record<string, string> = {};
  private htmlSource = '';

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  get classList(): FakeClassList {
    const self = this;
    return {
      add(name: string): void {
        const tokens = self.className ? self.className.split(/\s+/) : [];
        if (tokens.indexOf(name) < 0) {
          tokens.push(name);
          self.className = tokens.join(' ');
        }
      },
      remove(name: string): void {
        const tokens = (
          self.className ? self.className.split(/\s+/) : []
        ).filter(token => token !== name);
        self.className = tokens.join(' ');
      },
      contains(name: string): boolean {
        const tokens = self.className ? self.className.split(/\s+/) : [];
        return tokens.indexOf(name) >= 0;
      },
    };
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  getAttribute(name: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attributes, name)
      ? this.attributes[name]
      : null;
  }

  appendChild(child: FakeElement): FakeElement {
    this.writeCount += 1;
    // DOM 语义：appendChild 会先把节点从原父节点摘下来（ensureStreamActiveTail
    // 的 `while (body.firstChild) tail.appendChild(...)` 依赖这一点，否则死循环）。
    if (child.parentNode != null) {
      const siblings = child.parentNode.children;
      const index = siblings.indexOf(child);
      if (index >= 0) {
        siblings.splice(index, 1);
      }
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertAdjacentHTML(position: string, html: string): void {
    this.writeCount += 1;
    if (position === 'afterbegin') {
      this.htmlSource = html + this.htmlSource;
      return;
    }
    if (position === 'beforeend') {
      this.htmlSource += html;
      return;
    }
    const parent = this.parentNode;
    if (parent == null) {
      return;
    }
    const sibling = new FakeDomElement('div');
    sibling.innerHTML = html;
    sibling.parentNode = parent;
    const index = parent.children.indexOf(this);
    const at = position === 'beforebegin' ? index : index + 1;
    parent.children.splice(at, 0, sibling);
  }

  get firstChild(): FakeElement | null {
    return this.children.length > 0 ? this.children[0] : null;
  }

  get innerHTML(): string {
    return this.htmlSource;
  }

  set innerHTML(html: string) {
    this.writeCount += 1;
    this.htmlSource = html;
    this.children = [];
  }

  get textContent(): string {
    return decodeEntities(this.htmlSource);
  }

  set textContent(text: string) {
    this.writeCount += 1;
    this.htmlSource = escapeText(text);
    this.children = [];
  }

  querySelector(selector: string): FakeElement | null {
    const list = this.querySelectorAll(selector);
    return list.length > 0 ? list[0] : null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (node: FakeElement): void => {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (matchesSelector(child, selector)) {
          out.push(child);
        }
        walk(child);
      }
    };
    walk(this);
    return out;
  }
}

export type FakeDocument = {
  body: FakeElement;
  documentElement: FakeElement;
  hidden: boolean;
  readyState: string;
  getElementById(id: string): FakeElement | null;
  createElement(tag: string): FakeElement;
  querySelector(selector: string): FakeElement | null;
  querySelectorAll(selector: string): FakeElement[];
  addEventListener(): void;
  removeEventListener(): void;
};

function findById(doc: FakeDocument, id: string): FakeElement | null {
  let found: FakeElement | null = null;
  const walk = (node: FakeElement): void => {
    if (found != null) {
      return;
    }
    if (node.id === id) {
      found = node;
      return;
    }
    for (let i = 0; i < node.children.length; i++) {
      walk(node.children[i]);
    }
  };
  walk(doc.body);
  return found;
}

/** 创建独立 fake document（每次 beforeEach 一份，测试之间零共享）。 */
export function createFakeDocument(): FakeDocument {
  const body = new FakeDomElement('body');
  const documentElement = new FakeDomElement('html');
  const doc: FakeDocument = {
    body,
    documentElement,
    hidden: false,
    readyState: 'complete',
    getElementById(id: string): FakeElement | null {
      return findById(doc, id);
    },
    createElement(tag: string): FakeElement {
      return new FakeDomElement(tag);
    },
    querySelector(selector: string): FakeElement | null {
      if (matchesSelector(body, selector)) {
        return body;
      }
      return body.querySelector(selector);
    },
    querySelectorAll(selector: string): FakeElement[] {
      const list = body.querySelectorAll(selector);
      if (matchesSelector(body, selector)) {
        list.unshift(body);
      }
      return list;
    },
    addEventListener(): void {
      // no-op：runtime 只在模块顶层注册 visibilitychange
    },
    removeEventListener(): void {
      // no-op
    },
  };
  return doc;
}

/** 安装 / 卸载 fake document（global.document）。 */
export function installFakeDocument(doc: FakeDocument): void {
  (globalThis as unknown as {document: FakeDocument}).document = doc;
}

export function uninstallFakeDocument(): void {
  delete (globalThis as unknown as {document?: FakeDocument}).document;
}

export type RowShell = {
  rowEl: FakeElement;
  bubble: FakeElement;
  textBody: FakeElement;
  thinkingBody: FakeElement | null;
};

/**
 * 建一行流式壳（与 StreamingMessageRow 的 DOM 结构等价的最小面）：
 * `[data-id]` 行 → `.bubble` → `.bubble-body`（可选 `.thinking-body`）。
 * `attachToRows=false` 时只返回节点（用于窗口外场景）。
 */
export function createRowShell(
  doc: FakeDocument,
  id: string,
  options: {streaming?: boolean; withThinking?: boolean} = {},
): RowShell {
  const rowEl = doc.createElement('div');
  rowEl.className =
    'row message assistant' + (options.streaming ? ' stream' : '');
  rowEl.setAttribute('data-id', id);
  if (options.streaming) {
    rowEl.setAttribute('data-stream-id', id);
    rowEl.setAttribute('data-streaming', '1');
    rowEl.setAttribute('data-stream-status', 'streaming');
    rowEl.id = 'stream-tail';
  } else {
    rowEl.setAttribute('data-stream-status', 'finished');
  }
  const bubble = doc.createElement('div');
  bubble.className = 'bubble assistant';
  rowEl.appendChild(bubble);
  const textBody = doc.createElement('div');
  textBody.className = 'bubble-body';
  bubble.appendChild(textBody);
  let thinkingBody: FakeElement | null = null;
  if (options.withThinking) {
    const section = doc.createElement('div');
    section.className = 'thinking-section';
    section.setAttribute('data-thinking-key', 'stream:thinking');
    bubble.appendChild(section);
    thinkingBody = doc.createElement('div');
    thinkingBody.className = 'thinking-body';
    section.appendChild(thinkingBody);
  }
  const rowsEl = doc.getElementById('rows') ?? createRowsRoot(doc);
  rowsEl.appendChild(rowEl);
  return {rowEl, bubble, textBody, thinkingBody};
}

/** 建 #rows 挂载点（幂等）。 */
export function createRowsRoot(doc: FakeDocument): FakeElement {
  const existing = findById(doc, 'rows');
  if (existing != null) {
    return existing;
  }
  const rowsEl = doc.createElement('div');
  rowsEl.id = 'rows';
  doc.body.appendChild(rowsEl);
  return rowsEl;
}

/** 清零整棵树的写入计数（二次快照「零写入」断言的采样起点）。 */
export function resetWriteCounts(doc: FakeDocument): void {
  const walk = (node: FakeElement): void => {
    node.writeCount = 0;
    for (let i = 0; i < node.children.length; i++) {
      walk(node.children[i]);
    }
  };
  walk(doc.body);
}

/** 统计整棵树的写入总数。 */
export function totalWriteCount(doc: FakeDocument): number {
  let total = 0;
  const walk = (node: FakeElement): void => {
    total += node.writeCount;
    for (let i = 0; i < node.children.length; i++) {
      walk(node.children[i]);
    }
  };
  walk(doc.body);
  return total;
}

/** 统计字符串在整棵树 htmlSource 中的出现次数（marker 计数）。 */
export function countHtmlOccurrences(
  root: FakeElement,
  marker: string,
): number {
  let count = 0;
  const walk = (node: FakeElement): void => {
    const source = node.innerHTML;
    let index = source.indexOf(marker);
    while (index >= 0) {
      count += 1;
      index = source.indexOf(marker, index + marker.length);
    }
    for (let i = 0; i < node.children.length; i++) {
      walk(node.children[i]);
    }
  };
  walk(root);
  return count;
}

/**
 * 只统计**后代节点**的 htmlSource（不含 root 自身的 innerHTML）。
 * 用于块级模式：body 的 innerHTML 在真实 DOM 里已被尾块容器接管，fake DOM
 * 不做 HTML 解析，root 自身的旧 innerHTML 是采样噪声。
 */
export function countDescendantHtmlOccurrences(
  root: FakeElement,
  marker: string,
): number {
  let count = 0;
  const walk = (node: FakeElement): void => {
    const source = node.innerHTML;
    let index = source.indexOf(marker);
    while (index >= 0) {
      count += 1;
      index = source.indexOf(marker, index + marker.length);
    }
    for (let i = 0; i < node.children.length; i++) {
      walk(node.children[i]);
    }
  };
  for (let i = 0; i < root.children.length; i++) {
    walk(root.children[i]);
  }
  return count;
}
