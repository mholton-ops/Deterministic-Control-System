"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { EvidencePreview, orderedEvidenceTypes } from "./evidence-preview";
import { RouteLoader } from "./route-loader";
import {
  getBrowserApiBaseUrl,
  type GraphEntityType,
  type TruthGraphEntity,
  type TruthGraphSearchResult,
} from "../lib/api";

const PANEL_NAVIGATION_EVENT = "haldn:panel-navigation";
const PANEL_CLOSE_TRANSITION_MS = 140;

type PanelTarget = { entityType: GraphEntityType; entityId: string };

function parsePanel(value: string | null): { entityType: GraphEntityType; entityId: string } | null {
  if (!value) return null;
  const index = value.indexOf(":");
  if (index <= 0) return null;
  const entityType = value.slice(0, index) as GraphEntityType;
  const entityId = value.slice(index + 1);
  if (!entityId) return null;

  if (
    entityType !== "converter" &&
    entityType !== "box" &&
    entityType !== "queue" &&
    entityType !== "shipment" &&
    entityType !== "sample" &&
    entityType !== "ledger_entry" &&
    entityType !== "reconciliation_case" &&
    entityType !== "settlement"
  ) {
    return null;
  }

  return { entityType, entityId };
}

export function TruthGraphShell(props: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const rawPanel = useMemo(() => parsePanel(searchParams.get("panel")), [searchParams]);
  const rawPanelKey = rawPanel ? `${rawPanel.entityType}:${rawPanel.entityId}` : null;
  const [closedPanelKey, setClosedPanelKey] = useState<string | null>(null);
  const [panelOverride, setPanelOverride] = useState<PanelTarget | null>(null);
  const panel = panelOverride ?? (rawPanelKey && rawPanelKey === closedPanelKey ? null : rawPanel);

  const [panelData, setPanelData] = useState<TruthGraphEntity | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [loadingPanel, setLoadingPanel] = useState(false);
  const [panelTransition, setPanelTransition] = useState<"opening" | "closing" | null>(null);
  const closeLoaderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [panelLoadAttempt, setPanelLoadAttempt] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [results, setResults] = useState<readonly TruthGraphSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const searchShellRef = useRef<HTMLDivElement | null>(null);
  const panelDataMatchesTarget = Boolean(
    panel &&
      panelData &&
      panelData.identity.entityType === panel.entityType &&
      panelData.identity.entityId === panel.entityId,
  );
  const showPanelLoadingOverlay = Boolean(
    panelTransition === "closing" ||
      (panel && (panelTransition === "opening" || loadingPanel || (!panelDataMatchesTarget && !panelError))),
  );

  const openPanel = useCallback((entityType: GraphEntityType, entityId: string) => {
    if (closeLoaderTimerRef.current) {
      clearTimeout(closeLoaderTimerRef.current);
      closeLoaderTimerRef.current = null;
    }
    const currentUrl = new URL(window.location.href);
    const nextPanel = `${entityType}:${entityId}`;
    if (currentUrl.searchParams.get("panel") === nextPanel) return;

    if (!panel) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    setPanelOverride({ entityType, entityId });
    setClosedPanelKey(null);
    setPanelTransition("opening");
    setLoadingPanel(true);
    setPanelError(null);
    setPanelData(null);
    currentUrl.searchParams.set("panel", nextPanel);
    window.history.pushState(
      window.history.state,
      "",
      `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
    );
  }, [panel]);

  const closePanel = useCallback(() => {
    const panelKey = panel ? `${panel.entityType}:${panel.entityId}` : rawPanelKey;
    if (!panelKey) return;
    setPanelTransition("closing");
    if (closeLoaderTimerRef.current) {
      clearTimeout(closeLoaderTimerRef.current);
    }
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete("panel");
    const nextHref = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
    window.history.replaceState(window.history.state, "", nextHref);
    closeLoaderTimerRef.current = setTimeout(() => {
      setPanelOverride(null);
      setClosedPanelKey(panelKey);
      setPanelTransition(null);
      setPanelData(null);
      setPanelError(null);
      closeLoaderTimerRef.current = null;
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    }, PANEL_CLOSE_TRANSITION_MS);
  }, [panel, rawPanelKey]);

  useEffect(() => {
    function onPanelNavigation(event: Event) {
      const detail =
        event instanceof CustomEvent
          ? (event.detail as {
              action?: unknown;
              entityType?: unknown;
              entityId?: unknown;
            } | null)
          : null;
      if (detail?.action !== "open" && detail?.action !== "close") return;

      if (closeLoaderTimerRef.current) {
        clearTimeout(closeLoaderTimerRef.current);
        closeLoaderTimerRef.current = null;
      }
      if (detail.action === "open") {
        const nextPanel =
          typeof detail.entityType === "string" && typeof detail.entityId === "string"
            ? parsePanel(`${detail.entityType}:${detail.entityId}`)
            : null;
        if (nextPanel) {
          if (!panel) {
            previousFocusRef.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }
          setPanelOverride(nextPanel);
        }
        setClosedPanelKey(null);
        setLoadingPanel(true);
        setPanelError(null);
        setPanelData(null);
      } else {
        closePanel();
      }
    }

    document.addEventListener(PANEL_NAVIGATION_EVENT, onPanelNavigation);
    return () => {
      document.removeEventListener(PANEL_NAVIGATION_EVENT, onPanelNavigation);
      if (closeLoaderTimerRef.current) {
        clearTimeout(closeLoaderTimerRef.current);
      }
    };
  }, [closePanel, panel]);

  useEffect(() => {
    function syncPanelFromLocation() {
      const nextPanel = parsePanel(new URL(window.location.href).searchParams.get("panel"));
      setPanelOverride(nextPanel);
      setClosedPanelKey(null);
    }

    window.addEventListener("popstate", syncPanelFromLocation);
    return () => {
      window.removeEventListener("popstate", syncPanelFromLocation);
    };
  }, []);

  useEffect(() => {
    if (!panel) {
      setPanelData(null);
      setPanelError(null);
      setLoadingPanel(false);
      return;
    }
    const target = panel;
    const controller = new AbortController();

    async function load() {
      setLoadingPanel(true);
      setPanelData(null);
      setPanelError(null);
      try {
        const response = await fetch(
          `${getBrowserApiBaseUrl()}/graph/entity/${encodeURIComponent(target.entityType)}/${encodeURIComponent(target.entityId)}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) {
          throw new Error(`Unable to load detail data (HTTP ${response.status}).`);
        }
        const payload = (await response.json()) as TruthGraphEntity;
        if (!controller.signal.aborted) {
          setPanelData(payload);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setPanelData(null);
          setPanelError(error instanceof Error ? error.message : "Unable to load detail data.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingPanel(false);
          setPanelTransition(null);
        }
      }
    }

    void load();
    return () => {
      controller.abort();
    };
  }, [panel, panelLoadAttempt]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setSearchLoading(false);
      setSearchError(false);
      setActiveSearchIndex(-1);
      return;
    }

    const controller = new AbortController();
    setSearchLoading(true);
    setSearchError(false);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `${getBrowserApiBaseUrl()}/graph/search?q=${encodeURIComponent(query)}&limit=14`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) throw new Error("search_failed");
        const payload = (await response.json()) as TruthGraphSearchResult[];
        if (!controller.signal.aborted) {
          setResults(payload);
          setActiveSearchIndex(payload.length > 0 ? 0 : -1);
        }
      } catch {
        if (!controller.signal.aborted) {
          setResults([]);
          setSearchError(true);
          setActiveSearchIndex(-1);
        }
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false);
      }
    }, 180);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    function onDocumentPointerDown(event: PointerEvent) {
      if (searchShellRef.current && !searchShellRef.current.contains(event.target as Node)) {
        setSearchOpen(false);
      }
    }

    document.addEventListener("pointerdown", onDocumentPointerDown);
    return () => document.removeEventListener("pointerdown", onDocumentPointerDown);
  }, []);

  useEffect(() => {
    if (!panel || showPanelLoadingOverlay) return;

    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onDialogKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closePanel();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", onDialogKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onDialogKeyDown);
    };
  }, [closePanel, panel, showPanelLoadingOverlay]);

  return (
    <>
      <div
        className="space-y-4"
        aria-hidden={panel ? true : undefined}
        inert={panel ? true : undefined}
      >
        <div className="rounded-lg border border-surface-700/80 bg-surface-900/75 px-4 py-3 shadow-panel">
          <div className="grid gap-2 lg:grid-cols-[1fr_auto]">
            <div ref={searchShellRef} className="relative">
              <label htmlFor="truth-graph-search" className="sr-only">
                Search the truth graph
              </label>
              <input
                id="truth-graph-search"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={searchOpen && query.trim().length >= 2}
                aria-controls="truth-graph-search-results"
                aria-activedescendant={
                  activeSearchIndex >= 0 ? `truth-search-result-${activeSearchIndex}` : undefined
                }
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setSearchOpen(false);
                    return;
                  }
                  if (event.key === "ArrowDown" && results.length > 0) {
                    event.preventDefault();
                    setActiveSearchIndex((current) => Math.min(current + 1, results.length - 1));
                    return;
                  }
                  if (event.key === "ArrowUp" && results.length > 0) {
                    event.preventDefault();
                    setActiveSearchIndex((current) => Math.max(current - 1, 0));
                    return;
                  }
                  if (event.key === "Enter" && activeSearchIndex >= 0) {
                    const result = results[activeSearchIndex];
                    if (result) {
                      event.preventDefault();
                      openPanel(result.entityType, result.entityId);
                      setSearchOpen(false);
                    }
                  }
                }}
                placeholder="Search converter, box, queue, shipment, settlement, ledger, reconciliation..."
                className="w-full rounded-lg border border-surface-700/80 bg-surface-850/80 px-3 py-2 text-sm text-surface-100 outline-none ring-status-info/50 focus:ring-2"
              />
              {searchOpen && query.trim().length >= 2 ? (
                <div
                  id="truth-graph-search-results"
                  role="listbox"
                  aria-label="Truth graph search results"
                  className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-surface-700/80 bg-surface-900 shadow-panel"
                >
                  {searchLoading ? (
                    <div role="status" className="px-3 py-2 text-sm text-surface-200">
                      Searching control records...
                    </div>
                  ) : searchError ? (
                    <div role="status" className="px-3 py-2 text-sm text-status-bad">
                      Search is temporarily unavailable.
                    </div>
                  ) : results.length === 0 ? (
                    <div role="status" className="px-3 py-2 text-sm text-surface-200">
                      No matching control records.
                    </div>
                  ) : (
                    results.map((result, index) => (
                      <button
                        id={`truth-search-result-${index}`}
                        role="option"
                        aria-selected={index === activeSearchIndex}
                        key={`${result.entityType}:${result.entityId}`}
                        type="button"
                        onPointerMove={() => setActiveSearchIndex(index)}
                        onClick={() => {
                          openPanel(result.entityType, result.entityId);
                          setSearchOpen(false);
                        }}
                        className={`block w-full border-b border-surface-700/60 px-3 py-2 text-left hover:bg-surface-850/80 ${
                          index === activeSearchIndex ? "bg-surface-850/80" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs uppercase tracking-wider text-status-info">
                            {result.entityType}
                          </span>
                          <span className="text-xs text-surface-200">{result.state}</span>
                        </div>
                        <div className="text-sm text-surface-100">{result.label}</div>
                        <div className="text-xs text-surface-200">{result.context}</div>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
            <div className="text-left text-xs text-surface-200 lg:text-right">
              HALDN CONTROL | Truth Graph Navigation
            </div>
          </div>
        </div>

        {props.children}
      </div>

      {showPanelLoadingOverlay ? (
        <div
          className="fixed inset-0 z-40 grid place-items-center bg-black/45 p-4"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="w-full max-w-3xl">
            <div className="mb-2 text-center font-mono text-xs uppercase tracking-wider text-surface-100">
              {panelTransition === "closing" ? "Closing detail panel" : "Loading detail panel"}
            </div>
            <RouteLoader compact />
          </div>
        </div>
      ) : null}

      {panel && !showPanelLoadingOverlay ? (
        <div
          className="fixed inset-0 z-30 flex justify-end bg-black/45"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closePanel();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="truth-detail-panel-title"
            className="h-full w-full max-w-[540px] overflow-y-auto border-l border-surface-700/80 bg-surface-900 p-4 shadow-panel"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2
                id="truth-detail-panel-title"
                className="font-mono text-sm uppercase tracking-wider text-surface-100"
              >
                Truth Detail Panel
              </h2>
              <button
                ref={closeButtonRef}
                type="button"
                onPointerDown={(event) => {
                  if (event.button === 0) closePanel();
                }}
                onClick={(event) => {
                  if (event.detail === 0) closePanel();
                }}
                className="rounded border border-surface-700/70 px-2 py-1 text-xs text-surface-200 hover:bg-surface-850"
              >
                Close
              </button>
            </div>

            {panelError ? (
              <div
                role="alert"
                className="rounded border border-status-bad/40 bg-status-bad/10 p-3 text-sm text-status-bad"
              >
                <div>{panelError}</div>
                <button
                  type="button"
                  onClick={() => setPanelLoadAttempt((attempt) => attempt + 1)}
                  className="mt-3 rounded border border-status-bad/60 px-2 py-1 font-mono text-xs uppercase hover:bg-status-bad/10"
                >
                  Retry
                </button>
              </div>
            ) : null}

            {panelData && panelDataMatchesTarget ? (
              <div className="space-y-3 text-sm">
                <section className="rounded-lg border border-surface-700/70 bg-surface-850/40 p-3">
                  <div className="font-mono text-xs uppercase tracking-wider text-surface-200">Identity</div>
                  <div className="mt-1 text-base text-surface-100">{panelData.identity.title}</div>
                  <div className="font-mono text-xs text-surface-200">
                    {panelData.identity.entityType}:{panelData.identity.entityId}
                  </div>
                </section>

                <section className="rounded-lg border border-surface-700/70 bg-surface-850/40 p-3">
                  <div className="font-mono text-xs uppercase tracking-wider text-surface-200">State and Certainty</div>
                  <div className="text-surface-100">State: {panelData.lifecycle.state}</div>
                  <div className="text-surface-100">Custody: {panelData.financial.custodyStatus}</div>
                  <div className="text-surface-100">Material Form: {panelData.financial.materialForm}</div>
                  <div className="text-surface-100">
                    {panelData.lifecycle.truthStatus} | confidence {panelData.lifecycle.confidence}
                  </div>
                  <div className="text-surface-100">Financial status: {panelData.financial.financialStatus}</div>
                  <div className="text-surface-200">Validation: {panelData.lifecycle.validationStatus}</div>
                  <div className="text-surface-200">
                    Chain completeness: {panelData.chainCompleteness.complete}/{panelData.chainCompleteness.total}
                  </div>
                  {panelData.chainCompleteness.missing.length > 0 ? (
                    <div className="text-xs text-status-warn">
                      Missing: {panelData.chainCompleteness.missing.join(", ")}
                    </div>
                  ) : null}
                </section>

                <section className="rounded-lg border border-surface-700/70 bg-surface-850/40 p-3">
                  <div className="font-mono text-xs uppercase tracking-wider text-surface-200">Origin</div>
                  {panelData.origin ? (
                    <>
                      <div className="text-surface-100">{panelData.origin.sourceSystem}</div>
                      <div className="text-surface-100">{panelData.origin.user}</div>
                      <div className="font-mono text-xs text-surface-200">{panelData.origin.device}</div>
                      <div className="text-xs text-surface-200">{panelData.origin.capturedAt}</div>
                    </>
                  ) : (
                    <div className="text-surface-200">Origin context unavailable.</div>
                  )}
                </section>

                <section className="rounded-lg border border-surface-700/70 bg-surface-850/40 p-3">
                  <div className="font-mono text-xs uppercase tracking-wider text-surface-200">Evidence</div>
                  {panelData.evidenceBundles.length === 0 ? (
                    <div className="text-surface-200">No linked evidence bundles.</div>
                  ) : (
                    <div className="space-y-2">
                      {panelData.evidenceBundles.slice(0, 6).map((bundle) => (
                        <div key={bundle.bundleId} className="rounded border border-surface-700/60 p-2">
                          <div className="font-mono text-xs text-surface-100">{bundle.bundleId.slice(0, 12)}</div>
                          <div className="mt-1 grid grid-cols-2 gap-1">
                            {orderedEvidenceTypes(bundle.types).map((type) => (
                              <EvidencePreview
                                key={`${bundle.bundleId}-${type}`}
                                artifactId={`${bundle.bundleId}-${type}`}
                                evidenceType={type}
                                uri={`generated://${type}/${bundle.bundleId}`}
                                capturedAt={bundle.capturedAt}
                                gpsLat={bundle.gps.lat}
                                gpsLon={bundle.gps.lon}
                                gpsAccuracyM={bundle.gps.accuracyM}
                                capturedBy={bundle.capturedByDevice}
                                size="sm"
                              />
                            ))}
                          </div>
                          <div className="mt-1 text-xs text-surface-200">
                            artifacts:{bundle.artifactCount} | {bundle.capturedByUser ?? "-"} |{" "}
                            {bundle.capturedByDevice ?? "-"}
                          </div>
                          <div className="text-[11px] text-surface-200">
                            {bundle.gps.lat && bundle.gps.lon
                              ? `${bundle.gps.lat}, ${bundle.gps.lon} (${bundle.gps.accuracyM ?? "unknown"}m)`
                              : "Location not captured"}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="rounded-lg border border-surface-700/70 bg-surface-850/40 p-3">
                  <div className="font-mono text-xs uppercase tracking-wider text-surface-200">Dependency Graph</div>
                  <div className="mt-2 text-xs text-surface-200">Upstream</div>
                  <div className="space-y-1">
                    {panelData.upstream.length === 0 ? (
                      <div className="rounded border border-surface-700/60 px-2 py-1 text-xs text-surface-200">
                        none
                      </div>
                    ) : (
                      panelData.upstream.map((link) => (
                        <button
                          key={`up-${link.entityType}-${link.entityId}`}
                          type="button"
                          onClick={() => openPanel(link.entityType, link.entityId)}
                          className="block w-full rounded border border-surface-700/60 px-2 py-1 text-left hover:bg-surface-850/80"
                        >
                          <span className="font-mono text-xs text-status-info">{link.entityType}</span>{" "}
                          {link.label}
                        </button>
                      ))
                    )}
                  </div>
                  <div className="mt-2 text-xs text-surface-200">Downstream</div>
                  <div className="space-y-1">
                    {panelData.downstream.length === 0 ? (
                      <div className="rounded border border-surface-700/60 px-2 py-1 text-xs text-surface-200">
                        none
                      </div>
                    ) : (
                      panelData.downstream.map((link) => (
                        <button
                          key={`down-${link.entityType}-${link.entityId}`}
                          type="button"
                          onClick={() => openPanel(link.entityType, link.entityId)}
                          className="block w-full rounded border border-surface-700/60 px-2 py-1 text-left hover:bg-surface-850/80"
                        >
                          <span className="font-mono text-xs text-status-info">{link.entityType}</span>{" "}
                          {link.label}
                        </button>
                      ))
                    )}
                  </div>
                </section>

                <section className="rounded-lg border border-surface-700/70 bg-surface-850/40 p-3">
                  <div className="font-mono text-xs uppercase tracking-wider text-surface-200">Value Lineage</div>
                  {panelData.valueLineage ? (
                    <div className="space-y-1">
                      <div className="text-surface-100">Estimated: ${panelData.valueLineage.estimatedValueUsd ?? "-"}</div>
                      <div className="text-surface-100">Final: ${panelData.valueLineage.finalValueUsd ?? "-"}</div>
                      <div className="text-surface-100">Variance: ${panelData.valueLineage.varianceUsd ?? "-"}</div>
                      <div className="text-xs text-surface-200">{panelData.valueLineage.explanation}</div>
                    </div>
                  ) : (
                    <div className="text-surface-200">No value lineage available.</div>
                  )}
                </section>

                {panelData.divergence ? (
                  <section className="rounded-lg border border-status-warn/50 bg-status-warn/10 p-3">
                    <div className="font-mono text-xs uppercase tracking-wider text-status-warn">Divergence</div>
                    <div className="mt-1 text-sm text-surface-100">Type: {panelData.divergence.triggerType}</div>
                    <div className="text-xs text-surface-200">Scope: {panelData.divergence.originScope}</div>
                    <div className="text-xs text-surface-200">
                      expected ${panelData.divergence.expectedValueUsd ?? "-"} | observed $
                      {panelData.divergence.observedValueUsd ?? "-"} | variance $
                      {panelData.divergence.varianceUsd ?? "-"}
                    </div>
                    <div className="text-xs text-surface-200">
                      financial impact ${panelData.divergence.financialImpactUsd ?? "-"} | confidence impact{" "}
                      {panelData.divergence.confidenceImpact}
                    </div>
                    <div className="text-xs text-surface-200">
                      resolution step {panelData.divergence.currentResolutionStep} | related evidence bundles{" "}
                      {panelData.divergence.relatedEvidenceBundles}
                    </div>
                  </section>
                ) : null}

                <section className="rounded-lg border border-surface-700/70 bg-surface-850/40 p-3">
                  <div className="font-mono text-xs uppercase tracking-wider text-surface-200">Financial Records</div>
                  <div className="text-surface-100">
                    ledger entries: {panelData.financial.ledgerEntryCount} | total: $
                    {panelData.financial.ledgerAmountUsd}
                  </div>
                  <div className="mt-1 text-xs text-surface-200">
                    estimated {panelData.financial.estimatedValueUsd ?? "-"} | exposed{" "}
                    {panelData.financial.exposedValueUsd ?? "-"} | settlement{" "}
                    {panelData.financial.settlementValueUsd ?? "-"} | variance{" "}
                    {panelData.financial.varianceUsd ?? "-"}
                  </div>
                  <div className="mt-2 space-y-1">
                    {panelData.financial.entries.slice(0, 8).map((entry) => (
                      <button
                        key={entry.ledgerEntryId}
                        type="button"
                        onClick={() => openPanel("ledger_entry", entry.ledgerEntryId)}
                        className="block w-full rounded border border-surface-700/60 px-2 py-1 text-left hover:bg-surface-850/80"
                      >
                        <div className="font-mono text-xs text-status-info">{entry.ledgerEntryId.slice(0, 8)}</div>
                        <div className="text-xs text-surface-100">
                          {entry.purposeCode} | ${entry.amountUsd} | src {entry.sourceOperationalRef}
                        </div>
                      </button>
                    ))}
                    {panelData.financial.entries.length === 0 ? (
                      <div className="rounded border border-surface-700/60 px-2 py-1 text-xs text-surface-200">
                        no linked ledger records
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="rounded-lg border border-surface-700/70 bg-surface-850/40 p-3">
                  <div className="font-mono text-xs uppercase tracking-wider text-surface-200">Reconciliation Cases</div>
                  <div className="text-xs text-surface-200">linked: {panelData.reconciliation.length}</div>
                  <div className="mt-2 space-y-1">
                    {panelData.reconciliation.slice(0, 8).map((row) => (
                      <button
                        key={row.reconciliationCaseId}
                        type="button"
                        onClick={() => openPanel("reconciliation_case", row.reconciliationCaseId)}
                        className="block w-full rounded border border-surface-700/60 px-2 py-1 text-left hover:bg-surface-850/80"
                      >
                        <div className="font-mono text-xs text-status-info">{row.reconciliationCaseId.slice(0, 8)}</div>
                        <div className="text-xs text-surface-100">
                          {row.triggerType} | {row.severity} | {row.status}
                        </div>
                        <div className="text-[11px] text-surface-200">
                          {row.scopeType}:{row.scopeId}
                        </div>
                      </button>
                    ))}
                    {panelData.reconciliation.length === 0 ? (
                      <div className="rounded border border-surface-700/60 px-2 py-1 text-xs text-surface-200">
                        no linked divergence cases
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="rounded-lg border border-surface-700/70 bg-surface-850/40 p-3">
                  <div className="font-mono text-xs uppercase tracking-wider text-surface-200">Actions</div>
                  <div className="flex flex-wrap gap-2">
                    {panelData.actions.fullTraceHref ? (
                      <Link
                        href={panelData.actions.fullTraceHref}
                        className="inline-flex rounded border border-status-info/60 bg-status-info/10 px-2 py-1 font-mono text-xs uppercase tracking-wide text-status-info hover:bg-status-info/20"
                      >
                        View Full Trace
                      </Link>
                    ) : (
                      <span className="text-surface-200">No trace action available.</span>
                    )}
                    {panelData.identity.entityType === "settlement" ? (
                      <Link
                        href={`/settlements/${panelData.identity.entityId}/reconstruct`}
                        className="inline-flex rounded border border-status-info/60 bg-status-info/10 px-2 py-1 font-mono text-xs uppercase tracking-wide text-status-info hover:bg-status-info/20"
                      >
                        Reconstruct
                      </Link>
                    ) : null}
                  </div>
                </section>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
