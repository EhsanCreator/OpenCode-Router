# Security and Privacy Architecture

OpenCode Router is designed following the principle of least privilege, strict process isolation, and local-first data privacy.

---

## 1. Zero Root Privileges Required

Standard VPN software requires root (`sudo`) permissions to create network adapters (`tun0`, `tap0`) and alter kernel routing tables (`ip route replace default ...`).

OpenCode Router operates **completely in unprivileged user space**:
- Binds exclusively to loopback high ports (`127.0.0.1:10808` SOCKS5, `10809` HTTP). High ports (`>1024`) do not require root access on Linux.
- Spawns Xray-core as a child process of the running user.
- **Never prompts for your Ubuntu sudo password during normal operation.**

---

## 2. No System-Wide Routing Alterations

OpenCode Router intentionally avoids modifying global network configuration:
- Does NOT edit `/etc/resolv.conf`.
- Does NOT alter iptables, nftables, or UFW rules.
- Does NOT change the system default gateway.

**Benefit**: Active SSH sessions, local database servers, Docker bridge networks, and browser tabs remain on your direct host network with zero disruption.

---

## 3. Local-First Data Storage & Zero Telemetry

- **No Remote Telemetry**: OpenCode Router transmits zero analytics, tracking scripts, or usage metrics to external servers.
- **Excluded Sensitive Data**: All proxy configurations, connection logs, and SQLite database files reside exclusively in the local `data/` directory.
- **Git Protection**: Strict rules in `.gitignore` ensure that database files, logs, and connection exports are never committed to version control.
- **RFC 5737 Compliance**: All example IP addresses in public documentation and code samples use reserved documentation IP ranges (`198.51.100.0/24`, `192.0.2.0/24`, `203.0.113.0/24`).

---

## 4. Optional Least-Privilege Network Capabilities

If raw packet routing or custom network binding is desired on headless Ubuntu servers, `scripts/setup-privileges.sh` applies the Linux capability model:
```bash
sudo setcap 'cap_net_admin,cap_net_bind_service=+ep' bin/xray
```
This grants isolated network socket administration strictly to the Xray binary without granting broad root permissions to the user account.
