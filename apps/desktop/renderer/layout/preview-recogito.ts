/**
 * Desktop MD 预览：AnnotateDraft ↔ Recogito TextAnnotation 映射。
 * 投影权威为 renderStart/renderEnd（相对 Recogito 容器可见正文）。
 */

import type { TextAnnotation } from "@recogito/text-annotator";
import type { AnnotateDraft } from "@shared/logic/chat";

/** 从 Recogito 注解抽出半开渲染坐标 + quote。 */
export type RecogitoRenderRange = {
  readonly quote: string;
  readonly renderStart: number;
  readonly renderEnd: number;
};

/** 草稿是否具备可投影的 Recogito 渲染坐标（R8：旧 offset 稿可不投影）。 */
export function hasRecogitoRenderRange(
  draft: Pick<AnnotateDraft, "renderStart" | "renderEnd">,
): boolean {
  return (
    draft.renderStart != null &&
    draft.renderEnd != null &&
    draft.renderStart < draft.renderEnd
  );
}

/**
 * AnnotateDraft → Recogito 注解；缺 render 坐标则 null（不投影）。
 */
export function draftToRecogitoAnnotation(
  draft: AnnotateDraft,
): TextAnnotation | null {
  if (!hasRecogitoRenderRange(draft)) {
    return null;
  }
  const renderStart = draft.renderStart!;
  const renderEnd = draft.renderEnd!;
  const bodies =
    draft.userAnnotation.trim().length > 0
      ? [
          {
            id: `${draft.id}-body`,
            annotation: draft.id,
            purpose: "commenting" as const,
            value: draft.userAnnotation,
          },
        ]
      : [];
  return {
    id: draft.id,
    bodies,
    target: {
      annotation: draft.id,
      selector: [
        {
          quote: draft.originalText,
          start: renderStart,
          end: renderEnd,
        },
      ],
    },
  };
}

/** 同源草稿列表 → Recogito setAnnotations 入参（跳过无 render 坐标的旧稿）。 */
export function draftsToRecogitoAnnotations(
  drafts: readonly AnnotateDraft[],
): TextAnnotation[] {
  const out: TextAnnotation[] = [];
  for (const draft of drafts) {
    const ann = draftToRecogitoAnnotation(draft);
    if (ann != null) {
      out.push(ann);
    }
  }
  return out;
}

/**
 * 从 Recogito createAnnotation / selection 载荷抽出 quote + [start, end)。
 * selector 可能是单对象或数组（库类型与运行时不完全一致）。
 */
export function extractRecogitoRenderRange(
  annotation: {
    readonly target?: {
      readonly selector?: unknown;
    };
  } | null | undefined,
): RecogitoRenderRange | null {
  if (annotation?.target == null) {
    return null;
  }
  const raw = annotation.target.selector;
  const sel = Array.isArray(raw) ? raw[0] : raw;
  if (sel == null || typeof sel !== "object") {
    return null;
  }
  const quote =
    "quote" in sel && typeof (sel as { quote: unknown }).quote === "string"
      ? (sel as { quote: string }).quote
      : "";
  const start =
    "start" in sel && typeof (sel as { start: unknown }).start === "number"
      ? (sel as { start: number }).start
      : NaN;
  const end =
    "end" in sel && typeof (sel as { end: unknown }).end === "number"
      ? (sel as { end: number }).end
      : NaN;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start ||
    quote.trim().length === 0
  ) {
    return null;
  }
  return {
    quote: quote.replace(/\u00a0/g, " ").trim(),
    renderStart: start,
    renderEnd: end,
  };
}
