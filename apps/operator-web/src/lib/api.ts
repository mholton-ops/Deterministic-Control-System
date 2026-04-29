export interface OperationsOverview {
  readonly generatedAt: string;
  readonly convertersByState: Record<string, number>;
  readonly queueCount: number;
  readonly openReconciliationCount: number;
  readonly totalEstimatedQueueValueUsd: string;
}

export interface CommandSurface {
  readonly generatedAt: string;
  readonly totalCapitalDeployedUsd: string;
  readonly materialValueUnderControlUsd: string;
  readonly estimatedFloorValueUsd: string;
  readonly floorInventoryValueUsd: string;
  readonly materialInCustodyUsd: string;
  readonly materialInTransitUsd: string;
  readonly processedCatalystValueUsd: string;
  readonly wholeConverterValueUsd: string;
  readonly pendingSettlementValueUsd: string;
  readonly pendingAssayValueUsd: string;
  readonly unprovenExposureUsd: string;
  readonly unprovenCapitalExposureUsd: string;
  readonly lowConfidenceExposureUsd: string;
  readonly openDivergenceImpactUsd: string;
  readonly queuesAwaitingAssay: number;
  readonly openDivergences: number;
  readonly evidenceGaps: number;
  readonly chainCompleteness: {
    complete: number;
    total: number;
    percent: number;
  };
  readonly activeSites: number;
  readonly materialInTransit: number;
  readonly processingBacklog: number;
  readonly estimatedVsFinalVarianceUsd: string;
  readonly settlementVarianceUsd: string;
  readonly hedgeCoveragePercent: number;
  readonly agingRisk: {
    oldestCaptureDays: number;
    avgAssayWaitDays: number;
    oldestOpenDivergenceDays: number;
  };
}

export interface CustomerVisibility {
  readonly summary: {
    readonly generatedAt: string;
    readonly visibilityMode: "customer_filtered";
    readonly totalInventoryUnits: number;
    readonly totalBoxes: number;
    readonly totalConverters: number;
    readonly processedLots: number;
    readonly unprocessedLots: number;
    readonly currentValueUsd: string;
    readonly estimatedValueUsd: string;
    readonly finalizedValueUsd: string;
    readonly pendingAssayValueUsd: string;
    readonly openDivergences: number;
    readonly hedgeProtectedLots: number;
    readonly bidEligibleLots: number;
  };
  readonly perspectives: readonly {
    readonly name: "Internal System View" | "Customer View" | "External Market View";
    readonly exposure: string;
    readonly controls: readonly string[];
  }[];
  readonly inventory: readonly {
    readonly lotRef: string;
    readonly queueId: string;
    readonly progressStage: "intake" | "processing" | "assay" | "settlement";
    readonly materialForm: string;
    readonly boxCount: number;
    readonly converterCount: number;
    readonly evidenceArtifactCount: number;
    readonly sampleCount: number;
    readonly truthStatus: "estimated" | "provisional" | "validated" | "finalized";
    readonly confidence: "high" | "medium" | "low" | "unknown";
    readonly validationStatus: string;
    readonly estimatedValueUsd: string | null;
    readonly finalValueUsd: string | null;
    readonly varianceUsd: string | null;
    readonly customerVisibleValueUsd: string | null;
    readonly marketComparisonUsd: string | null;
    readonly openDivergenceCount: number;
    readonly hedgeStatus: "protected" | "lock_in_available" | "not_required";
    readonly saleStatus: "eligible" | "needs_assay_or_pricing" | "intake_pending" | "settled";
    readonly bidVisibility: "invite_ready" | "not_ready" | "closed";
    readonly reportStatus: "available" | "pending";
    readonly proofStatus: "complete" | "partial" | "evidence_gap";
  }[];
  readonly actions: readonly {
    readonly action: string;
    readonly status: string;
    readonly control: string;
    readonly systemEffect: string;
  }[];
  readonly reports: readonly {
    readonly report: string;
    readonly basis: string;
    readonly status: "available" | "pending";
  }[];
  readonly dailyTotals: {
    readonly converterActivity: number;
    readonly activeFieldUsers: number;
    readonly latestCaptureAt: string | null;
    readonly openCustomerVisibleIssues: number;
  };
}

export interface QueueExposureRow {
  readonly queueId: string;
  readonly queueCode: string;
  readonly queueState: string;
  readonly materialForm: string;
  readonly estimatedValueUsd: string | null;
  readonly exposedValueUsd: string | null;
  readonly possibleVarianceUsd: string | null;
  readonly linkedLedgerAmountUsd: string;
  readonly openDivergenceCount: number;
  readonly sourceMethod: string | null;
  readonly confidenceBand: string | null;
  readonly avgPtPpmCorrected: string;
  readonly avgPdPpmCorrected: string;
  readonly avgRhPpmCorrected: string;
  readonly hedgedPtOz: string;
  readonly hedgedPdOz: string;
  readonly hedgedRhOz: string;
  readonly openHedgeCount: number;
  readonly settlementStatus: string | null;
  readonly needsHedgeAttention: boolean;
}

export interface IntakeRow {
  readonly converterId: string;
  readonly state: string;
  readonly vinOrSerial: string | null;
  readonly capturedAt: string;
  readonly siteCode: string | null;
  readonly boxCode: string | null;
  readonly evidenceBundleId: string;
  readonly evidenceArtifactCount: number;
  readonly originUserDisplay: string | null;
  readonly originDeviceRef: string | null;
}

export interface CustodyProjection {
  readonly boxes: readonly {
    boxId: string;
    boxCode: string;
    state: string;
    materialType: string;
    converterCount: number;
    evidenceArtifactCount: number;
    representativeEvidence: readonly {
      artifactId: string;
      evidenceType: string;
      uri: string;
    }[];
    createdAt: string;
  }[];
  readonly queues: readonly {
    queueId: string;
    queueCode: string;
    state: string;
    lockedForProcessing: boolean;
    materialMix: string;
    catalystWeightKg: string | null;
    estimatedValueUsd: string | null;
    exposedValueUsd: string | null;
    possibleVarianceUsd: string | null;
    boxCount: number;
    converterCount: number;
    evidenceArtifactCount: number;
    sampleCount: number;
    ledgerEntryCount: number;
    linkedLedgerAmountUsd: string;
    openReconciliationCount: number;
    settlementStatus: string | null;
    chainCompleteness: {
      complete: number;
      total: number;
      missing: readonly string[];
    };
    createdAt: string;
  }[];
  readonly shipments: readonly {
    shipmentId: string;
    shipmentCode: string;
    state: string;
    originSiteId: string;
    destinationSiteId: string;
    boxCount: number;
    departedAt: string | null;
    receivedAt: string | null;
  }[];
}

export interface GradingRow {
  readonly gradingDecisionId: string;
  readonly converterId: string;
  readonly converterState: string;
  readonly method: string;
  readonly confidenceBand: string;
  readonly estimatedValueUsd: string;
  readonly overridden: boolean;
  readonly overrideReason: string | null;
  readonly libraryEntryId: string;
  readonly qualificationStatus: string;
  readonly decidedBy: string | null;
  readonly decidedAt: string;
}

export interface AnalyticsRow {
  readonly sampleId: string;
  readonly queueCode: string;
  readonly source: string;
  readonly ptPpmRaw: string;
  readonly pdPpmRaw: string;
  readonly rhPpmRaw: string;
  readonly ptPpmCorrected: string | null;
  readonly pdPpmCorrected: string | null;
  readonly rhPpmCorrected: string | null;
  readonly matrixId: string | null;
  readonly matrixQualificationStatus: string | null;
  readonly capturedAt: string;
}

export interface LedgerTraceEntry {
  readonly ledgerEntryId: string;
  readonly purposeCode: string;
  readonly amountUsd: string;
  readonly sourceOperationalRef: string;
  readonly createdAt: string;
}

export interface LedgerTrace {
  readonly generatedAt: string;
  readonly entries: readonly LedgerTraceEntry[];
}

export interface ReconciliationRow {
  readonly reconciliationCaseId: string;
  readonly triggerType: string;
  readonly severity: string;
  readonly status: string;
  readonly scopeType: string;
  readonly scopeId: string;
  readonly actionCount: number;
  readonly expectedValueUsd: string | null;
  readonly observedValueUsd: string | null;
  readonly varianceUsd: string | null;
  readonly financialImpactUsd: string | null;
  readonly confidenceImpact: string;
  readonly currentResolutionStep: string;
  readonly relatedEvidenceBundles: number;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly closureRationale: string | null;
}

export interface SettlementListRow {
  readonly settlementId: string;
  readonly scopeType: string;
  readonly scopeId: string;
  readonly status: string;
  readonly estimatedValueUsd: string;
  readonly finalValueUsd: string | null;
  readonly varianceUsd: string | null;
  readonly invoiceCount: number;
  readonly chainCompleteness: {
    complete: number;
    total: number;
    missing: readonly string[];
  };
  readonly createdAt: string;
  readonly finalizedAt: string | null;
}

export interface SettlementDrilldown {
  readonly settlement: {
    settlementId: string;
    status: string;
    estimatedValueUsd: string;
    finalValueUsd: string | null;
    varianceUsd: string | null;
    finalizedAt: string | null;
  };
  readonly steps: readonly {
    stepOrder: number;
    stepName: string;
    recordedAt: string;
  }[];
  readonly invoices: readonly {
    invoiceId: string;
    invoiceNumber: string;
    issuedAt: string;
    lines: readonly {
      sortOrder: number;
      lineType: string;
      description: string;
      amountUsd: string;
    }[];
  }[];
}

export interface EvidenceRow {
  readonly evidenceBundleId: string;
  readonly capturedAt: string;
  readonly gpsLat: string;
  readonly gpsLon: string;
  readonly gpsAccuracyM: string;
  readonly artifactCount: number;
  readonly converterLinks: number;
  readonly custodyEventLinks: number;
  readonly ledgerLinks: number;
  readonly capturedByUser: string | null;
  readonly capturedByDevice: string | null;
  readonly artifacts: readonly {
    artifactId: string;
    evidenceType: string;
    uri: string;
    capturedAt: string;
  }[];
}

export interface TransactionHistoryRow {
  readonly transactionId: string;
  readonly idempotencyKey: string;
  readonly eventType: string;
  readonly sourceSystem: string;
  readonly validationState: string;
  readonly originUserDisplay: string | null;
  readonly originDeviceRef: string | null;
  readonly createdAt: string;
  readonly appliedAt: string | null;
}

type ReplicationLegState = "confirmed" | "failed" | "retrying" | "dependency_blocked";

export interface ReplicationSync {
  readonly generatedAt: string;
  readonly framing: string;
  readonly summary: {
    readonly localCreated: number;
    readonly localPersisted: number;
    readonly outboundQueued: number;
    readonly transmitting: number;
    readonly receiverValidated: number;
    readonly idempotentApplied: number;
    readonly acknowledged: number;
    readonly confirmed: number;
    readonly failed: number;
    readonly retrying: number;
    readonly dependencyBlocked: number;
    readonly recordStreamCount: number;
    readonly imageStreamCount: number;
  };
  readonly siteSync: readonly {
    readonly siteCode: string;
    readonly siteType: string;
    readonly lastSyncAt: string;
    readonly recordStreamStatus: ReplicationLegState;
    readonly imageStreamStatus: ReplicationLegState;
    readonly outboundQueueDepth: number;
    readonly dependencyBlockedTransactions: number;
  }[];
  readonly movement: readonly {
    readonly transactionId: string;
    readonly eventType: string;
    readonly sourceSystem: string;
    readonly localCreation: string;
    readonly localPersistence: string;
    readonly outboundQueue: string;
    readonly transmissionStatus: ReplicationLegState;
    readonly receiverValidation: string;
    readonly dependencyCheck: string;
    readonly idempotentApply: string;
    readonly acknowledgement: string;
    readonly streamType: "record_stream" | "image_stream";
    readonly origin: string;
    readonly createdAt: string;
  }[];
  readonly streamSeparation: readonly {
    readonly streamType: "record_stream" | "image_stream";
    readonly queued: number;
    readonly confirmed: number;
    readonly retrying: number;
    readonly failed: number;
    readonly controlNote: string;
  }[];
  readonly projectionReplay: readonly {
    readonly projectionName: string;
    readonly sourceTransactionCount: number;
    readonly replayStatus: string;
    readonly rebuildStatus: string;
    readonly lastReplayAt: string;
  }[];
}

export interface SmartLibraryDetail {
  readonly generatedAt: string;
  readonly rows: readonly {
    readonly gradingDecisionId: string;
    readonly converterId: string;
    readonly converterState: string;
    readonly vinOrSerial: string | null;
    readonly libraryEntryId: string;
    readonly matchMethod: string;
    readonly matchHierarchy: string;
    readonly imageArtifactRef: string;
    readonly physicalCharacteristics: string;
    readonly dimensionalAttributes: string;
    readonly assayHistory: string;
    readonly pricingHistory: string;
    readonly qualificationStatus: string;
    readonly overrideHistory: string;
    readonly finalAssayFeedbackLoop: string;
    readonly libraryRefinementNote: string;
    readonly authorityControl: string;
    readonly decidedAt: string;
  }[];
}

export interface FundingControl {
  readonly generatedAt: string;
  readonly summary: {
    readonly fundingAdvanceCount: number;
    readonly provisionalCount: number;
    readonly finalizedCount: number;
    readonly correctionCount: number;
    readonly totalFundingAdvancedUsd: string;
  };
  readonly rows: readonly {
    readonly ledgerEntryId: string;
    readonly transactionId: string;
    readonly purposeCode: string;
    readonly fundingAdvanceUsd: string;
    readonly approvingActor: string;
    readonly executingActor: string;
    readonly buyerOrSiteBalanceUsd: string;
    readonly linkedPurchases: string;
    readonly linkedBoxesQueues: string;
    readonly provisionalFinalState: string;
    readonly offsettingCorrections: string;
    readonly separationOfDutyTrail: string;
    readonly evidenceRequirement: string;
    readonly ledgerSourceReferences: string;
    readonly createdAt: string;
  }[];
}

export type TraceEntityType =
  | "converter"
  | "box"
  | "queue"
  | "shipment"
  | "sample"
  | "reconciliation_case"
  | "settlement"
  | "ledger_entry";

export type GraphEntityType =
  | "converter"
  | "box"
  | "queue"
  | "shipment"
  | "sample"
  | "ledger_entry"
  | "reconciliation_case"
  | "settlement";

export interface TraceStep {
  readonly stepOrder: number;
  readonly stepKey: string;
  readonly title: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly occurredAt: string | null;
  readonly lifecycleState: string;
  readonly truthStatus: "estimated" | "provisional" | "validated" | "finalized";
  readonly confidence: "high" | "medium" | "low" | "unknown";
  readonly validationStatus: string;
  readonly dependencyState: "complete" | "incomplete";
  readonly dependencies: readonly {
    entityType: string;
    entityId: string;
    requiredState: string;
  }[];
  readonly origin: {
    sourceSystem: string;
    originUserId: string;
    originDeviceId: string;
    originUserDisplay: string | null;
    originDeviceRef: string | null;
    capturedAt: string;
  } | null;
  readonly evidence: {
    evidenceBundleId: string;
    requiredTypes: readonly string[];
    presentTypes: readonly string[];
    missingTypes: readonly string[];
    artifacts: readonly {
      artifactId: string;
      evidenceType: string;
      uri: string;
      capturedAt: string;
    }[];
    capturedAt: string;
    capturedByUser: string | null;
    capturedByDevice: string | null;
    location: {
      lat: string;
      lon: string;
      accuracyM: string;
    };
  } | null;
  readonly summary: string;
}

export interface TraceView {
  readonly traceRef: {
    entityType: TraceEntityType;
    entityId: string;
    resolvedAt: string;
  };
  readonly chain: {
    converterId: string | null;
    boxId: string | null;
    boxCode: string | null;
    queueId: string | null;
    queueCode: string | null;
    shipmentIds: readonly string[];
    sampleIds: readonly string[];
    pricingDecisionId: string | null;
    hedgePositionIds: readonly string[];
    reconciliationCaseIds: readonly string[];
    settlementId: string | null;
    ledgerEntryIds: readonly string[];
  };
  readonly certaintySummary: {
    overallTrust: "high" | "medium" | "low" | "unknown";
    finalizationState: string;
    openGaps: readonly string[];
  };
  readonly steps: readonly TraceStep[];
}

export interface SettlementReconstruction {
  readonly settlementId: string;
  readonly beforeAfter: {
    estimatedValueUsd: string | null;
    finalValueUsd: string | null;
    varianceUsd: string | null;
    explanation: string;
  };
  readonly replay: readonly {
    order: number;
    stage: string;
    truthStatus: "estimated" | "provisional" | "validated" | "finalized";
    confidence: "high" | "medium" | "low" | "unknown";
    validationStatus: string;
    uncertainty: string[];
    origin: TraceStep["origin"];
    dependencies: TraceStep["dependencies"];
    evidenceBundleId: string | null;
    evidenceMissingTypes: string[];
    summary: string;
  }[];
}

export interface TruthGraphSearchResult {
  readonly entityType: GraphEntityType;
  readonly entityId: string;
  readonly label: string;
  readonly state: string;
  readonly context: string;
}

export interface TruthGraphEntity {
  readonly identity: {
    entityType: GraphEntityType;
    entityId: string;
    displayId: string;
    title: string;
  };
  readonly lifecycle: {
    state: string;
    truthStatus: "estimated" | "provisional" | "validated" | "finalized";
    confidence: "high" | "medium" | "low" | "unknown";
    validationStatus: string;
    updatedAt: string | null;
  };
  readonly chainCompleteness: {
    complete: number;
    total: number;
    missing: readonly string[];
  };
  readonly origin: {
    sourceSystem: string;
    user: string;
    device: string;
    capturedAt: string;
  } | null;
  readonly evidenceBundles: readonly {
    bundleId: string;
    artifactCount: number;
    types: readonly string[];
    capturedAt: string;
    capturedByUser: string | null;
    capturedByDevice: string | null;
    gps: {
      lat: string;
      lon: string;
      accuracyM: string;
    };
  }[];
  readonly upstream: readonly {
    entityType: GraphEntityType;
    entityId: string;
    label: string;
    state: string;
  }[];
  readonly downstream: readonly {
    entityType: GraphEntityType;
    entityId: string;
    label: string;
    state: string;
  }[];
  readonly financial: {
    ledgerEntryCount: number;
    settlementCount: number;
    ledgerAmountUsd: string;
    estimatedValueUsd: string | null;
    exposedValueUsd: string | null;
    settlementValueUsd: string | null;
    varianceUsd: string | null;
    financialStatus: "provisional" | "exposed" | "reconciled" | "finalized";
    materialForm: string;
    custodyStatus: string;
    entries: readonly {
      ledgerEntryId: string;
      purposeCode: string;
      amountUsd: string;
      sourceOperationalRef: string;
      createdAt: string;
      settlementId: string | null;
    }[];
  };
  readonly reconciliation: readonly {
    reconciliationCaseId: string;
    triggerType: string;
    severity: string;
    status: string;
    scopeType: string;
    scopeId: string;
    actionCount: number;
    openedAt: string;
    closedAt: string | null;
  }[];
  readonly valueLineage: {
    estimatedValueUsd: string | null;
    finalValueUsd: string | null;
    varianceUsd: string | null;
    explanation: string;
  } | null;
  readonly divergence: {
    triggerType: string;
    expectedValueUsd: string | null;
    observedValueUsd: string | null;
    varianceUsd: string | null;
    financialImpactUsd: string | null;
    confidenceImpact: string;
    currentResolutionStep: string;
    originScope: string;
    relatedEvidenceBundles: number;
  } | null;
  readonly related: {
    queueFacts: {
      boxCount: number;
      converterCount: number;
      sampleCount: number;
      evidenceArtifactCount: number;
      ledgerEntryCount: number;
      openReconciliationCount: number;
    } | null;
  };
  readonly actions: {
    fullTraceHref: string | null;
  };
}

const DEFAULT_API_BASE_URL = "http://localhost:3001";

function apiBase(): string {
  return process.env.DCS_API_BASE_URL ?? DEFAULT_API_BASE_URL;
}

export function getApiBaseUrl(): string {
  return apiBase();
}

export function getBrowserApiBaseUrl(): string {
  return "/api/control";
}

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText} ${body}`.trim());
  }

  return (await response.json()) as T;
}

export async function readOperationsOverview(): Promise<OperationsOverview> {
  return readJson<OperationsOverview>("/projections/operations-overview");
}

export async function readCommandSurface(): Promise<CommandSurface> {
  return readJson<CommandSurface>("/graph/command-surface");
}

export async function readCustomerVisibility(): Promise<CustomerVisibility> {
  return readJson<CustomerVisibility>("/customer/visibility");
}

export async function readIntake(): Promise<readonly IntakeRow[]> {
  return readJson<readonly IntakeRow[]>("/workbench/intake");
}

export async function readCustody(): Promise<CustodyProjection> {
  return readJson<CustodyProjection>("/workbench/custody");
}

export async function readGrading(): Promise<readonly GradingRow[]> {
  return readJson<readonly GradingRow[]>("/workbench/grading");
}

export async function readAnalytics(): Promise<readonly AnalyticsRow[]> {
  return readJson<readonly AnalyticsRow[]>("/workbench/analytics");
}

export async function readPricingExposure(): Promise<readonly QueueExposureRow[]> {
  return readJson<readonly QueueExposureRow[]>("/workbench/pricing-exposure");
}

export async function readLedgerTrace(sourceOperationalRef?: string): Promise<LedgerTrace> {
  if (!sourceOperationalRef) {
    return readJson<LedgerTrace>("/projections/ledger-trace");
  }

  return readJson<LedgerTrace>(
    `/projections/ledger-trace?sourceOperationalRef=${encodeURIComponent(sourceOperationalRef)}`,
  );
}

export async function readReconciliation(): Promise<readonly ReconciliationRow[]> {
  return readJson<readonly ReconciliationRow[]>("/workbench/reconciliation");
}

export async function readSettlements(): Promise<readonly SettlementListRow[]> {
  return readJson<readonly SettlementListRow[]>("/workbench/settlements");
}

export async function readSettlement(settlementId: string): Promise<SettlementDrilldown> {
  return readJson<SettlementDrilldown>(
    `/projections/settlement/${encodeURIComponent(settlementId)}`,
  );
}

export async function readEvidence(): Promise<readonly EvidenceRow[]> {
  return readJson<readonly EvidenceRow[]>("/workbench/evidence");
}

export async function readTransactions(limit = 100): Promise<readonly TransactionHistoryRow[]> {
  return readJson<readonly TransactionHistoryRow[]>(
    `/workbench/transactions?limit=${encodeURIComponent(String(limit))}`,
  );
}

export async function readReplicationSync(): Promise<ReplicationSync> {
  return readJson<ReplicationSync>("/workbench/replication-sync");
}

export async function readSmartLibraryDetail(): Promise<SmartLibraryDetail> {
  return readJson<SmartLibraryDetail>("/workbench/smart-library-detail");
}

export async function readFundingControl(): Promise<FundingControl> {
  return readJson<FundingControl>("/workbench/funding-control");
}

export async function readTrace(
  entityType: TraceEntityType,
  entityId: string,
): Promise<TraceView> {
  return readJson<TraceView>(
    `/trace/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`,
  );
}

export async function readSettlementReconstruction(
  settlementId: string,
): Promise<SettlementReconstruction> {
  return readJson<SettlementReconstruction>(
    `/reconstruct/settlement/${encodeURIComponent(settlementId)}`,
  );
}

export async function readTruthGraphEntity(
  entityType: GraphEntityType,
  entityId: string,
): Promise<TruthGraphEntity> {
  return readJson<TruthGraphEntity>(
    `/graph/entity/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`,
  );
}

export async function searchTruthGraph(
  query: string,
  limit = 20,
): Promise<readonly TruthGraphSearchResult[]> {
  return readJson<readonly TruthGraphSearchResult[]>(
    `/graph/search?q=${encodeURIComponent(query)}&limit=${encodeURIComponent(String(limit))}`,
  );
}
