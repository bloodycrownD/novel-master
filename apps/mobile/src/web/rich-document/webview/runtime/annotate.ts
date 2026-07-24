/**
 * rich-document 划词批注：仅 Markdown 预览挂 @recogito/text-annotator。
 *
 * Recogito **只负责**已确认草稿的高亮投影与点击打开（annotatingEnabled=false），
 * **禁止**划词即 createAnnotation（否则选区变蓝、抢走原生复制/批注菜单）。
 * 新建批注：RN menuItems「批注」→ inject 采集 → recogitoCreate。
 */
import { createTextAnnotator, type TextAnnotator } from '@recogito/text-annotator';
import { post } from './post';
import {
  draftsToRecogitoAnnotations,
  type RecogitoTextAnnotation,
} from './annotate-recogito-map';
import { bindAnnotateCollectBridge } from './annotate-collect';

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

/** 生命周期：挂 inject 采集桥；Recogito 在 ensureAnnotator 时挂到 .doc-body。 */
export function bindAnnotateUi(): void {
  bindAnnotateCollectBridge();
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
    // 划词不自动建批注，避免选区变蓝并吞掉系统选区菜单
    annotatingEnabled: false,
    // 已投影批注用下划线，不用大块蓝底
    style: {
      fill: 'transparent',
      fillOpacity: 0,
      underlineStyle: 'solid',
      underlineThickness: 2,
      underlineOffset: 1,
    },
  });
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

function onSelectionChanged(selected: unknown): void {
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
  // 立刻取消选中：否则同一批注二次点击不触发 selectionChanged，体感卡死/极慢
  try {
    annotator?.cancelSelected();
  } catch {
    // ignore
  }
}

/** 宿主关弹窗时清选中，避免残留选中态拖慢下一次点击。 */
export function clearAnnotateSelection(): void {
  try {
    annotator?.cancelSelected();
  } catch {
    // ignore
  }
}
