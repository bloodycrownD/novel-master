/**
 * AnnotateDraft ↔ Recogito TextAnnotation 映射（纯函数，供单测与 WebView 共用）。
 * 坐标系：相对 Recogito 容器可见正文的半开 [renderStart, renderEnd)（UTF-16）。
 */

export type RecogitoRenderDraft = {
  readonly id: string;
  readonly originalText: string;
  readonly renderStart: number;
  readonly renderEnd: number;
};

/** Recogito / W3C-ish 注解最小形状（只依赖 selector.quote/start/end）。 */
export type RecogitoTextAnnotation = {
  readonly id: string;
  readonly bodies: readonly unknown[];
  readonly target: {
    readonly selector: readonly {
      readonly quote: string;
      readonly start: number;
      readonly end: number;
    }[];
  };
};

export function draftToRecogitoAnnotation(
  draft: RecogitoRenderDraft,
): RecogitoTextAnnotation {
  return {
    id: draft.id,
    bodies: [],
    target: {
      selector: [
        {
          quote: draft.originalText,
          start: draft.renderStart,
          end: draft.renderEnd,
        },
      ],
    },
  };
}

/**
 * 从 Recogito annotation 抽出草稿投影字段。
 * selector 缺失或非法时返回 null（不写脏 offset）。
 */
export function recogitoAnnotationToDraftFields(
  annotation: {
    readonly id?: string;
    readonly target?: {
      readonly selector?: readonly {
        readonly quote?: string;
        readonly start?: number;
        readonly end?: number;
      }[];
    };
  } | null | undefined,
): {
  readonly id: string;
  readonly originalText: string;
  readonly renderStart: number;
  readonly renderEnd: number;
} | null {
  if (annotation == null) {
    return null;
  }
  const id = String(annotation.id ?? '').trim();
  const sel = annotation.target?.selector?.[0];
  if (!sel) {
    return null;
  }
  const quote = String(sel.quote ?? '').replace(/\u00a0/g, ' ');
  const originalText = quote; // 保留首尾空白语义与 Recogito quote 一致；宿主 trim 另议
  const renderStart = sel.start;
  const renderEnd = sel.end;
  if (
    id.length === 0 ||
    typeof renderStart !== 'number' ||
    typeof renderEnd !== 'number' ||
    !Number.isFinite(renderStart) ||
    !Number.isFinite(renderEnd) ||
    renderStart < 0 ||
    renderEnd <= renderStart
  ) {
    return null;
  }
  return {
    id,
    originalText,
    renderStart,
    renderEnd,
  };
}

/** 仅投影带成对 renderStart/renderEnd 的草稿（R8：旧 VFS offset 稿可不投影）。 */
export function draftsToRecogitoAnnotations(
  drafts: readonly {
    readonly id: string;
    readonly originalText: string;
    readonly renderStart?: number;
    readonly renderEnd?: number;
  }[],
): RecogitoTextAnnotation[] {
  const out: RecogitoTextAnnotation[] = [];
  for (const d of drafts) {
    if (
      typeof d.renderStart !== 'number' ||
      typeof d.renderEnd !== 'number' ||
      d.renderStart < 0 ||
      d.renderEnd <= d.renderStart
    ) {
      continue;
    }
    out.push(
      draftToRecogitoAnnotation({
        id: d.id,
        originalText: d.originalText,
        renderStart: d.renderStart,
        renderEnd: d.renderEnd,
      }),
    );
  }
  return out;
}
