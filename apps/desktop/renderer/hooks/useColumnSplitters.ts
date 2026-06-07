/**
 * Column splitter drag + visibility — ported from examples/desktop/shell.js initColumnSplitters.
 *
 * @module hooks/useColumnSplitters
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

const COLUMN_SPLITTER_SIZE = 0;
const COLUMN_PREVIEW_MIN_WIDTH = 450;
const COLUMN_EXPLORER_MIN_WIDTH = 300;
const COLUMN_CHAT_MIN_WIDTH = 350;
const NARROW_VIEWPORT_MAX_WIDTH = 900;

function isNarrowViewport(): boolean {
  return window.innerWidth <= NARROW_VIEWPORT_MAX_WIDTH;
}

type ColumnKey = "preview" | "explorer" | "chat";

const WORKSPACE_LAYOUT_IDS = [
  "preview-header",
  "preview-pane",
  "splitter-preview-explorer",
  "explorer-header",
  "explorer-pane",
  "splitter-explorer-chat",
  "rail-header",
  "chat-rail",
] as const;

function countVisibleWorkspaceColumns(vis: Record<ColumnKey, boolean>): number {
  return (vis.preview ? 1 : 0) + (vis.explorer ? 1 : 0) + (vis.chat ? 1 : 0);
}

function countWorkspaceSplitters(vis: Record<ColumnKey, boolean>): number {
  return Math.max(0, countVisibleWorkspaceColumns(vis) - 1);
}

function getColumnMinWidth(key: ColumnKey): number {
  if (key === "preview") return COLUMN_PREVIEW_MIN_WIDTH;
  if (key === "explorer") return COLUMN_EXPLORER_MIN_WIDTH;
  return COLUMN_CHAT_MIN_WIDTH;
}

function getDefaultColumnWidths(workspace: HTMLElement) {
  const total = workspace.clientWidth - COLUMN_SPLITTER_SIZE * 2;
  const ratioSum = 2 + 1 + 2.2;
  return {
    preview: Math.round((total * 2) / ratioSum),
    explorer: Math.round((total * 1) / ratioSum),
  };
}

function getWorkspaceUsableWidth(
  workspace: HTMLElement,
  vis: Record<ColumnKey, boolean>,
): number {
  return (
    workspace.clientWidth - countWorkspaceSplitters(vis) * COLUMN_SPLITTER_SIZE
  );
}

function clampColumnWidths(
  workspace: HTMLElement,
  widths: { preview: number; explorer: number },
  vis: Record<ColumnKey, boolean>,
  columnLayoutMaterialized: boolean,
) {
  const splitterCount = countWorkspaceSplitters(vis);
  const total = workspace.clientWidth - COLUMN_SPLITTER_SIZE * splitterCount;
  let preview = Math.round(widths.preview);
  let explorer = Math.round(widths.explorer);

  if (countVisibleWorkspaceColumns(vis) <= 1) {
    return { preview, explorer };
  }

  if (vis.preview && vis.explorer && vis.chat) {
    preview = Math.max(COLUMN_PREVIEW_MIN_WIDTH, preview);
    explorer = Math.max(COLUMN_EXPLORER_MIN_WIDTH, explorer);

    const maxPreview =
      total - COLUMN_EXPLORER_MIN_WIDTH - COLUMN_CHAT_MIN_WIDTH;
    const maxExplorer =
      total - COLUMN_PREVIEW_MIN_WIDTH - COLUMN_CHAT_MIN_WIDTH;
    if (maxPreview >= COLUMN_PREVIEW_MIN_WIDTH) {
      preview = Math.min(preview, maxPreview);
    }
    if (maxExplorer >= COLUMN_EXPLORER_MIN_WIDTH) {
      explorer = Math.min(explorer, maxExplorer);
    }

    if (total - preview - explorer < COLUMN_CHAT_MIN_WIDTH) {
      explorer = Math.max(
        COLUMN_EXPLORER_MIN_WIDTH,
        total - preview - COLUMN_CHAT_MIN_WIDTH,
      );
    }
    if (total - preview - explorer < COLUMN_CHAT_MIN_WIDTH) {
      preview = Math.max(
        COLUMN_PREVIEW_MIN_WIDTH,
        total - explorer - COLUMN_CHAT_MIN_WIDTH,
      );
    }

    preview = Math.max(COLUMN_PREVIEW_MIN_WIDTH, preview);
    explorer = Math.max(COLUMN_EXPLORER_MIN_WIDTH, explorer);
  } else if (vis.preview && vis.explorer && !vis.chat) {
    preview = Math.max(
      COLUMN_PREVIEW_MIN_WIDTH,
      Math.min(preview, total - COLUMN_EXPLORER_MIN_WIDTH),
    );
    explorer = Math.max(COLUMN_EXPLORER_MIN_WIDTH, total - preview);
    preview = Math.max(COLUMN_PREVIEW_MIN_WIDTH, total - explorer);
  } else if (vis.preview && !vis.explorer && vis.chat) {
    if (columnLayoutMaterialized) {
      preview = Math.max(
        COLUMN_PREVIEW_MIN_WIDTH,
        Math.min(preview, total - COLUMN_CHAT_MIN_WIDTH),
      );
    }
  } else if (!vis.preview && vis.explorer && vis.chat) {
    if (columnLayoutMaterialized) {
      explorer = Math.max(
        COLUMN_EXPLORER_MIN_WIDTH,
        Math.min(explorer, total - COLUMN_CHAT_MIN_WIDTH),
      );
    }
  } else if (vis.preview && !vis.explorer && !vis.chat) {
    preview = Math.max(COLUMN_PREVIEW_MIN_WIDTH, Math.min(preview, total));
  } else if (!vis.preview && vis.explorer && !vis.chat) {
    explorer = Math.max(COLUMN_EXPLORER_MIN_WIDTH, Math.min(explorer, total));
  }

  return { preview, explorer };
}

function getFlexibleWorkspaceColumn(
  vis: Record<ColumnKey, boolean>,
  columnLayoutMaterialized: boolean,
): ColumnKey | null {
  if (columnLayoutMaterialized) return null;
  if (countVisibleWorkspaceColumns(vis) === 3) return "chat";
  if (vis.preview) return "preview";
  if (vis.chat) return "chat";
  if (vis.explorer) return "explorer";
  return null;
}

function trackForColumn(
  key: ColumnKey,
  widths: { preview: number; explorer: number },
  flexKey: ColumnKey | null,
  vis: Record<ColumnKey, boolean>,
  columnLayoutMaterialized: boolean,
): string {
  if (flexKey === key) {
    return `minmax(${getColumnMinWidth(key)}px, 1fr)`;
  }
  if (columnLayoutMaterialized && key === "chat" && vis.chat) {
    const visibleCount = countVisibleWorkspaceColumns(vis);
    if (
      visibleCount === 3 ||
      (visibleCount === 2 && !vis.preview && vis.explorer)
    ) {
      return `minmax(${getColumnMinWidth("chat")}px, 1fr)`;
    }
  }
  if (key === "preview") return `${widths.preview}px`;
  if (key === "explorer") return `${widths.explorer}px`;
  return `${getColumnMinWidth("chat")}px`;
}

function setWorkspaceGridItem(id: string, gridCol: number, visible: boolean) {
  const el = document.getElementById(id);
  if (!el) return;
  if (visible) {
    el.classList.remove("workspace-col-hidden");
    el.style.gridColumn = String(gridCol);
  } else {
    el.classList.add("workspace-col-hidden");
    el.style.gridColumn = "";
  }
}

function applyWorkspaceLayout(
  workspace: HTMLElement,
  vis: Record<ColumnKey, boolean>,
  widths: { preview: number; explorer: number },
  columnLayoutMaterialized: boolean,
) {
  const flexKey = getFlexibleWorkspaceColumn(vis, columnLayoutMaterialized);
  const tracks: string[] = [];
  let col = 1;
  const visibleColumns: ColumnKey[] = [];

  for (const id of WORKSPACE_LAYOUT_IDS) {
    setWorkspaceGridItem(id, 0, false);
  }

  if (vis.preview) {
    visibleColumns.push("preview");
    tracks.push(trackForColumn("preview", widths, flexKey, vis, columnLayoutMaterialized));
    setWorkspaceGridItem("preview-header", col, true);
    setWorkspaceGridItem("preview-pane", col, true);
    col += 1;
  }

  if (vis.explorer) {
    if (visibleColumns.length) {
      tracks.push(`${COLUMN_SPLITTER_SIZE}px`);
      const leftCol = visibleColumns[visibleColumns.length - 1]!;
      if (leftCol === "preview") {
        setWorkspaceGridItem("splitter-preview-explorer", col, true);
      } else {
        setWorkspaceGridItem("splitter-explorer-chat", col, true);
      }
      col += 1;
    }
    visibleColumns.push("explorer");
    tracks.push(trackForColumn("explorer", widths, flexKey, vis, columnLayoutMaterialized));
    setWorkspaceGridItem("explorer-header", col, true);
    setWorkspaceGridItem("explorer-pane", col, true);
    col += 1;
  }

  if (vis.chat) {
    if (visibleColumns.length) {
      tracks.push(`${COLUMN_SPLITTER_SIZE}px`);
      const leftColChat = visibleColumns[visibleColumns.length - 1]!;
      if (leftColChat === "preview") {
        setWorkspaceGridItem("splitter-preview-explorer", col, true);
      } else {
        setWorkspaceGridItem("splitter-explorer-chat", col, true);
      }
      col += 1;
    }
    visibleColumns.push("chat");
    tracks.push(trackForColumn("chat", widths, flexKey, vis, columnLayoutMaterialized));
    setWorkspaceGridItem("rail-header", col, true);
    setWorkspaceGridItem("chat-rail", col, true);
    col += 1;
  }

  workspace.style.gridTemplateColumns = tracks.join(" ");
  workspace.style.setProperty("--col-preview-width", `${widths.preview}px`);
  workspace.style.setProperty("--col-explorer-width", `${widths.explorer}px`);
}

export interface UseColumnSplittersResult {
  workspaceRef: RefObject<HTMLDivElement | null>;
  columnVisibility: Record<ColumnKey, boolean>;
  toggleColumn: (key: ColumnKey) => void;
}

export function useColumnSplitters(): UseColumnSplittersResult {
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const [columnVisibility, setColumnVisibility] = useState<
    Record<ColumnKey, boolean>
  >({
    preview: true,
    explorer: true,
    chat: true,
  });
  const [narrowViewport, setNarrowViewport] = useState(isNarrowViewport);

  const widthsRef = useRef({ preview: 0, explorer: 0 });
  const materializedRef = useRef(false);

  const layoutVisibility = useMemo(
    () => ({
      ...columnVisibility,
      preview: columnVisibility.preview && !narrowViewport,
    }),
    [columnVisibility, narrowViewport],
  );

  const commitColumnWidths = useCallback(
    (
      workspace: HTMLElement,
      widths: { preview: number; explorer: number },
      vis: Record<ColumnKey, boolean>,
    ) => {
      widthsRef.current = clampColumnWidths(
        workspace,
        widths,
        vis,
        materializedRef.current,
      );
      applyWorkspaceLayout(
        workspace,
        vis,
        widthsRef.current,
        materializedRef.current,
      );
    },
    [],
  );

  const snapColumnWidthsForVisibility = useCallback(
    (workspace: HTMLElement, vis: Record<ColumnKey, boolean>) => {
      if (countVisibleWorkspaceColumns(vis) === 3) {
        return clampColumnWidths(
          workspace,
          getDefaultColumnWidths(workspace),
          vis,
          materializedRef.current,
        );
      }
      const flexKey = getFlexibleWorkspaceColumn(vis, materializedRef.current);
      return {
        preview:
          vis.preview && flexKey !== "preview"
            ? getColumnMinWidth("preview")
            : widthsRef.current.preview,
        explorer:
          vis.explorer && flexKey !== "explorer"
            ? getColumnMinWidth("explorer")
            : widthsRef.current.explorer,
      };
    },
    [],
  );

  const toggleColumn = useCallback(
    (key: ColumnKey) => {
      setColumnVisibility((prev) => {
        if (prev[key] && countVisibleWorkspaceColumns(prev) <= 1) {
          return prev;
        }
        const next = { ...prev, [key]: !prev[key] };
        materializedRef.current = false;
        const workspace = workspaceRef.current;
        if (workspace) {
          commitColumnWidths(
            workspace,
            snapColumnWidthsForVisibility(workspace, next),
            next,
          );
        }
        return next;
      });
    },
    [commitColumnWidths, snapColumnWidthsForVisibility],
  );

  useEffect(() => {
    const onResize = () => setNarrowViewport(isNarrowViewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;

    materializedRef.current = false;
    commitColumnWidths(
      workspace,
      getDefaultColumnWidths(workspace),
      layoutVisibility,
    );

    const clampPreviewExplorerDragDelta = (deltaX: number) => {
      const preview = widthsRef.current.preview;
      const explorer = widthsRef.current.explorer;
      if (deltaX < 0) {
        const maxShrinkPreview = preview - getColumnMinWidth("preview");
        if (maxShrinkPreview <= 0) return 0;
        if (-deltaX > maxShrinkPreview) return -maxShrinkPreview;
        return deltaX;
      }
      if (deltaX > 0) {
        const maxShrinkExplorer = explorer - getColumnMinWidth("explorer");
        if (maxShrinkExplorer <= 0) return 0;
        if (deltaX > maxShrinkExplorer) return maxShrinkExplorer;
      }
      return deltaX;
    };

    const clampExplorerChatDragDelta = (deltaX: number) => {
      const explorer = widthsRef.current.explorer;
      const vis = layoutVisibility;
      const total = getWorkspaceUsableWidth(workspace, vis);
      const previewWidth = vis.preview ? widthsRef.current.preview : 0;
      if (deltaX > 0) {
        const maxExplorer = total - previewWidth - getColumnMinWidth("chat");
        const maxGrowExplorer = maxExplorer - explorer;
        if (maxGrowExplorer <= 0) return 0;
        if (deltaX > maxGrowExplorer) return maxGrowExplorer;
        return deltaX;
      }
      if (deltaX < 0) {
        const maxShrinkExplorer = explorer - getColumnMinWidth("explorer");
        if (maxShrinkExplorer <= 0) return 0;
        if (-deltaX > maxShrinkExplorer) return -maxShrinkExplorer;
      }
      return deltaX;
    };

    const clampPreviewChatDragDelta = (deltaX: number) => {
      const preview = widthsRef.current.preview;
      const total = getWorkspaceUsableWidth(workspace, layoutVisibility);
      if (deltaX < 0) {
        const maxShrinkPreview = preview - getColumnMinWidth("preview");
        if (maxShrinkPreview <= 0) return 0;
        if (-deltaX > maxShrinkPreview) return -maxShrinkPreview;
        return deltaX;
      }
      if (deltaX > 0) {
        const maxGrowPreview = total - getColumnMinWidth("chat") - preview;
        if (maxGrowPreview <= 0) return 0;
        if (deltaX > maxGrowPreview) return maxGrowPreview;
      }
      return deltaX;
    };

    const materializeFlexColumns = () => {
      if (materializedRef.current) return;
      materializedRef.current = true;
      const vis = layoutVisibility;
      const widths = {
        preview: widthsRef.current.preview,
        explorer: widthsRef.current.explorer,
      };
      const previewPane = document.getElementById("preview-pane");
      const explorerPane = document.getElementById("explorer-pane");
      if (vis.preview && previewPane) {
        widths.preview = Math.round(previewPane.getBoundingClientRect().width);
      }
      if (vis.explorer && explorerPane) {
        widths.explorer = Math.round(
          explorerPane.getBoundingClientRect().width,
        );
      }
      commitColumnWidths(workspace, widths, vis);
    };

    const bindSplitter = (
      splitterEl: HTMLElement | null,
      onDrag: (deltaX: number) => void,
    ) => {
      if (!splitterEl) return () => {};
      const onMouseDown = (e: MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        materializeFlexColumns();
        splitterEl.classList.add("is-dragging");
        document.body.classList.add("is-column-resizing");
        let lastX = e.clientX;
        const onMove = (ev: MouseEvent) => {
          const delta = ev.clientX - lastX;
          if (delta !== 0) {
            onDrag(delta);
            lastX = ev.clientX;
          }
        };
        const onUp = () => {
          splitterEl.classList.remove("is-dragging");
          document.body.classList.remove("is-column-resizing");
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      };
      splitterEl.addEventListener("mousedown", onMouseDown);
      return () => splitterEl.removeEventListener("mousedown", onMouseDown);
    };

    const vis = layoutVisibility;
    const unbindPreviewExplorer = bindSplitter(
      document.getElementById("splitter-preview-explorer"),
      (deltaX) => {
        if (vis.preview && vis.explorer) {
          deltaX = clampPreviewExplorerDragDelta(deltaX);
          if (deltaX === 0) return;
          commitColumnWidths(
            workspace,
            {
              preview: widthsRef.current.preview + deltaX,
              explorer: widthsRef.current.explorer - deltaX,
            },
            vis,
          );
          return;
        }
        if (vis.preview && vis.chat) {
          deltaX = clampPreviewChatDragDelta(deltaX);
          if (deltaX === 0) return;
          commitColumnWidths(
            workspace,
            {
              preview: widthsRef.current.preview + deltaX,
              explorer: widthsRef.current.explorer,
            },
            vis,
          );
        }
      },
    );

    const unbindExplorerChat = bindSplitter(
      document.getElementById("splitter-explorer-chat"),
      (deltaX) => {
        if (vis.explorer && vis.chat) {
          deltaX = clampExplorerChatDragDelta(deltaX);
          if (deltaX === 0) return;
          commitColumnWidths(
            workspace,
            {
              preview: widthsRef.current.preview,
              explorer: widthsRef.current.explorer + deltaX,
            },
            vis,
          );
        }
      },
    );

    const onResize = () => {
      if (materializedRef.current) {
        commitColumnWidths(workspace, widthsRef.current, vis);
        return;
      }
      commitColumnWidths(
        workspace,
        snapColumnWidthsForVisibility(workspace, vis),
        vis,
      );
    };

    window.addEventListener("resize", onResize);

    return () => {
      unbindPreviewExplorer();
      unbindExplorerChat();
      window.removeEventListener("resize", onResize);
    };
  }, [layoutVisibility, commitColumnWidths, snapColumnWidthsForVisibility]);

  return { workspaceRef, columnVisibility, toggleColumn };
}
