import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { subscribeToast, type ToastState } from "./toast-bus";

const EXIT_MS = 480;

type ToastPhase = "idle" | "enter" | "show" | "exit";

export function ToastHost() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [phase, setPhase] = useState<ToastPhase>("idle");
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>();

  useEffect(() => {
    return subscribeToast((state) => {
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = undefined;
      }

      if (state) {
        setToast(state);
        setPhase((current) => (current === "show" ? "show" : "enter"));
        return;
      }

      setPhase((current) => (current === "idle" ? "idle" : "exit"));
    });
  }, []);

  useLayoutEffect(() => {
    if (phase !== "enter") {
      return;
    }

    let frame = 0;
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setPhase("show"));
    });

    return () => cancelAnimationFrame(frame);
  }, [phase]);

  useEffect(() => {
    if (phase !== "exit") {
      return;
    }

    exitTimerRef.current = setTimeout(() => {
      setToast(null);
      setPhase("idle");
      exitTimerRef.current = undefined;
    }, EXIT_MS);

    return () => {
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = undefined;
      }
    };
  }, [phase]);

  if (phase === "idle" && !toast) {
    return null;
  }

  const hasAction = Boolean(toast?.actionLabel && toast.onAction);

  return (
    <div
      className={`shell-toast${phase === "show" ? " is-visible" : ""}${hasAction ? " has-action" : ""}`}
      role="status"
      aria-live="polite"
    >
      <span className="shell-toast__message">{toast?.message ?? ""}</span>
      {hasAction ? (
        <button
          type="button"
          className="shell-toast__action"
          onClick={() => toast?.onAction?.()}
        >
          {toast?.actionLabel}
        </button>
      ) : null}
    </div>
  );
}
