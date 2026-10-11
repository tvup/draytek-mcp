#!/usr/bin/env node

process.stderr.write("[draytek-mcp] Module loading...\n");

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DraytekClient, type DraytekConfig } from "./draytek-client.js";

function log(msg: string) {
  const line = `[${new Date().toISOString()}] [draytek-mcp] ${msg}\n`;
  process.stderr.write(line);
}

process.on("uncaughtException", (err) => {
  log(`UNCAUGHT: ${err.stack ?? err}`);
});
process.on("unhandledRejection", (err) => {
  log(`UNHANDLED REJECTION: ${err}`);
});

function getConfig(): DraytekConfig {
  const host = process.env.DRAYTEK_HOST;
  if (!host) {
    log("ERROR: DRAYTEK_HOST environment variable is required");
    throw new Error("DRAYTEK_HOST environment variable is required");
  }
  log("Config loaded");
  return {
    host,
    port: process.env.DRAYTEK_PORT ? parseInt(process.env.DRAYTEK_PORT) : 22,
    username: process.env.DRAYTEK_USERNAME ?? "admin",
    password: process.env.DRAYTEK_PASSWORD ?? "",
  };
}

const server = new McpServer({
  name: "draytek-vigor2927",
  version: "1.0.0",
});

let client: DraytekClient | null = null;

function getClient(): DraytekClient {
  if (!client) {
    client = new DraytekClient(getConfig());
  }
  return client;
}

async function run(toolName: string, fn: () => Promise<string | object>) {
  log(`CALL ${toolName}`);
  try {
    const data = await fn();
    const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    log(`${toolName} OK (${text.length} chars)`);
    return { content: [{ type: "text" as const, text }] };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`${toolName} ERROR: ${msg}`);
    return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true as const };
  }
}

const ipv4 = z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/).describe("IPv4 address");
const wanIdx = z.number().int().min(1).max(4).describe("WAN interface number (1-4)");
const singleToken = z.string().regex(/^[^-\s]\S*$/).describe("Single token (no whitespace, no leading dash)");
const safePassword = z.string().regex(/^\S+$/).describe("Password (no whitespace)");
const macAddr = z.string().regex(/^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$/).describe("MAC address (colon-separated, e.g. 00:11:22:33:44:55)");

let toolCount = 0;
function t(name: string, desc: string, args: Record<string, z.ZodTypeAny>, handler: (a: any) => ReturnType<typeof run>) {
  toolCount++;
  server.tool(name, desc, args, handler);
}
function t0(name: string, desc: string, handler: () => ReturnType<typeof run>) {
  toolCount++;
  server.tool(name, desc, {}, handler);
}

// ============================================================
// DISCOVERY
// ============================================================

t0("draytek_list_commands",
  "List all available CLI commands on the router.",
  () => run("list_commands", async () => {
    const commands = await getClient().listCommands();
    return JSON.stringify({ commands });
  })
);

t("draytek_help",
  "Show available subcommands and syntax for a router CLI command. You MUST provide the 'command' argument. To find out what 'partner' can do: command='partner'. To explore system commands: command='sys'. To see DHCP options: command='srv dhcp'. To see license options: command='sys license'.",
  { command: z.string().regex(/^[a-zA-Z0-9_ ]+$/).optional().describe("The command to look up, e.g. 'sys', 'wan', 'vpn', 'partner', 'cert', 'srv dhcp', 'sys license'") },
  ({ command }) => {
    if (!command) {
      return run("help", async () => {
        const commands = await getClient().listCommands();
        return `You called draytek_help without a command. Please call again with command='<name>' where <name> is one of:\n${commands.join(", ")}\n\nExample: draytek_help({command: "partner"}) or draytek_help({command: "sys license"})`;
      });
    }
    return run("help", () => getClient().execute(`${command} ?`));
  }
);

// ============================================================
// SYSTEM
// ============================================================

t0("draytek_sys_version",
  "Get system version (model, firmware, build date, serial).",
  () => run("sys_version", () => getClient().execute("sys version"))
);

t0("draytek_sys_info",
  "Get system information and status.",
  () => run("sys_info", () => getClient().execute("sys info"))
);

t0("draytek_sys_iface",
  "Show network interface status with IP, MAC, and netmask.",
  () => run("sys_iface", () => getClient().execute("sys iface"))
);

t0("draytek_sys_commit",
  "Save running config (SRAM) to flash memory. Required after configuration changes to persist them across reboots.",
  () => run("sys_commit", () => getClient().execute("sys commit"))
);

t("draytek_sys_reboot",
  "Reboot the router. Causes a brief network outage.",
  { confirm: z.literal("yes").describe("Must be 'yes' to confirm reboot") },
  ({ confirm }) => {
    if (confirm !== "yes") return Promise.resolve({ content: [{ type: "text" as const, text: "Reboot not confirmed" }], isError: true as const });
    return run("sys_reboot", () => getClient().execute("sys reboot"));
  }
);

t("draytek_sys_name",
  "Set the router's syslog identity name for a WAN interface.",
  {
    wan: z.enum(["wan1", "wan2"]).describe("WAN interface"),
    name: z.string().max(20).regex(/^\S+$/).describe("Router name (max 20 chars, no spaces)"),
  },
  ({ wan, name }) => run("sys_name", () => getClient().execute(`sys name ${wan} ${name}`))
);

t("draytek_sys_domainname",
  "Set WAN domain-name suffix.",
  {
    wan: z.enum(["wan1", "wan2"]).describe("WAN interface"),
    domain: z.string().max(39).regex(/^\S+$/).describe("Domain suffix (max 39 chars, no spaces)"),
  },
  ({ wan, domain }) => run("sys_domainname", () => getClient().execute(`sys domainname ${wan} ${domain}`))
);

t("draytek_sys_autoreboot",
  "Configure scheduled automatic reboot.",
  {
    mode: z.enum(["on", "off"]).describe("Enable or disable auto-reboot"),
    hours: z.number().int().min(1).max(168).optional().describe("Interval in hours (1-168), required when mode=on"),
  },
  ({ mode, hours }) => {
    if (mode === "on" && hours) return run("sys_autoreboot", () => getClient().execute(`sys autoreboot ${hours}`));
    return run("sys_autoreboot", () => getClient().execute(`sys autoreboot ${mode}`));
  }
);

t("draytek_sys_passwd",
  "Change the admin password.",
  {
    old_password: safePassword.max(83).describe("Current password"),
    new_password: safePassword.max(83).describe("New password"),
  },
  ({ old_password, new_password }) =>
    run("sys_passwd", () => getClient().execute(`sys passwd ${old_password} ${new_password}`))
);

t("draytek_sys_alg",
  "Enable or disable Application Layer Gateway (ALG).",
  { enabled: z.boolean().describe("true to enable, false to disable") },
  ({ enabled }) => run("sys_alg", () => getClient().execute(`sys alg -e ${enabled ? 1 : 0}`))
);

t0("draytek_sys_time",
  "Show system time.",
  () => run("sys_time", () => getClient().execute("sys time"))
);

// ============================================================
// SHOW (read-only views)
// ============================================================

t0("draytek_show_status", "Show system status overview (uptime, WAN links, LAN, DNS).",
  () => run("show_status", () => getClient().execute("show status")));

t0("draytek_show_lan", "Show LAN/VLAN interface configuration (IP, mask, DHCP pool).",
  () => run("show_lan", () => getClient().execute("show lan")));

t0("draytek_show_dns", "Show DNS server settings.",
  () => run("show_dns", () => getClient().execute("show dns")));

t0("draytek_show_nat", "Show NAT port redirection running table.",
  () => run("show_nat", () => getClient().execute("show nat")));

t0("draytek_show_portmap", "Show port mapping table.",
  () => run("show_portmap", () => getClient().execute("show portmap")));

t0("draytek_show_dmz", "Show DMZ host configuration.",
  () => run("show_dmz", () => getClient().execute("show dmz")));

t0("draytek_show_openport", "Show opened ports (NAT).",
  () => run("show_openport", () => getClient().execute("show openport")));

t0("draytek_show_session", "Show session usage statistics.",
  () => run("show_session", () => getClient().execute("show session")));

t0("draytek_show_traffic", "Show traffic statistics.",
  () => run("show_traffic", () => getClient().execute("show traffic")));

t0("draytek_show_cpu", "Show CPU usage.",
  () => run("show_cpu", () => getClient().execute("show cpu")));

t0("draytek_show_memory", "Show memory usage.",
  () => run("show_memory", () => getClient().execute("show memory")));

t0("draytek_show_statistic", "Show interface statistics.",
  () => run("show_statistic", () => getClient().execute("show statistic")));

// ============================================================
// WAN
// ============================================================

t0("draytek_wan_status",
  "Get WAN connection status for all WAN interfaces.",
  () => run("wan_status", () => getClient().execute("wan status"))
);

t("draytek_wan_enable", "Enable a WAN interface.",
  { wan_index: wanIdx },
  ({ wan_index }) => run("wan_enable", () => getClient().execute(`wan enable WAN${wan_index}`))
);

t("draytek_wan_disable", "Disable a WAN interface.",
  { wan_index: wanIdx },
  ({ wan_index }) => run("wan_disable", () => getClient().execute(`wan disable WAN${wan_index}`))
);

t("draytek_wan_dns",
  "Set a DNS server for a WAN interface (one at a time).",
  {
    wan_index: wanIdx,
    position: z.enum(["pri", "sec"]).describe("Primary or secondary DNS"),
    ip: ipv4,
  },
  ({ wan_index, position, ip }) =>
    run("wan_dns", () => getClient().execute(`wan dns ${wan_index} ${position} ${ip}`))
);

t("draytek_wan_mtu",
  "Set global WAN MTU.",
  {
    target: z.enum(["mtu", "mtu2"]).describe("Primary or secondary MTU"),
    value: z.number().int().min(1000).max(1500).describe("MTU value (1000-1500)"),
  },
  ({ target, value }) => run("wan_mtu", () => getClient().execute(`wan ${target} ${value}`))
);

t("draytek_wan_forward",
  "Enable or disable inter-WAN IP forwarding.",
  { enabled: z.boolean().describe("true to enable, false to disable") },
  ({ enabled }) => run("wan_forward", () => getClient().execute(`wan forward ${enabled ? "on" : "off"}`))
);

t("draytek_wan_lb",
  "Enable or disable a WAN interface in the load-balance pool.",
  {
    wan: z.string().regex(/^wan[1-4]$/).describe("WAN interface (wan1-wan4)"),
    enabled: z.boolean().describe("true to include in load-balance, false to exclude"),
  },
  ({ wan, enabled }) => run("wan_lb", () => getClient().execute(`wan lb ${wan} ${enabled ? "on" : "off"}`))
);

t("draytek_wan_failover",
  "Configure WAN failover. Use action 'show' to view, 'off' to disable, 'on' to configure.",
  {
    action: z.enum(["off", "show", "on"]).describe("Failover action"),
    index: z.number().int().min(1).max(4).optional().describe("WAN index (required for show/off)"),
    failover_wan: z.number().int().min(1).max(4).optional().describe("Failover WAN (required for on)"),
    main_wan: z.number().int().min(1).max(4).optional().describe("Main WAN (required for on)"),
    download_threshold_kbps: z.number().int().min(0).optional().describe("Download threshold in kbps"),
    upload_threshold_kbps: z.number().int().min(0).optional().describe("Upload threshold in kbps"),
  },
  ({ action, index, failover_wan, main_wan, download_threshold_kbps, upload_threshold_kbps }) =>
    run("wan_failover", () => {
      if (action === "show" || action === "off") {
        return getClient().execute(`wan failover ${action}${index !== undefined ? ` ${index}` : ""}`);
      }
      let cmd = `wan failover on`;
      if (failover_wan !== undefined) cmd += ` ${failover_wan}`;
      if (main_wan !== undefined) cmd += ` ${main_wan}`;
      if (download_threshold_kbps !== undefined) cmd += ` ${download_threshold_kbps}`;
      if (upload_threshold_kbps !== undefined) cmd += ` ${upload_threshold_kbps}`;
      return getClient().execute(cmd);
    })
);

t("draytek_wan_budget",
  "Configure WAN data budget/cap.",
  {
    wan_index: wanIdx,
    action: z.enum(["state", "thresholdMb", "thresholdGb"]).describe("Budget action"),
    value: singleToken.describe("'enable'/'disable' for state, or numeric limit for threshold"),
  },
  ({ wan_index, action, value }) =>
    run("wan_budget", () => getClient().execute(`wan budget ${wan_index} ${action} ${value}`))
);

t("draytek_wan_vlan_tag",
  "Set VLAN tagging on a WAN interface.",
  {
    wan_index: wanIdx,
    action: z.enum(["tag", "state", "priority"]).describe("VLAN action"),
    value: singleToken.describe("Tag value (-1 to 4095), state (on/off), or priority (0-7)"),
  },
  ({ wan_index, action, value }) =>
    run("wan_vlan_tag", () => getClient().execute(`wan vlan ${wan_index} ${action} ${value}`))
);

// ============================================================
// INTERNET
// ============================================================

t0("draytek_internet_view",
  "View internet/WAN connection settings.",
  () => run("internet_view", () => getClient().execute("internet -V"))
);

t("draytek_internet_set",
  "Configure internet/WAN connection. Mode: 0=Static, 1=DHCP, 2=PPPoE, 3=PPTP, 4=L2TP.",
  {
    wan_interface: wanIdx.optional(),
    mode: z.number().int().min(0).max(7).describe("Connection mode"),
    username: singleToken.max(49).optional().describe("PPPoE/PPTP username"),
    password: safePassword.max(49).optional().describe("PPPoE/PPTP password"),
    wan_ip: ipv4.optional().describe("Static WAN IP"),
    netmask: ipv4.optional().describe("WAN netmask"),
    gateway: ipv4.optional().describe("Gateway IP"),
    isp_name: singleToken.max(23).optional().describe("ISP display name"),
    idle_timeout: z.number().int().min(-1).max(999).optional().describe("Idle timeout in minutes (-1=always on)"),
  },
  ({ wan_interface, mode, username, password, wan_ip, netmask, gateway, isp_name, idle_timeout }) =>
    run("internet_set", () => {
      let cmd = `internet -M ${mode}`;
      if (wan_interface !== undefined) cmd += ` -W ${wan_interface}`;
      if (username) cmd += ` -u ${username}`;
      if (password) cmd += ` -p ${password}`;
      if (wan_ip) cmd += ` -w ${wan_ip}`;
      if (netmask) cmd += ` -n ${netmask}`;
      if (gateway) cmd += ` -g ${gateway}`;
      if (isp_name) cmd += ` -S ${isp_name}`;
      if (idle_timeout !== undefined) cmd += ` -t ${idle_timeout}`;
      return getClient().execute(cmd);
    })
);

// ============================================================
// IP / LAN
// ============================================================

t0("draytek_ip_route", "Show the IP routing table.",
  () => run("ip_route", () => getClient().execute("ip route status")));

t0("draytek_ip_arp", "Show the ARP table.",
  () => run("ip_arp", () => getClient().execute("ip arp status")));

t0("draytek_ip_session", "Show IP session table.",
  () => run("ip_session", () => getClient().execute("ip session")));

t("draytek_ip_ping", "Ping a host from the router.",
  {
    host: singleToken.describe("IP address or hostname to ping"),
    wan: z.string().regex(/^wan[1-4]$/).optional().describe("WAN interface to use (e.g. 'wan1')"),
  },
  ({ host, wan }) =>
    run("ip_ping", () => getClient().execute(`ip ping ${host}${wan ? ` ${wan}` : ""}`, 30_000))
);

t("draytek_ip_tracert", "Traceroute to a host from the router.",
  { host: singleToken.describe("IP address or hostname to trace") },
  ({ host }) => run("ip_tracert", () => getClient().execute(`ip tracert ${host}`, 60_000))
);

t("draytek_ip_dhcpc", "DHCP client operations for WAN interfaces.",
  { action: z.enum(["status", "renew", "release"]).describe("DHCP client action") },
  ({ action }) => run("ip_dhcpc", () => getClient().execute(`ip dhcpc ${action}`))
);

t("draytek_ip_addr", "Set LAN IP address.",
  { ip: ipv4.describe("New LAN IP address") },
  ({ ip }) => run("ip_addr", () => getClient().execute(`ip addr ${ip}`))
);

t("draytek_ip_nmask", "Set LAN subnet mask.",
  { mask: ipv4.describe("New subnet mask (e.g. 255.255.255.0)") },
  ({ mask }) => run("ip_nmask", () => getClient().execute(`ip nmask ${mask}`))
);

t("draytek_ip_bindmac",
  "Bind an IP address to a MAC address (ARP binding).",
  {
    ip: ipv4.describe("IP address to bind"),
    mac: macAddr,
    comment: z.string().max(20).regex(/^\S+$/).optional().describe("Comment/description (no spaces)"),
  },
  ({ ip, mac, comment }) =>
    run("ip_bindmac", () => getClient().execute(`ip bindmac add ${ip} ${mac}${comment ? ` ${comment}` : ""}`))
);

// ============================================================
// DHCP SERVER (srv dhcp)
// ============================================================

t0("draytek_dhcp_status", "Show DHCP server status and lease table.",
  () => run("dhcp_status", () => getClient().execute("srv dhcp status")));

t0("draytek_dhcp_on", "Enable the DHCP server (may require reboot to apply).",
  () => run("dhcp_on", () => getClient().execute("srv dhcp on")));

t0("draytek_dhcp_off", "Disable the DHCP server (may require reboot to apply).",
  () => run("dhcp_off", () => getClient().execute("srv dhcp off")));

t("draytek_dhcp_startip", "Set DHCP pool start IP address.",
  { ip: ipv4.describe("Start IP for DHCP pool") },
  ({ ip }) => run("dhcp_startip", () => getClient().execute(`srv dhcp startip ${ip}`))
);

t("draytek_dhcp_gateway", "Set DHCP pool gateway.",
  { ip: ipv4.describe("Gateway IP for DHCP clients") },
  ({ ip }) => run("dhcp_gateway", () => getClient().execute(`srv dhcp gateway ${ip}`))
);

t("draytek_dhcp_dns",
  "Set DNS server for a LAN's DHCP pool.",
  {
    position: z.enum(["dns1", "dns2"]).describe("Primary or secondary DNS"),
    lan: z.number().int().min(1).max(8).describe("LAN number (1-8)"),
    ip: ipv4.describe("DNS server IP"),
  },
  ({ position, lan, ip }) =>
    run("dhcp_dns", () => getClient().execute(`srv dhcp ${position} lan${lan} ${ip}`))
);

t("draytek_dhcp_leasetime",
  "Set DHCP lease time.",
  { seconds: z.number().int().min(120).max(604800).describe("Lease time in seconds (120-604800)") },
  ({ seconds }) => run("dhcp_leasetime", () => getClient().execute(`srv dhcp leasetime ${seconds}`))
);

t("draytek_dhcp_relay",
  "Set DHCP relay server IP.",
  { ip: ipv4.describe("DHCP relay server IP") },
  ({ ip }) => run("dhcp_relay", () => getClient().execute(`srv dhcp relay servip ${ip}`))
);

t("draytek_dhcp_ipcnt",
  "Set DHCP IP pool count.",
  { count: z.number().int().min(0).max(256).describe("Number of IPs in pool (0-256)") },
  ({ count }) => run("dhcp_ipcnt", () => getClient().execute(`srv dhcp ipcnt ${count}`))
);

// ============================================================
// NAT / PORT FORWARDING (srv nat)
// ============================================================

t0("draytek_nat_view", "View NAT configuration overview.",
  () => run("nat_view", () => getClient().execute("srv nat view")));

t0("draytek_nat_portmap_table", "Show port mapping table.",
  () => run("nat_portmap_table", () => getClient().execute("srv nat portmap table")));

t("draytek_nat_dmz",
  "Configure DMZ mapping for a WAN interface.",
  {
    wan: z.enum(["1", "2"]).describe("WAN interface (1 or 2)"),
    index: z.number().int().min(1).max(300).describe("DMZ rule index"),
    action: z.enum(["view", "enable", "disable", "set_ip", "reset"]).describe("DMZ action"),
    ip: ipv4.optional().describe("DMZ host IP (required for set_ip)"),
  },
  ({ wan, index, action, ip }) =>
    run("nat_dmz", () => {
      let flags = "";
      if (action === "view") flags = "-v";
      else if (action === "enable") flags = "-e 1";
      else if (action === "disable") flags = "-e 0";
      else if (action === "set_ip" && ip) flags = `-i ${ip}`;
      else if (action === "reset") flags = "-r";
      return getClient().execute(`srv nat dmz ${wan} ${index} ${flags}`);
    })
);

t("draytek_nat_portmap_add",
  "Add a NAT port mapping (port forwarding) rule. This forwards traffic arriving on a WAN public port to an internal LAN IP. Use this ONLY for WAN-to-LAN port forwarding (e.g. exposing a LAN server to the internet). For cross-VLAN/inter-LAN access control, use draytek_ipf_rule_set instead.",
  {
    index: z.number().int().min(1).max(260).describe("Rule index (1-260)"),
    service_name: z.string().max(15).regex(/^\S+$/).describe("Service name, e.g. 'HTTP', 'SSH', 'Custom3080'"),
    protocol: z.enum(["tcp", "udp"]).describe("Protocol: tcp or udp"),
    public_port: z.number().int().min(0).max(65535).describe("Public/external WAN port number"),
    private_ip: ipv4.describe("Internal/private LAN IP address to forward to"),
    private_port: z.number().int().min(1).max(65535).describe("Internal/private port on the LAN host"),
    wan: z.string().regex(/^(wan[1-4]|all)$/).optional().describe("WAN interface (wan1-wan4 or 'all', default: all)"),
  },
  ({ index, service_name, protocol, public_port, private_ip, private_port, wan }) =>
    run("nat_portmap_add", () =>
      getClient().execute(`srv nat portmap add ${index} ${service_name} ${protocol} ${public_port} 0 0 ${private_ip} ${private_port} ${wan ?? "all"} 0`)
    )
);

t("draytek_nat_portmap_del",
  "Delete a port mapping rule.",
  { index: z.number().int().min(1).max(260).describe("Rule index to delete") },
  ({ index }) => run("nat_portmap_del", () => getClient().execute(`srv nat portmap del ${index}`))
);

t("draytek_nat_portmap_enable",
  "Enable a port mapping rule.",
  {
    index: z.number().int().min(1).max(260).describe("Rule index"),
    protocol: z.enum(["tcp", "udp"]).describe("Protocol"),
  },
  ({ index, protocol }) =>
    run("nat_portmap_enable", () => getClient().execute(`srv nat portmap enable ${index} ${protocol}`))
);

t("draytek_nat_portmap_disable",
  "Disable a port mapping rule.",
  { index: z.number().int().min(1).max(260).describe("Rule index") },
  ({ index }) => run("nat_portmap_disable", () => getClient().execute(`srv nat portmap disable ${index}`))
);

t("draytek_nat_portmap_view",
  "View a specific port mapping rule.",
  { index: z.number().int().min(1).max(260).describe("Rule index") },
  ({ index }) => run("nat_portmap_view", () => getClient().execute(`srv nat portmap view ${index}`))
);

t("draytek_nat_ipsecpass",
  "Enable or disable IPSec passthrough.",
  { action: z.enum(["on", "off", "status"]).describe("Action") },
  ({ action }) => run("nat_ipsecpass", () => getClient().execute(`srv nat ipsecpass ${action}`))
);

// ============================================================
// FIREWALL (ipf)
// Use firewall rules for: cross-VLAN access, inter-LAN traffic control,
// blocking/allowing specific IPs or ports between network segments.
// Do NOT use NAT port mapping for inter-VLAN — that is WAN-to-LAN only.
// ============================================================

t0("draytek_ipf_view", "View all IP filter (firewall) rule sets. Shows which data/call filter sets are active. Use this first to find available filter sets before creating rules with draytek_ipf_rule_set.",
  () => run("ipf_view", () => getClient().execute("ipf view")));

t("draytek_ipf_view_detail",
  "View IP filter rules with specific detail flags. Use '-d' to see data filter sets, '-c' for call filter sets, '-V' for verbose.",
  { flags: z.string().describe("View flags: -V (verbose), -c (call filter), -d (data filter), -r (raw), -t (table)") },
  ({ flags }) => run("ipf_view_detail", () => getClient().execute(`ipf view ${flags}`))
);

t("draytek_ipf_set_default_action",
  "Set the default firewall action for packets not matching any rule.",
  {
    pass: z.boolean().describe("true=pass (allow unmatched packets), false=block (deny unmatched packets)"),
    log_to_syslog: z.boolean().describe("true to log unmatched packets to syslog"),
  },
  ({ pass, log_to_syslog }) =>
    run("ipf_set_default_action", () => getClient().execute(`ipf set -p ${pass ? 0 : 1} ${log_to_syslog ? 1 : 0}`))
);

t("draytek_ipf_set_filter",
  "Activate a data or call filter set number as the router's current filter set. A filter set contains up to 7 rules. You must activate a set before its rules take effect. First create rules with draytek_ipf_rule_set, then activate the set here.",
  {
    type: z.enum(["call", "data"]).describe("Filter type: 'data' for LAN/WAN traffic filtering, 'call' for dial-up triggers"),
    set_no: z.number().int().min(0).max(12).describe("Filter set number to activate (1-12, or 0 to disable)"),
  },
  ({ type, set_no }) =>
    run("ipf_set_filter", () => getClient().execute(`ipf set -${type === "call" ? "c" : "d"} ${set_no}`))
);

t("draytek_ipf_rule_view",
  "View a specific firewall rule's full configuration (source/dest IP, protocol, ports, action, interfaces). Use this to inspect existing rules or find empty rule slots.",
  {
    set_no: z.number().int().min(1).max(50).describe("Filter set number (1-12 commonly used)"),
    rule_no: z.number().int().min(1).max(30).describe("Rule number within the set (1-7 commonly used)"),
  },
  ({ set_no, rule_no }) =>
    run("ipf_rule_view", () => getClient().execute(`ipf rule ${set_no} ${rule_no} -v`))
);

t("draytek_ipf_rule_set",
  "Configure a firewall rule to allow or block traffic between VLANs/LANs or LAN/WAN. Each setting is applied as a separate command for reliability. You MUST provide set_no and rule_no. Call draytek_ipf_view_detail(flags='-d') first to find available rule slots. Example — allow 192.168.40.12 on VLAN4 to reach 192.168.1.22:3080 on VLAN1: draytek_ipf_rule_set(set_no=2, rule_no=1, direction='lan_to_lan', source_ip='192.168.40.12', dest_ip='192.168.1.22', protocol='tcp', dest_port=3080, action='pass'). After creating the rule, run draytek_sys_commit to persist.",
  {
    set_no: z.number().int().min(1).max(12).optional().describe("Filter set number (1-12). First call draytek_ipf_view_detail(flags='-d') to find available sets."),
    rule_no: z.number().int().min(1).max(7).optional().describe("Rule number within the set (1-7). First call draytek_ipf_view_detail(flags='-d') to find available slots."),
    enabled: z.boolean().optional().describe("Enable (true) or disable (false) this rule. Default: true"),
    comment: z.string().max(40).optional().describe("Rule comment — use underscores instead of spaces, e.g. 'Allow_VLAN4_to_VLAN1'"),
    direction: z.enum(["lan_to_wan", "wan_to_lan", "lan_to_lan", "wan_to_localhost"]).optional().describe("Traffic direction: 'lan_to_lan' for cross-VLAN, 'lan_to_wan' for outbound, 'wan_to_lan' for inbound"),
    source_ip: ipv4.optional().describe("Source IPv4 address, e.g. '192.168.40.12'. Omit for any source."),
    source_mask_or_end: ipv4.optional().describe("Subnet mask or range end IP. Omit for single IP."),
    dest_ip: ipv4.optional().describe("Destination IPv4 address, e.g. '192.168.1.22'. Omit for any destination."),
    dest_mask_or_end: ipv4.optional().describe("Subnet mask or range end IP. Omit for single IP."),
    protocol: z.enum(["tcp", "udp", "tcp_udp", "icmp", "any"]).optional().describe("IP protocol. Use 'tcp' or 'udp' for port-based rules."),
    src_port: z.number().int().min(1).max(65535).optional().describe("Source port number. Omit for any source port."),
    dest_port: z.number().int().min(1).max(65535).optional().describe("Destination port number, e.g. 3080, 80, 443, 22."),
    action: z.enum(["pass", "block", "pass_if_no_match", "block_if_no_match"]).optional().describe("Firewall action: 'pass'=allow immediately, 'block'=deny immediately"),
    log: z.boolean().optional().describe("Log matching packets to syslog. Default: false"),
    incoming_interfaces: z.string().regex(/^[A-Za-z0-9]+(\s*,\s*[A-Za-z0-9]+)*$/).optional().describe("Incoming interface, e.g. 'LAN4'. LAN1=VLAN1, LAN2=VLAN2, LAN3=VLAN3, LAN4=VLAN4."),
    outgoing_interfaces: z.string().regex(/^[A-Za-z0-9]+(\s*,\s*[A-Za-z0-9]+)*$/).optional().describe("Outgoing interface, e.g. 'LAN1'. LAN1=VLAN1, LAN2=VLAN2, LAN3=VLAN3, LAN4=VLAN4."),
  },
  ({ set_no, rule_no, enabled, comment, direction, source_ip, source_mask_or_end, dest_ip, dest_mask_or_end, protocol, src_port, dest_port, action, log: logToSyslog, incoming_interfaces, outgoing_interfaces }) =>
    run("ipf_rule_set", async () => {
      if (!set_no || !rule_no) {
        return "Error: set_no and rule_no are required.\n\n" +
          "Step 1: Call draytek_ipf_view_detail(flags='-d') to see existing data filter rules and find an available set/rule slot.\n\n" +
          "Step 2: Call draytek_ipf_rule_set with set_no and rule_no. Example:\n" +
          "draytek_ipf_rule_set(set_no=2, rule_no=1, direction='lan_to_lan', source_ip='192.168.40.12', dest_ip='192.168.1.22', protocol='tcp', dest_port=3080, action='pass')";
      }

      const client = getClient();
      const base = `ipf rule ${set_no} ${rule_no}`;
      const results: string[] = [];

      const isError = (out: string) =>
        /Usage:|usage:|^%?\s*Error|^%?\s*error|invalid|denied|unknown/im.test(out);

      const tryFormats = async (desc: string, ...formats: string[]): Promise<boolean> => {
        for (const flag of formats) {
          const cmd = `${base} ${flag}`;
          log(`ipf_rule_set [${desc}]: ${cmd}`);
          const out = await client.execute(cmd);
          if (!isError(out)) {
            results.push(`OK [${desc}]`);
            return true;
          }
          log(`ipf_rule_set [${desc}] rejected`);
        }
        results.push(`FAILED [${desc}] — all format variants rejected by router`);
        return false;
      };

      if (direction) {
        const dirMap: Record<string, string> = { lan_to_wan: "0", wan_to_lan: "1", lan_to_lan: "2", wan_to_localhost: "3" };
        await tryFormats("direction", `-D ${dirMap[direction]}`);
      }

      if (comment) {
        const clean = comment.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 40);
        await tryFormats("comment", `-M ${clean}`);
      }

      if (source_ip) {
        const type = source_mask_or_end
          ? (source_mask_or_end.startsWith("255") ? "3" : "2")
          : "1";
        const addr = source_mask_or_end ? `${source_ip} ${source_mask_or_end}` : source_ip;
        await tryFormats("source_ip",
          `-s u ${type} ${addr}`,
          `-s "u ${type} ${addr}"`,
          `-s c ${type} ${addr}`,
          `-s 'u ${type} ${addr}'`,
        );
      }

      if (dest_ip) {
        const type = dest_mask_or_end
          ? (dest_mask_or_end.startsWith("255") ? "3" : "2")
          : "1";
        const addr = dest_mask_or_end ? `${dest_ip} ${dest_mask_or_end}` : dest_ip;
        await tryFormats("dest_ip",
          `-d u ${type} ${addr}`,
          `-d "u ${type} ${addr}"`,
          `-d c ${type} ${addr}`,
          `-d 'u ${type} ${addr}'`,
        );
      }

      if (protocol) {
        const protoMap: Record<string, string> = { tcp: "6", udp: "17", tcp_udp: "255", icmp: "1", any: "0" };
        const proto = protoMap[protocol] ?? "0";
        const sp = src_port ?? 0;
        const dp = dest_port ?? 0;
        await tryFormats("service",
          `-S u ${proto} 0 0 ${sp} ${dp} ${sp} ${dp}`,
          `-S "u ${proto} 0 0 ${sp} ${dp} ${sp} ${dp}"`,
          `-S c ${proto} 0 0 ${sp} ${dp} ${sp} ${dp}`,
        );
      }

      if (action) {
        const actionMap: Record<string, string> = { pass: "0", block: "1", pass_if_no_match: "2", block_if_no_match: "3" };
        const logVal = logToSyslog ? "1" : "0";
        await tryFormats("action",
          `-F ${actionMap[action]} ${logVal}`,
          `-F "${actionMap[action]} ${logVal}"`,
        );
      }

      if (incoming_interfaces) {
        const ifaces = incoming_interfaces.split(",").map((s: string) => s.trim());
        await tryFormats("incoming_iface",
          `-I e ${ifaces.join(" ")}`,
          `-I "e ${ifaces.join(" ")}"`,
          `-I e,${ifaces.join(",")}`,
        );
      }

      if (outgoing_interfaces) {
        const ifaces = outgoing_interfaces.split(",").map((s: string) => s.trim());
        await tryFormats("outgoing_iface",
          `-O e ${ifaces.join(" ")}`,
          `-O "e ${ifaces.join(" ")}"`,
          `-O e,${ifaces.join(",")}`,
        );
      }

      await tryFormats("enable", `-e ${enabled === false ? 0 : 1}`);

      const view = await client.execute(`${base} -v`);
      results.push(`\nRule ${set_no}/${rule_no} state after configuration:\n${view}`);

      const anyFailed = results.some(r => r.startsWith("FAILED"));
      if (anyFailed) {
        results.push("\nSome steps failed. Run draytek_ipf_rule_diagnose to determine the correct flag formats for this router, then use draytek_ipf_rule_raw with the working format.");
      }

      return results.join("\n");
    })
);

t0("draytek_ipf_rule_diagnose",
  "Test which ipf rule flag formats this router accepts. Run this if draytek_ipf_rule_set reports failures — it tests enable, direction, source/dest IP, service, and action flags in multiple format variants (unquoted, double-quoted, single-quoted, with u/c format specifiers) and reports which ones succeed. Uses set 12 / rule 7 (the last slot) to avoid overwriting production rules. Also captures the router's ipf rule help text.",
  () => run("ipf_rule_diagnose", async () => {
    const client = getClient();
    const SET = 12, RULE = 7;
    const base = `ipf rule ${SET} ${RULE}`;
    const results: string[] = ["=== ipf rule format diagnostic ===\n", `Using slot ${SET}/${RULE} for tests.\n`];

    const savedState = await client.execute(`${base} -v`);

    const test = async (desc: string, cmd: string): Promise<boolean> => {
      log(`diagnose [${desc}]: ${cmd}`);
      try {
        const out = await client.execute(cmd);
        const ok = !out.includes("Usage:") && !out.includes("usage:");
        results.push(`${ok ? "PASS" : "FAIL"} [${desc}]: ${cmd}`);
        return ok;
      } catch (err) {
        results.push(`ERROR [${desc}]: ${err instanceof Error ? err.message : err}`);
        return false;
      }
    };

    results.push("--- Basic commands ---");
    await test("view", `${base} -v`);
    await test("enable", `${base} -e 0`);
    await test("direction", `${base} -D 0`);

    results.push("\n--- Source IP formats ---");
    await test("src unquoted_u", `${base} -s u 1 192.168.1.1`);
    await test("src dquoted_u", `${base} -s "u 1 192.168.1.1"`);
    await test("src squoted_u", `${base} -s 'u 1 192.168.1.1'`);
    await test("src unquoted_c", `${base} -s c 1 192.168.1.1`);
    await test("src dquoted_c", `${base} -s "c 1 192.168.1.1"`);

    results.push("\n--- Dest IP formats ---");
    await test("dst unquoted_u", `${base} -d u 1 192.168.1.1`);
    await test("dst dquoted_u", `${base} -d "u 1 192.168.1.1"`);
    await test("dst unquoted_c", `${base} -d c 1 192.168.1.1`);

    results.push("\n--- Service/protocol formats ---");
    await test("svc unquoted_u", `${base} -S u 6 0 0 0 80 0 80`);
    await test("svc dquoted_u", `${base} -S "u 6 0 0 0 80 0 80"`);
    await test("svc unquoted_c", `${base} -S c 6 0 0 0 80 0 80`);

    results.push("\n--- Action (filter) formats ---");
    await test("action unquoted", `${base} -F 0 0`);
    await test("action dquoted", `${base} -F "0 0"`);

    results.push("\n--- Interface formats ---");
    await test("iface_in unquoted", `${base} -I e LAN1`);
    await test("iface_in dquoted", `${base} -I "e LAN1"`);
    await test("iface_in comma", `${base} -I e,LAN1`);

    results.push("\n--- Alternative ipf set syntax ---");
    await test("alt_view", `ipf set ${SET} rule ${RULE} -v`);
    await test("alt_enable", `ipf set ${SET} rule ${RULE} -e 0`);

    await client.execute(`${base} -e 0`);

    results.push("\n--- Router help text ---");
    try {
      const help = await client.execute("ipf rule ?");
      results.push(help);
    } catch {
      results.push("(could not retrieve help text)");
    }

    results.push(`\n--- Original state of slot ${SET}/${RULE} (before diagnostic) ---`);
    results.push(savedState);

    return results.join("\n");
  })
);

t("draytek_ipf_rule_raw",
  "Send raw flags to 'ipf rule' command. Use this as a fallback when draytek_ipf_rule_set doesn't work. IMPORTANT: do NOT use double quotes around flag values — the DrayTek CLI is not a bash shell. Send values as bare space-separated arguments. Example: flags='-e 1 -D 2 -s u 1 192.168.40.12 -F 0 0'. Run draytek_ipf_rule_diagnose first if unsure about syntax.",
  {
    set_no: z.number().int().min(1).max(50).describe("Filter set number"),
    rule_no: z.number().int().min(1).max(30).describe("Rule number"),
    flags: z.string().describe("Raw flags WITHOUT quotes, e.g. '-e 1 -D 2 -s u 1 192.168.1.10 -F 0 0'"),
  },
  ({ set_no, rule_no, flags }) =>
    run("ipf_rule_raw", () => getClient().execute(`ipf rule ${set_no} ${rule_no} ${flags}`))
);

t("draytek_ipf_rule_enable",
  "Enable or disable an existing firewall rule. Use draytek_ipf_rule_set for full rule configuration.",
  {
    set_no: z.number().int().min(1).max(50).describe("Filter set number"),
    rule_no: z.number().int().min(1).max(30).describe("Rule number"),
    enabled: z.boolean().describe("true to enable, false to disable"),
  },
  ({ set_no, rule_no, enabled }) =>
    run("ipf_rule_enable", () => getClient().execute(`ipf rule ${set_no} ${rule_no} -e ${enabled ? 1 : 0}`))
);

t("draytek_ipf_rule_direction",
  "Set a firewall rule's traffic direction. Use draytek_ipf_rule_set for full rule configuration.",
  {
    set_no: z.number().int().min(1).max(50).describe("Filter set number"),
    rule_no: z.number().int().min(1).max(30).describe("Rule number"),
    direction: z.enum(["0", "1", "2", "3"]).describe("0=LAN/RT/VPN->WAN, 1=WAN->LAN/RT/VPN, 2=LAN->LAN (cross-VLAN), 3=WAN->Localhost"),
  },
  ({ set_no, rule_no, direction }) =>
    run("ipf_rule_direction", () => getClient().execute(`ipf rule ${set_no} ${rule_no} -D ${direction}`))
);

t("draytek_ipf_strict_security",
  "Enable or disable strict security firewall mode. When enabled, all inter-VLAN traffic is blocked unless explicitly allowed by firewall rules.",
  { enabled: z.boolean().describe("true to enable (block all inter-VLAN unless rules allow), false to disable") },
  ({ enabled }) => run("ipf_strict_security", () => getClient().execute(`ipf set -L ${enabled ? 1 : 0}`))
);

t0("draytek_ipf_flowtrack",
  "View active firewall flow tracking sessions (current connections through the router).",
  () => run("ipf_flowtrack", () => getClient().execute("ipf flowtrack view -f"))
);

// ============================================================
// MANAGEMENT (mngt)
// ============================================================

t("draytek_mngt_set_port",
  "Set the port number for a management service.",
  {
    service: z.enum(["ssh", "telnet", "http", "https"]).describe("Management service"),
    port: z.number().int().min(1).max(65535).describe("Port number"),
  },
  ({ service, port }) =>
    run("mngt_set_port", () => getClient().execute(`mngt ${service}port ${port}`))
);

t("draytek_mngt_set_timeout",
  "Set session timeout for SSH or Telnet.",
  {
    service: z.enum(["ssh", "telnet"]).describe("Service"),
    seconds: z.number().int().min(60).max(300).describe("Timeout in seconds (60-300)"),
  },
  ({ service, seconds }) =>
    run("mngt_set_timeout", () => getClient().execute(`mngt ${service}timeout ${seconds}`))
);

t0("draytek_mngt_rmtcfg_status",
  "Show remote management configuration status.",
  () => run("mngt_rmtcfg_status", () => getClient().execute("mngt rmtcfg status"))
);

t("draytek_mngt_rmtcfg",
  "Enable or disable a specific remote management protocol.",
  {
    protocol: z.enum(["http", "https", "ftp", "telnet", "ssh", "tr069", "snmp", "enforce_https"]).describe("Protocol"),
    enabled: z.boolean().describe("true to enable, false to disable"),
  },
  ({ protocol, enabled }) =>
    run("mngt_rmtcfg", () => getClient().execute(`mngt rmtcfg ${protocol} ${enabled ? "on" : "off"}`))
);

t0("draytek_mngt_accesslist",
  "Show access control list.",
  () => run("mngt_accesslist", () => getClient().execute("mngt accesslist list"))
);

t0("draytek_mngt_lanaccess",
  "View LAN access control settings.",
  () => run("mngt_lanaccess", () => getClient().execute("mngt lanaccess -v"))
);

t("draytek_mngt_noping",
  "Control ping blocking (disable WAN ping response).",
  {
    action: z.enum(["on", "off", "viewlog", "clearlog"]).describe("on=block pings, off=allow pings"),
  },
  ({ action }) => run("mngt_noping", () => getClient().execute(`mngt noping ${action}`))
);

t("draytek_mngt_defenseworm",
  "Configure worm defense. Use add/del with a port number.",
  {
    action: z.enum(["on", "off", "viewlog", "clearlog", "add", "del"]).describe("Action"),
    port: z.number().int().min(1).max(65535).optional().describe("Port (required for add/del)"),
  },
  ({ action, port }) =>
    run("mngt_defenseworm", () => {
      let cmd = `mngt defenseworm ${action}`;
      if ((action === "add" || action === "del") && port) cmd += ` ${port}`;
      return getClient().execute(cmd);
    })
);

t("draytek_mngt_bfp",
  "Brute-force protection settings. Flags: -e (enable), -s (settings), -l (log), -p (params), -v (view).",
  { flags: z.string().describe("BFP flags, e.g. '-e 1' to enable or '-v' to view") },
  ({ flags }) => run("mngt_bfp", () => getClient().execute(`mngt bfp ${flags}`))
);

// ============================================================
// VPN
// ============================================================

t0("draytek_vpn_list", "List all VPN profiles.",
  () => run("vpn_list", () => getClient().execute("vpn list")));

t("draytek_vpn_list_detail",
  "View a specific VPN profile.",
  {
    index: z.number().int().min(1).max(128).describe("VPN profile index"),
    section: z.enum(["all", "com", "out", "in", "net"]).optional().describe("Section to view"),
  },
  ({ index, section }) =>
    run("vpn_list_detail", () => getClient().execute(`vpn list ${index} ${section ?? "all"}`))
);

t0("draytek_vpn_remote", "Show remote VPN users.",
  () => run("vpn_remote", () => getClient().execute("vpn remote")));

t("draytek_vpn_remote_toggle",
  "Enable or disable a remote VPN type.",
  {
    type: z.enum(["PPTP", "IPsec", "L2TP", "SSLVPN", "OpenVPN", "WireGuard"]).describe("VPN type"),
    wan: z.string().regex(/^wan[1-4]$/).optional().describe("WAN interface (e.g. 'wan1')"),
    enabled: z.boolean().describe("true to enable, false to disable"),
  },
  ({ type, wan, enabled }) =>
    run("vpn_remote_toggle", () => {
      let cmd = `vpn remote ${type}`;
      if (wan) cmd += ` ${wan}`;
      cmd += ` ${enabled ? "on" : "off"}`;
      return getClient().execute(cmd);
    })
);

t("draytek_vpn_setup",
  "Configure a VPN profile. Use vpn_list_detail to see current config first.",
  {
    index: z.number().int().min(1).max(128).describe("VPN profile index"),
    param: z.string().describe("Configuration parameters (trailing CLI syntax)"),
  },
  ({ index, param }) =>
    run("vpn_setup", () => getClient().execute(`vpn setup ${index} ${param}`))
);

t("draytek_vpn_ovpn",
  "Configure OpenVPN settings.",
  { param: z.string().describe("OpenVPN subcommand (e.g. 'show', 'mode', 'udp_port 1194')") },
  ({ param }) => run("vpn_ovpn", () => getClient().execute(`vpn ovpn ${param}`))
);

t("draytek_vpn_dinset",
  "Configure VPN dial-in (host-to-LAN) settings.",
  {
    index: z.number().int().min(1).max(128).describe("Dial-in profile index"),
    param: z.string().describe("Parameters (e.g. 'on', 'off', 'username X', 'password X')"),
  },
  ({ index, param }) =>
    run("vpn_dinset", () => getClient().execute(`vpn dinset ${index} ${param}`))
);

t("draytek_vpn_l2lset",
  "Configure VPN LAN-to-LAN settings.",
  {
    index: z.number().int().min(1).max(128).describe("L2L profile index"),
    param: z.string().describe("Parameters (e.g. 'peerid X', 'phase1 aes256', 'compress on')"),
  },
  ({ index, param }) =>
    run("vpn_l2lset", () => getClient().execute(`vpn l2lset ${index} ${param}`))
);

t("draytek_vpn_subnet",
  "Set VPN subnet for a profile.",
  {
    index: z.number().int().min(1).max(128).describe("VPN profile index"),
    lan: z.number().int().min(1).max(8).describe("LAN number"),
  },
  ({ index, lan }) => run("vpn_subnet", () => getClient().execute(`vpn subnet ${index} ${lan}`))
);

t("draytek_vpn_isolate",
  "Enable or disable VPN isolation (prevent VPN clients from seeing each other).",
  { enabled: z.boolean().describe("true to enable isolation, false to disable") },
  ({ enabled }) => run("vpn_isolate", () => getClient().execute(`vpn isolate ${enabled ? "on" : "off"}`))
);

// ============================================================
// VLAN
// ============================================================

t0("draytek_vlan_status", "Show VLAN status.",
  () => run("vlan_status", () => getClient().execute("vlan status")));

t0("draytek_vlan_on", "Enable VLAN.",
  () => run("vlan_on", () => getClient().execute("vlan on")));

t0("draytek_vlan_off", "Disable VLAN.",
  () => run("vlan_off", () => getClient().execute("vlan off")));

t("draytek_vlan_group",
  "Manage VLAN groups. Use 'show' to view, 'add'/'set' to assign ports.",
  {
    group_id: z.number().int().min(0).max(99).describe("VLAN group ID"),
    action: z.enum(["add", "set", "show"]).describe("Action"),
    ports: z.string().regex(/^p\d+( p\d+)*$/).optional().describe("Space-separated port numbers (e.g. 'p1 p2 p3'), required for add/set"),
  },
  ({ group_id, action, ports }) =>
    run("vlan_group", () => getClient().execute(`vlan group ${group_id} ${action}${ports ? ` ${ports}` : ""}`))
);

t("draytek_vlan_vid",
  "Set VLAN ID for a channel.",
  {
    channel: z.number().int().min(0).max(7).describe("VLAN channel (0-7)"),
    vid: z.number().int().min(0).max(4095).describe("VLAN ID (0-4095)"),
  },
  ({ channel, vid }) => run("vlan_vid", () => getClient().execute(`vlan vid ${channel} ${vid}`))
);

t("draytek_vlan_tagged",
  "Enable or disable VLAN tagging on a channel.",
  {
    channel: z.number().int().min(0).max(99).describe("VLAN channel"),
    enabled: z.boolean().describe("true to enable tagging, false to disable"),
  },
  ({ channel, enabled }) =>
    run("vlan_tagged", () => getClient().execute(`vlan tagged ${channel} ${enabled ? "on" : "off"}`))
);

t("draytek_vlan_subnet",
  "Set VLAN subnet to a LAN interface.",
  {
    group_id: z.number().int().min(0).max(99).describe("VLAN group ID"),
    lan: z.number().int().min(1).max(8).describe("LAN interface number"),
  },
  ({ group_id, lan }) => run("vlan_subnet", () => getClient().execute(`vlan subnet ${group_id} ${lan}`))
);

t0("draytek_vlan_map", "Show LAN-to-VLAN mapping table.",
  () => run("vlan_map", () => getClient().execute("vlan map")));

// ============================================================
// QoS
// ============================================================

t("draytek_qos_setup",
  "Configure QoS/bandwidth management. Use showAll to view current config.",
  { param: z.string().describe("QoS parameters (e.g. 'showAll', 'mode 1', 'inboundBandwidthKbps 50000')") },
  ({ param }) => run("qos_setup", () => getClient().execute(`qos setup ${param}`))
);

t("draytek_qos_voip",
  "Enable or disable VoIP QoS prioritization.",
  { enabled: z.boolean().describe("true to enable VoIP QoS, false to disable") },
  ({ enabled }) => run("qos_voip", () => getClient().execute(`qos voip ${enabled}`))
);

t("draytek_qos_class",
  "Manage QoS classification rules.",
  {
    class_index: z.number().int().min(1).max(3).describe("QoS class (1-3)"),
    action: z.enum(["add", "edit", "delete"]).describe("Action"),
    param: z.string().optional().describe("Parameters for add/edit (e.g. rule name, IP)"),
  },
  ({ class_index, action, param }) =>
    run("qos_class", () => getClient().execute(`qos class ${class_index} ${action}${param ? ` ${param}` : ""}`))
);

// ============================================================
// DDNS
// ============================================================

t0("draytek_ddns_show", "Show DDNS configuration for all accounts.",
  () => run("ddns_show", () => getClient().execute("ddns show")));

t("draytek_ddns_show_account",
  "Show DDNS configuration for a specific account.",
  { index: z.number().int().min(1).max(6).describe("DDNS account index (1-6)") },
  ({ index }) => run("ddns_show_account", () => getClient().execute(`ddns show -i ${index}`))
);

t0("draytek_ddns_log", "Show DDNS log.",
  () => run("ddns_log", () => getClient().execute("ddns log")));

t("draytek_ddns_enable",
  "Enable or disable DDNS globally.",
  { enabled: z.boolean().describe("true to enable, false to disable") },
  ({ enabled }) => run("ddns_enable", () => getClient().execute(`ddns enable ${enabled ? 1 : 0}`))
);

t0("draytek_ddns_forceupdate", "Force an immediate DDNS update.",
  () => run("ddns_forceupdate", () => getClient().execute("ddns forceupdate")));

t("draytek_ddns_set",
  "Configure a DDNS account.",
  {
    index: z.number().int().min(1).max(6).describe("Account index (1-6)"),
    provider: z.number().int().min(1).max(19).optional().describe("Service provider (1=User-Defined, 2=DynDNS, etc.)"),
    hostname: singleToken.max(64).optional().describe("Hostname/domain name"),
    login: singleToken.max(64).optional().describe("Login/username"),
    password: safePassword.max(24).optional().describe("Password"),
    enabled: z.boolean().optional().describe("Enable this account"),
    wan: z.number().int().min(1).max(4).optional().describe("WAN interface"),
  },
  ({ index, provider, hostname, login, password, enabled, wan }) =>
    run("ddns_set", () => {
      let cmd = `ddns set -i ${index}`;
      if (provider !== undefined) cmd += ` -S ${provider}`;
      if (hostname) cmd += ` -D ${hostname}`;
      if (login) cmd += ` -L ${login}`;
      if (password) cmd += ` -P ${password}`;
      if (enabled !== undefined) cmd += ` -E ${enabled ? 1 : 0}`;
      if (wan !== undefined) cmd += ` -W ${wan}`;
      return getClient().execute(cmd);
    })
);

t("draytek_ddns_time",
  "Set DDNS update interval.",
  { minutes: z.number().int().min(1).max(14400).describe("Update interval in minutes") },
  ({ minutes }) => run("ddns_time", () => getClient().execute(`ddns time ${minutes}`))
);

// ============================================================
// OBJECTS
// ============================================================

t("draytek_object_ip_view",
  "View an IP object definition.",
  { index: z.number().int().min(1).max(255).describe("IP object index") },
  ({ index }) => run("object_ip_view", () => getClient().execute(`object ip obj ${index} -v`))
);

t("draytek_object_ip_set",
  "Configure an IP object.",
  {
    index: z.number().int().min(1).max(255).describe("IP object index"),
    name: z.string().max(15).regex(/^\S+$/).optional().describe("Object name (no spaces)"),
    address_type: z.enum(["0", "1", "2", "3"]).optional().describe("0=any, 1=single IP, 2=range, 3=subnet"),
    start_ip: ipv4.optional().describe("Start IP (or single IP)"),
    end_ip: ipv4.optional().describe("End IP (for range) or subnet mask"),
  },
  ({ index, name, address_type, start_ip, end_ip }) =>
    run("object_ip_set", () => {
      const parts: string[] = [];
      if (name) parts.push(`-n ${name}`);
      if (address_type !== undefined) {
        let addr = `-a ${address_type}`;
        if (start_ip) addr += ` ${start_ip}`;
        if (end_ip) addr += ` ${end_ip}`;
        parts.push(addr);
      }
      return getClient().execute(`object ip obj ${index} ${parts.join(" ")}`);
    })
);

t("draytek_object_ip_grp",
  "Configure an IP group (set of IP objects).",
  {
    index: z.number().int().min(1).max(255).describe("IP group index"),
    action: z.enum(["view", "set_name", "set_members"]).describe("Action"),
    name: z.string().max(15).regex(/^\S+$/).optional().describe("Group name (for set_name, no spaces)"),
    members: z.string().regex(/^[\d ]+$/).optional().describe("Space-separated IP object indices (for set_members)"),
  },
  ({ index, action, name, members }) =>
    run("object_ip_grp", () => {
      if (action === "view") return getClient().execute(`object ip grp ${index} -v`);
      if (action === "set_name" && name) return getClient().execute(`object ip grp ${index} -n ${name}`);
      if (action === "set_members" && members) return getClient().execute(`object ip grp ${index} -a "${members}"`);
      return getClient().execute(`object ip grp ${index} -v`);
    })
);

t("draytek_object_service_view",
  "View a service object definition.",
  { index: z.number().int().min(1).max(255).describe("Service object index") },
  ({ index }) => run("object_service_view", () => getClient().execute(`object service obj ${index} -v`))
);

t("draytek_object_service_set",
  "Configure a service object.",
  {
    index: z.number().int().min(1).max(255).describe("Service object index"),
    name: z.string().max(15).regex(/^\S+$/).optional().describe("Service name (no spaces)"),
    protocol: z.number().int().min(0).max(255).optional().describe("Protocol number (6=TCP, 17=UDP)"),
    dst_start_port: z.number().int().min(0).max(65535).optional().describe("Destination start port"),
    dst_end_port: z.number().int().min(0).max(65535).optional().describe("Destination end port"),
  },
  ({ index, name, protocol, dst_start_port, dst_end_port }) =>
    run("object_service_set", () => {
      const parts: string[] = [];
      if (name) parts.push(`-n ${name}`);
      if (protocol !== undefined) parts.push(`-p ${protocol}`);
      if (dst_start_port !== undefined && dst_end_port !== undefined) {
        parts.push(`-d 1 ${dst_start_port} ${dst_end_port}`);
      }
      return getClient().execute(`object service obj ${index} ${parts.join(" ")}`);
    })
);

t("draytek_object_schedule",
  "Configure a schedule object.",
  {
    index: z.number().int().min(1).max(15).describe("Schedule index (1-15)"),
    enabled: z.boolean().optional().describe("Enable this schedule"),
    comment: z.string().max(32).regex(/^\S+$/).optional().describe("Comment (no spaces)"),
    action: z.enum(["0", "1", "2", "3"]).optional().describe("Action type (0-3)"),
  },
  ({ index, enabled, comment, action }) =>
    run("object_schedule", () => {
      const parts: string[] = [];
      if (enabled !== undefined) parts.push(`-e ${enabled ? 1 : 0}`);
      if (comment) parts.push(`-c ${comment}`);
      if (action !== undefined) parts.push(`-a ${action}`);
      return getClient().execute(`object schedule set ${index} ${parts.join(" ")}`);
    })
);

// ============================================================
// PORT
// ============================================================

t0("draytek_port_status", "Show physical Ethernet port status.",
  () => run("port_status", () => getClient().execute("port status")));

t("draytek_port_speed",
  "Set Ethernet port speed/duplex.",
  {
    port: z.string().regex(/^([1-5]|all)$/).describe("Port number (1-5) or 'all'"),
    speed: z.enum(["AN", "100F", "100H", "10F", "10H"]).describe("AN=Auto, 100F=100Mbps Full, 100H=100 Half, 10F=10 Full, 10H=10 Half"),
  },
  ({ port, speed }) => run("port_speed", () => getClient().execute(`port ${port} ${speed}`))
);

t0("draytek_port_sniff_status", "Show port sniffing (mirroring) status.",
  () => run("port_sniff_status", () => getClient().execute("port sniff status")));

// ============================================================
// HIGH AVAILABILITY (HA)
// ============================================================

t("draytek_ha_status",
  "Show HA status.",
  {
    scope: z.enum(["all", "local"]).describe("'all' for all routers, 'local' for this router"),
    detail: z.enum(["0", "1", "2"]).optional().describe("Detail level: 0=summary, 1=normal, 2=verbose"),
  },
  ({ scope, detail }) =>
    run("ha_status", () => getClient().execute(`ha status -${scope === "all" ? "a" : "m"} ${detail ?? "0"}`))
);

t0("draytek_ha_show_config", "Show HA configuration.",
  () => run("ha_show_config", () => getClient().execute("ha show -g")));

t("draytek_ha_set",
  "Configure High Availability settings. Pass raw flags.",
  { flags: z.string().describe("HA flags, e.g. '-e 1' (enable), '-v' (view), '-R 0' (role)") },
  ({ flags }) => run("ha_set", () => getClient().execute(`ha set ${flags}`))
);

// ============================================================
// WAKE ON LAN (WoL)
// ============================================================

t("draytek_wol_up",
  "Send Wake-on-LAN magic packet to wake a device.",
  { target: singleToken.describe("MAC address or IP address of the device to wake") },
  ({ target }) => run("wol_up", () => getClient().execute(`wol up ${target}`))
);

t("draytek_wol_fromwan",
  "Configure Wake-on-LAN from WAN.",
  { mode: z.enum(["on", "off", "any"]).describe("on=specific IPs only, off=disabled, any=all WAN IPs") },
  ({ mode }) => run("wol_fromwan", () => getClient().execute(`wol fromWan ${mode}`))
);

// ============================================================
// LOGGING
// ============================================================

t0("draytek_log_system", "View system log.",
  () => run("log_system", () => getClient().execute("log -t", 20_000)));

t0("draytek_log_wan", "View WAN log.",
  () => run("log_wan", () => getClient().execute("log -w", 20_000)));

// ============================================================
// UPnP
// ============================================================

t0("draytek_upnp_on", "Enable UPnP.",
  () => run("upnp_on", () => getClient().execute("upnp on")));

t0("draytek_upnp_off", "Disable UPnP.",
  () => run("upnp_off", () => getClient().execute("upnp off")));

// ============================================================
// CONTENT SECURITY (CSM)
// ============================================================

t("draytek_csm",
  "Content Security Management commands (app enforcement, URL filter, web filter, DNS filter).",
  { subcommand: z.string().describe("CSM subcommand (e.g. 'ucf', 'wcf', 'dnsf', 'appe')") },
  ({ subcommand }) => run("csm", () => getClient().execute(`csm ${subcommand}`))
);

// ============================================================
// DoS PROTECTION
// ============================================================

t("draytek_dos",
  "DoS protection commands.",
  { subcommand: z.string().describe("DoS subcommand and arguments") },
  ({ subcommand }) => run("dos", () => getClient().execute(`dos ${subcommand}`))
);

// ============================================================
// ADDITIONAL ROUTER COMMANDS
// ============================================================

t("draytek_ip6",
  "IPv6 configuration and status commands.",
  { subcommand: z.string().describe("IPv6 subcommand, e.g. 'status', 'addr', 'route'") },
  ({ subcommand }) => run("ip6", () => getClient().execute(`ip6 ${subcommand}`))
);

t("draytek_cert",
  "Certificate management (view, import, generate CSR).",
  { subcommand: z.string().describe("Certificate subcommand, e.g. 'status', 'mycert', 'trustedca'") },
  ({ subcommand }) => run("cert", () => getClient().execute(`cert ${subcommand}`))
);

t("draytek_ldap",
  "LDAP authentication configuration.",
  { subcommand: z.string().describe("LDAP subcommand and arguments") },
  ({ subcommand }) => run("ldap", () => getClient().execute(`ldap ${subcommand}`))
);

t("draytek_radius",
  "RADIUS authentication server configuration.",
  { subcommand: z.string().describe("RADIUS subcommand and arguments") },
  ({ subcommand }) => run("radius", () => getClient().execute(`radius ${subcommand}`))
);

t("draytek_tacacsplus",
  "TACACS+ authentication configuration.",
  { subcommand: z.string().describe("TACACS+ subcommand and arguments") },
  ({ subcommand }) => run("tacacsplus", () => getClient().execute(`tacacsplus ${subcommand}`))
);

t("draytek_local_8021x",
  "Local 802.1X authentication configuration.",
  { subcommand: z.string().describe("802.1X subcommand and arguments") },
  ({ subcommand }) => run("local_8021x", () => getClient().execute(`local_8021x ${subcommand}`))
);

t("draytek_user",
  "User account management (remote dial-in users, user profiles).",
  { subcommand: z.string().describe("User subcommand, e.g. 'list', 'add', 'del', 'show'") },
  ({ subcommand }) => run("user", () => getClient().execute(`user ${subcommand}`))
);

t("draytek_switch",
  "Managed switch configuration.",
  { subcommand: z.string().describe("Switch subcommand and arguments") },
  ({ subcommand }) => run("switch", () => getClient().execute(`switch ${subcommand}`))
);

t("draytek_switch_cli",
  "Direct switch CLI passthrough.",
  { subcommand: z.string().describe("Switch CLI command") },
  ({ subcommand }) => run("switch_cli", () => getClient().execute(`switch_cli ${subcommand}`))
);

t("draytek_swm",
  "Central switch management (VigorSwitch).",
  { subcommand: z.string().describe("Switch management subcommand") },
  ({ subcommand }) => run("swm", () => getClient().execute(`swm ${subcommand}`))
);

t("draytek_smb",
  "SMB/CIFS file sharing configuration.",
  { subcommand: z.string().describe("SMB subcommand and arguments") },
  ({ subcommand }) => run("smb", () => getClient().execute(`smb ${subcommand}`))
);

t("draytek_usb",
  "USB device and storage management.",
  { subcommand: z.string().describe("USB subcommand, e.g. 'status', 'storage', 'modem'") },
  ({ subcommand }) => run("usb", () => getClient().execute(`usb ${subcommand}`))
);

t("draytek_fs",
  "File system operations (USB storage, firmware files).",
  { subcommand: z.string().describe("File system subcommand, e.g. 'ls', 'cat', 'df'") },
  ({ subcommand }) => run("fs", () => getClient().execute(`fs ${subcommand}`))
);

t("draytek_msubnet",
  "Multi-subnet (LAN subnet) configuration.",
  { subcommand: z.string().describe("Multi-subnet subcommand and arguments") },
  ({ subcommand }) => run("msubnet", () => getClient().execute(`msubnet ${subcommand}`))
);

t("draytek_apm",
  "Access Point Management (manage VigorAP devices).",
  { subcommand: z.string().describe("APM subcommand, e.g. 'status', 'list', 'scan'") },
  ({ subcommand }) => run("apm", () => getClient().execute(`apm ${subcommand}`))
);

t("draytek_hsportal",
  "Hotspot Web Portal configuration.",
  { subcommand: z.string().describe("Hotspot portal subcommand and arguments") },
  ({ subcommand }) => run("hsportal", () => getClient().execute(`hsportal ${subcommand}`))
);

t("draytek_appqos",
  "Application-based QoS configuration.",
  { subcommand: z.string().describe("App QoS subcommand and arguments") },
  ({ subcommand }) => run("appqos", () => getClient().execute(`appqos ${subcommand}`))
);

t("draytek_hwqos",
  "Hardware QoS configuration.",
  { subcommand: z.string().describe("Hardware QoS subcommand and arguments") },
  ({ subcommand }) => run("hwqos", () => getClient().execute(`hwqos ${subcommand}`))
);

t("draytek_vrrp",
  "VRRP (Virtual Router Redundancy Protocol) configuration.",
  { subcommand: z.string().describe("VRRP subcommand and arguments") },
  ({ subcommand }) => run("vrrp", () => getClient().execute(`vrrp ${subcommand}`))
);

t("draytek_lldp",
  "LLDP (Link Layer Discovery Protocol) configuration and status.",
  { subcommand: z.string().describe("LLDP subcommand, e.g. 'status', 'enable', 'disable'") },
  ({ subcommand }) => run("lldp", () => getClient().execute(`lldp ${subcommand}`))
);

t("draytek_service",
  "Service management (service scheduling, enable/disable).",
  { subcommand: z.string().describe("Service subcommand and arguments") },
  ({ subcommand }) => run("service", () => getClient().execute(`service ${subcommand}`))
);

t("draytek_testmail",
  "Send a test email to verify mail alert configuration.",
  { subcommand: z.string().optional().describe("Optional test mail arguments") },
  ({ subcommand }) => run("testmail", () => getClient().execute(`testmail${subcommand ? ` ${subcommand}` : ""}`))
);

t("draytek_partner",
  "Partner/reseller configuration and settings.",
  { subcommand: z.string().describe("Partner subcommand and arguments") },
  ({ subcommand }) => run("partner", () => getClient().execute(`partner ${subcommand}`))
);

t("draytek_model",
  "Show router model information.",
  { subcommand: z.string().optional().describe("Optional model subcommand") },
  ({ subcommand }) => run("model", () => getClient().execute(`model${subcommand ? ` ${subcommand}` : ""}`))
);

t("draytek_prodline",
  "Product line information.",
  { subcommand: z.string().optional().describe("Optional prodline subcommand") },
  ({ subcommand }) => run("prodline", () => getClient().execute(`prodline${subcommand ? ` ${subcommand}` : ""}`))
);

t("draytek_provision",
  "Auto-provisioning / Zero Touch configuration.",
  { subcommand: z.string().describe("Provisioning subcommand and arguments") },
  ({ subcommand }) => run("provision", () => getClient().execute(`provision ${subcommand}`))
);

t("draytek_vigbrg",
  "Vigor bridge mode configuration.",
  { subcommand: z.string().describe("Bridge subcommand and arguments") },
  ({ subcommand }) => run("vigbrg", () => getClient().execute(`vigbrg ${subcommand}`))
);

t("draytek_fullbrg",
  "Full bridge mode configuration.",
  { subcommand: z.string().describe("Full bridge subcommand and arguments") },
  ({ subcommand }) => run("fullbrg", () => getClient().execute(`fullbrg ${subcommand}`))
);

t("draytek_sfp",
  "SFP module status and configuration.",
  { subcommand: z.string().describe("SFP subcommand, e.g. 'status', 'info'") },
  ({ subcommand }) => run("sfp", () => getClient().execute(`sfp ${subcommand}`))
);

t("draytek_ethoam",
  "Ethernet OAM (Operations, Administration and Maintenance).",
  { subcommand: z.string().describe("Ethernet OAM subcommand and arguments") },
  ({ subcommand }) => run("ethoam", () => getClient().execute(`ethoam ${subcommand}`))
);

t("draytek_dmn",
  "Domain management / DNS configuration.",
  { subcommand: z.string().describe("Domain management subcommand and arguments") },
  ({ subcommand }) => run("dmn", () => getClient().execute(`dmn ${subcommand}`))
);

t("draytek_portmaptime",
  "Port mapping time/schedule configuration.",
  { subcommand: z.string().describe("Port mapping time subcommand and arguments") },
  ({ subcommand }) => run("portmaptime", () => getClient().execute(`portmaptime ${subcommand}`))
);

t("draytek_ppa",
  "Protocol acceleration (hardware offloading).",
  { subcommand: z.string().describe("PPA subcommand, e.g. 'status', 'enable', 'disable'") },
  ({ subcommand }) => run("ppa", () => getClient().execute(`ppa ${subcommand}`))
);

t("draytek_hwaccswap",
  "Hardware acceleration swap configuration.",
  { subcommand: z.string().describe("Hardware acceleration swap subcommand") },
  ({ subcommand }) => run("hwaccswap", () => getClient().execute(`hwaccswap ${subcommand}`))
);

t("draytek_prn",
  "Printer sharing configuration.",
  { subcommand: z.string().describe("Printer sharing subcommand") },
  ({ subcommand }) => run("prn", () => getClient().execute(`prn ${subcommand}`))
);

t("draytek_nand",
  "NAND flash storage operations.",
  { subcommand: z.string().describe("NAND subcommand and arguments") },
  ({ subcommand }) => run("nand", () => getClient().execute(`nand ${subcommand}`))
);

t("draytek_sflash",
  "Serial flash operations.",
  { subcommand: z.string().describe("Serial flash subcommand and arguments") },
  ({ subcommand }) => run("sflash", () => getClient().execute(`sflash ${subcommand}`))
);

t("draytek_db",
  "Internal database operations.",
  { subcommand: z.string().describe("Database subcommand and arguments") },
  ({ subcommand }) => run("db", () => getClient().execute(`db ${subcommand}`))
);

t("draytek_fw_backupmode",
  "Firmware backup mode configuration.",
  { subcommand: z.string().describe("Firmware backup mode subcommand") },
  ({ subcommand }) => run("fw_backupmode", () => getClient().execute(`fw_backupmode ${subcommand}`))
);

t("draytek_gci",
  "GCI configuration interface.",
  { subcommand: z.string().describe("GCI subcommand and arguments") },
  ({ subcommand }) => run("gci", () => getClient().execute(`gci ${subcommand}`))
);

// ============================================================
// RAW COMMAND
// ============================================================

t("draytek_raw",
  "Execute any CLI command on the router. Use for commands not covered by other tools.",
  {
    command: z.string().describe("The full CLI command to execute"),
    timeout_ms: z.number().int().optional().describe("Timeout in ms (default 15000)"),
  },
  ({ command, timeout_ms }) =>
    run("raw", () => getClient().execute(command, timeout_ms ?? 15_000))
);

// ============================================================

log(`Registered ${toolCount} tools`);

async function main() {
  log(`Starting draytek-vigor2927 MCP server v1.0.0`);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("MCP server connected to transport");

  process.on("SIGINT", async () => {
    if (client) await client.disconnect();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    if (client) await client.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  log(`Fatal error: ${err.stack ?? err}`);
  process.exit(1);
});
