# Draytek Vigor2927 MCP Server

MCP server for full configuration of Draytek Vigor2927 (DrayOS) routers via SSH CLI.

174 structured tools with Zod-validated parameters covering every router CLI command: system, WAN, LAN, DHCP, NAT, firewall, VPN, VLAN, QoS, DDNS, objects, ports, HA, WoL, logging, UPnP, CSM, DoS, IPv6, certificates, LDAP, RADIUS, TACACS+, 802.1X, user management, switch, SMB, USB, hotspot portal, LLDP, VRRP, AP management, and more.

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- SSH access to a Draytek Vigor2927 router (or compatible DrayOS device)
- An MCP-compatible client (e.g. [Claude Code](https://claude.com/product/claude-code), [LibreChat Code](https://github.com/tvup/lcc), or any MCP client)

## Installation

```bash
git clone https://github.com/tvup/draytek-mcp.git
cd draytek-mcp
npm install
npm run build
```

This produces `dist/index.js`, which is the MCP server entry point.

## Configuration

The server reads its connection settings from environment variables, which are set in your MCP client's configuration:

| Variable | Description | Default |
|---|---|---|
| `DRAYTEK_HOST` | Router hostname or IP address | (required) |
| `DRAYTEK_PORT` | SSH port | `22` |
| `DRAYTEK_USERNAME` | Login username | `admin` |
| `DRAYTEK_PASSWORD` | Login password | (empty) |

## MCP Client Configuration

Add to your MCP client's configuration file (e.g. `~/.config/lcc/mcp.json` or Claude Code's `mcp.json`).

Replace `/path/to/draytek-mcp` with the actual path where you cloned the repository:

```json
{
  "mcpServers": {
    "draytek": {
      "command": "node",
      "args": ["/path/to/draytek-mcp/dist/index.js"],
      "env": {
        "DRAYTEK_HOST": "192.168.1.1",
        "DRAYTEK_USERNAME": "admin",
        "DRAYTEK_PASSWORD": "your-password"
      }
    }
  }
}
```

## All Tools (174)

### Discovery (2)

| Tool | Description |
|---|---|
| `draytek_list_commands` | List all available CLI commands on the router |
| `draytek_help` | Show syntax/help for a specific command |

### System (11)

| Tool | Description |
|---|---|
| `draytek_sys_version` | Firmware, model, build date, serial number |
| `draytek_sys_info` | System status |
| `draytek_sys_iface` | Network interfaces (IP, MAC, netmask) |
| `draytek_sys_commit` | Save configuration from SRAM to FLASH |
| `draytek_sys_reboot` | Reboot the router (requires confirmation) |
| `draytek_sys_name` | Set syslog identity name per WAN |
| `draytek_sys_domainname` | Set WAN domain name suffix |
| `draytek_sys_autoreboot` | Configure scheduled automatic reboot |
| `draytek_sys_passwd` | Change the admin password |
| `draytek_sys_alg` | Enable/disable Application Layer Gateway |
| `draytek_sys_time` | Show system time |

### Show / Status Views (12)

| Tool | Description |
|---|---|
| `draytek_show_status` | System overview (uptime, WAN, LAN, DNS) |
| `draytek_show_lan` | LAN/VLAN interface configuration |
| `draytek_show_dns` | DNS server settings |
| `draytek_show_nat` | NAT port redirection table |
| `draytek_show_portmap` | Port mapping table |
| `draytek_show_dmz` | DMZ configuration |
| `draytek_show_openport` | Opened ports (NAT) |
| `draytek_show_session` | Session usage statistics |
| `draytek_show_traffic` | Traffic statistics |
| `draytek_show_cpu` | CPU usage |
| `draytek_show_memory` | Memory usage |
| `draytek_show_statistic` | Interface statistics |

### WAN (10)

| Tool | Description |
|---|---|
| `draytek_wan_status` | WAN connection status |
| `draytek_wan_enable` | Enable a WAN interface |
| `draytek_wan_disable` | Disable a WAN interface |
| `draytek_wan_dns` | Set DNS per WAN (primary/secondary) |
| `draytek_wan_mtu` | Set global WAN MTU |
| `draytek_wan_forward` | Enable/disable inter-WAN IP forwarding |
| `draytek_wan_lb` | Add/remove WAN from load-balance pool |
| `draytek_wan_failover` | Configure WAN failover |
| `draytek_wan_budget` | Set WAN data budget/cap |
| `draytek_wan_vlan_tag` | Set VLAN tagging on a WAN interface |

### Internet (2)

| Tool | Description |
|---|---|
| `draytek_internet_view` | View internet/WAN connection settings |
| `draytek_internet_set` | Configure internet (mode, credentials, IP) |

### IP / LAN (9)

| Tool | Description |
|---|---|
| `draytek_ip_route` | Show routing table |
| `draytek_ip_arp` | Show ARP table |
| `draytek_ip_session` | Show IP session table |
| `draytek_ip_ping` | Ping a host from the router |
| `draytek_ip_tracert` | Traceroute from the router |
| `draytek_ip_dhcpc` | DHCP client (status/renew/release) |
| `draytek_ip_addr` | Set LAN IP address |
| `draytek_ip_nmask` | Set LAN subnet mask |
| `draytek_ip_bindmac` | Bind IP to MAC address (ARP binding) |

### DHCP Server (9)

| Tool | Description |
|---|---|
| `draytek_dhcp_status` | DHCP status and lease table |
| `draytek_dhcp_on` | Enable DHCP server |
| `draytek_dhcp_off` | Disable DHCP server |
| `draytek_dhcp_startip` | Set DHCP pool start IP |
| `draytek_dhcp_gateway` | Set DHCP pool gateway |
| `draytek_dhcp_dns` | Set DNS for DHCP per LAN |
| `draytek_dhcp_leasetime` | Set DHCP lease time |
| `draytek_dhcp_relay` | Set DHCP relay server |
| `draytek_dhcp_ipcnt` | Set number of IPs in DHCP pool |

### NAT / Port Forwarding (9)

NAT port mapping forwards traffic from a WAN public port to an internal LAN host. For cross-VLAN/inter-LAN access control, use the Firewall tools below instead.

| Tool | Description |
|---|---|
| `draytek_nat_view` | NAT configuration overview |
| `draytek_nat_portmap_table` | Port mapping table |
| `draytek_nat_dmz` | DMZ configuration (view/enable/disable/set IP) |
| `draytek_nat_portmap_add` | Add a WAN-to-LAN port forwarding rule |
| `draytek_nat_portmap_del` | Delete a port forwarding rule |
| `draytek_nat_portmap_enable` | Enable a port forwarding rule |
| `draytek_nat_portmap_disable` | Disable a port forwarding rule |
| `draytek_nat_portmap_view` | View a specific port forwarding rule |
| `draytek_nat_ipsecpass` | Enable/disable IPSec passthrough |

### Firewall (12)

Use firewall rules for cross-VLAN/inter-LAN access control. For WAN-to-LAN port forwarding, use NAT port mapping instead.

| Tool | Description |
|---|---|
| `draytek_ipf_view` | View all IP filter sets — use first to find available sets |
| `draytek_ipf_view_detail` | View firewall rules with detail flags (-d data, -c call, -V verbose) |
| `draytek_ipf_set_default_action` | Set default action (pass/block) for unmatched packets |
| `draytek_ipf_set_filter` | Activate a data/call filter set (required after creating rules) |
| `draytek_ipf_rule_view` | View a specific firewall rule's full configuration |
| `draytek_ipf_rule_set` | **Configure a firewall rule** — source/dest IP, protocol, port, action, direction, interfaces. Use for cross-VLAN access, traffic filtering, etc. |
| `draytek_ipf_rule_diagnose` | Test which `ipf rule` flag formats the router accepts — run if `draytek_ipf_rule_set` reports failures |
| `draytek_ipf_rule_raw` | Send raw flags to `ipf rule` — fallback when structured parameters don't work |
| `draytek_ipf_rule_enable` | Enable/disable an existing firewall rule |
| `draytek_ipf_rule_direction` | Set rule direction (LAN→WAN, WAN→LAN, LAN→LAN, WAN→Localhost) |
| `draytek_ipf_strict_security` | Enable/disable strict security (blocks all inter-VLAN unless rules allow) |
| `draytek_ipf_flowtrack` | View active firewall flow tracking sessions |

### Management (9)

| Tool | Description |
|---|---|
| `draytek_mngt_set_port` | Set port number for a service (SSH/HTTP/...) |
| `draytek_mngt_set_timeout` | Set session timeout (SSH/Telnet) |
| `draytek_mngt_rmtcfg_status` | Show remote management status |
| `draytek_mngt_rmtcfg` | Enable/disable a remote management protocol |
| `draytek_mngt_accesslist` | Show access control list |
| `draytek_mngt_lanaccess` | View LAN access control settings |
| `draytek_mngt_noping` | Enable/disable ping blocking |
| `draytek_mngt_defenseworm` | Worm defence configuration |
| `draytek_mngt_bfp` | Brute-force protection settings |

### VPN (10)

| Tool | Description |
|---|---|
| `draytek_vpn_list` | List all VPN profiles |
| `draytek_vpn_list_detail` | View a specific VPN profile (all sections) |
| `draytek_vpn_remote` | Show remote VPN users |
| `draytek_vpn_remote_toggle` | Enable/disable a remote VPN type |
| `draytek_vpn_setup` | Configure a VPN profile |
| `draytek_vpn_ovpn` | OpenVPN configuration |
| `draytek_vpn_dinset` | VPN dial-in (host-to-LAN) settings |
| `draytek_vpn_l2lset` | VPN LAN-to-LAN settings |
| `draytek_vpn_subnet` | Set VPN subnet |
| `draytek_vpn_isolate` | Enable/disable VPN isolation |

### VLAN (8)

| Tool | Description |
|---|---|
| `draytek_vlan_status` | Show VLAN status |
| `draytek_vlan_on` | Enable VLAN |
| `draytek_vlan_off` | Disable VLAN |
| `draytek_vlan_group` | Manage VLAN groups (add/set/show) |
| `draytek_vlan_vid` | Set VLAN ID per channel |
| `draytek_vlan_tagged` | Enable/disable VLAN tagging per channel |
| `draytek_vlan_subnet` | Map VLAN group to LAN interface |
| `draytek_vlan_map` | Show LAN-to-VLAN mapping table |

### QoS (3)

| Tool | Description |
|---|---|
| `draytek_qos_setup` | Configure QoS / bandwidth management |
| `draytek_qos_voip` | Enable/disable VoIP QoS prioritisation |
| `draytek_qos_class` | Manage QoS classification rules |

### DDNS (7)

| Tool | Description |
|---|---|
| `draytek_ddns_show` | Show DDNS configuration |
| `draytek_ddns_show_account` | Show a specific DDNS account |
| `draytek_ddns_log` | Show DDNS log |
| `draytek_ddns_enable` | Enable/disable DDNS globally |
| `draytek_ddns_forceupdate` | Force an immediate DDNS update |
| `draytek_ddns_set` | Configure a DDNS account (provider, hostname, login) |
| `draytek_ddns_time` | Set DDNS update interval |

### Objects (6)

| Tool | Description |
|---|---|
| `draytek_object_ip_view` | View an IP object |
| `draytek_object_ip_set` | Configure an IP object (single/range/subnet) |
| `draytek_object_ip_grp` | Configure an IP group |
| `draytek_object_service_view` | View a service object |
| `draytek_object_service_set` | Configure a service object (protocol, ports) |
| `draytek_object_schedule` | Configure a schedule object |

### Port (3)

| Tool | Description |
|---|---|
| `draytek_port_status` | Show physical Ethernet port status |
| `draytek_port_speed` | Set port speed/duplex (Auto/100F/10H/...) |
| `draytek_port_sniff_status` | Show port sniffing/mirroring status |

### High Availability (3)

| Tool | Description |
|---|---|
| `draytek_ha_status` | Show HA status |
| `draytek_ha_show_config` | Show HA configuration |
| `draytek_ha_set` | Configure HA settings |

### Wake-on-LAN (2)

| Tool | Description |
|---|---|
| `draytek_wol_up` | Send WoL magic packet |
| `draytek_wol_fromwan` | Enable/disable WoL from WAN |

### Logging (2)

| Tool | Description |
|---|---|
| `draytek_log_system` | View system log |
| `draytek_log_wan` | View WAN log |

### UPnP (2)

| Tool | Description |
|---|---|
| `draytek_upnp_on` | Enable UPnP |
| `draytek_upnp_off` | Disable UPnP |

### CSM / DoS (2)

| Tool | Description |
|---|---|
| `draytek_csm` | Content Security Management (URL/web/DNS filter) |
| `draytek_dos` | DoS protection commands |

### IPv6 (1)

| Tool | Description |
|---|---|
| `draytek_ip6` | IPv6 configuration and status |

### Certificates (1)

| Tool | Description |
|---|---|
| `draytek_cert` | Certificate management (view, import, CSR) |

### Authentication (4)

| Tool | Description |
|---|---|
| `draytek_ldap` | LDAP authentication configuration |
| `draytek_radius` | RADIUS server configuration |
| `draytek_tacacsplus` | TACACS+ authentication configuration |
| `draytek_local_8021x` | Local 802.1X authentication |

### User Management (1)

| Tool | Description |
|---|---|
| `draytek_user` | User account management (profiles, dial-in users) |

### Switch (3)

| Tool | Description |
|---|---|
| `draytek_switch` | Managed switch configuration |
| `draytek_switch_cli` | Direct switch CLI passthrough |
| `draytek_swm` | Central switch management (VigorSwitch) |

### File Sharing / USB (3)

| Tool | Description |
|---|---|
| `draytek_smb` | SMB/CIFS file sharing configuration |
| `draytek_usb` | USB device and storage management |
| `draytek_fs` | File system operations |

### Multi-Subnet (1)

| Tool | Description |
|---|---|
| `draytek_msubnet` | Multi-subnet (LAN subnet) configuration |

### Access Point Management (1)

| Tool | Description |
|---|---|
| `draytek_apm` | AP management (manage VigorAP devices) |

### Hotspot Portal (1)

| Tool | Description |
|---|---|
| `draytek_hsportal` | Hotspot Web Portal configuration |

### Application / Hardware QoS (2)

| Tool | Description |
|---|---|
| `draytek_appqos` | Application-based QoS |
| `draytek_hwqos` | Hardware QoS |

### Network Protocols (3)

| Tool | Description |
|---|---|
| `draytek_vrrp` | VRRP (Virtual Router Redundancy Protocol) |
| `draytek_lldp` | LLDP (Link Layer Discovery Protocol) |
| `draytek_ethoam` | Ethernet OAM |

### Service / Domain (2)

| Tool | Description |
|---|---|
| `draytek_service` | Service management |
| `draytek_dmn` | Domain management / DNS configuration |

### Bridge Modes (2)

| Tool | Description |
|---|---|
| `draytek_vigbrg` | Vigor bridge mode |
| `draytek_fullbrg` | Full bridge mode |

### Partner / Product / Provisioning (4)

| Tool | Description |
|---|---|
| `draytek_partner` | Partner/reseller settings |
| `draytek_model` | Router model information |
| `draytek_prodline` | Product line information |
| `draytek_provision` | Auto-provisioning / Zero Touch |

### Hardware / Low-Level (11)

| Tool | Description |
|---|---|
| `draytek_sfp` | SFP module status |
| `draytek_testmail` | Send test email |
| `draytek_portmaptime` | Port mapping time/schedule |
| `draytek_ppa` | Protocol acceleration (hardware offloading) |
| `draytek_hwaccswap` | Hardware acceleration swap |
| `draytek_prn` | Printer sharing |
| `draytek_nand` | NAND flash operations |
| `draytek_sflash` | Serial flash operations |
| `draytek_db` | Internal database operations |
| `draytek_fw_backupmode` | Firmware backup mode |
| `draytek_gci` | GCI configuration interface |

### Raw Command (1)

| Tool | Description |
|---|---|
| `draytek_raw` | Execute any CLI command (escape hatch) |

## Important Notes

- **`draytek_sys_commit`** must be run after configuration changes to save from SRAM to FLASH. Otherwise changes are lost on reboot.
- **`draytek_sys_reboot`** requires `confirm: "yes"` to prevent accidental reboots.
- The server maintains a persistent SSH connection and automatically handles `--- MORE ---` paging and prompt detection.
- Debug logs are written to stderr (captured by the MCP client).
- **SSH host key** is pinned on first connect to `~/.config/draytek-mcp/known_hosts`. Subsequent connections verify against the stored fingerprint. If the router's key changes (factory reset, firmware upgrade), delete the entry from that file.

## Security

- **Input validation** — All tool parameters with structured intent (IPs, hostnames, passwords, interfaces, ports) are validated with Zod regex schemas. A central guard in the SSH client rejects any command containing control characters (`\x00-\x1f`, `\x7f`), preventing CR/LF command injection.
- **SSH host key pinning** — On first connect, the router's host key fingerprint (SHA-256) is saved to `~/.config/draytek-mcp/known_hosts` (mode `600`). Subsequent connections reject mismatches, protecting against man-in-the-middle attacks. To reset after a router factory reset or firmware upgrade, delete the relevant entry from the file.
- **SSH algorithms** — Only strong algorithms are offered: `diffie-hellman-group14-sha256` (preferred), AES-CTR/GCM ciphers, `rsa-sha2-256` host keys, and `hmac-sha2-256` MACs. Weak algorithms (`group1-sha1`, `3des-cbc`, `hmac-md5`, `ssh-dss`) are not offered.
- **No secrets in code** — Router credentials are read from environment variables. The `sys admin drayteker` command used after login is a DrayTek factory default, not a secret.
- **No file logging** — All diagnostic output goes to stderr only (captured by the MCP client). No log files are written to disk.
- **Free-text tools** — Some tools (`draytek_raw`, VPN/certificate/RADIUS configuration, etc.) accept arbitrary command strings by design. The control character guard limits each call to a single command, but they can still execute any valid router CLI command.

## How It Works

The MCP server connects to the router via SSH and runs DrayOS CLI commands in an interactive shell. It automatically:

- Maintains a persistent SSH session (reconnects as needed)
- Handles `--- MORE ---` paging by sending space characters to fetch all output
- Detects the shell prompt to know when a command has finished
- Pins the router's SSH host key on first use (TOFU) and rejects mismatches
- Runs `sys admin drayteker` after login to unlock the full command set

## Development

```bash
npm run dev              # Run with tsx (hot reload)
npm run build            # Compile TypeScript
npm start                # Run compiled version
npm run test:connection  # Test SSH connection
```

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
