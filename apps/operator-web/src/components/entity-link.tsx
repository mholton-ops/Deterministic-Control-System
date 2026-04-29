"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import type { GraphEntityType } from "../lib/api";

const PANEL_NAVIGATION_EVENT = "haldn:panel-navigation";

function signalPanelNavigation(action: "open" | "close", entityType?: GraphEntityType, entityId?: string) {
  document.dispatchEvent(
    new CustomEvent(PANEL_NAVIGATION_EVENT, {
      detail: { action, entityType, entityId },
    }),
  );
}

export function EntityLink(props: {
  entityType: GraphEntityType;
  entityId: string;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const pathname = usePathname();

  return (
    <button
      type="button"
      title={props.title ?? "Open detail panel"}
      onClick={() => {
        const currentUrl = new URL(window.location.href);
        const next = new URLSearchParams(currentUrl.search);
        const nextPanel = `${props.entityType}:${props.entityId}`;
        if (currentUrl.searchParams.get("panel") === nextPanel) return;

        signalPanelNavigation("open", props.entityType, props.entityId);
        next.set("panel", nextPanel);
        window.history.pushState(window.history.state, "", `${pathname}?${next.toString()}`);
      }}
      className={props.className ?? "font-mono text-status-info hover:underline"}
    >
      {props.children}
    </button>
  );
}

export function OpenPanelButton(props: {
  entityType: GraphEntityType;
  entityId: string;
  label?: string;
}) {
  return (
    <EntityLink
      entityType={props.entityType}
      entityId={props.entityId}
      className="inline-flex rounded border border-status-info/60 bg-status-info/10 px-2 py-1 font-mono text-xs uppercase tracking-wide text-status-info hover:bg-status-info/20"
    >
      {props.label ?? "Detail"}
    </EntityLink>
  );
}
