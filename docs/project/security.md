---
title: "Security Policy"
description: "Security disclosure policy, supported versions, and vulnerability reporting procedures for OpenCode Router."
---

# Security Policy

## Supported Versions

| Version | Supported Status |
| :--- | :---: |
| 1.0.x | :white_check_mark: Active Support |

---

## Reporting a Vulnerability

The OpenCode Router project takes security and data confidentiality seriously. If you discover a vulnerability or accidental sensitive information exposure, please report it responsibly.

### How to Report
Please **DO NOT** report security vulnerabilities via public GitHub issues.

Instead, please send a private report to:
- **Author**: Ehsan Shahriyari
- **GitHub**: [@EhsanCreator](https://github.com/EhsanCreator)
- **Repository Issues (Security Category)**: Private security advisory channel on GitHub

Please include:
- A description of the vulnerability.
- Steps to reproduce or proof-of-concept code.
- Potential impact and affected components.

We will acknowledge receipt of your report within 48 hours and work on a fix as quickly as possible.

---

## Security Architecture Principles
1. **User-Space Isolation**: All proxy routing is handled at the application level via local loopback sockets (`127.0.0.1:10808` / `10809`) and dedicated process launchers (`bin/opencode-vpn`), preventing unintended global network alterations.
2. **Sanitized Storage**: Proxy connection strings, tokens, and node databases are strictly kept in the local `data/` directory and never committed to source control.
3. **Zero Root Privilege Requirement**: The core application runs entirely with unprivileged standard user permissions.
