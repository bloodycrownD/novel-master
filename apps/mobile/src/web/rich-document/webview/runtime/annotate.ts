/**
 * rich-document 划词批注：仅 Markdown 预览挂 @recogito/text-annotator。
 * createAnnotation → bridge recogitoCreate；草稿变更 → setAnnotations 重投影。
 * 禁止源串插锚与 DOM 搜字 apply 作为主路径。
 */
import { createTextAnnotator, type TextAnnotator } from '@recogito/text-annotator';
import { post } from './post';
import {
  draftsToRecogitoAnnotations,
  recogitoAnnotationToDraftFields,
  type RecogitoTextAnnotation,
} from './annotate-recogito-map';

export type AnnotateRenderMark = {
  readonly id: string;
  readonly originalText: string;
  readonly renderStart: number;
  readonly renderEnd: number;
};

let annotateEnabled = false;
let annotations: AnnotateRenderMark[] = [];
let annotator: TextAnnotator | null = null;
/** 已由宿主确认并 setAnnotations 的 draft id；用于 selectionChanged 打开详情。 */
const knownDraftIds = new Set<string>();
/** createAnnotation 进行中：避免紧随其后的 selectionChanged 误开详情。 */
let suppressOpenUntil = 0;

export function setAnnotateEnabled(enabled: boolean): void {
  annotateEnabled = enabled === true;
  if (!annotateEnabled) {
    destroyAnnotator();
    return;
  }
  ensureAnnotator();
  applyAnnotationsToAnnotator();
}

export function setAnnotations(next: readonly AnnotateRenderMark[]): void {
  annotations = Array.isArray(next)
    ? next
        .map(a => ({
          id: String(a.id ?? ''),
          originalText: String(a.originalText ?? ''),
          renderStart: Number(a.renderStart),
          renderEnd: Number(a.renderEnd),
        }))
        .filter(
          a =>
            a.id.length > 0 &&
            Number.isFinite(a.renderStart) &&
            Number.isFinite(a.renderEnd) &&
            a.renderStart >= 0 &&
            a.renderEnd > a.renderStart,
        )
    : [];
  knownDraftIds.clear();
  for (const a of annotations) {
    knownDraftIds.add(a.id);
  }
  if (!annotateEnabled) {
    destroyAnnotator();
    return;
  }
  ensureAnnotator();
  applyAnnotationsToAnnotator();
}

/**
 * setDocument 渲染后：重建 Recogito（DOM 已换）。
 * 由 main.registerSetDocumentView 在 Preact render 之后调用。
 */
export function refreshAnnotateAfterDocument(): void {
  destroyAnnotator();
  if (!annotateEnabled) {
    return;
  }
  ensureAnnotator();
  applyAnnotationsToAnnotator();
}

export function destroyAnnotator(): void {
  if (annotator) {
    try {
      annotator.destroy();
    } catch {
      // ignore
    }
    annotator = null;
  }
}

/** 生命周期入口：当前无额外全局监听；保留符号供契约测 / 未来扩展。 */
export function bindAnnotateUi(): void {
  // Recogito 在 ensureAnnotator 时挂到 .doc-body
}

function ensureAnnotator(): void {
  if (annotator) {
    return;
  }
  const body = document.querySelector('.doc-body');
  if (!(body instanceof HTMLElement)) {
    return;
  }
  const anno = createTextAnnotator(body, {
    annotatingEnabled: true,
  });
  anno.on('createAnnotation', onCreateAnnotation);
  anno.on('selectionChanged', onSelectionChanged);
  annotator = anno;
}

function applyAnnotationsToAnnotator(): void {
  if (!annotator) {
    return;
  }
  const list = draftsToRecogitoAnnotations(annotations) as RecogitoTextAnnotation[];
  // Recogito setAnnotations 接受 TextAnnotation[]；映射形状与库一致
  annotator.setAnnotations(list as Parameters<TextAnnotator['setAnnotations']>[0]);
}

function onCreateAnnotation(annotation: unknown): void {
  const fields = recogitoAnnotationToDraftFields(
    annotation as Parameters<typeof recogitoAnnotationToDraftFields>[0],
  );
  if (!fields) {
    return;
  }
  suppressOpenUntil = Date.now() + 400;
  post('recogitoCreate', {
    quote: fields.originalText,
    renderStart: fields.renderStart,
    renderEnd: fields.renderEnd,
    tempId: fields.id,
  });
}

function onSelectionChanged(selected: unknown): void {
  if (Date.now() < suppressOpenUntil) {
    return;
  }
  if (!Array.isArray(selected) || selected.length === 0) {
    return;
  }
  const ids: string[] = [];
  for (const item of selected) {
    const id = String((item as {id?: string})?.id ?? '');
    if (id.length > 0 && knownDraftIds.has(id)) {
      ids.push(id);
    }
  }
  if (ids.length === 0) {
    return;
  }
  post('annotateOpen', {ids});
}
