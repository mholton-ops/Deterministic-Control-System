import {
  ApiFailure,
  Badge,
  DataTable,
  EmptyState,
  PageHeader,
  Panel,
  StatCard,
  formatDateTime,
} from "../../components/workbench";
import { readReplicationSync } from "../../lib/api";

type SyncState = "confirmed" | "failed" | "retrying" | "dependency_blocked";

function syncTone(value: SyncState): "good" | "warn" | "bad" | "info" {
  if (value === "confirmed") return "good";
  if (value === "failed") return "bad";
  if (value === "dependency_blocked") return "warn";
  return "info";
}

export default async function ReplicationPage() {
  try {
    const projection = await readReplicationSync();

    return (
      <div className="space-y-4">
        <PageHeader
          title="Replication / Sync"
          subtitle="Replication is treated as controlled transaction movement, not casual data copying."
        />

        <div className="rounded-lg border border-surface-700/70 bg-surface-850/60 px-4 py-3 text-sm text-surface-100">
          This surface shows whether distributed actions can converge without duplication, silent loss, or dependency violations.
          <div className="mt-1 text-xs text-surface-200">{projection.framing}</div>
        </div>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Local Created" value={String(projection.summary.localCreated)} />
          <StatCard label="Local Persisted" value={String(projection.summary.localPersisted)} />
          <StatCard label="Outbound Held" value={String(projection.summary.outboundQueued)} />
          <StatCard label="Receiver Validated" value={String(projection.summary.receiverValidated)} />
          <StatCard label="Idempotent Applied" value={String(projection.summary.idempotentApplied)} />
          <StatCard label="Acknowledged" value={String(projection.summary.acknowledged)} />
          <StatCard label="Confirmed" value={String(projection.summary.confirmed)} />
          <StatCard label="Retrying / Failed" value={`${projection.summary.retrying} / ${projection.summary.failed}`} />
          <StatCard label="Dependency Blocked" value={String(projection.summary.dependencyBlocked)} />
          <StatCard label="Record Stream" value={String(projection.summary.recordStreamCount)} />
          <StatCard label="Image Stream" value={String(projection.summary.imageStreamCount)} />
          <StatCard label="Generated" value={formatDateTime(projection.generatedAt)} />
        </section>

        <Panel title="Site Sync Integrity">
          {projection.siteSync.length === 0 ? (
            <EmptyState message="No site sync records available." />
          ) : (
            <DataTable
              columns={[
                "Site",
                "Type",
                "Last Sync",
                "Record Stream",
                "Image Stream",
                "Outbound Queue",
                "Dependency Blocked",
              ]}
            >
              {projection.siteSync.map((site) => (
                <tr key={site.siteCode}>
                  <td className="px-3 py-2 font-mono text-status-info">{site.siteCode}</td>
                  <td className="px-3 py-2">{site.siteType}</td>
                  <td className="px-3 py-2">{formatDateTime(site.lastSyncAt)}</td>
                  <td className="px-3 py-2">
                    <Badge value={site.recordStreamStatus} tone={syncTone(site.recordStreamStatus)} />
                  </td>
                  <td className="px-3 py-2">
                    <Badge value={site.imageStreamStatus} tone={syncTone(site.imageStreamStatus)} />
                  </td>
                  <td className="px-3 py-2">{site.outboundQueueDepth}</td>
                  <td className="px-3 py-2">{site.dependencyBlockedTransactions}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>

        <Panel title="Transaction Movement">
          {projection.movement.length === 0 ? (
            <EmptyState message="No transaction movement records available." />
          ) : (
            <DataTable
              columns={[
                "Transaction",
                "Event",
                "Source",
                "Local",
                "Outbound",
                "Transmission",
                "Receiver Validation",
                "Dependency",
                "Idempotent Apply",
                "Acknowledgement",
                "Stream",
                "Origin",
                "Created",
              ]}
              stickyActionColumns={0}
            >
              {projection.movement.slice(0, 40).map((row) => (
                <tr key={row.transactionId}>
                  <td className="px-3 py-2 font-mono text-status-info">{row.transactionId.slice(0, 8)}</td>
                  <td className="px-3 py-2">{row.eventType}</td>
                  <td className="px-3 py-2">{row.sourceSystem}</td>
                  <td className="px-3 py-2 text-xs">
                    <div>{row.localCreation}</div>
                    <div>{row.localPersistence}</div>
                  </td>
                  <td className="px-3 py-2">{row.outboundQueue}</td>
                  <td className="px-3 py-2">
                    <Badge value={row.transmissionStatus} tone={syncTone(row.transmissionStatus)} />
                  </td>
                  <td className="px-3 py-2">{row.receiverValidation}</td>
                  <td className="px-3 py-2">{row.dependencyCheck}</td>
                  <td className="px-3 py-2">{row.idempotentApply}</td>
                  <td className="px-3 py-2">{row.acknowledgement}</td>
                  <td className="px-3 py-2">{row.streamType}</td>
                  <td className="px-3 py-2">{row.origin}</td>
                  <td className="px-3 py-2">{formatDateTime(row.createdAt)}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>

        <section className="grid gap-4 xl:grid-cols-2">
          <Panel title="Image Stream vs Record Stream">
            <DataTable columns={["Stream", "Queued", "Confirmed", "Retrying", "Failed", "Control"]}>
              {projection.streamSeparation.map((stream) => (
                <tr key={stream.streamType}>
                  <td className="px-3 py-2 font-mono text-status-info">{stream.streamType}</td>
                  <td className="px-3 py-2">{stream.queued}</td>
                  <td className="px-3 py-2">{stream.confirmed}</td>
                  <td className="px-3 py-2">{stream.retrying}</td>
                  <td className="px-3 py-2">{stream.failed}</td>
                  <td className="px-3 py-2">{stream.controlNote}</td>
                </tr>
              ))}
            </DataTable>
          </Panel>

          <Panel title="Projection Rebuild / Replay">
            <DataTable columns={["Projection", "Source Count", "Replay Status", "Rebuild", "Last Replay"]}>
              {projection.projectionReplay.map((row) => (
                <tr key={row.projectionName}>
                  <td className="px-3 py-2 font-mono text-status-info">{row.projectionName}</td>
                  <td className="px-3 py-2">{row.sourceTransactionCount}</td>
                  <td className="px-3 py-2">{row.replayStatus}</td>
                  <td className="px-3 py-2">
                    <Badge value={row.rebuildStatus} tone="good" />
                  </td>
                  <td className="px-3 py-2">{formatDateTime(row.lastReplayAt)}</td>
                </tr>
              ))}
            </DataTable>
          </Panel>
        </section>
      </div>
    );
  } catch (error) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Replication / Sync"
          subtitle="Replication is treated as controlled transaction movement, not casual data copying."
        />
        <ApiFailure error={error instanceof Error ? error.message : "Unknown API error"} />
      </div>
    );
  }
}
