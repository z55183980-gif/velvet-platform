"use client";

import { useMemo, useState, type MouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  adminOpsMonitorOverview,
  type AdminOpsMonitorOverview,
} from "@velvet/api-client";
import { Button, cn } from "@velvet/ui";
import {
  Activity,
  Cloud,
  Cpu,
  HardDrive,
  MemoryStick,
  RefreshCw,
  Server,
} from "lucide-react";
import { AdminShell } from "@/components/admin-shell";
import { useI18n } from "@/lib/i18n";

type NetworkSample = AdminOpsMonitorOverview["server"]["network"]["samples"][number];
type CfPoint = AdminOpsMonitorOverview["cloudflare"]["r2"]["series"][number];

function formatBytes(value: number | null | undefined) {
  const n = Number(value || 0);
  if (n >= 1024 ** 4) return `${(n / 1024 ** 4).toFixed(2)} TB`;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${Math.round(n)} B`;
}

function formatRate(bytesPerSecond: number) {
  if (bytesPerSecond >= 1024 ** 2) return `${(bytesPerSecond / 1024 ** 2).toFixed(2)} MB/s`;
  if (bytesPerSecond >= 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return `${Math.round(bytesPerSecond)} B/s`;
}

function formatNum(value: number) {
  return new Intl.NumberFormat().format(Math.round(value));
}

function MetricBar({
  icon: Icon,
  label,
  value,
  detail,
  percent,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
  detail: string;
  percent: number;
}) {
  const color =
    percent >= 90 ? "bg-danger" : percent >= 75 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 text-caption text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </span>
        <span>{percent.toFixed(1)}%</span>
      </div>
      <div className="mt-1 text-lg font-semibold text-ink">{value}</div>
      <div className="mt-0.5 truncate text-caption text-ink-subtle">{detail}</div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/80">
        <div
          className={cn("h-full rounded-full", color)}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    </div>
  );
}

function NetworkChart({ samples }: { samples: NetworkSample[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const width = 640;
  const height = 180;
  const padding = { top: 14, right: 12, bottom: 28, left: 54 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const visible = samples.slice(-60);
  const max = Math.max(1, ...visible.flatMap((s) => [s.upload_bps, s.download_bps]));
  const points = (key: "upload_bps" | "download_bps") =>
    visible
      .map((sample, index) => {
        const x =
          padding.left +
          (visible.length <= 1 ? 0 : (index / (visible.length - 1)) * chartWidth);
        const y = padding.top + chartHeight - (sample[key] / max) * chartHeight;
        return `${x},${y}`;
      })
      .join(" ");
  const upload = points("upload_bps");
  const download = points("download_bps");
  const baseline = padding.top + chartHeight;
  const hovered = hoveredIndex == null ? null : visible[hoveredIndex];
  const hoveredX =
    hoveredIndex == null
      ? 0
      : padding.left + (hoveredIndex / Math.max(1, visible.length - 1)) * chartWidth;

  const onMove = (event: MouseEvent<SVGSVGElement>) => {
    const svg = event.currentTarget;
    const rect = svg.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const idx = Math.round(ratio * (visible.length - 1));
    setHoveredIndex(Math.min(visible.length - 1, Math.max(0, idx)));
  };

  if (visible.length < 2) {
    return (
      <div className="flex h-44 items-center justify-center rounded-xl border border-dashed border-line text-caption text-ink-muted">
        …
      </div>
    );
  }

  return (
    <div className="h-44 overflow-hidden rounded-xl border border-line bg-white">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full cursor-crosshair"
        onMouseMove={onMove}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <defs>
          <linearGradient id="ops-up" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="ops-down" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = padding.top + chartHeight - ratio * chartHeight;
          return (
            <g key={ratio}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="#e2e8f0"
                strokeDasharray="4 4"
              />
              <text x={padding.left - 7} y={y + 3} textAnchor="end" className="fill-ink-subtle text-[9px]">
                {formatRate(max * ratio)}
              </text>
            </g>
          );
        })}
        <polygon
          points={`${padding.left},${baseline} ${download} ${width - padding.right},${baseline}`}
          fill="url(#ops-down)"
        />
        <polygon
          points={`${padding.left},${baseline} ${upload} ${width - padding.right},${baseline}`}
          fill="url(#ops-up)"
        />
        <polyline points={upload} fill="none" stroke="#10b981" strokeWidth="2.5" />
        <polyline points={download} fill="none" stroke="#f59e0b" strokeWidth="2" />
        {hovered ? (
          <g>
            <line
              x1={hoveredX}
              y1={padding.top}
              x2={hoveredX}
              y2={baseline}
              stroke="#94a3b8"
              strokeDasharray="4 4"
            />
            <circle
              cx={hoveredX}
              cy={padding.top + chartHeight - (hovered.upload_bps / max) * chartHeight}
              r="3.5"
              fill="#10b981"
              stroke="white"
            />
            <circle
              cx={hoveredX}
              cy={padding.top + chartHeight - (hovered.download_bps / max) * chartHeight}
              r="3.5"
              fill="#f59e0b"
              stroke="white"
            />
          </g>
        ) : null}
      </svg>
      {hovered ? (
        <div className="border-t border-line px-3 py-1.5 text-caption text-ink-muted">
          {new Date(hovered.timestamp).toLocaleTimeString()} · ↑ {formatRate(hovered.upload_bps)} · ↓{" "}
          {formatRate(hovered.download_bps)}
        </div>
      ) : null}
    </div>
  );
}

function TrafficChart({
  series,
  mode,
}: {
  series: CfPoint[];
  mode: "requests" | "bytes";
}) {
  const width = 640;
  const height = 160;
  const padding = { top: 12, right: 10, bottom: 24, left: 48 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const values = series.map((p) => (mode === "requests" ? p.requests : p.bytes));
  const max = Math.max(1, ...values);
  const poly = series
    .map((point, index) => {
      const x =
        padding.left +
        (series.length <= 1 ? 0 : (index / (series.length - 1)) * chartWidth);
      const y =
        padding.top +
        chartHeight -
        ((mode === "requests" ? point.requests : point.bytes) / max) * chartHeight;
      return `${x},${y}`;
    })
    .join(" ");

  if (series.length < 2) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-line text-caption text-ink-muted">
        —
      </div>
    );
  }

  return (
    <div className="h-40 overflow-hidden rounded-xl border border-line bg-white">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full">
        <polyline points={poly} fill="none" stroke="#0ea5e9" strokeWidth="2.2" />
      </svg>
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
      <div className="text-caption text-ink-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold text-ink">{value}</div>
      {hint ? <div className="mt-0.5 text-caption text-ink-subtle">{hint}</div> : null}
    </div>
  );
}

export default function OpsMonitorPage() {
  const { t } = useI18n();
  const [hours, setHours] = useState(24);

  const q = useQuery({
    queryKey: ["admin", "ops-monitor", hours],
    queryFn: () => adminOpsMonitorOverview(hours),
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  const data = q.data;
  const server = data?.server;
  const cf = data?.cloudflare;
  const storage = data?.storage;
  const queue = data?.queue;
  const transcode = data?.transcode;

  const loadText = useMemo(() => {
    if (!server?.cpu?.load_avg?.length) return "—";
    return server.cpu.load_avg.map((n) => n.toFixed(2)).join(" / ");
  }, [server?.cpu?.load_avg]);

  return (
    <AdminShell title={t("opsMonitor")}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-body-sm text-ink-muted">{t("opsMonitorHint")}</p>
          {data?.fetchedAt ? (
            <p className="mt-1 text-caption text-ink-subtle">
              {new Date(data.fetchedAt).toLocaleString()}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[
            { h: 24, label: t("opsRange24h") },
            { h: 72, label: t("opsRange72h") },
            { h: 168, label: t("opsRange7d") },
          ].map((item) => (
            <Button
              key={item.h}
              size="sm"
              variant={hours === item.h ? "primary" : "secondary"}
              onClick={() => setHours(item.h)}
            >
              {item.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant="secondary"
            disabled={q.isFetching}
            onClick={() => void q.refetch()}
          >
            <RefreshCw className={cn("h-4 w-4", q.isFetching && "animate-spin")} />
            {t("opsRefresh")}
          </Button>
        </div>
      </div>

      {q.error ? (
        <p className="mb-3 text-body-sm text-danger">{(q.error as Error).message}</p>
      ) : null}

      {/* Server metrics — zai parity */}
      <section className="upload-panel mb-4 space-y-4">
        <div className="upload-panel__head">
          <div className="flex items-start gap-2">
            <Server className="mt-0.5 h-4 w-4 text-ink-muted" />
            <div>
              <h2>{t("opsServerTitle")}</h2>
              <p>{t("opsServerHint")}</p>
            </div>
          </div>
          {server?.host ? (
            <div className="text-right text-caption text-ink-muted">
              <div className="font-medium text-ink">{server.host.hostname}</div>
              <div>
                {server.host.platform} {server.host.platform_release} · {server.host.architecture}
              </div>
              <div>{server.host.uptime_human}</div>
            </div>
          ) : null}
        </div>

        {!server?.available ? (
          <p className="text-body-sm text-ink-muted">
            {server?.message || t("opsUnavailable")}
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricBar
                icon={Cpu}
                label={t("opsCpu")}
                value={`${server.cpu.percent.toFixed(1)}%`}
                detail={`Load ${loadText} · ${server.cpu.cores_logical} cores`}
                percent={server.cpu.percent}
              />
              <MetricBar
                icon={MemoryStick}
                label={t("opsMemory")}
                value={`${server.memory.used_gb} / ${server.memory.total_gb} GB`}
                detail={`${server.memory.available_gb} GB free`}
                percent={server.memory.percent}
              />
              <MetricBar
                icon={HardDrive}
                label={t("opsDisk")}
                value={
                  server.root_disk
                    ? `${server.root_disk.used_gb} / ${server.root_disk.total_gb} GB`
                    : "—"
                }
                detail={server.root_disk?.mount || "—"}
                percent={server.root_disk?.percent || 0}
              />
              <div className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
                <div className="text-caption text-ink-muted">{t("opsNetwork")}</div>
                <div className="mt-1 text-body-sm font-semibold text-ink">
                  ↑ {formatRate(server.network.upload_bps)} · ↓{" "}
                  {formatRate(server.network.download_bps)}
                </div>
                <div className="mt-0.5 text-caption text-ink-subtle">
                  Σ ↑ {server.network.sent_gb} GB · ↓ {server.network.recv_gb} GB
                </div>
              </div>
            </div>
            <NetworkChart samples={server.network.samples || []} />
            {server.processes?.length ? (
              <div>
                <h3 className="mb-2 text-body-sm font-medium">{t("opsPm2")}</h3>
                <div className="overflow-x-auto rounded-xl border border-line">
                  <table className="min-w-full text-left text-caption">
                    <thead className="bg-surface-2 text-ink-muted">
                      <tr>
                        <th className="px-3 py-2">Name</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">CPU</th>
                        <th className="px-3 py-2">Mem</th>
                        <th className="px-3 py-2">Restarts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {server.processes.map((p) => (
                        <tr key={p.name} className="border-t border-line">
                          <td className="px-3 py-2 font-medium">{p.name}</td>
                          <td className="px-3 py-2">{p.status}</td>
                          <td className="px-3 py-2">
                            {p.cpu == null ? "—" : `${p.cpu}%`}
                          </td>
                          <td className="px-3 py-2">
                            {p.memory == null ? "—" : formatBytes(p.memory)}
                          </td>
                          <td className="px-3 py-2">{p.restarts ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>

      {/* Cloudflare */}
      <section className="upload-panel mb-4 space-y-4">
        <div className="upload-panel__head">
          <div className="flex items-start gap-2">
            <Cloud className="mt-0.5 h-4 w-4 text-ink-muted" />
            <div>
              <h2>{t("opsCfTitle")}</h2>
              <p>{t("opsCfHint")}</p>
            </div>
          </div>
        </div>

        {!cf?.configured ? (
          <p className="text-body-sm text-ink-muted">{t("opsCfNotConfigured")}</p>
        ) : (
          <>
            {cf.error ? (
              <p className="text-body-sm text-danger">{cf.error}</p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile label={t("opsR2Ops")} value={formatNum(cf.r2.objectOps)} />
              <StatTile label={t("opsR2BytesOut")} value={formatBytes(cf.r2.bytesOut)} />
              <StatTile label={t("opsR2BytesIn")} value={formatBytes(cf.r2.bytesIn)} />
              <StatTile
                label={t("opsR2Storage")}
                value={cf.r2.storageBytes == null ? "—" : formatBytes(cf.r2.storageBytes)}
                hint={`${cf.mediaBucket} + ${cf.uploadBucket}`}
              />
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-caption text-ink-muted">R2 ops / hour</p>
                <TrafficChart series={cf.r2.series} mode="requests" />
              </div>
              <div>
                <p className="mb-2 text-caption text-ink-muted">R2 bytes / hour</p>
                <TrafficChart series={cf.r2.series} mode="bytes" />
              </div>
            </div>
            {cf.cdn.available ? (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <StatTile label={t("opsCdnRequests")} value={formatNum(cf.cdn.requests)} />
                  <StatTile label={t("opsCdnBytes")} value={formatBytes(cf.cdn.bytes)} />
                  <StatTile
                    label={t("opsCacheHit")}
                    value={
                      cf.cdn.cacheHitRatio == null ? "—" : `${cf.cdn.cacheHitRatio}%`
                    }
                  />
                </div>
                <TrafficChart series={cf.cdn.series} mode="bytes" />
              </>
            ) : (
              <p className="text-caption text-ink-subtle">{t("opsCfZoneHint")}</p>
            )}
          </>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="upload-panel space-y-3">
          <div className="upload-panel__head">
            <div className="flex items-start gap-2">
              <HardDrive className="mt-0.5 h-4 w-4 text-ink-muted" />
              <div>
                <h2>{t("opsStorageTitle")}</h2>
              </div>
            </div>
          </div>
          {storage ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <StatTile label="Backend" value={storage.storageBackend} />
              <StatTile
                label="CDN"
                value={storage.cdnBase || "—"}
                hint={storage.probe?.ok ? t("opsProbeOk") : t("opsProbeFail")}
              />
              <StatTile
                label={t("opsFfmpeg")}
                value={storage.ffmpegReady ? "ready" : "missing"}
              />
              <StatTile
                label={t("opsRedis")}
                value={storage.redisConfigured ? "configured" : "off"}
                hint={storage.transcodeQueue}
              />
              <StatTile
                label="Probe latency"
                value={
                  storage.probe?.latencyMs != null
                    ? `${storage.probe.latencyMs} ms`
                    : "—"
                }
              />
              <StatTile
                label="Probe size"
                value={
                  storage.probe?.storageBytes != null
                    ? formatBytes(storage.probe.storageBytes)
                    : "—"
                }
                hint={storage.probe?.storageSource || undefined}
              />
            </div>
          ) : (
            <p className="text-body-sm text-ink-muted">{t("loading")}</p>
          )}
        </section>

        <section className="upload-panel space-y-3">
          <div className="upload-panel__head">
            <div className="flex items-start gap-2">
              <Activity className="mt-0.5 h-4 w-4 text-ink-muted" />
              <div>
                <h2>{t("opsTranscodeTitle")}</h2>
              </div>
            </div>
          </div>
          {queue && transcode ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <StatTile
                  label={t("opsQueueWaiting")}
                  value={String(queue.waiting)}
                  hint={queue.mode}
                />
                <StatTile
                  label={t("opsQueueActive")}
                  value={String(queue.active)}
                  hint={queue.workerRunning ? "worker on" : "worker off"}
                />
                <StatTile
                  label={t("opsQueueFailed")}
                  value={String(queue.failed + (transcode.jobCounts.FAILED || 0))}
                />
              </div>
              <div>
                <h3 className="mb-2 text-body-sm font-medium">{t("opsRecentFailed")}</h3>
                {!transcode.recentFailed.length ? (
                  <p className="text-caption text-ink-muted">{t("opsNoFailed")}</p>
                ) : (
                  <div className="space-y-2">
                    {transcode.recentFailed.map((job) => (
                      <div
                        key={job.id}
                        className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-caption"
                      >
                        <div className="font-medium text-ink">
                          {job.id.slice(0, 8)}…
                          {job.episodeId ? ` · ep ${job.episodeId}` : ""}
                        </div>
                        <div className="mt-0.5 text-ink-muted line-clamp-2">
                          {job.error || "failed"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-body-sm text-ink-muted">{t("loading")}</p>
          )}
        </section>
      </div>
    </AdminShell>
  );
}
