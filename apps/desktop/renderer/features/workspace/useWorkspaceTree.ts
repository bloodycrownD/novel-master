import { useCallback, useEffect, useState } from "react";
import type {
  PreviewFileSelection,
  WorkspacePanelScope,
} from "../../../shared/ipc-types";

export function usePreviewSelection() {
  const [previewFile, setPreviewFile] = useState<PreviewFileSelection | null>(
    null,
  );

  const selectFile = useCallback(
    (workspaceScope: WorkspacePanelScope, path: string) => {
      setPreviewFile({
        workspaceScope,
        path,
        name: path === "/" ? "/" : path.slice(path.lastIndexOf("/") + 1),
      });
    },
    [],
  );

  const clearPreview = useCallback(() => {
    setPreviewFile(null);
  }, []);

  return { previewFile, selectFile, clearPreview, setPreviewFile };
}

export function useTreeRefreshToken() {
  const [token, setToken] = useState(0);
  const refresh = useCallback(() => setToken((t) => t + 1), []);
  return { refreshToken: token, refreshTree: refresh };
}

/** Reload tree when workspace scope or refresh token changes. */
export function useTreeLoader(
  load: () => Promise<void>,
  deps: unknown[],
): { loading: boolean; error: string | undefined } {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    void load()
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { loading, error };
}
