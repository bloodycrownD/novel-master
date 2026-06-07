import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { subscribeToast } from "./toast-bus";

const EXIT_MS = 480;

type ToastPhase = "idle" | "enter" | "show" | "exit";

export function ToastHost() {
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState<ToastPhase>("idle");
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>();

  useEffect(() => {
    return subscribeToast((msg) => {
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = undefined;
      }

      if (msg) {
        setMessage(msg);
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
      setMessage("");
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

  if (phase === "idle" && !message) {
    return null;
  }

  return (
    <div
      className={`shell-toast${phase === "show" ? " is-visible" : ""}`}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}
