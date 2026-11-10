import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { Platform } from '../platform/platform';

export interface PrivilegeStatus {
  localProxyReady: boolean;
  hasNetAdminCap: boolean;
  hasScopedSudo: boolean;
  summary: string;
  setupScriptPath: string;
}

export class PrivilegeWizard {
  public static checkStatus(): PrivilegeStatus {
    const xrayBin = Platform.resolveXrayBinary();
    const projectRoot = Platform.getProjectRoot();
    const setupScriptPath = Platform.isWindows()
      ? path.join(projectRoot, 'scripts', 'windows', 'install.ps1')
      : path.join(projectRoot, 'scripts', 'setup-privileges.sh');

    // Local proxy is always ready without privileges (ports > 1024)
    const localProxyReady = fs.existsSync(xrayBin);

    let hasNetAdminCap = false;
    let hasScopedSudo = false;

    if (!Platform.isWindows()) {
      // Check capabilities on Linux
      try {
        const getcapOut = execSync(`getcap "${xrayBin}" 2>/dev/null`, { encoding: 'utf-8' });
        if (getcapOut.includes('cap_net_admin')) {
          hasNetAdminCap = true;
        }
      } catch {
        // ignore
      }

      // Check sudoers on Linux
      try {
        if (fs.existsSync('/etc/sudoers.d/opencode-vpn')) {
          hasScopedSudo = true;
        }
      } catch {
        // ignore
      }
    }

    let summary = Platform.isWindows()
      ? 'Local SOCKS5/HTTP Proxy Mode operates 100% in user-space (Zero Administrator Privileges Required).'
      : 'Local SOCKS5/HTTP Proxy Mode is 100% active and unprivileged (Zero Root Required).';

    if (hasNetAdminCap || hasScopedSudo) {
      summary = 'Passwordless execution & network capabilities are fully configured.';
    }

    return {
      localProxyReady,
      hasNetAdminCap,
      hasScopedSudo,
      summary,
      setupScriptPath
    };
  }
}
