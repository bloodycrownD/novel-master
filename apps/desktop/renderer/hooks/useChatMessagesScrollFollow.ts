import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import {
  nearBottom as isNearBottom,
  scrollTopForBottom,
} from "@/features/chat/chat-messages-scroll";

interface UseChatMessagesScrollFollowOptions {
  readonly streamingText?: string;
  readonly streamingThinking?: string;
  readonly streamTailGenerating?: boolean;
  readonly messagesLength: number;
  readonly running: boolean;
  readonly sessionId: string;
}

function applyScrollTop(el: HTMLElement) {
  el.scrollTop = scrollTopForBottom(el.scrollHeight, el.clientHeight);
}

/**
 * Keep chat transcript pinned to the bottom while streaming when the user is
 * already near the tail; do not fight manual scroll-up.
 */
export function useChatMessagesScrollFollow(
  scrollRef: React.RefObject<HTMLElement | null>,
  {
    streamingText,
    streamingThinking,
    streamTailGenerating = false,
    messagesLength,
    running,
    sessionId,
  }: UseChatMessagesScrollFollowOptions,
) {
  const nearBottomRef = useRef(true);
  const followRafRef = useRef<number | null>(null);
  const prevRunningRef = useRef(false);
  const prevMessagesLengthRef = useRef(messagesLength);
  const prevSessionIdRef = useRef(sessionId);

  const syncNearBottomFromScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    nearBottomRef.current = isNearBottom(
      el.scrollTop,
      el.scrollHeight,
      el.clientHeight,
    );
  }, [scrollRef]);

  const stickToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    applyScrollTop(el);
    nearBottomRef.current = true;
  }, [scrollRef]);

  const followTailIfNearBottom = useCallback(() => {
    if (!nearBottomRef.current) {
      return;
    }
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    applyScrollTop(el);
    if (followRafRef.current != null) {
      cancelAnimationFrame(followRafRef.current);
    }
    followRafRef.current = requestAnimationFrame(() => {
      followRafRef.current = null;
      if (!nearBottomRef.current) {
        return;
      }
      const current = scrollRef.current;
      if (current) {
        applyScrollTop(current);
      }
    });
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const onScroll = () => {
      syncNearBottomFromScroll();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
    };
  }, [scrollRef, syncNearBottomFromScroll]);

  useLayoutEffect(() => {
    if (prevSessionIdRef.current !== sessionId) {
      prevSessionIdRef.current = sessionId;
      nearBottomRef.current = true;
      stickToBottom();
    }
  }, [sessionId, stickToBottom]);

  useLayoutEffect(() => {
    const wasRunning = prevRunningRef.current;
    prevRunningRef.current = running;
    if (!wasRunning && running) {
      nearBottomRef.current = true;
      stickToBottom();
    }
  }, [running, stickToBottom]);

  useLayoutEffect(() => {
    const prevLength = prevMessagesLengthRef.current;
    prevMessagesLengthRef.current = messagesLength;
    if (messagesLength > prevLength) {
      followTailIfNearBottom();
    }
  }, [messagesLength, followTailIfNearBottom]);

  useLayoutEffect(() => {
    if (!running && !streamingText && !streamingThinking && !streamTailGenerating) {
      return;
    }
    followTailIfNearBottom();
  }, [
    running,
    streamingText,
    streamingThinking,
    streamTailGenerating,
    followTailIfNearBottom,
  ]);

  useEffect(() => {
    return () => {
      if (followRafRef.current != null) {
        cancelAnimationFrame(followRafRef.current);
      }
    };
  }, []);
}
