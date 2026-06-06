/**
 * React context: desktop runtime bootstrap via IPC (loading / error / retry).
 * Mirrors mobile NovelMasterProvider; domain services live in main process.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getBootstrapStatus,
  rebootstrap,
} from "../ipc/client";
import type { BootstrapStatusResponse } from "../../shared/ipc-types";

export type RuntimeStatus = "loading" | "ready" | "error";

export interface NovelMasterContextValue {
  status: RuntimeStatus;
  dbPath: string | undefined;
  error: string | undefined;
  retry: () => void;
}

const NovelMasterContext = createContext<NovelMasterContextValue | undefined>(
  undefined,
);

function formatBootstrapError(response: BootstrapStatusResponse): string {
  if (response.ok) {
    return "Unexpected ready response during error handling";
  }
  return response.error.message;
}

function formatThrownError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export function NovelMasterProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<RuntimeStatus>("loading");
  const [dbPath, setDbPath] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [bootToken, setBootToken] = useState(0);

  const retry = useCallback(() => {
    setBootToken((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(undefined);

    (async () => {
      const response =
        bootToken > 0 ? await rebootstrap() : await getBootstrapStatus();
      if (cancelled) {
        return;
      }
      if (response.ok) {
        setDbPath(response.dbPath);
        setStatus("ready");
        return;
      }
      setDbPath(undefined);
      setError(formatBootstrapError(response));
      setStatus("error");
    })().catch((err) => {
      if (!cancelled) {
        setDbPath(undefined);
        setError(formatThrownError(err));
        setStatus("error");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [bootToken]);

  const value = useMemo<NovelMasterContextValue>(
    () => ({
      status,
      dbPath,
      error,
      retry,
    }),
    [status, dbPath, error, retry],
  );

  if (status === "loading") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          fontFamily: "system-ui, sans-serif",
          gap: "0.75rem",
        }}
      >
        <p>Runtime loading...</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          fontFamily: "system-ui, sans-serif",
          gap: "0.75rem",
          padding: "1.5rem",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: "1.125rem", margin: 0 }}>启动失败</h1>
        <p style={{ color: "#666", margin: 0 }}>{error}</p>
        <button type="button" onClick={retry}>
          重试
        </button>
      </div>
    );
  }

  return (
    <NovelMasterContext.Provider value={value}>
      {children}
    </NovelMasterContext.Provider>
  );
}

export function useNovelMaster(): NovelMasterContextValue {
  const ctx = useContext(NovelMasterContext);
  if (!ctx) {
    throw new Error("useNovelMaster must be used within NovelMasterProvider");
  }
  return ctx;
}
