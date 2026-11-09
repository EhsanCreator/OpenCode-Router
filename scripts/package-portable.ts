import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { Platform } from '../src/backend/platform/platform';
import { ensureSecureDirectory } from '../src/backend/security/file-guard';

async function main() {
  console.log('==========================================================');
  console.log('📦 OpenCode Router — Portable Windows Release Packager');
  console.log('==========================================================\n');

  const projectRoot = Platform.getProjectRoot();
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
  const version = pkg.version || '1.0.0';

  const releaseDir = path.join(projectRoot, 'dist-release');
  ensureSecureDirectory(releaseDir);

  const stagingName = `OpenCode-Router-v${version}-windows-x64`;
  const stagingDir = path.join(releaseDir, stagingName);

  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  ensureSecureDirectory(stagingDir);

  console.log(`1. Staging portable release files in: ${stagingDir}`);

  // 1. Build native launcher if on Windows and csc is available
  if (Platform.isWindows()) {
    const buildLauncherScript = path.join(projectRoot, 'scripts', 'windows', 'build-launcher.ps1');
    if (fs.existsSync(buildLauncherScript)) {
      console.log('1b. Compiling native Windows launcher (opencode-vpn.exe)...');
      try {
        execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${buildLauncherScript}"`, {
          cwd: projectRoot,
          stdio: 'inherit'
        });
      } catch (err: any) {
        console.warn('Warning: Could not build native launcher automatically:', err.message);
      }
    }
  }

  // 2. Compile frontend
  console.log('2. Verifying frontend production build...');
  execSync('npm run build:frontend', { cwd: projectRoot, stdio: 'inherit' });

  // 2. Copy source and runtime files
  const itemsToCopy = [
    { src: 'package.json', dest: 'package.json' },
    { src: 'package-lock.json', dest: 'package-lock.json' },
    { src: 'tsconfig.json', dest: 'tsconfig.json' },
    { src: 'README.md', dest: 'README.md' },
    { src: 'LICENSE', dest: 'LICENSE' },
    { src: 'src', dest: 'src' },
    { src: 'bin', dest: 'bin' },
    { src: 'scripts', dest: 'scripts' }
  ];

  for (const item of itemsToCopy) {
    const fullSrc = path.join(projectRoot, item.src);
    const fullDest = path.join(stagingDir, item.dest);
    if (fs.existsSync(fullSrc)) {
      const stat = fs.statSync(fullSrc);
      if (stat.isDirectory()) {
        fs.cpSync(fullSrc, fullDest, {
          recursive: true,
          filter: (src) => {
            // Ignore node_modules, temp files, and caches
            return !src.includes('node_modules') && !src.includes('.git') && !src.includes('.cache');
          }
        });
      } else {
        fs.copyFileSync(fullSrc, fullDest);
      }
    }
  }

  // Add a convenient top-level Start-Router.bat in the root of the portable package
  const rootLauncherBat = `@echo off
rem ============================================================================
rem OpenCode Router - Windows Quick Start Launcher
rem ============================================================================
cd /d "%~dp0"
if not exist "node_modules" (
    echo [OpenCode Router] First-time setup: Installing dependencies...
    call npm install --omit=dev
)
echo [OpenCode Router] Starting backend server and web dashboard...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts/windows/start.ps1"
`;
  fs.writeFileSync(path.join(stagingDir, 'Start-Router.bat'), rootLauncherBat, 'utf-8');

  // Add QuickStart guide
  const quickStartTxt = `==========================================================
OpenCode Router v${version} - Native Windows Portable Edition
==========================================================

Prerequisites (Host Machine):
  1. Node.js 20.19+ or 22.12+ (https://nodejs.org) [Required for Vite 8 / Server runtime]
  2. OpenCode CLI: npm install -g opencode-ai

Note on Architecture:
  Node.js runtime itself is NOT bundled in this portable distribution.
  First run executes 'npm install --omit=dev' to compile/link native C++
  SQLite bindings specifically for the host Windows architecture (x64).

Quick Start:
  1. Double-click 'Start-Router.bat' or run:
     powershell -File scripts/windows/start.ps1

  2. Open the Web Dashboard:
     http://127.0.0.1:3000

  3. Find and activate a working proxy node.

  4. Open any terminal (PowerShell, Windows Terminal, or CMD) and run:
     opencode-vpn
     opencode-vpn run "Explain this project"

For full installation, Desktop shortcuts, and PATH integration:
  powershell -ExecutionPolicy Bypass -File scripts/windows/install.ps1
`;
  fs.writeFileSync(path.join(stagingDir, 'QUICKSTART.txt'), quickStartTxt, 'utf-8');

  // 3. Compress staging directory into ZIP
  const zipFile = path.join(releaseDir, `${stagingName}.zip`);
  if (fs.existsSync(zipFile)) {
    fs.unlinkSync(zipFile);
  }

  console.log(`3. Creating standalone ZIP archive: ${zipFile}`);
  try {
    if (Platform.isWindows()) {
      execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${stagingDir}\\*' -DestinationPath '${zipFile}' -Force"`, { stdio: 'inherit' });
    } else {
      execSync(`python3 -c "import shutil; shutil.make_archive(r'${path.join(releaseDir, stagingName)}', 'zip', r'${stagingDir}')"`, { stdio: 'inherit' });
    }
    console.log(`\n🎉 Portable Windows distribution created successfully!`);
    console.log(`   Location: ${zipFile}`);
    const sizeMb = (fs.statSync(zipFile).size / (1024 * 1024)).toFixed(2);
    console.log(`   Size:     ${sizeMb} MB\n`);

    // 4. Compute SHA256 checksum and write build manifest
    const crypto = require('crypto');
    const fileBuffer = fs.readFileSync(zipFile);
    const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    console.log(`   SHA256:   ${sha256}`);

    const manifest = {
      name: stagingName,
      version: version,
      targetPlatform: 'win32',
      targetArch: 'x64',
      fileName: `${stagingName}.zip`,
      fileSizeBytes: fs.statSync(zipFile).size,
      fileSizeMb: parseFloat(sizeMb),
      sha256: sha256,
      builtAt: new Date().toISOString(),
      contains: {
        xrayExe: fs.existsSync(path.join(stagingDir, 'bin', 'xray.exe')),
        geoipDat: fs.existsSync(path.join(stagingDir, 'bin', 'geoip.dat')),
        geositeDat: fs.existsSync(path.join(stagingDir, 'bin', 'geosite.dat')),
        launcherExe: fs.existsSync(path.join(stagingDir, 'bin', 'opencode-vpn.exe')),
        launcherCs: fs.existsSync(path.join(stagingDir, 'src', 'launcher', 'opencode-vpn-launcher.cs')),
        buildLauncherPs1: fs.existsSync(path.join(stagingDir, 'scripts', 'windows', 'build-launcher.ps1')),
        verifyReleasePs1: fs.existsSync(path.join(stagingDir, 'scripts', 'windows', 'verify-release.ps1')),
        cmdLauncher: fs.existsSync(path.join(stagingDir, 'bin', 'opencode-vpn.cmd')),
        psLauncher: fs.existsSync(path.join(stagingDir, 'bin', 'opencode-vpn.ps1')),
        startBat: fs.existsSync(path.join(stagingDir, 'Start-Router.bat')),
        frontendDist: fs.existsSync(path.join(stagingDir, 'src', 'frontend', 'dist', 'index.html'))
      }
    };

    const manifestPath = path.join(releaseDir, `${stagingName}.manifest.json`);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    console.log(`   Manifest: ${manifestPath}\n`);
  } catch (err: any) {
    console.error('Failed to compress portable archive:', err.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Packaging failed:', err);
  process.exit(1);
});
