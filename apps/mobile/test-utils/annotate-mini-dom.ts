/**
 * 批注 mark DOM 测用精简宿主（Jest 下避免 jsdom/linkedom ESM 链）。
 * 仅覆盖 applyAnnotateMarks / unwrap 所需 API。
 */

export class MiniDocument {
  createElement(tagName: string): MiniElement {
    return new MiniElement(this, tagName.toUpperCase());
  }

  createTextNode(data: string): MiniText {
    return new MiniText(this, data);
  }
}

abstract class MiniNode {
  parentNode: MiniParent | null = null;
  abstract readonly nodeType: number;
  abstract readonly ownerDocument: MiniDocument;

  get firstChild(): MiniNode | null {
    return null;
  }
}

type MiniParent = MiniElement;

export class MiniText extends MiniNode {
  readonly nodeType = 3;
  nodeValue: string;

  constructor(
    readonly ownerDocument: MiniDocument,
    data: string,
  ) {
    super();
    this.nodeValue = data;
  }
}

export class MiniElement extends MiniNode {
  readonly nodeType = 1;
  readonly childNodes: MiniNode[] = [];
  private readonly attrs = new Map<string, string>();

  constructor(
    readonly ownerDocument: MiniDocument,
    readonly tagName: string,
  ) {
    super();
  }

  get className(): string {
    return this.attrs.get('class') ?? '';
  }

  set className(value: string) {
    this.attrs.set('class', value);
  }

  readonly classList = {
    contains: (token: string): boolean => {
      return this.className
        .split(/\s+/)
        .filter(Boolean)
        .includes(token);
    },
  };

  get firstChild(): MiniNode | null {
    return this.childNodes[0] ?? null;
  }

  get textContent(): string {
    let out = '';
    for (const child of this.childNodes) {
      if (child.nodeType === 3) {
        out += (child as MiniText).nodeValue;
      } else if (child.nodeType === 1) {
        out += (child as MiniElement).textContent;
      }
    }
    return out;
  }

  set textContent(value: string) {
    this.childNodes.length = 0;
    if (value) {
      const t = this.ownerDocument.createTextNode(value);
      this.appendChild(t);
    }
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.has(name) ? this.attrs.get(name)! : null;
  }

  appendChild(node: MiniNode): MiniNode {
    if (node.parentNode) {
      node.parentNode.removeChild(node);
    }
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  insertBefore(node: MiniNode, ref: MiniNode | null): MiniNode {
    if (node.parentNode) {
      node.parentNode.removeChild(node);
    }
    node.parentNode = this;
    if (ref == null) {
      this.childNodes.push(node);
      return node;
    }
    const idx = this.childNodes.indexOf(ref);
    if (idx < 0) {
      this.childNodes.push(node);
    } else {
      this.childNodes.splice(idx, 0, node);
    }
    return node;
  }

  removeChild(node: MiniNode): MiniNode {
    const idx = this.childNodes.indexOf(node);
    if (idx >= 0) {
      this.childNodes.splice(idx, 1);
      node.parentNode = null;
    }
    return node;
  }

  querySelectorAll(selector: string): MiniElement[] {
    // 仅支持 `.class` / `mark.class`
    const classMatch = selector.match(/^\.?([\w-]+)$|^mark\.([\w-]+)$/);
    if (!classMatch) {
      return [];
    }
    const className = classMatch[1] ?? classMatch[2]!;
    const requireMark = Boolean(classMatch[2]);
    const out: MiniElement[] = [];
    const visit = (el: MiniElement): void => {
      if (
        el.classList.contains(className) &&
        (!requireMark || el.tagName === 'MARK')
      ) {
        out.push(el);
      }
      for (const child of el.childNodes) {
        if (child.nodeType === 1) {
          visit(child as MiniElement);
        }
      }
    };
    visit(this);
    return out;
  }

  normalize(): void {
    const merged: MiniNode[] = [];
    for (const child of this.childNodes) {
      if (child.nodeType === 1) {
        (child as MiniElement).normalize();
        merged.push(child);
        continue;
      }
      if (child.nodeType === 3) {
        const text = child as MiniText;
        const prev = merged[merged.length - 1];
        if (prev && prev.nodeType === 3) {
          (prev as MiniText).nodeValue += text.nodeValue;
          text.parentNode = null;
          continue;
        }
        if (text.nodeValue === '') {
          text.parentNode = null;
          continue;
        }
        merged.push(text);
      }
    }
    this.childNodes.length = 0;
    for (const n of merged) {
      n.parentNode = this;
      this.childNodes.push(n);
    }
  }
}

/** 构造 `<div>` 根并挂入给定子树构建回调。 */
export function createMiniRoot(
  build: (doc: MiniDocument, root: MiniElement) => void,
): MiniElement {
  const doc = new MiniDocument();
  const root = doc.createElement('div');
  build(doc, root);
  return root;
}
