"use client";

import { useEffect, useRef, useState } from "react";

import { RouteLoader } from "./route-loader";

const SHOW_DELAY_MS = 0;
const MIN_VISIBLE_MS = 1500;
const MAX_OVERLAY_MS = 12_000;

type Bounds = { left: number; top: number; width: number; height: number };

export function RouteTransitionOverlay() {
  const [visible, setVisible] = useState(false);
  const [panelBounds, setPanelBounds] = useState<Bounds | null>(null);
  const visibleStartedAtRef = useRef<number>(0);

  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const minTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimers() {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (minTimerRef.current) {
      clearTimeout(minTimerRef.current);
      minTimerRef.current = null;
    }
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  }

  function startOverlay() {
    clearTimers();
    function show() {
      visibleStartedAtRef.current = Date.now();
      setVisible(true);
    }

    if (SHOW_DELAY_MS <= 0) {
      show();
    } else {
      showTimerRef.current = setTimeout(show, SHOW_DELAY_MS);
    }

    minTimerRef.current = setTimeout(() => {
      stopOverlay();
    }, MIN_VISIBLE_MS);
    maxTimerRef.current = setTimeout(() => {
      stopOverlay();
    }, MAX_OVERLAY_MS);
  }

  function stopOverlay() {
    clearTimers();
    setVisible(false);
    visibleStartedAtRef.current = 0;
  }

  useEffect(() => {
    let frame = 0;

    function updateBounds() {
      const panel = document.getElementById("haldn-main-panel");
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const viewportLeft = 0;
      const viewportTop = 0;
      const viewportRight = window.innerWidth;
      const viewportBottom = window.innerHeight;

      const left = Math.max(rect.left, viewportLeft);
      const top = Math.max(rect.top, viewportTop);
      const right = Math.min(rect.right, viewportRight);
      const bottom = Math.min(rect.bottom, viewportBottom);
      const width = Math.max(0, right - left);
      const height = Math.max(0, bottom - top);

      // Keep overlay anchored to the visible slice of the right panel while scrolling.
      setPanelBounds({
        left,
        top,
        width,
        height: height > 0 ? height : viewportBottom,
      });
    }

    function scheduleBoundsUpdate() {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateBounds);
    }

    updateBounds();
    window.addEventListener("resize", scheduleBoundsUpdate);
    window.addEventListener("scroll", scheduleBoundsUpdate, true);

    return () => {
      window.removeEventListener("resize", scheduleBoundsUpdate);
      window.removeEventListener("scroll", scheduleBoundsUpdate, true);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    function onRouteIntent(event: MouseEvent | PointerEvent) {
      if (event.defaultPrevented) return;
      if ("metaKey" in event && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;

      const targetNode = event.target;
      const target =
        targetNode instanceof Element
          ? targetNode
          : targetNode instanceof Node
            ? targetNode.parentElement
            : null;
      if (!target) return;
      const anchor = target.closest("a");
      if (!anchor) return;
      if (anchor.hasAttribute("data-no-route-loader")) return;
      if (anchor.hasAttribute("download")) return;
      if (anchor.target && anchor.target !== "_self") return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;

      let nextUrl: URL;
      try {
        nextUrl = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }

      const currentUrl = new URL(window.location.href);
      if (nextUrl.origin !== currentUrl.origin) return;
      if (nextUrl.pathname === currentUrl.pathname && nextUrl.search === currentUrl.search) return;

      startOverlay();
    }

    function onPopState() {
      startOverlay();
    }

    document.addEventListener("click", onRouteIntent, { capture: true });
    window.addEventListener("popstate", onPopState);

    return () => {
      document.removeEventListener("click", onRouteIntent, { capture: true });
      window.removeEventListener("popstate", onPopState);
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible) return <span data-haldn-route-overlay-ready className="hidden" />;

  const overlayStyle = panelBounds
    ? {
        left: `${panelBounds.left}px`,
        top: `${panelBounds.top}px`,
        width: `${panelBounds.width}px`,
        height: `${panelBounds.height}px`,
      }
    : undefined;

  return (
    <>
      <span data-haldn-route-overlay-ready className="hidden" />
      <div
        className="pointer-events-none fixed z-[70]"
        style={overlayStyle ?? { inset: 0 }}
        aria-live="polite"
      >
        <div className="absolute inset-0 rounded-2xl bg-surface-950/55 backdrop-blur-[2px]" />
        <div className="absolute inset-0">
          <div className="absolute left-1/2 top-[20%] w-full max-w-3xl -translate-x-1/2 px-4 md:px-6">
            <div className="relative z-10 rounded-2xl border-2 border-sky-300/70 bg-slate-950/95 p-4 shadow-[0_18px_50px_rgba(0,0,0,0.55)] md:p-5">
            <div className="mb-3 flex items-center gap-3 border-b border-sky-200/25 pb-3">
              <span className="haldn-overlay-spinner" aria-hidden />
              <div>
                <div className="font-mono text-xs uppercase tracking-[0.16em] text-sky-200">
                  HALDN CONTROL
                </div>
                <div className="text-sm font-semibold text-slate-100">
                  Loading Next Operational Surface
                </div>
              </div>
            </div>
            <RouteLoader compact />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
