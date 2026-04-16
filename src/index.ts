import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import si from "systeminformation";

// ─── Constants ────────────────────────────────────────────────────────────────

const SERVER_NAME = "pc-stats-mcp-server";
const SERVER_VERSION = "1.0.0";

// ─── Helpers ──────────────────────────────────────────────────────────────────


const toGB = (bytes: number): string => (bytes / 1_073_741_824).toFixed(2) + " GB";

/**
 * Calculate usage percentage from raw bytes to avoid discrepancies
 * caused by systeminformation using reserved-sector-aware values.
 */
const usagePct = (used: number, total: number): string =>
  total > 0 ? ((used / total) * 100).toFixed(1) + "%" : "0%";

// ─── PC Stats Client ──────────────────────────────────────────────────────────

class PcStatsClient {

  // 🧠 CPU usage & speed right now
  async getCpu() {
    const [load, cpu, temp] = await Promise.all([
      si.currentLoad(),
      si.cpu(),
      si.cpuTemperature(),
    ]);
    return {
      model: `${cpu.manufacturer} ${cpu.brand}`,
      cores: cpu.cores,
      speed_ghz: cpu.speed,
      usage_percent: load.currentLoad.toFixed(1) + "%",
      per_core: load.cpus.map((c, i) => ({
        core: i + 1,
        usage: c.load.toFixed(1) + "%",
      })),
      temperature_c: temp.main ?? "N/A",
    };
  }

  // 💾 RAM usage
  async getRam() {
    const mem = await si.mem();
    return {
      total: toGB(mem.total),
      used: toGB(mem.active),          // ✅ active only, matches Task Manager
      free: toGB(mem.available),
      // Recalculate from raw bytes — matches Task Manager exactly
      usage_percent: usagePct(mem.used, mem.total),
      swap_total: toGB(mem.swaptotal),
      swap_used: toGB(mem.swapused),
      swap_usage_percent: usagePct(mem.swapused, mem.swaptotal),
    };
  }

  // 💿 Disk usage
  async getDisk() {
    const disks = await si.fsSize();
    return disks.map((d) => ({
      mount: d.mount,
      type: d.type,
      total: toGB(d.size),
      used: toGB(d.used),
      free: toGB(d.size - d.used),     // ✅ calculate from size-used, not d.available
      // Recalculate usage % from raw bytes instead of using d.use,
      // which can differ due to reserved OS blocks / unit mismatch
      usage_percent: usagePct(d.used, d.size),
    }));
  }

  // 🌐 Network speed (live bytes in/out)
  async getNetwork() {
    const nets = await si.networkStats();
    return nets.map((n) => ({
      interface: n.iface,
      rx_sec: (n.rx_sec / 1024).toFixed(2) + " KB/s",
      tx_sec: (n.tx_sec / 1024).toFixed(2) + " KB/s",
      rx_total: (n.rx_bytes / 1_000_000).toFixed(2) + " MB",
      tx_total: (n.tx_bytes / 1_000_000).toFixed(2) + " MB",
    }));
  }

  // ⚙️ Running processes (top 10 by CPU)
  async getTopProcesses() {
    const procs = await si.processes();
    return procs.list
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 10)
      .map((p) => ({
        name: p.name,
        pid: p.pid,
        cpu: p.cpu.toFixed(1) + "%",
        ram: toGB(p.memRss),
      }));
  }

  // 🖥️ Full system snapshot (everything at once)
  async getSnapshot() {
    const [cpu, ram, disk, network, processes] = await Promise.all([
      this.getCpu(),
      this.getRam(),
      this.getDisk(),
      this.getNetwork(),
      this.getTopProcesses(),
    ]);
    return { cpu, ram, disk, network, top_processes: processes };
  }
}

// ─── Server Setup ─────────────────────────────────────────────────────────────

const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
const pc = new PcStatsClient();

// ─── MCP Tools ────────────────────────────────────────────────────────────────

server.tool(
  "get_cpu_stats",
  "Get live CPU usage, speed, per-core load, and temperature of this machine",
  {},
  async () => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await pc.getCpu(), null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.tool(
  "get_ram_stats",
  "Get live RAM and swap memory usage of this machine (values match Windows Task Manager)",
  {},
  async () => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await pc.getRam(), null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.tool(
  "get_disk_stats",
  "Get disk usage for all mounted drives (values match Windows Explorer)",
  {},
  async () => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await pc.getDisk(), null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.tool(
  "get_network_stats",
  "Get live network upload/download speed on this machine",
  {},
  async () => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await pc.getNetwork(), null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.tool(
  "get_top_processes",
  "Get the top 10 processes consuming the most CPU on this machine right now",
  {},
  async () => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await pc.getTopProcesses(), null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.tool(
  "get_full_snapshot",
  "Get a full snapshot of CPU, RAM, disk, network, and top processes all at once",
  {},
  async () => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(await pc.getSnapshot(), null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);


// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});