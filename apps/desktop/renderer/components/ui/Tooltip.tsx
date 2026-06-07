import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactElement,
  type Ref,
} from "react";
import { createPortal } from "react-dom";

type TooltipPlacement = "top" | "bottom";

type TooltipProps = {
  content: string;
  children: ReactElement;
  placement?: TooltipPlacement;
};

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 8;

function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (!ref) {
        continue;
      }
      if (typeof ref === "function") {
        ref(node);
      } else {
        (ref as MutableRefObject<T | null>).current = node;
      }
    }
  };
}

function resolvePlacement(
  preferred: TooltipPlacement,
  anchorRect: DOMRect,
  tipHeight: number,
): TooltipPlacement {
  const spaceBelow = window.innerHeight - anchorRect.bottom - ANCHOR_GAP - VIEWPORT_MARGIN;
  const spaceAbove = anchorRect.top - ANCHOR_GAP - VIEWPORT_MARGIN;

  if (preferred === "bottom") {
    if (tipHeight <= spaceBelow) {
      return "bottom";
    }
    if (spaceAbove >= tipHeight || spaceAbove >= spaceBelow) {
      return "top";
    }
    return "bottom";
  }

  if (tipHeight <= spaceAbove) {
    return "top";
  }
  if (spaceBelow >= tipHeight || spaceBelow >= spaceAbove) {
    return "bottom";
  }
  return "top";
}

export function Tooltip({
  content,
  children,
  placement = "bottom",
}: TooltipProps) {
  const tooltipId = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [resolvedPlacement, setResolvedPlacement] = useState<TooltipPlacement>(placement);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    const tooltip = tooltipRef.current;
    if (!anchor || !tooltip) {
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    const tipHeight = tipRect.height > 0 ? tipRect.height : 32;
    const tipWidth = tipRect.width > 0 ? tipRect.width : 80;
    const resolved = resolvePlacement(placement, rect, tipHeight);

    const top = resolved === "top" ? rect.top - ANCHOR_GAP : rect.bottom + ANCHOR_GAP;
    const halfWidth = tipWidth / 2;
    const left = Math.max(
      halfWidth + VIEWPORT_MARGIN,
      Math.min(window.innerWidth - halfWidth - VIEWPORT_MARGIN, rect.left + rect.width / 2),
    );

    setResolvedPlacement(resolved);
    setPosition({ top, left });
  }, [placement]);

  const show = useCallback(() => {
    if (!content.trim()) {
      return;
    }
    setResolvedPlacement(placement);
    setOpen(true);
  }, [content, placement]);

  const hide = useCallback(() => {
    setOpen(false);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    reposition();
  }, [open, content, reposition]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onScrollOrResize = () => reposition();
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, reposition]);

  const child = cloneElement(children, {
    ref: mergeRefs(
      anchorRef,
      (children as ReactElement & { ref?: Ref<HTMLElement> }).ref,
    ),
    "aria-describedby": open ? tooltipId : undefined,
    title: undefined,
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
      show();
      children.props.onMouseEnter?.(event);
    },
    onMouseLeave: (event: React.MouseEvent<HTMLElement>) => {
      hide();
      children.props.onMouseLeave?.(event);
    },
    onFocus: (event: React.FocusEvent<HTMLElement>) => {
      show();
      children.props.onFocus?.(event);
    },
    onBlur: (event: React.FocusEvent<HTMLElement>) => {
      hide();
      children.props.onBlur?.(event);
    },
  });

  return (
    <>
      {child}
      {open
        ? createPortal(
            <div
              ref={tooltipRef}
              id={tooltipId}
              role="tooltip"
              className={`app-tooltip app-tooltip--${resolvedPlacement}`}
              style={{ top: position.top, left: position.left }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
