import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

type NetworkSample = {
  timestamp: string;
  upload_bps: number;
  download_bps: number;
};

type DiskMetric = {
  mount: string;
  fstype: string;
  total_bytes: number;
  used_bytes: number;
  free_bytes: number;
  total_gb: number;
  used_gb: number;
  free_gb: number;
  percent: number;
};

export type ServerMetricsSnapshot = {
  available: boolean;
  collected_at: string;
  sampling_mode: 'background' | 'sync';
  poll_interval_sec: number;
  message?: string;
  host: {
    hostname: string;
    platform: string;
    platform_release: string;
    architecture: string;
    uptime_seconds: number;
    uptime_human: string;
  };
  cpu: {
    percent: number;
    cores_logical: number;
    cores_physical: number;
    load_avg: number[];
  };
  memory: {
    total_bytes: number;
    used_bytes: number;
    available_bytes: number;
    total_gb: number;
    used_gb: number;
    available_gb: number;
    percent: number;
  };
  root_disk: DiskMetric | null;
  disks: DiskMetric[];
  network: {
    bytes_sent: number;
    bytes_recv: number;
    sent_gb: number;
    recv_gb: number;
    upload_bps: number;
    download_bps: number;
    samples: NetworkSample[];
  };
  processes?: Array<{
    name: string;
    status: string;
    cpu: number | null;
    memory: number | null;
    restarts: number | null;
    uptime_ms: number | null;
  }>;
};

function bytesToGb(value: number) {
  return Math.round((value / 1024 ** 3) * 100) / 100;
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || !parts.length) parts.push(`${minutes}m`);
  return parts.join(' ');
}

function isoNow() {
  return new Date().toISOString();
}

/**
 * Host metrics sampler (zai HealthPage parity): CPU / memory / disk / network
 * with a short rolling network history for sparklines.
 */
@Injectable()
export class ServerMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ServerMetricsService.name);
  private readonly pollSec = Math.max(
    2,
    Number(process.env.SERVER_METRICS_POLL_SEC || 3) || 3,
  );
  private readonly historySize = Math.max(
    20,
    Number(process.env.SERVER_METRICS_NETWORK_HISTORY || 100) || 100,
  );
  private timer: NodeJS.Timeout | null = null;
  private cached: ServerMetricsSnapshot | null = null;
  private prevCpu: { idle: number; total: number } | null = null;
  private prevNet: { at: number; sent: number; recv: number } | null = null;
  private samples: NetworkSample[] = [];

  onModuleInit() {
    void this.refresh(true).catch((e) =>
      this.logger.warn(`server metrics warm-up failed: ${e?.message || e}`),
    );
    this.timer = setInterval(() => {
      void this.refresh(false).catch(() => undefined);
    }, this.pollSec * 1000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async getSnapshot(opts?: { includeProcesses?: boolean }) {
    if (!this.cached) await this.refresh(true);
    const base = this.cached
      ? { ...this.cached, network: { ...this.cached.network, samples: [...this.samples] } }
      : this.emptyUnavailable('metrics not ready');
    if (opts?.includeProcesses) {
      base.processes = await this.readPm2Processes();
    }
    return base;
  }

  private emptyUnavailable(message: string): ServerMetricsSnapshot {
    return {
      available: false,
      collected_at: isoNow(),
      sampling_mode: 'sync',
      poll_interval_sec: this.pollSec,
      message,
      host: {
        hostname: os.hostname(),
        platform: os.platform(),
        platform_release: os.release(),
        architecture: os.arch(),
        uptime_seconds: Math.floor(os.uptime()),
        uptime_human: formatUptime(Math.floor(os.uptime())),
      },
      cpu: {
        percent: 0,
        cores_logical: os.cpus().length,
        cores_physical: Math.max(1, Math.floor(os.cpus().length / 2)),
        load_avg: [],
      },
      memory: {
        total_bytes: os.totalmem(),
        used_bytes: 0,
        available_bytes: os.freemem(),
        total_gb: bytesToGb(os.totalmem()),
        used_gb: 0,
        available_gb: bytesToGb(os.freemem()),
        percent: 0,
      },
      root_disk: null,
      disks: [],
      network: {
        bytes_sent: 0,
        bytes_recv: 0,
        sent_gb: 0,
        recv_gb: 0,
        upload_bps: 0,
        download_bps: 0,
        samples: [],
      },
    };
  }

  private async refresh(force: boolean) {
    const collected_at = isoNow();
    const cpuPercent = this.sampleCpuPercent();
    const total = os.totalmem();
    const free = os.freemem();
    const used = Math.max(0, total - free);
    const disks = await this.readDisks();
    const root =
      disks.find((d) => d.mount === '/' || d.mount === 'C:\\' || d.mount === 'C:') ||
      disks[0] ||
      null;
    const network = this.sampleNetwork(collected_at);
    let loadAvg: number[] = [];
    try {
      loadAvg = os.loadavg().map((n) => Math.round(n * 100) / 100);
    } catch {
      loadAvg = [];
    }

    this.cached = {
      available: true,
      collected_at,
      sampling_mode: force ? 'sync' : 'background',
      poll_interval_sec: this.pollSec,
      host: {
        hostname: os.hostname(),
        platform: os.platform(),
        platform_release: os.release(),
        architecture: os.arch(),
        uptime_seconds: Math.floor(os.uptime()),
        uptime_human: formatUptime(Math.floor(os.uptime())),
      },
      cpu: {
        percent: cpuPercent,
        cores_logical: os.cpus().length,
        cores_physical: Math.max(1, Math.floor(os.cpus().length / 2)),
        load_avg: loadAvg,
      },
      memory: {
        total_bytes: total,
        used_bytes: used,
        available_bytes: free,
        total_gb: bytesToGb(total),
        used_gb: bytesToGb(used),
        available_gb: bytesToGb(free),
        percent: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
      },
      root_disk: root,
      disks,
      network: {
        ...network,
        samples: [...this.samples],
      },
    };
  }

  private sampleCpuPercent() {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
      idle += cpu.times.idle;
      total +=
        cpu.times.user +
        cpu.times.nice +
        cpu.times.sys +
        cpu.times.idle +
        cpu.times.irq;
    }
    if (!this.prevCpu || total <= this.prevCpu.total) {
      this.prevCpu = { idle, total };
      return 0;
    }
    const idleDiff = idle - this.prevCpu.idle;
    const totalDiff = total - this.prevCpu.total;
    this.prevCpu = { idle, total };
    if (totalDiff <= 0) return 0;
    const pct = (1 - idleDiff / totalDiff) * 100;
    return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
  }

  private sampleNetwork(timestamp: string) {
    const counters = this.readNetCounters();
    const now = Date.now();
    let upload_bps = 0;
    let download_bps = 0;
    if (this.prevNet && now > this.prevNet.at) {
      const elapsed = (now - this.prevNet.at) / 1000;
      upload_bps = Math.max(0, (counters.sent - this.prevNet.sent) / elapsed);
      download_bps = Math.max(0, (counters.recv - this.prevNet.recv) / elapsed);
    }
    this.prevNet = { at: now, sent: counters.sent, recv: counters.recv };
    const sample = {
      timestamp,
      upload_bps: Math.round(upload_bps * 100) / 100,
      download_bps: Math.round(download_bps * 100) / 100,
    };
    this.samples.push(sample);
    if (this.samples.length > this.historySize) {
      this.samples = this.samples.slice(-this.historySize);
    }
    return {
      bytes_sent: counters.sent,
      bytes_recv: counters.recv,
      sent_gb: bytesToGb(counters.sent),
      recv_gb: bytesToGb(counters.recv),
      upload_bps: sample.upload_bps,
      download_bps: sample.download_bps,
    };
  }

  private readNetCounters() {
    if (process.platform === 'linux') {
      try {
        const raw = fs.readFileSync('/proc/net/dev', 'utf8');
        let sent = 0;
        let recv = 0;
        for (const line of raw.split('\n').slice(2)) {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 10) continue;
          const iface = parts[0].replace(':', '');
          if (iface === 'lo') continue;
          recv += Number(parts[1]) || 0;
          sent += Number(parts[9]) || 0;
        }
        return { sent, recv };
      } catch {
        /* fall through */
      }
    }
    return { sent: 0, recv: 0 };
  }

  private async readDisks(): Promise<DiskMetric[]> {
    if (typeof (fs as any).statfs === 'function') {
      const mounts =
        process.platform === 'win32'
          ? ['C:\\']
          : ['/', '/www', '/data'].filter((m) => {
              try {
                fs.accessSync(m);
                return true;
              } catch {
                return false;
              }
            });
      const unique = [...new Set(mounts)];
      const out: DiskMetric[] = [];
      for (const mount of unique) {
        try {
          const st = await (fs.promises as any).statfs(mount);
          const bsize = Number(st.bsize || st.frsize || 0);
          const blocks = Number(st.blocks || 0);
          const bavail = Number(st.bavail || st.bfree || 0);
          const total = bsize * blocks;
          const free = bsize * bavail;
          const used = Math.max(0, total - free);
          if (!total) continue;
          out.push({
            mount,
            fstype: String(st.type || ''),
            total_bytes: total,
            used_bytes: used,
            free_bytes: free,
            total_gb: bytesToGb(total),
            used_gb: bytesToGb(used),
            free_gb: bytesToGb(free),
            percent: Math.round((used / total) * 1000) / 10,
          });
        } catch {
          /* skip */
        }
      }
      if (out.length) return out;
    }
    return this.readDisksViaDf();
  }

  private async readDisksViaDf(): Promise<DiskMetric[]> {
    if (process.platform === 'win32') return [];
    try {
      const { stdout } = await execFileAsync('df', ['-kP'], { timeout: 4000 });
      const lines = stdout.trim().split('\n').slice(1);
      const out: DiskMetric[] = [];
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 6) continue;
        const mount = parts[5];
        if (
          mount.startsWith('/snap') ||
          mount.startsWith('/run') ||
          mount.startsWith('/dev') ||
          mount.startsWith('/sys') ||
          mount.startsWith('/proc')
        ) {
          continue;
        }
        const totalKb = Number(parts[1]) || 0;
        const usedKb = Number(parts[2]) || 0;
        const freeKb = Number(parts[3]) || 0;
        const total = totalKb * 1024;
        const used = usedKb * 1024;
        const free = freeKb * 1024;
        if (!total) continue;
        out.push({
          mount,
          fstype: '',
          total_bytes: total,
          used_bytes: used,
          free_bytes: free,
          total_gb: bytesToGb(total),
          used_gb: bytesToGb(used),
          free_gb: bytesToGb(free),
          percent: Math.round((used / total) * 1000) / 10,
        });
      }
      out.sort((a, b) => (a.mount === '/' ? -1 : b.mount === '/' ? 1 : a.mount.localeCompare(b.mount)));
      return out;
    } catch {
      return [];
    }
  }

  private async readPm2Processes() {
    try {
      const { stdout } = await execFileAsync('pm2', ['jlist'], {
        timeout: 5000,
        env: process.env,
        cwd: path.resolve(process.cwd()),
      });
      const list = JSON.parse(stdout || '[]') as any[];
      if (!Array.isArray(list)) return [];
      return list
        .filter((p) => String(p?.name || '').includes('velvet'))
        .map((p) => {
          const env = p?.pm2_env || {};
          const monit = p?.monit || {};
          return {
            name: String(p.name || ''),
            status: String(env.status || 'unknown'),
            cpu: monit.cpu == null ? null : Number(monit.cpu),
            memory: monit.memory == null ? null : Number(monit.memory),
            restarts: env.restart_time == null ? null : Number(env.restart_time),
            uptime_ms: env.pm_uptime == null ? null : Date.now() - Number(env.pm_uptime),
          };
        });
    } catch {
      return [];
    }
  }
}
