import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn, execSync, SpawnOptions, ChildProcess } from 'child_process';
import { ensureSecureDirectory } from '../security/file-guard';

export interface AppPaths {
  rootDir: string;
  dataDir: string;
  configsDir: string;
  logsDir: string;
  binDir: string;
  dbPath: string;
  activeConfigPath: string;
  activeStatePath: string;
  xrayLogPath: string;
}

export interface ProcessOwnershipRecord {
  pid: number;
  ownerId?: string;
  executablePath?: string;
  configPath?: string;
  commandLinePattern?: string;
  startedAt?: number;
}

export class Platform {
  private static projectRoot: string = path.resolve(__dirname, '../../../');

  public static isWindows(): boolean {
    return process.platform === 'win32';
  }

  public static isLinux(): boolean {
    return process.platform === 'linux';
  }

  public static isMacOS(): boolean {
    return process.platform === 'darwin';
  }

  public static getArch(): string {
    return process.arch;
  }

  public static getProjectRoot(): string {
    return this.projectRoot;
  }

  public static setProjectRoot(root: string): void {
    this.projectRoot = path.resolve(root);
  }

  /**
   * Resolve application directories according to OS conventions:
   * - Linux/macOS: Uses repo `data/` and `bin/` by default (or OPENCODE_ROUTER_DATA_DIR).
   * - Windows: Uses `%LOCALAPPDATA%\OpenCode-Router` if installed, or repo `data/` in portable/dev mode.
   */
  public static getPaths(): AppPaths {
    const customDataDir = process.env.OPENCODE_ROUTER_DATA_DIR;
    let baseDataDir: string;

    if (customDataDir && customDataDir.trim().length > 0) {
      baseDataDir = path.resolve(customDataDir.trim());
    } else if (this.isWindows()) {
      // In dev/portable mode where repo data directory exists, keep it local
      const localRepoData = path.join(this.projectRoot, 'data');
      if (fs.existsSync(localRepoData) && fs.existsSync(path.join(this.projectRoot, 'package.json'))) {
        baseDataDir = localRepoData;
      } else {
        const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
        baseDataDir = path.join(localAppData, 'OpenCode-Router');

        // Safe migration from legacy unhyphenated OpenCodeRouter if present
        const legacyDataDir = path.join(localAppData, 'OpenCodeRouter');
        if (fs.existsSync(legacyDataDir)) {
          this.migrateLegacyDataDirectory(legacyDataDir, baseDataDir);
        }
      }
    } else {
      // Linux/macOS standard
      baseDataDir = path.join(this.projectRoot, 'data');
    }

    const configsDir = this.isWindows() && !baseDataDir.endsWith('data')
      ? path.join(baseDataDir, 'configs')
      : baseDataDir;

    const logsDir = this.isWindows() && !baseDataDir.endsWith('data')
      ? path.join(baseDataDir, 'logs')
      : baseDataDir;

    const binDir = path.join(this.projectRoot, 'bin');

    return {
      rootDir: this.projectRoot,
      dataDir: baseDataDir,
      configsDir,
      logsDir,
      binDir,
      dbPath: path.join(baseDataDir, 'opencode-vpn.db'),
      activeConfigPath: path.join(configsDir, 'active-xray-config.json'),
      activeStatePath: path.join(baseDataDir, 'active-connection.json'),
      xrayLogPath: path.join(logsDir, 'xray.log')
    };
  }

  /**
   * Get the standard Xray executable name for the current platform
   */
  public static getXrayBinaryName(): string {
    return this.isWindows() ? 'xray.exe' : 'xray';
  }

  /**
   * Resolve Xray binary path
   */
  public static resolveXrayBinary(customPath?: string): string {
    if (customPath && fs.existsSync(customPath)) {
      return path.resolve(customPath);
    }

    const binName = this.getXrayBinaryName();
    const paths = this.getPaths();

    // 1. Check project bin directory (bin/xray or bin/xray.exe)
    const localBin = path.join(paths.binDir, binName);
    if (fs.existsSync(localBin)) {
      return localBin;
    }

    // 2. Check application data bin directory (on Windows AppData)
    const appDataBin = path.join(paths.dataDir, 'bin', binName);
    if (fs.existsSync(appDataBin)) {
      return appDataBin;
    }

    // 3. Check system locations
    if (this.isWindows()) {
      const candidates = [
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Xray', 'xray.exe'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Xray', 'xray.exe')
      ];
      for (const c of candidates) {
        if (fs.existsSync(c)) return c;
      }

      // Check PATH via where.exe
      const foundInPath = this.lookupPathCommand('xray.exe');
      if (foundInPath) return foundInPath;
    } else {
      const posixCandidates = ['/usr/local/bin/xray', '/usr/bin/xray', '/usr/local/bin/v2ray'];
      for (const c of posixCandidates) {
        if (fs.existsSync(c)) return c;
      }
      const foundInPath = this.lookupPathCommand('xray');
      if (foundInPath) return foundInPath;
    }

    // Fallback to local project bin path even if not yet provisioned
    return localBin;
  }

  /**
   * Resolve OpenCode CLI executable path across platforms
   */
  public static resolveOpenCodeBinary(customPath?: string): string {
    // 1. Environment variable override
    if (process.env.OPENCODE_BIN && fs.existsSync(process.env.OPENCODE_BIN)) {
      return path.resolve(process.env.OPENCODE_BIN);
    }

    if (customPath && fs.existsSync(customPath)) {
      return path.resolve(customPath);
    }

    if (this.isWindows()) {
      // Prioritize native .exe over .cmd/.ps1 shims to avoid shell execution
      const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      const npmCandidates = [
        path.join(appData, 'npm', 'opencode.exe'),
        path.join(appData, 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'),
        path.join(localAppData, 'Programs', 'opencode', 'opencode.exe'),
        path.join(appData, 'npm', 'opencode.cmd'),
        path.join(appData, 'npm', 'opencode.ps1'),
        path.join(appData, 'npm', 'opencode')
      ];
      for (const c of npmCandidates) {
        if (c && fs.existsSync(c)) return c;
      }

      // Query where.exe opencode.exe or opencode
      const foundExe = this.lookupPathCommand('opencode.exe');
      if (foundExe) return foundExe;
      const found = this.lookupPathCommand('opencode');
      if (found) return found;

      return 'opencode.exe';
    } else {
      // Linux/macOS paths
      const posixCandidates = [
        '/usr/local/bin/opencode',
        path.join(os.homedir(), '.local', 'bin', 'opencode'),
        path.join(os.homedir(), '.bun', 'bin', 'opencode'),
        '/usr/bin/opencode'
      ];
      for (const c of posixCandidates) {
        if (fs.existsSync(c)) return c;
      }

      const found = this.lookupPathCommand('opencode');
      if (found) return found;

      return '/usr/local/bin/opencode';
    }
  }

  /**
   * Search PATH for command across OSes without invoking external shell
   */
  public static lookupPathCommand(command: string): string | null {
    const pathEnv = process.env.PATH || '';
    const delimiter = path.delimiter;
    const dirs = pathEnv.split(delimiter).filter(Boolean);

    const extensions = this.isWindows()
      ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase())
      : [''];

    const hasExt = path.extname(command).length > 0;

    for (const dir of dirs) {
      if (hasExt) {
        const full = path.join(dir, command);
        if (fs.existsSync(full)) {
          try {
            const stat = fs.statSync(full);
            if (!stat.isDirectory()) return full;
          } catch {}
        }
      } else {
        for (const ext of extensions) {
          const candidate = path.join(dir, command + ext);
          if (fs.existsSync(candidate)) {
            try {
              const stat = fs.statSync(candidate);
              if (!stat.isDirectory()) return candidate;
            } catch {}
          }
        }
      }
    }

    return null;
  }

  /**
   * Locate potential OpenCode configuration files
   */
  public static getUserConfigPaths(): string[] {
    const home = os.homedir();
    const candidates: string[] = [
      path.join(home, '.config', 'opencode', 'opencode.json'),
      path.join(home, '.config', 'opencode', 'opencode.jsonc')
    ];

    if (this.isWindows()) {
      const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      candidates.push(path.join(appData, 'opencode', 'opencode.json'));
      candidates.push(path.join(appData, 'opencode', 'opencode.jsonc'));
    }

    return candidates;
  }

  /**
   * Resolve an executable, unwrapping Windows batch/cmd shims to native binaries (.exe) or Node.js scripts.
   * This bypasses cmd.exe completely for known CLI wrappers like npm global shims, mitigating CVE-2024-27980.
   */
  public static resolveExecutableTarget(executable: string): { executable: string; prependArgs?: string[] } {
    if (!this.isWindows()) {
      return { executable };
    }

    const ext = path.extname(executable).toLowerCase();
    if (ext !== '.cmd' && ext !== '.bat') {
      return { executable };
    }

    if (!fs.existsSync(executable)) {
      return { executable };
    }

    try {
      const content = fs.readFileSync(executable, 'utf-8');
      const dir = path.dirname(executable);

      // 1. Check if the batch shim points directly to a compiled .exe
      const exeMatches = content.match(/["']?([^"'\r\n]+\.exe)["']?/gi);
      if (exeMatches) {
        for (const match of exeMatches) {
          const raw = match.replace(/["']/g, '');
          const normalized = raw.replace(/%~dp0%/gi, dir).replace(/%dp0%/gi, dir);
          const resolved = path.isAbsolute(normalized) ? normalized : path.resolve(dir, normalized);
          if (fs.existsSync(resolved) && !resolved.toLowerCase().endsWith('node.exe')) {
            return { executable: resolved };
          }
        }
      }

      // 2. Check if the batch shim points to a JS script run by node
      const jsMatches = content.match(/["']?([^"'\r\n]+\.(?:js|mjs|cjs))["']?/gi);
      if (jsMatches) {
        for (const match of jsMatches) {
          const raw = match.replace(/["']/g, '');
          const normalized = raw.replace(/%~dp0%/gi, dir).replace(/%dp0%/gi, dir);
          const resolved = path.isAbsolute(normalized) ? normalized : path.resolve(dir, normalized);
          if (fs.existsSync(resolved)) {
            return {
              executable: process.execPath,
              prependArgs: [resolved]
            };
          }
        }
      }
    } catch {
      // Fallback to original
    }

    return { executable };
  }

  /**
   * Safely quote and escape an argument for Windows CMD invocation when batch files must be used.
   * Escapes double quotes and neutralizes cmd metacharacters (&, |, <, >, ^, %, !).
   */
  public static escapeCmdArg(arg: string): string {
    if (arg === '') return '""';
    // Double any existing double quotes
    const escaped = arg.replace(/"/g, '""');
    // If it contains spaces, CMD metacharacters, or non-ASCII/special characters, wrap in double quotes
    if (/[^a-zA-Z0-9_\-\/]/.test(escaped)) {
      return `"${escaped}"`;
    }
    return escaped;
  }

  /**
   * Safely spawn a command across Linux and Windows.
   * Unwraps batch shims to direct binaries or Node scripts where possible.
   * Strictly controls argument escaping when cmd.exe invocation is required.
   */
  public static safeSpawn(
    executable: string,
    args: string[],
    options: SpawnOptions = {}
  ): ChildProcess {
    const opts: SpawnOptions = { ...options };

    if (this.isWindows()) {
      opts.windowsHide = opts.windowsHide !== undefined ? opts.windowsHide : true;

      // Attempt to resolve underlying native binary or Node entry point
      const resolved = this.resolveExecutableTarget(executable);
      if (resolved.executable !== executable || resolved.prependArgs) {
        const fullArgs = [...(resolved.prependArgs || []), ...args];
        return spawn(resolved.executable, fullArgs, opts);
      }

      const ext = path.extname(executable).toLowerCase();
      if (ext === '.cmd' || ext === '.bat') {
        // When CMD invocation remains necessary, strictly quote arguments to prevent shell injection
        const comspec = process.env.COMSPEC || 'cmd.exe';
        const escapedArgs = args.map((a) => this.escapeCmdArg(a));
        return spawn(comspec, ['/d', '/s', '/c', `"${executable}"`, ...escapedArgs], {
          ...opts
        });
      }
    }

    return spawn(executable, args, opts);
  }

  /**
   * Check if a process is still running
   */
  public static isProcessAlive(pid: number): boolean {
    if (!pid || pid <= 0) return false;
    try {
      // In Node.js, process.kill(pid, 0) tests existence on both POSIX and Windows
      return process.kill(pid, 0);
    } catch (e: any) {
      return e.code === 'EPERM'; // EPERM means exists but cannot signal
    }
  }

  /**
   * Verify if an active PID belongs to an expected executable image name.
   * Protects against PID reuse attacks or stale PID termination of unrelated processes.
   */
  public static isTargetProcess(pid: number, expectedNames: string[] = ['xray', 'node', 'opencode']): boolean {
    if (!this.isProcessAlive(pid)) return false;

    if (this.isWindows()) {
      try {
        const out = execSync(`tasklist /fi "PID eq ${pid}" /fo csv /nh`, {
          encoding: 'utf-8',
          timeout: 2000,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        if (!out || out.includes('No tasks are running')) return false;
        const firstCol = out.split(',')[0].replace(/"/g, '').toLowerCase();
        return expectedNames.some((name) => firstCol.includes(name.toLowerCase()));
      } catch {
        return false;
      }
    } else {
      try {
        const commPath = `/proc/${pid}/comm`;
        const cmdlinePath = `/proc/${pid}/cmdline`;
        const comm = fs.existsSync(commPath) ? fs.readFileSync(commPath, 'utf-8').trim().toLowerCase() : '';
        const cmdline = fs.existsSync(cmdlinePath) ? fs.readFileSync(cmdlinePath, 'utf-8').trim().toLowerCase() : '';
        return expectedNames.some(
          (name) => comm.includes(name.toLowerCase()) || cmdline.includes(name.toLowerCase())
        );
      } catch {
        return false;
      }
    }
  }

  /**
   * Safely migrate user data from legacy directory (%LOCALAPPDATA%\OpenCodeRouter)
   * to canonical directory (%LOCALAPPDATA%\OpenCode-Router).
   * - Preserves all existing files at targetDir (never overwrites).
   * - Uses SQLite VACUUM INTO snapshot API to commit WAL changes into a consistent standalone database.
   * - Never copies live raw -shm shared memory files.
   * - Verifies SQLite PRAGMA integrity_check on both source and staged databases.
   * - Atomic staging using a temporary staging directory (.migration.tmp).
   * - Prevents concurrent migration races via .migration.lock.
   * - Detects active database locks or active running processes before migrating.
   * - Never deletes legacy directory to ensure zero data loss.
   * - Resumable after interruption and reports detailed diagnostics on failure.
   */
  public static migrateLegacyDataDirectory(legacyDir: string, targetDir: string): boolean {
    if (!fs.existsSync(legacyDir)) return true;
    const stagingDir = `${targetDir}.migration.tmp`;
    const lockFile = path.join(targetDir, '.migration.lock');
    let acquiredLock = false;

    try {
      if (!fs.existsSync(targetDir)) {
        ensureSecureDirectory(targetDir);
      }

      // 1. Prevent concurrent migration races
      if (fs.existsSync(lockFile)) {
        try {
          const lockStat = fs.statSync(lockFile);
          if (Date.now() - lockStat.mtimeMs < 30000) {
            console.warn(`[Platform] Notice: Migration lock active at ${lockFile}. Deferring concurrent migration.`);
            return false;
          }
        } catch {}
      }
      fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, time: Date.now() }));
      acquiredLock = true;

      // 2. Clean up any stale staging directory from a previously interrupted migration
      if (fs.existsSync(stagingDir)) {
        try {
          fs.rmSync(stagingDir, { recursive: true, force: true });
        } catch {}
      }

      // 3. Check if legacy directory has active locks or active running processes
      const legacyStateFile = path.join(legacyDir, 'active-connection.json');
      if (fs.existsSync(legacyStateFile)) {
        try {
          const state = JSON.parse(fs.readFileSync(legacyStateFile, 'utf-8'));
          if (state?.pid && Number.isSafeInteger(state.pid) && this.isProcessAlive(state.pid)) {
            console.warn(
              `[Platform] Notice: Active process PID ${state.pid} is running against legacy directory ${legacyDir}. Deferring database migration until process terminates.`
            );
            return false;
          }
        } catch {}
      }

      // Check for active SQLite journal or exclusive locks
      const files = fs.readdirSync(legacyDir);
      const activeJournal = files.some((f) => f.endsWith('.db-journal'));
      if (activeJournal) {
        console.warn(
          `[Platform] Notice: Active SQLite journal found in ${legacyDir}. Deferring migration until transaction finishes.`
        );
        return false;
      }

      // 4. Stage migration into stagingDir
      ensureSecureDirectory(stagingDir);

      const copyToStaging = (src: string, dst: string): void => {
        const stat = fs.statSync(src);
        if (stat.isDirectory()) {
          ensureSecureDirectory(dst);
          for (const item of fs.readdirSync(src)) {
            copyToStaging(path.join(src, item), path.join(dst, item));
          }
        } else {
          // If SQLite .db file, validate integrity and perform transactional snapshot via VACUUM INTO
          if (src.endsWith('.db')) {
            try {
              // First verify 16-byte magic header
              const fd = fs.openSync(src, 'r');
              const header = Buffer.alloc(16);
              fs.readSync(fd, header, 0, 16, 0);
              fs.closeSync(fd);
              if (!header.toString('utf-8').startsWith('SQLite format 3\0')) {
                console.warn(`[Platform] Warning: Malformed SQLite database header at ${src}. Skipping corrupt database.`);
                return;
              }

              // Use better-sqlite3 for transactional snapshot with WAL incorporation
              const Database = require('better-sqlite3');
              const sourceDb = new Database(src, { readonly: true, fileMustExist: true });
              const check = sourceDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
              if (!check || check.length === 0 || check[0].integrity_check !== 'ok') {
                sourceDb.close();
                console.warn(`[Platform] Warning: Database integrity check failed for ${src}. Skipping corrupt database.`);
                return;
              }

              // Snapshot atomically via VACUUM INTO (safely rolls uncheckpointed WAL pages into destination)
              if (fs.existsSync(dst)) fs.unlinkSync(dst);
              sourceDb.exec(`VACUUM INTO '${dst.replace(/'/g, "''")}'`);
              sourceDb.close();

              // Verify destination snapshot
              const destDb = new Database(dst, { readonly: true, fileMustExist: true });
              const destCheck = destDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
              destDb.close();
              if (!destCheck || destCheck.length === 0 || destCheck[0].integrity_check !== 'ok') {
                console.warn(`[Platform] Warning: Staged database integrity check failed for ${dst}.`);
                if (fs.existsSync(dst)) fs.unlinkSync(dst);
                return;
              }
              return;
            } catch (dbErr: any) {
              console.warn(`[Platform] Warning: Failed to create transactional snapshot of ${src}: ${dbErr.message}`);
              return;
            }
          }

          // Skip raw WAL/SHM companion files during staging because VACUUM INTO incorporated them into .db
          if (src.endsWith('.db-wal') || src.endsWith('.db-shm')) {
            return;
          }

          // Copy configuration files, state files, and logs
          fs.copyFileSync(src, dst);
        }
      };

      for (const item of files) {
        copyToStaging(path.join(legacyDir, item), path.join(stagingDir, item));
      }

      // 5. Copy staged items into targetDir preserving pre-existing files
      const commitStaging = (stagedSrc: string, finalDst: string): void => {
        const stat = fs.statSync(stagedSrc);
        if (stat.isDirectory()) {
          if (!fs.existsSync(finalDst)) {
            ensureSecureDirectory(finalDst);
          }
          for (const item of fs.readdirSync(stagedSrc)) {
            commitStaging(path.join(stagedSrc, item), path.join(finalDst, item));
          }
        } else {
          // Strictly preserve existing destination files
          if (!fs.existsSync(finalDst)) {
            fs.copyFileSync(stagedSrc, finalDst);
          }
        }
      };

      for (const item of fs.readdirSync(stagingDir)) {
        commitStaging(path.join(stagingDir, item), path.join(targetDir, item));
      }

      // 6. Clean up staging directory
      fs.rmSync(stagingDir, { recursive: true, force: true });
      return true;
    } catch (err: any) {
      console.warn(
        `[Platform] Warning: Migration from ${legacyDir} to ${targetDir} encountered an error: ${err.message}. Legacy data was preserved intact.`
      );
      if (fs.existsSync(stagingDir)) {
        try {
          fs.rmSync(stagingDir, { recursive: true, force: true });
        } catch {}
      }
      return false;
    } finally {
      if (acquiredLock && fs.existsSync(lockFile)) {
        try {
          fs.unlinkSync(lockFile);
        } catch {}
      }
    }
  }

  /**
   * Calculate precise Linux process start time in milliseconds since Unix epoch
   * using /proc/<pid>/stat starttime ticks, /proc/stat btime, and system clock ticks (100 Hz).
   * Fallback to /proc/<pid> directory inode ctime if /proc/stat btime is unavailable.
   * Handles process comm names with spaces and parentheses by indexing from the last ')'.
   */
  public static getLinuxProcessStartTimeMs(pid: number): number | null {
    try {
      if (fs.existsSync(`/proc/${pid}/stat`)) {
        const statContent = fs.readFileSync(`/proc/${pid}/stat`, 'utf-8');
        const closeParenIdx = statContent.lastIndexOf(')');
        if (closeParenIdx !== -1) {
          const rest = statContent.slice(closeParenIdx + 1).trim().split(/\s+/);
          // field 22 is index 19 (0-based) after closing parenthesis
          const starttimeTicks = Number(rest[19]);
          if (Number.isFinite(starttimeTicks)) {
            try {
              const statFile = fs.readFileSync('/proc/stat', 'utf-8');
              const btimeLine = statFile.split('\n').find((l) => l.startsWith('btime '));
              if (btimeLine) {
                const btimeSeconds = Number(btimeLine.split(' ')[1]);
                if (Number.isFinite(btimeSeconds)) {
                  // Standard Linux clock ticks frequency is 100 Hz
                  return btimeSeconds * 1000 + Math.round((starttimeTicks / 100) * 1000);
                }
              }
            } catch {}
          }
        }
      }

      // Robust fallback: Kernel sets /proc/<pid> directory ctime to process creation time
      if (fs.existsSync(`/proc/${pid}`)) {
        const stat = fs.statSync(`/proc/${pid}`);
        return Math.round(stat.ctimeMs || stat.mtimeMs);
      }
      return null;
    } catch {
      try {
        if (fs.existsSync(`/proc/${pid}`)) {
          return Math.round(fs.statSync(`/proc/${pid}`).ctimeMs);
        }
      } catch {}
      return null;
    }
  }

  /**
   * Cross-platform helper to retrieve process start time in milliseconds since Unix epoch.
   * On Windows, uses Win32_Process CreationDate.
   * On Linux, uses /proc/<pid>/stat kernel starttime or /proc/<pid> ctime.
   */
  public static getProcessStartTimeMs(pid: number): number | null {
    if (this.isWindows()) {
      try {
        const psCmd = `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object @{N='Epoch';E={[DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds()}} | ConvertTo-Json -Compress`;
        const out = execSync(`powershell -NoProfile -NonInteractive -Command "${psCmd}"`, {
          encoding: 'utf-8',
          timeout: 4000,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        if (out) {
          const parsed = JSON.parse(out);
          const epoch = typeof parsed.Epoch === 'number' ? parsed.Epoch : Number(parsed.Epoch);
          if (Number.isFinite(epoch)) return epoch;
        }
      } catch {}
      return null;
    } else {
      return this.getLinuxProcessStartTimeMs(pid);
    }
  }

  /**
   * Structurally verify process ownership using full executable path,
   * process creation timestamp, and normalized config path.
   * Protects against PID reuse attacks where an unrelated process reuses a stale PID.
   * Fails closed whenever process identity cannot be definitively established.
   */
  public static verifyProcessOwnership(record: ProcessOwnershipRecord): boolean {
    // 1. Reject incomplete ownership records (Fail closed)
    if (
      !record ||
      !Number.isSafeInteger(record.pid) ||
      record.pid <= 0 ||
      !record.ownerId ||
      typeof record.ownerId !== 'string' ||
      !record.executablePath ||
      typeof record.executablePath !== 'string' ||
      typeof record.startedAt !== 'number' ||
      record.startedAt <= 0
    ) {
      return false;
    }

    if (!this.isProcessAlive(record.pid)) {
      return false;
    }

    if (this.isWindows()) {
      try {
        const psCmd = `Get-CimInstance Win32_Process -Filter "ProcessId = ${record.pid}" | Select-Object ProcessId, ExecutablePath, CommandLine, @{N='CreationEpoch';E={[DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds()}} | ConvertTo-Json -Compress`;
        const out = execSync(`powershell -NoProfile -NonInteractive -Command "${psCmd}"`, {
          encoding: 'utf-8',
          timeout: 4000,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore']
        }).trim();

        if (!out) return false;
        const info = JSON.parse(out);

        // A. Validate PID match
        if (Number(info.ProcessId) !== record.pid) {
          return false;
        }

        // B. Validate ExecutablePath (exact normalized path comparison - no basename fallback)
        if (!info.ExecutablePath) return false;
        const normalizedActualExe = path.normalize(info.ExecutablePath).toLowerCase();
        const normalizedExpectedExe = path.normalize(path.resolve(record.executablePath)).toLowerCase();
        if (normalizedActualExe !== normalizedExpectedExe) {
          return false;
        }

        // C. Compare process creation time against persisted timestamp (bounded tolerance: ±30000ms)
        if (info.CreationEpoch && typeof info.CreationEpoch === 'number') {
          const timeDiff = Math.abs(info.CreationEpoch - record.startedAt);
          if (timeDiff > 30000) {
            return false;
          }
        } else {
          return false;
        }

        // D. Validate exact normalized active configuration path in the command line
        const cmdLine = (info.CommandLine || '').toLowerCase();
        if (record.configPath) {
          const normalizedConfig = path.normalize(path.resolve(record.configPath)).toLowerCase();
          const normalizedConfigForward = normalizedConfig.replace(/\\/g, '/');
          const normalizedConfigBack = normalizedConfig.replace(/\//g, '\\');
          const relConfig = path.normalize(record.configPath).toLowerCase();
          const relConfigForward = relConfig.replace(/\\/g, '/');
          const relConfigBack = relConfig.replace(/\//g, '\\');
          const relToRoot = path.relative(this.getProjectRoot(), record.configPath).toLowerCase();
          const relToRootForward = relToRoot.replace(/\\/g, '/');
          const relToRootBack = relToRoot.replace(/\//g, '\\');

          const cmdLineForward = cmdLine.replace(/\\/g, '/');

          const configMatched =
            cmdLineForward.includes(normalizedConfigForward) ||
            cmdLine.includes(normalizedConfigBack) ||
            cmdLineForward.includes(relConfigForward) ||
            cmdLine.includes(relConfigBack) ||
            cmdLineForward.includes(relToRootForward) ||
            cmdLine.includes(relToRootBack);

          if (!configMatched) {
            return false;
          }
        }

        if (record.commandLinePattern) {
          if (!cmdLine.includes(record.commandLinePattern.toLowerCase())) {
            return false;
          }
        }

        return true;
      } catch {
        return false;
      }
    } else {
      try {
        const procDir = `/proc/${record.pid}`;
        if (!fs.existsSync(procDir)) return false;

        // A. Validate Executable symlink (/proc/<pid>/exe) - exact normalized path match, no basename fallback
        const exeLink = path.join(procDir, 'exe');
        if (!fs.existsSync(exeLink)) return false;
        const actualExe = fs.readlinkSync(exeLink);
        let normalizedActualExe = path.resolve(actualExe);
        let normalizedExpectedExe = path.resolve(record.executablePath);
        try {
          if (fs.existsSync(normalizedActualExe)) normalizedActualExe = fs.realpathSync(normalizedActualExe);
          if (fs.existsSync(normalizedExpectedExe)) normalizedExpectedExe = fs.realpathSync(normalizedExpectedExe);
        } catch {}
        if (normalizedActualExe !== normalizedExpectedExe) {
          return false;
        }

        // B. Validate process creation identity / start time via /proc/<pid>/stat field 22
        const kernelStartMs = this.getLinuxProcessStartTimeMs(record.pid);
        if (!kernelStartMs) return false;
        const timeDiff = Math.abs(kernelStartMs - record.startedAt);
        if (timeDiff > 30000) {
          return false;
        }

        // C. Validate command line (/proc/<pid>/cmdline)
        const cmdlineFile = path.join(procDir, 'cmdline');
        if (!fs.existsSync(cmdlineFile)) return false;
        const cmdlineRaw = fs.readFileSync(cmdlineFile, 'utf-8');
        if (!cmdlineRaw || cmdlineRaw.length === 0) {
          return false; // Fail closed if unavailable or empty
        }

        const cmdlineArgs = cmdlineRaw.split('\0').filter(Boolean);
        const cmdlineJoined = cmdlineArgs.join(' ');

        if (record.configPath) {
          const normalizedConfig = path.resolve(record.configPath);
          let realConfig = normalizedConfig;
          try {
            if (fs.existsSync(normalizedConfig)) realConfig = fs.realpathSync(normalizedConfig);
          } catch {}

          const configArgFound = cmdlineArgs.some((arg) => {
            try {
              const cleanedArg = arg.replace(/^--?[a-zA-Z0-9_-]+=/, '');
              const resolvedArg = path.resolve(cleanedArg);
              let realArg = resolvedArg;
              try {
                if (fs.existsSync(resolvedArg)) realArg = fs.realpathSync(resolvedArg);
              } catch {}
              return (
                resolvedArg === normalizedConfig ||
                realArg === realConfig ||
                arg === record.configPath ||
                arg.includes(normalizedConfig) ||
                arg.includes(realConfig)
              );
            } catch {
              return false;
            }
          });

          if (
            !configArgFound &&
            !cmdlineJoined.includes(normalizedConfig) &&
            !cmdlineJoined.includes(realConfig) &&
            !cmdlineJoined.includes(record.configPath)
          ) {
            return false;
          }
        }

        if (record.commandLinePattern) {
          if (!cmdlineJoined.toLowerCase().includes(record.commandLinePattern.toLowerCase())) {
            return false;
          }
        }

        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Terminate a process and its process tree reliably across operating systems.
   * Implements cooperative termination first, bounded timeout, and forceful cleanup only when needed.
   * Validates process ownership immediately before both cooperative and forceful termination.
   */
  public static async terminateProcess(
    pid: number,
    options?: {
      ownershipRecord?: ProcessOwnershipRecord;
      expectedNames?: string[];
      timeoutMs?: number;
      force?: boolean;
    }
  ): Promise<boolean> {
    if (!pid || pid <= 0 || pid === process.pid) return true;
    if (!this.isProcessAlive(pid)) return true;

    const timeoutMs = options?.timeoutMs !== undefined ? options.timeoutMs : 800;

    // Strict ownership verification immediately before termination
    if (options?.ownershipRecord) {
      const isOwner = this.verifyProcessOwnership(options.ownershipRecord);
      if (!isOwner) {
        console.warn(
          `[Platform] Warning: PID ${pid} failed ownership verification. Refusing to terminate to prevent collateral damage.`
        );
        return false;
      }
    } else if (options?.expectedNames && options.expectedNames.length > 0) {
      const isTarget = this.isTargetProcess(pid, options.expectedNames);
      if (!isTarget) {
        console.warn(
          `[Platform] Warning: PID ${pid} does not match expected target processes (${options.expectedNames.join(
            ', '
          )}). Skipping termination to prevent PID reuse collateral damage.`
        );
        return false;
      }
    }

    if (this.isWindows()) {
      // Step 1: Attempt cooperative termination
      // Note: taskkill without /F delivers WM_CLOSE to windowed processes.
      // Console applications without message pumps ignore WM_CLOSE.
      // We allow a bounded wait window before escalating.
      if (!options?.force) {
        try {
          execSync(`taskkill /pid ${pid} /t`, { stdio: 'ignore', timeout: 2000, windowsHide: true });
        } catch {
          // Process may not respond to WM_CLOSE
        }

        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (!this.isProcessAlive(pid)) return true;
          await new Promise((r) => setTimeout(r, 50));
        }
      }

      // Step 2: Forceful termination fallback with re-verification
      if (this.isProcessAlive(pid)) {
        // Re-verify process identity immediately before forceful kill to prevent killing a recycled PID
        if (options?.ownershipRecord) {
          if (!this.verifyProcessOwnership(options.ownershipRecord)) {
            console.warn(`[Platform] Warning: PID ${pid} changed identity before forceful kill. Aborting termination.`);
            return false;
          }
        } else if (options?.expectedNames && options.expectedNames.length > 0) {
          if (!this.isTargetProcess(pid, options.expectedNames)) {
            console.warn(`[Platform] Warning: PID ${pid} image name changed before forceful kill. Aborting termination.`);
            return false;
          }
        }

        try {
          execSync(`taskkill /pid ${pid} /t /f`, { stdio: 'ignore', timeout: 3000, windowsHide: true });
        } catch {
          try {
            process.kill(pid);
          } catch {}
        }
      }

      return !this.isProcessAlive(pid);
    } else {
      // Step 1: POSIX SIGTERM for graceful shutdown
      if (!options?.force) {
        try {
          process.kill(pid, 'SIGTERM');
        } catch {}

        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (!this.isProcessAlive(pid)) return true;
          await new Promise((r) => setTimeout(r, 50));
        }
      }

      // Step 2: POSIX SIGKILL fallback with re-verification
      if (this.isProcessAlive(pid)) {
        if (options?.ownershipRecord) {
          if (!this.verifyProcessOwnership(options.ownershipRecord)) {
            console.warn(`[Platform] Warning: PID ${pid} changed identity before forceful kill. Aborting SIGKILL.`);
            return false;
          }
        } else if (options?.expectedNames && options.expectedNames.length > 0) {
          if (!this.isTargetProcess(pid, options.expectedNames)) {
            return false;
          }
        }

        try {
          process.kill(pid, 'SIGKILL');
        } catch {}
      }

      return !this.isProcessAlive(pid);
    }
  }
}
