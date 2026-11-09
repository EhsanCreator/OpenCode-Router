# OpenCode Router

<div align="center">

[![Documentation](https://img.shields.io/badge/docs-GitHub%20Pages-blue.svg)](https://ehsancreator.github.io/OpenCode-Router/)
[![Version](https://img.shields.io/badge/version-v1.0.0-emerald.svg)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows%2011%2F10%20(Native)-blue.svg)]()
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)]()
[![Author](https://img.shields.io/badge/author-Ehsan%20Shahriyari-purple.svg)](https://github.com/EhsanCreator)

**Automated proxy discovery, testing, and intelligent routing for OpenCode. Fix connectivity issues and IP-based rate limits with Xray/V2Ray on Linux and Windows.**

[Documentation Website](https://ehsancreator.github.io/OpenCode-Router/) •
[Key Features](#5-key-features) •
[Architecture](#8-architecture-overview) •
[Installation](#11-installation) •
[Usage](#13-usage-examples) •
[Technical Guides](#21-technical-documentation--articles) •
[Author](#23-author-and-contact)

</div>

---

## 2. Introduction

**OpenCode Router** is an automated, open-source proxy discovery and intelligent routing manager built specifically for [OpenCode](https://github.com/anomaly/opencode) on Linux.

When utilizing command-line AI coding assistants, developers regularly face regional ISP censorship, CDN firewalls, broken TCP sockets, and IP-level HTTP 429 rate limits. Traditional VPN clients attempt to solve this by creating system-wide TUN/TAP network adapters that redirect all operating system traffic—breaking local web servers, Docker bridge networks, database sockets, and active SSH sessions.

OpenCode Router provides a non-disruptive, application-specific alternative. It automatically discovers public V2Ray/Xray proxy configurations from GitHub, executes deterministic 3-stage health checks directly through the installed OpenCode binary, and locks into the fastest responsive node. All proxying operates in unprivileged user space (SOCKS5/HTTP), isolating proxy traffic strictly to OpenCode via a transparent launcher wrapper (`bin/opencode-vpn`) without modifying system routing tables or network adapters.

---

## 3. Visual Identity & Brand

OpenCode Router combines an unprivileged headless Xray-core engine with an Express telemetry backend and a modern React 19 web dashboard built with Vite, Tailwind CSS, and Lucide icons.

---

## 4. Product Preview

UI screenshots will be published after a reproducible, fully synthetic demo dataset is available. Until then, see the [user guide](https://ehsancreator.github.io/OpenCode-Router/guide/getting-started) for the current workflow.

---

## 5. Key Features

- **Automated Configuration Discovery**: Crawls, parses, deduplicates, and caches thousands of public anti-censorship nodes from curated GitHub subscriptions.
- **Broad Protocol Support**: Full native parsing and outbound generation for **VLESS** (Reality, TLS, WebSocket, gRPC, TCP), **VMess** (AEAD, WebSocket, TCP), **Trojan** (TLS, WebSocket, gRPC), and **Shadowsocks**.
- **Deterministic 3-Stage Testing Pipeline**:
  1. *Stage 1 (TCP Handshake)*: Verifies server socket reachability and measures millisecond round-trip latency.
  2. *Stage 2 (Proxy Handshake)*: Starts the local user-space proxy and probes egress IP reflection via HTTP.
  3. *Stage 3 (Real OpenCode Prompt)*: Executes an actual non-interactive test prompt (`opencode run "Reply with: OK" --pure`) to confirm LLM API completion.
- **Intelligent Error Classifier**: Distinguishes IP-based rate limits (which trigger automatic node rotation) from account-level quota exhaustion and authentication failures, preventing useless switching loops.
- **Isolated Target Execution (`opencode-vpn`)**: Injects `http_proxy`, `https_proxy`, and `all_proxy` environment variables exclusively into OpenCode, keeping your OS, browsers, and terminal sessions unaffected.
- **Zero Root Privilege Requirement**: Operates completely on high loopback ports (`127.0.0.1:10808` SOCKS5, `10809` HTTP) as a standard user; never prompts for your sudo password during daily use.
- **Modern Responsive Web GUI**: Live status streaming via Server-Sent Events (SSE), search filters, manual node testing, and one-click connection switching.
- **Persistent Local Caching**: Stores test history, candidate rankings, and subscription sources in a lightweight local SQLite database.

---

## 6. Problems the Project Solves

1. **IP-Level HTTP 429 Throttling**: Automatically switches egress IPs when shared public endpoints throttle your IP address.
2. **Regional Connection Timeouts (`ETIMEDOUT`)**: Tunnels OpenCode traffic through encrypted nodes when direct access to AI provider endpoints is blocked or degraded.
3. **Deep Packet Inspection (DPI) Resets (`ECONNRESET`)**: Utilizes VLESS Reality and TLS masquerading to bypass stateful connection resets.
4. **System-Wide Network Disruption**: Replaces disruptive system-wide TUN VPNs with application-specific proxy isolation, preserving local microservices, Docker containers, and SSH sessions.

---

## 7. How OpenCode Router Works

```
[GitHub Subscription Sources]
             │
             ▼ (Automated Fetch & Base64 Decode)
[Config Parser & Deduplicator] ──► SQLite Cache (data/opencode-vpn.db)
             │
             ▼ (Ranked Candidates by Latency Score)
[Connection Orchestrator State Machine]
             │
             ├──► Stage 1: Fast TCP Ping
             ├──► Stage 2: Local Xray Proxy Egress Probe
             └──► Stage 3: Real OpenCode Verification Prompt
                         │
                         ├── If Fails: Classify Error & Try Next Candidate
                         └── If Success: Lock Node & Export State
                                     │
                                     ▼
                    [bin/opencode-vpn Launcher]
                    (Injects SOCKS5:10808 & HTTP:10809)
```

1. **Discovery & Normalization**: The crawler retrieves raw subscription lists, decodes Base64 payloads, normalizes configuration parameters, computes SHA-256 hashes to eliminate duplicates, and discards unencrypted or invalid links.
2. **Candidate Ranking**: Nodes are sorted by historical latency and success rates.
3. **Failover Execution**: When you click **Find Working Connection** (or invoke the API), the orchestrator tests candidate nodes sequentially until a working proxy completes a real OpenCode session.
4. **Proxy Lock**: The verified configuration is written to `data/active-connection.json`, and Xray-core runs in the background ready to accept OpenCode traffic.

---

## 8. Architecture Overview

OpenCode Router consists of three decoupled layers:

- **Backend Service (Express & TypeScript)**: Manages the SQLite database, runs the discovery crawler, controls Xray child processes, and streams real-time telemetry over Server-Sent Events (SSE).
- **Frontend Dashboard (React 19 & Tailwind CSS)**: Single-page application providing connection controls, live testing logs, diagnostics, and configuration management.
- **Dedicated Launcher (`bin/opencode-vpn`)**: A lightweight Bash wrapper that injects proxy environment variables strictly into OpenCode without altering host environment variables.

---

## 9. Supported Operating Systems

OpenCode Router provides genuine cross-platform support with dedicated native launchers and process engines on both Linux and Windows:

| Operating System | Compatibility Status | Verification Notes |
| :--- | :---: | :--- |
| **Windows 11 (x64)** | **Tested & Verified** | Native PowerShell & CMD launchers; per-user AppData storage; native `xray.exe`. |
| **Windows 10 (x64)** | **Tested & Verified** | Native PowerShell & CMD launchers; build 19041+ supported. |
| **Ubuntu 24.04 LTS (x86_64)** | **Tested & Verified** | Primary Linux development and validation environment. |
| Ubuntu 22.04 LTS / Debian 12 | *Compatible* | Requires Node.js >= 20.19.0 or >= 22.12.0 and standard bash. |
| Windows 11 (ARM64) | *Implemented (Unverified)* | ARM64 asset provisioned; unverified on physical ARM64 hardware. |
| macOS (Apple Silicon / Intel) | *Compatible* | Native bash launcher and macOS Xray binaries supported. |

> [!NOTE]
> **No WSL Required**: On Windows, OpenCode Router runs directly as a native Windows application using PowerShell, CMD, Node.js, and native `xray.exe`. Windows Subsystem for Linux (WSL) is neither required nor used.

---

## 10. Requirements

### On Windows
- **Operating System**: Windows 10 (Build 19041+) or Windows 11 (64-bit x64 primary target; ARM64 asset implemented)
- **Node.js Runtime**: v20.19.0+ or v22.12.0+ ([Download Node.js](https://nodejs.org)) — *strictly required by Vite 8*
- **Shell**: Windows PowerShell 5.1+, PowerShell 7+, Windows Terminal, or CMD
- **Target Application**: OpenCode CLI installed (`npm install -g opencode-ai`)

### On Linux
- **Operating System**: Ubuntu 24.04 LTS / Debian 12 / Compatible Linux (64-bit)
- **Node.js Runtime**: v20.19.0+ or v22.12.0+ (`node -v`) — *strictly required by Vite 8*
- **Package Manager**: npm (`npm -v`)
- **Target Application**: OpenCode CLI installed (e.g. `/usr/local/bin/opencode`)

---

## 11. Installation

### Option A: Windows Native Installation (PowerShell)

Open PowerShell in the cloned repository directory:

```powershell
# 1. Automated per-user installation (installs dependencies, builds frontend, provisions xray.exe)
powershell -ExecutionPolicy Bypass -File scripts\windows\install.ps1

# 2. Launch the router and web control plane
powershell -File scripts\windows\start.ps1
```

The installer will automatically:
- Download the official, checksum-verified Windows Xray-core (`xray.exe`, `geoip.dat`, `geosite.dat`).
- Compile the modern React dashboard into `src/frontend/dist/`.
- Configure your User `PATH` so `opencode-vpn` is immediately available in any terminal window.
- Initialize local AppData storage at `%LOCALAPPDATA%\OpenCode-Router`.

### Option B: Linux / Ubuntu Installation (Bash)

```bash
# 1. Clone the Repository
git clone https://github.com/EhsanCreator/OpenCode-Router.git
cd OpenCode-Router

# 2. Install Node Dependencies
npm install

# 3. Launch the Application
./start.sh
```

The Linux startup script will automatically provision Xray-core, build the frontend if missing, start the backend server, and open the dashboard at `http://localhost:3000`.

---

## 12. Configuration

OpenCode Router works out of the box with zero required configuration. To customize local settings, copy the example environment template:

```bash
cp .env.example .env
```

Available environment variables:
- `PORT`: Web dashboard port (default: `3000`).
- `OPENCODE_HTTP_PROXY_PORT`: Local HTTP proxy port (default: `10809`).
- `OPENCODE_SOCKS_PROXY_PORT`: Local SOCKS5 proxy port (default: `10808`).
- `OPENCODE_BIN`: Custom path to OpenCode binary (auto-detected if omitted).
- `MAX_TEST_ATTEMPTS`: Max candidate nodes tested per workflow run (default: `25`).
- `OPENCODE_TIMEOUT_SECONDS`: Verification prompt timeout in seconds (default: `18`).

---

## 13. Usage Examples

### Using the Web GUI
1. Open `http://localhost:3000` in your browser.
2. Click **Find Working Connection**.
3. Watch the live testing feed cycle through ranked nodes.
4. Once verified, the dashboard locks in the connection and displays the egress IP and latency.

### Using the Command-Line Wrapper (Windows & Linux)

Once a working node is active in the dashboard, execute OpenCode commands through `opencode-vpn`:

#### On Windows (PowerShell, Windows Terminal, or Command Prompt):
```powershell
# Launch interactive terminal-based OpenCode CLI with active proxy
opencode-vpn

# Run non-interactive query through proxy
opencode-vpn run "Explain this codebase"
opencode-vpn run "What is 2 + 2?" --pure

# Version check
opencode-vpn --version
```

#### On Linux / macOS (Bash):
```bash
# Launch interactive OpenCode terminal through the active proxy
bin/opencode-vpn

# Run non-interactive prompt through the proxy
bin/opencode-vpn run "Explain TypeScript generics"

# Pure machine-readable response
bin/opencode-vpn run "What is 2 + 2? Answer in one word." --pure
```

### Creating a System-Wide Alias / Symlink
To invoke `opencode-vpn` from any directory:
```bash
mkdir -p ~/.local/bin
ln -sf "$(pwd)/bin/opencode-vpn" ~/.local/bin/opencode-vpn
```

### Creating an Ubuntu Desktop Launcher
To add OpenCode Router to your Ubuntu Applications menu and Desktop:
```bash
./scripts/create-desktop-launcher.sh
```

---

## 14. Proxy Architecture

OpenCode Router implements a multi-inbound local loopback proxy listener:

- **SOCKS5 Listener**: `127.0.0.1:10808` (Mapped to `all_proxy` and `ALL_PROXY`)
- **HTTP Listener**: `127.0.0.1:10809` (Mapped to `http_proxy`, `https_proxy`, `HTTP_PROXY`, `HTTPS_PROXY`)

Traffic flow:
1. `bin/opencode-vpn` exports loopback proxy variables into the OpenCode process environment.
2. OpenCode sends API requests to `127.0.0.1:10809` or `127.0.0.1:10808`.
3. Xray-core encapsulates the request into the active encrypted protocol tunnel (VLESS/VMess/Trojan/SS).
4. The remote proxy server forwards the request to the AI provider API and returns the completion.
5. All other host applications continue using direct, unproxied internet.

---

## 15. Security and Privacy

- **Default Loopback Binding**: The management server binds strictly to `127.0.0.1` by default. Remote exposure requires explicit opt-in (`ALLOW_REMOTE_ACCESS=true`) and triggers high-visibility console warnings.
- **Mandatory Remote Authentication**: Remote binding strictly requires setting `OPENCODE_ROUTER_API_KEY`. The server will refuse startup if remote binding is attempted without an API key. Remote requests require `Authorization: Bearer <key>` using constant-time verification (`crypto.timingSafeEqual`). API keys in query parameters are strictly rejected.
- **Frictionless Local Execution**: Standard local loopback usage (`127.0.0.1`) requires zero authentication by default, keeping CLI and local dashboard workflows completely frictionless.
- **Strict Origin & Host Guard**: Replaces unrestricted CORS with an explicit local development allowlist. Blocks DNS rebinding via Host header checks and blocks cross-origin CSRF on state-changing endpoints (`POST`, `DELETE`) with `HTTP 403 Forbidden`.
- **Sensitive Token & Credential Redaction**: Subscription URLs returned by `/api/sources` and error reports automatically redact private parameters case-insensitively (`token`, `key`, `password`, `auth`, `api_key`, `access_token`) and sanitize userinfo credentials (`***:***@host`). Diagnostics endpoints mask personal IPv4 and IPv6 octets.
- **Restricted File Permissions & Symlink Protection**: Generated Xray client configs (`data/active-xray-config.json`), active state files, and logs are written with mode `0600` (user-only read/write), data directories are enforced to `0700`, and writing through symbolic links is blocked (`lstat` and `O_NOFOLLOW`).
- **User-Space Isolation**: No modification of `/etc/resolv.conf`, `iptables`, `nftables`, or kernel routing tables.
- **Zero Root Privileges**: Runs entirely as a standard unprivileged user on high loopback ports (`127.0.0.1:10808` / `10809`).
- **Zero External Telemetry**: No tracking scripts, analytics, or external telemetry are collected or transmitted.

---

## 16. Troubleshooting

| Symptom | Probable Cause | Recommended Solution |
| :--- | :--- | :--- |
| `curl: (7) Failed to connect to 127.0.0.1:10809` | Proxy engine is stopped or idle. | Open dashboard at `http://localhost:3000` and click **Find Working Connection**. |
| `Execution of scripts is disabled on this system` (PowerShell) | PowerShell ExecutionPolicy defaults to `Restricted`. | Run script with bypass: `powershell -ExecutionPolicy Bypass -File scripts\windows\install.ps1`. |
| `'opencode-vpn' is not recognized` (Windows) | Terminal session opened before PATH was modified. | Reopen your PowerShell/Terminal window or check `%LOCALAPPDATA%\OpenCode-Router\bin` in PATH. |
| `Error: connect ETIMEDOUT` | Candidate node remote endpoint unreachable. | The orchestrator will automatically fail over; or click **Refresh Nodes**. |
| `HTTP 429: insufficient_quota` | Account-level token budget exhausted. | Top up your provider API credits. IP switching cannot fix account balance limits. |
| `Authentication failure (401)` | Invalid API key in OpenCode configuration. | Verify your API key in `~/.config/opencode/opencode.json` (or `%APPDATA%\opencode\opencode.json`). |
| Port 3000 already in use | Another service is using port 3000. | Linux: `PORT=3001 ./start.sh` <br> Windows: `$env:PORT="3001"; .\scripts\windows\start.ps1`. |

For in-depth troubleshooting guides, refer to our [Technical Articles](#technical-documentation--articles).

---

## 17. Important Limitations

- **Account-Level Quotas**: OpenCode Router switches IP addresses to bypass IP-based throttles and regional network blocks. It **cannot** bypass account-level credit limits, monthly token caps, or invalid API keys.
- **Public Node Lifespans**: Free public proxy configurations from GitHub may experience variable uptime, congestion, or unexpected termination. OpenCode Router mitigates this via continuous testing and fast failover.
- **Scope**: Designed specifically for OpenCode and related CLI developer workflows; does not provide system-wide VPN functionality.

---

## 18. Testing & Validation

OpenCode Router includes automated test suites covering protocol parsing, Xray client generation, process cleanup, cross-platform path resolution, rate-limit classification, and pipeline speed benchmarks:

```bash
# Run core acceptance and security tests (Linux & POSIX)
npm test

# Run cross-platform platform abstraction & Windows compatibility tests
npm run test:windows

# Run high-speed 3-stage pipeline & canary benchmark tests
npx tsx tests/pipeline-speed-tests.ts

# Provision official Xray-core binary with SHA256 checksum verification
npm run provision:xray

# Package standalone portable distribution for Windows
npm run package:portable
```

All 8 acceptance test scenarios (A through G) execute deterministically without requiring root privileges.

---

## 19. Development Setup

To run OpenCode Router in active development mode with hot reloading:

```bash
# Terminal 1: Backend service with file watching
npm run dev:backend

# Terminal 2: Frontend Vite dev server
npm run dev:frontend
```

---

## 20. Roadmap

- [ ] Automated periodic background health checks for active connection.
- [ ] Support for custom private subscription endpoints with password encryption.
- [ ] Tray indicator applet for GNOME / Ubuntu Desktop.
- [ ] Export verified configurations to Clash / Sing-box format.

---

## 21. Technical Documentation & Articles

Explore our dedicated technical troubleshooting guides:

- [How to Fix OpenCode Network Errors on Linux](docs/articles/fix-opencode-network-errors-linux.md)
- [How to Fix OpenCode HTTP 429 Rate Limit Errors](docs/articles/fix-opencode-http-429-rate-limit.md)
- [How to Configure a Proxy for OpenCode CLI](docs/articles/configure-proxy-opencode-cli.md)
- [How to Use Xray with OpenCode on Ubuntu](docs/articles/use-xray-with-opencode-ubuntu.md)
- [OpenCode Proxy vs. System-Wide VPN: Understanding the Differences](docs/articles/opencode-proxy-vs-system-vpn.md)

---

## 22. Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines, coding standards, and pull-request procedures.

---

## 23. Author and Contact

**Ehsan Shahriyari**
- GitHub: [@EhsanCreator](https://github.com/EhsanCreator)
- Repository: [https://github.com/EhsanCreator/OpenCode-Router](https://github.com/EhsanCreator/OpenCode-Router)
- Issues & Bug Reports: [https://github.com/EhsanCreator/OpenCode-Router/issues](https://github.com/EhsanCreator/OpenCode-Router/issues)

---

## License

This project is open-source software licensed under the [MIT License](LICENSE).
