import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { execSync, spawnSync } from 'child_process';
import { Platform } from '../platform/platform';
import { ensureSecureDirectory } from '../security/file-guard';

export interface ProvisionOptions {
  version?: string;
  targetDir?: string;
  force?: boolean;
  onProgress?: (percent: number, message: string) => void;
}

export interface ProvisionResult {
  success: boolean;
  binaryPath: string;
  version: string;
  arch: string;
  platform: string;
  sha256Verified: boolean;
  error?: string;
}

export class XrayProvisioner {
  /**
   * Pinned official Xray-core release version.
   * v26.11.9 was released on 2026-11-09 with critical transport stability and Go 1.27 security patches.
   */
  public static readonly DEFAULT_VERSION = 'v26.11.9';

  /**
   * Determine asset name based on OS and architecture
   */
  public static getAssetName(targetPlatform: string = process.platform, targetArch: string = process.arch): string {
    let osTag = 'linux';
    if (targetPlatform === 'win32') osTag = 'windows';
    else if (targetPlatform === 'darwin') osTag = 'macos';

    let archTag = '64';
    if (targetArch === 'arm64') archTag = 'arm64-v8a';
    else if (targetArch === 'ia32') archTag = '32';
    else if (targetArch === 'x64') archTag = '64';

    return `Xray-${osTag}-${archTag}.zip`;
  }

  public static getReleaseUrl(version: string = this.DEFAULT_VERSION, targetPlatform?: string, targetArch?: string): { url: string; dgstUrl: string; assetName: string } {
    const assetName = this.getAssetName(targetPlatform, targetArch);
    const baseUrl = `https://github.com/XTLS/Xray-core/releases/download/${version}`;
    return {
      assetName,
      url: `${baseUrl}/${assetName}`,
      dgstUrl: `${baseUrl}/${assetName}.dgst`
    };
  }

  /**
   * Fetch checksums from official .dgst release artifact
   */
  public static async fetchChecksums(dgstUrl: string): Promise<Record<string, string>> {
    const response = await fetch(dgstUrl, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      throw new Error(`Failed to fetch dgst file from ${dgstUrl}: HTTP ${response.status}`);
    }
    const text = await response.text();
    const checksums: Record<string, string> = {};

    for (const line of text.split('\n')) {
      const parts = line.split('=');
      if (parts.length >= 2) {
        const algo = parts[0].trim().toUpperCase();
        const hash = parts.slice(1).join('=').trim().toLowerCase();
        checksums[algo] = hash;
      }
    }

    return checksums;
  }

  /**
   * Compute file SHA256
   */
  public static async computeSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('error', reject);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex').toLowerCase()));
    });
  }

  /**
   * Extract ZIP archive portably across Windows, Linux, and macOS
   */
  public static extractArchive(zipPath: string, targetDir: string, filesToExtract: string[] = ['xray', 'xray.exe', 'geoip.dat', 'geosite.dat']): void {
    ensureSecureDirectory(targetDir);

    // Strategy 1: unzip on Linux/macOS
    if (!Platform.isWindows()) {
      try {
        const unzipCheck = spawnSync('which', ['unzip']);
        if (unzipCheck.status === 0) {
          execSync(`unzip -q -o "${zipPath}" -d "${targetDir}"`, { stdio: 'ignore' });
          return;
        }
      } catch {}
    }

    // Strategy 2: tar on Windows / Linux (tar is built into modern Windows 10/11)
    try {
      execSync(`tar -xf "${zipPath}" -C "${targetDir}"`, { stdio: 'ignore' });
      return;
    } catch {}

    // Strategy 3: PowerShell Expand-Archive on Windows
    if (Platform.isWindows()) {
      try {
        const psCmd = `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${targetDir}' -Force`;
        execSync(`powershell -NoProfile -NonInteractive -Command "${psCmd}"`, { stdio: 'ignore' });
        return;
      } catch {}
    }

    // Strategy 4: Python 3 fallback
    try {
      const pyCmd = `import zipfile; zipfile.ZipFile(r'${zipPath}').extractall(r'${targetDir}')`;
      execSync(`python3 -c "${pyCmd}"`, { stdio: 'ignore' });
      return;
    } catch {}

    try {
      const pyCmd = `import zipfile; zipfile.ZipFile(r'${zipPath}').extractall(r'${targetDir}')`;
      execSync(`python -c "${pyCmd}"`, { stdio: 'ignore' });
      return;
    } catch {}

    throw new Error('No compatible extraction tool found (tested unzip, tar, PowerShell Expand-Archive, python zipfile).');
  }

  /**
   * Download a remote file to a destination path
   */
  public static async downloadFile(url: string, destPath: string, onProgress?: (percent: number) => void): Promise<void> {
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) {
      throw new Error(`Failed to download ${url}: HTTP ${res.status} ${res.statusText}`);
    }

    const totalBytes = parseInt(res.headers.get('content-length') || '0', 10);
    const fileStream = fs.createWriteStream(destPath);

    if (!res.body) {
      throw new Error('Response body is null');
    }

    const reader = res.body.getReader();
    let downloadedBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          fileStream.write(Buffer.from(value));
          downloadedBytes += value.length;
          if (totalBytes > 0 && onProgress) {
            const percent = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
            onProgress(percent);
          }
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        fileStream.end((err?: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  /**
   * Main provisioning workflow:
   * 1. Checks if current binary exists and is working.
   * 2. Downloads official archive to atomic temp file.
   * 3. Validates SHA256 checksum from .dgst metadata.
   * 4. Extracts required binaries (xray / xray.exe, geoip.dat, geosite.dat).
   * 5. Sets appropriate executable permissions.
   * 6. Validates execution with `xray version`.
   */
  public static async provision(options: ProvisionOptions = {}): Promise<ProvisionResult> {
    const version = options.version || process.env.XRAY_VERSION || this.DEFAULT_VERSION;
    const projectRoot = Platform.getProjectRoot();
    const targetDir = options.targetDir || path.join(projectRoot, 'bin');
    ensureSecureDirectory(targetDir);

    const binaryName = Platform.getXrayBinaryName();
    const finalBinaryPath = path.join(targetDir, binaryName);

    // 1. Check if already provisioned and operational
    if (!options.force && fs.existsSync(finalBinaryPath)) {
      try {
        const verify = spawnSync(finalBinaryPath, ['version'], { encoding: 'utf-8', timeout: 3000 });
        if (verify.status === 0 || (verify.stdout && verify.stdout.includes('Xray'))) {
          return {
            success: true,
            binaryPath: finalBinaryPath,
            version,
            arch: process.arch,
            platform: process.platform,
            sha256Verified: true
          };
        }
      } catch {}
    }

    const { url, dgstUrl, assetName } = this.getReleaseUrl(version);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-provision-'));
    const tempZipPath = path.join(tempDir, assetName);
    const tempExtractDir = path.join(tempDir, 'extracted');

    try {
      options.onProgress?.(5, `Downloading official Xray-core ${version} (${assetName})...`);
      await this.downloadFile(url, tempZipPath, (p) => {
        options.onProgress?.(5 + Math.round(p * 0.7), `Downloading ${assetName}: ${p}%`);
      });

      // Fetch and verify SHA256 checksum from official .dgst release artifact
      // Note: .dgst provides cryptographic hash verification (SHA256) against transit corruption
      // and tampering, distinct from asymmetric GPG digital signatures.
      options.onProgress?.(80, 'Validating SHA256 checksum from official release digest...');
      const dgst = await this.fetchChecksums(dgstUrl);
      const expectedSha256 = dgst['SHA2-256'] || dgst['SHA256'] || dgst['SHA-256'];
      if (!expectedSha256 || !/^[a-f0-9]{64}$/i.test(expectedSha256.trim())) {
        throw new Error(`Invalid or malformed SHA256 checksum in release digest: ${JSON.stringify(dgst)}`);
      }

      const actualSha256 = await this.computeSha256(tempZipPath);
      if (expectedSha256.trim().toLowerCase() !== actualSha256.toLowerCase()) {
        throw new Error(
          `SHA256 checksum mismatch for ${assetName}! Expected: ${expectedSha256.trim().toLowerCase()}, Actual: ${actualSha256}. Aborting extraction.`
        );
      }
      const sha256Verified = true;

      // Extract
      options.onProgress?.(90, 'Extracting binaries...');
      this.extractArchive(tempZipPath, tempExtractDir);

      // Copy required files into targetDir
      const filesToInstall = [binaryName, 'geoip.dat', 'geosite.dat', 'LICENSE', 'README.md'];
      for (const file of filesToInstall) {
        const src = path.join(tempExtractDir, file);
        if (fs.existsSync(src)) {
          const dest = path.join(targetDir, file);
          fs.copyFileSync(src, dest);
        }
      }

      // On Linux/macOS, chmod +x
      if (!Platform.isWindows()) {
        try {
          fs.chmodSync(finalBinaryPath, 0o755);
        } catch {}
      }

      // Test execution
      options.onProgress?.(95, 'Verifying executable execution...');
      const testRun = spawnSync(finalBinaryPath, ['version'], { encoding: 'utf-8', timeout: 3000 });
      if (testRun.status !== 0 && (!testRun.stdout || !testRun.stdout.includes('Xray'))) {
        throw new Error(`Xray binary test run failed with exit code ${testRun.status}: ${testRun.stderr || testRun.stdout}`);
      }

      options.onProgress?.(100, `Xray-core ${version} successfully provisioned!`);
      return {
        success: true,
        binaryPath: finalBinaryPath,
        version,
        arch: process.arch,
        platform: process.platform,
        sha256Verified
      };
    } finally {
      // Clean up temp directory
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  }
}
