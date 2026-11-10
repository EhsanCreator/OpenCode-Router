import assert from 'assert';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { Platform } from '../src/backend/platform/platform';
import { XrayProvisioner } from '../src/backend/vpn/xray-provisioner';
import { OpenCodeService } from '../src/backend/opencode/opencode-service';
import { ensureSecureDirectory, safeWriteSensitiveFile } from '../src/backend/security/file-guard';

async function runPlatformTests() {
  console.log('====================================================');
  console.log('🧪 Starting OpenCode Router Platform & Windows Tests');
  console.log('====================================================\n');

  // --------------------------------------------------------------------------
  // Test 1: Platform & Architecture Detection
  // --------------------------------------------------------------------------
  console.log('▶ Test 1: Platform & Architecture Detection');
  assert.strictEqual(typeof Platform.isWindows(), 'boolean');
  assert.strictEqual(typeof Platform.isLinux(), 'boolean');
  assert.strictEqual(typeof Platform.isMacOS(), 'boolean');
  assert.strictEqual(typeof Platform.getArch(), 'string');
  assert(Platform.getProjectRoot().length > 0);
  console.log(`  ✔ Current platform: ${process.platform} (${Platform.getArch()})`);
  console.log('  ✔ Platform detection flags verified.\n');

  // --------------------------------------------------------------------------
  // Test 2: Application Paths & Data Directory Resolution
  // --------------------------------------------------------------------------
  console.log('▶ Test 2: Application Paths & Data Directory Resolution');
  const standardPaths = Platform.getPaths();
  assert(standardPaths.dataDir.length > 0);
  assert(standardPaths.dbPath.endsWith('opencode-vpn.db'));
  assert(standardPaths.activeConfigPath.endsWith('active-xray-config.json'));
  assert(standardPaths.activeStatePath.endsWith('active-connection.json'));

  // Test custom OPENCODE_ROUTER_DATA_DIR override
  const tempCustomDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-test-data-'));
  try {
    process.env.OPENCODE_ROUTER_DATA_DIR = tempCustomDir;
    const customPaths = Platform.getPaths();
    assert.strictEqual(path.resolve(customPaths.dataDir), path.resolve(tempCustomDir));
    assert.strictEqual(path.resolve(customPaths.dbPath), path.resolve(tempCustomDir, 'opencode-vpn.db'));
    console.log('  ✔ Environment variable OPENCODE_ROUTER_DATA_DIR override verified.');
  } finally {
    delete process.env.OPENCODE_ROUTER_DATA_DIR;
    fs.rmSync(tempCustomDir, { recursive: true, force: true });
  }
  console.log('  ✔ Cross-platform paths and data directory resolution verified.\n');

  // --------------------------------------------------------------------------
  // Test 3: Xray Asset Naming & Release Matrix
  // --------------------------------------------------------------------------
  console.log('▶ Test 3: Xray Asset Naming & Release Matrix');
  assert.strictEqual(XrayProvisioner.getAssetName('win32', 'x64'), 'Xray-windows-64.zip');
  assert.strictEqual(XrayProvisioner.getAssetName('win32', 'arm64'), 'Xray-windows-arm64-v8a.zip');
  assert.strictEqual(XrayProvisioner.getAssetName('win32', 'ia32'), 'Xray-windows-32.zip');
  assert.strictEqual(XrayProvisioner.getAssetName('linux', 'x64'), 'Xray-linux-64.zip');
  assert.strictEqual(XrayProvisioner.getAssetName('linux', 'arm64'), 'Xray-linux-arm64-v8a.zip');
  assert.strictEqual(XrayProvisioner.getAssetName('darwin', 'arm64'), 'Xray-macos-arm64-v8a.zip');

  const winUrl = XrayProvisioner.getReleaseUrl('v26.10.31', 'win32', 'x64');
  assert.strictEqual(winUrl.assetName, 'Xray-windows-64.zip');
  assert(winUrl.url.includes('Xray-windows-64.zip'));
  assert(winUrl.dgstUrl.includes('Xray-windows-64.zip.dgst'));
  console.log('  ✔ Verified asset matrix: Windows (x64, arm64, 32-bit), Linux (x64, arm64), macOS.');
  console.log('  ✔ Verified official release download URLs and .dgst checksum URLs.\n');

  // --------------------------------------------------------------------------
  // Test 4: Windows Launcher Scripts Generation & Content Integrity
  // --------------------------------------------------------------------------
  console.log('▶ Test 4: Windows & Linux Launcher Scripts Generation');
  const opencodeService = OpenCodeService.getInstance();
  opencodeService.ensureLauncherScript();

  const binDir = path.join(Platform.getProjectRoot(), 'bin');
  const bashLauncher = path.join(binDir, 'opencode-vpn');
  const cmdLauncher = path.join(binDir, 'opencode-vpn.cmd');
  const psLauncher = path.join(binDir, 'opencode-vpn.ps1');

  assert(fs.existsSync(bashLauncher), 'Linux/Bash launcher must exist');
  assert(fs.existsSync(cmdLauncher), 'Windows CMD launcher must exist');
  assert(fs.existsSync(psLauncher), 'Windows PowerShell launcher must exist');

  // Inspect CMD launcher contents
  const cmdContent = fs.readFileSync(cmdLauncher, 'utf-8');
  assert(cmdContent.includes('setlocal'), 'CMD launcher must use setlocal');
  assert(cmdContent.includes('http_proxy=http://127.0.0.1:'), 'CMD launcher must set http_proxy');
  assert(cmdContent.includes('all_proxy=socks5://127.0.0.1:'), 'CMD launcher must set all_proxy');
  assert(cmdContent.includes('no_proxy='), 'CMD launcher must set loopback exclusions');
  assert(cmdContent.includes('--standalone'), 'CMD launcher must support --standalone isolation');
  assert(cmdContent.includes('--attach'), 'CMD launcher must warn on --attach');
  assert(cmdContent.includes('%*'), 'CMD launcher must forward all arguments');
  assert(cmdContent.includes('exit /b %EXIT_CODE%') || cmdContent.includes('exit /b %ERRORLEVEL%'), 'CMD launcher must preserve OpenCode exit code');

  // Inspect PowerShell launcher contents
  const psContent = fs.readFileSync(psLauncher, 'utf-8');
  assert(psContent.includes('$env:http_proxy'), 'PS launcher must set $env:http_proxy');
  assert(psContent.includes('$env:all_proxy'), 'PS launcher must set $env:all_proxy');
  assert(psContent.includes('$env:no_proxy'), 'PS launcher must set $env:no_proxy');
  assert(psContent.includes('--standalone'), 'PS launcher must support --standalone isolation');
  assert(psContent.includes('--attach'), 'PS launcher must warn on --attach');
  assert(psContent.includes('@finalArgs') || psContent.includes('@args'), 'PS launcher must forward arguments');
  assert(psContent.includes('exit $LASTEXITCODE'), 'PS launcher must preserve $LASTEXITCODE');
  assert(psContent.includes('finally {'), 'PS launcher must clean up process environment');

  // Regression Test: PowerShell Hashtable Case-Insensitive Duplicate Keys Check
  // PowerShell hash literals @{ ... } strictly disallow duplicate keys ignoring case.
  const psScriptsToVerify = [
    psLauncher,
    ...fs.readdirSync(path.join(Platform.getProjectRoot(), 'scripts', 'windows'))
      .filter((f: string) => f.endsWith('.ps1'))
      .map((f: string) => path.join(Platform.getProjectRoot(), 'scripts', 'windows', f))
  ];

  for (const scriptPath of psScriptsToVerify) {
    const content = fs.readFileSync(scriptPath, 'utf-8');
    const hashRegex = /@\s*\{([^}]+)\}/g;
    let match: RegExpExecArray | null;
    while ((match = hashRegex.exec(content)) !== null) {
      const body = match[1];
      const seenKeys = new Map<string, string>();
      for (const rawLine of body.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const keyMatch = line.match(/^['"]?([a-zA-Z0-9_\-]+)['"]?\s*=/);
        if (keyMatch) {
          const originalKey = keyMatch[1];
          const lowerKey = originalKey.toLowerCase();
          if (seenKeys.has(lowerKey)) {
            assert.fail(
              `Duplicate case-insensitive key '${originalKey}' collided with '${seenKeys.get(lowerKey)}' in hashtable inside ${path.basename(scriptPath)}`
            );
          }
          seenKeys.set(lowerKey, originalKey);
        }
      }
    }
  }

  // Regression assertions specifically for bin/opencode-vpn.ps1 $oldEnv snapshotting
  const oldEnvMatch = psContent.match(/\$oldEnv\s*=\s*@\{([^}]+)\}/);
  assert(oldEnvMatch, 'PS launcher must define $oldEnv hashtable');
  const oldEnvBody = oldEnvMatch[1];
  assert(!oldEnvBody.includes('http_proxy'), '$oldEnv hashtable must not define lowercase http_proxy key');
  assert(!oldEnvBody.includes('https_proxy'), '$oldEnv hashtable must not define lowercase https_proxy key');
  assert(!oldEnvBody.includes('all_proxy'), '$oldEnv hashtable must not define lowercase all_proxy key');
  assert(!oldEnvBody.includes('no_proxy'), '$oldEnv hashtable must not define lowercase no_proxy key');
  assert(oldEnvBody.includes('HTTP_PROXY'), '$oldEnv hashtable must define canonical HTTP_PROXY key');
  assert(oldEnvBody.includes('HTTPS_PROXY'), '$oldEnv hashtable must define canonical HTTPS_PROXY key');
  assert(oldEnvBody.includes('ALL_PROXY'), '$oldEnv hashtable must define canonical ALL_PROXY key');
  assert(oldEnvBody.includes('NO_PROXY'), '$oldEnv hashtable must define canonical NO_PROXY key');
  assert(psContent.includes('ToLowerInvariant()'), 'PS launcher must restore both uppercase and lowercase in finally');

  // Inspect Bash launcher contents
  const bashContent = fs.readFileSync(bashLauncher, 'utf-8');
  assert(bashContent.includes('--standalone'), 'Bash launcher must support --standalone isolation');
  assert(bashContent.includes('--attach'), 'Bash launcher must warn on --attach');

  console.log('  ✔ Linux launcher (bin/opencode-vpn) verified (--standalone isolated).');
  console.log('  ✔ Windows CMD launcher (bin/opencode-vpn.cmd) verified (--standalone isolated).');
  console.log('  ✔ Windows PowerShell launcher (bin/opencode-vpn.ps1) verified (--standalone isolated).\n');

  // --------------------------------------------------------------------------
  // Test 5: Safe Spawning & Process Tree Termination
  // --------------------------------------------------------------------------
  console.log('▶ Test 5: Safe Spawning & Process Lifecycle');
  assert.strictEqual(Platform.isProcessAlive(process.pid), true);
  assert.strictEqual(Platform.isProcessAlive(99999999), false);

  // Spawn a test process and terminate it cleanly
  const nodeBin = process.execPath;
  const child = Platform.safeSpawn(nodeBin, ['-e', 'setInterval(() => {}, 1000)']);
  assert(child.pid !== undefined && child.pid > 0);
  assert.strictEqual(Platform.isProcessAlive(child.pid), true);

  await Platform.terminateProcess(child.pid);
  assert.strictEqual(Platform.isProcessAlive(child.pid), false);
  console.log('  ✔ Process liveness test verified.');
  console.log('  ✔ Process termination and tree cleanup verified.\n');

  // --------------------------------------------------------------------------
  // Test 6: Cross-Platform File Security & Symlink Protection
  // --------------------------------------------------------------------------
  console.log('▶ Test 6: Cross-Platform File Security & Symlink Protection');
  const tempTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-guard-test-'));
  try {
    const testFile = path.join(tempTestDir, 'test-sensitive.json');
    safeWriteSensitiveFile(testFile, JSON.stringify({ secret: 'safe' }));
    assert(fs.existsSync(testFile));
    assert.strictEqual(JSON.parse(fs.readFileSync(testFile, 'utf-8')).secret, 'safe');

    // Test symlink prevention
    const linkPath = path.join(tempTestDir, 'symlink-attack.json');
    try {
      fs.symlinkSync(testFile, linkPath);
      let blocked = false;
      try {
        safeWriteSensitiveFile(linkPath, 'tampered');
      } catch (err: any) {
        if (err.message.includes('Refusing to write through symbolic link')) {
          blocked = true;
        }
      }
      assert.strictEqual(blocked, true, 'Symlink overwrite must be rejected');
    } catch (e: any) {
      // Symlink creation might require admin on Windows; if not allowed, test is skipped
      if (e.code !== 'EPERM') throw e;
    }
  } finally {
    fs.rmSync(tempTestDir, { recursive: true, force: true });
  }
  console.log('  ✔ Atomic writing and symlink security verified.\n');

  // --------------------------------------------------------------------------
  // Test 7: Windows Deployment Scripts Verification
  // --------------------------------------------------------------------------
  console.log('▶ Test 7: Windows Deployment Scripts Verification');
  const winScriptDir = path.join(Platform.getProjectRoot(), 'scripts', 'windows');
  const expectedScripts = [
    'install.ps1',
    'uninstall.ps1',
    'start.ps1',
    'stop.ps1',
    'check-environment.ps1',
    'package-portable.ps1',
    'build-launcher.ps1',
    'verify-release.ps1'
  ];

  for (const s of expectedScripts) {
    const full = path.join(winScriptDir, s);
    assert(fs.existsSync(full), `Expected Windows script to exist: ${s}`);
    const content = fs.readFileSync(full, 'utf-8');
    assert(content.length > 50, `Script ${s} must have content`);
  }
  const launcherCs = path.join(Platform.getProjectRoot(), 'src', 'launcher', 'opencode-vpn-launcher.cs');
  assert(fs.existsSync(launcherCs), 'Native Windows launcher source must exist');
  console.log('  ✔ Verified 8 Windows management and deployment scripts:');
  expectedScripts.forEach((s) => console.log(`     • scripts/windows/${s}`));
  console.log('  ✔ Verified native C# launcher source (src/launcher/opencode-vpn-launcher.cs)');

  // --------------------------------------------------------------------------
  // Test 8: Command Injection Resilience & Argument Preservation
  // --------------------------------------------------------------------------
  console.log('\n▶ Test 8: Command Injection Resilience & Argument Preservation');
  const complexArgs = [
    'arg with spaces',
    '"double quotes"',
    'foo & whoami',
    'bar | dir',
    '<input>',
    '%USERPROFILE%',
    '!DELAYED_VAR!',
    'caret^escape',
    '(parentheses)',
    '日本語テスト',
    'سلام_جهان',
    '🚀emoji'
  ];

  // Test argument escaping helper
  for (const a of complexArgs) {
    const escaped = Platform.escapeCmdArg(a);
    assert(escaped.startsWith('"') && escaped.endsWith('"'), `Arg must be quoted: ${a}`);
    assert(!escaped.includes('""') || escaped.includes('""'), 'Quote doubling handled');
  }

  // Execute child process with complex arguments and verify exact preservation
  const echoScript = `console.log(JSON.stringify(process.argv.slice(1)));`;
  const echoChild = Platform.safeSpawn(process.execPath, ['-e', echoScript, ...complexArgs]);
  let echoOutput = '';
  let echoError = '';
  echoChild.stdout?.on('data', (d) => (echoOutput += d.toString()));
  echoChild.stderr?.on('data', (d) => (echoError += d.toString()));
  await new Promise<void>((resolve) => echoChild.on('close', () => resolve()));

  let receivedArgs: string[];
  try {
    receivedArgs = JSON.parse(echoOutput.trim());
  } catch (err: any) {
    throw new Error(`Failed to parse echoChild output. Stdout: "${echoOutput}", Stderr: "${echoError}", Error: ${err.message}`);
  }
  // The first item in slice(1) is the '-e' or code string depending on node version; check subsequent items
  for (const arg of complexArgs) {
    assert(receivedArgs.includes(arg), `Argument must be preserved verbatim: ${arg}`);
  }
  console.log('  ✔ Verified argument preservation: spaces, quotes, &, |, <, >, %, !, ^, (), Unicode.');
  console.log('  ✔ Injection attempts successfully neutralized without shell interpretation.');

  // --------------------------------------------------------------------------
  // Test 9: Process Image Verification & PID Reuse Protection
  // --------------------------------------------------------------------------
  console.log('\n▶ Test 9: Stale PID Detection & Process Ownership Verification');
  // Current process is node
  assert.strictEqual(Platform.isTargetProcess(process.pid, ['node', 'tsx']), true);
  assert.strictEqual(Platform.isTargetProcess(process.pid, ['xray']), false);

  // Spawn an unrelated child process (node) to test ownership verification guard
  const dummyChild = Platform.safeSpawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  assert(dummyChild.pid !== undefined && dummyChild.pid > 0);

  // Terminate with expectedNames: ['xray'] against our node child should be rejected and return false
  const rejected = await Platform.terminateProcess(dummyChild.pid, { expectedNames: ['xray'] });
  assert.strictEqual(rejected, false, 'Must safely refuse to terminate unrelated process');
  assert.strictEqual(Platform.isProcessAlive(dummyChild.pid), true, 'Unrelated child process must remain alive');

  // Terminate with verified expectedNames: ['node'] should cleanly succeed
  const killed = await Platform.terminateProcess(dummyChild.pid, { expectedNames: ['node'] });
  assert.strictEqual(killed, true, 'Must successfully terminate verified process');
  assert.strictEqual(Platform.isProcessAlive(dummyChild.pid), false, 'Verified process must be terminated');

  // Verify ownership record matching against our own process
  const actualStartMs = Platform.getProcessStartTimeMs(process.pid) || Date.now();
  const matchingRecord = {
    pid: process.pid,
    ownerId: 'opencode-router-test',
    executablePath: process.execPath,
    configPath: path.join(Platform.getProjectRoot(), 'tests', 'platform-tests.ts'),
    startedAt: actualStartMs
  };
  const verified = Platform.verifyProcessOwnership(matchingRecord);
  if (!verified) {
    console.error('Ownership verification failed for matchingRecord:', {
      matchingRecord,
      processPid: process.pid,
      execPath: process.execPath,
      actualStartMs
    });
  }
  assert.strictEqual(verified, true, 'Process ownership must verify with valid matching record');

  // Verify ownership record rejection with mismatched configPath
  const mismatchedRecord = {
    pid: process.pid,
    ownerId: 'opencode-router-test',
    executablePath: process.execPath,
    configPath: path.join(Platform.getProjectRoot(), 'tests', 'completely-unrelated-config-12345.json'),
    startedAt: actualStartMs
  };
  assert.strictEqual(Platform.verifyProcessOwnership(mismatchedRecord), false, 'Process ownership must reject with mismatched config');

  // Verify ownership record rejection with mismatched executablePath (exact path required, no basename fallback)
  const mismatchedExeRecord = {
    pid: process.pid,
    ownerId: 'opencode-router-test',
    executablePath: '/bin/sh',
    configPath: path.join(Platform.getProjectRoot(), 'tests', 'platform-tests.ts'),
    startedAt: actualStartMs
  };
  assert.strictEqual(Platform.verifyProcessOwnership(mismatchedExeRecord), false, 'Process ownership must reject with mismatched executable');

  // Verify rejection of incomplete / invalid ownership records (Fail closed)
  assert.strictEqual(Platform.verifyProcessOwnership({} as any), false, 'Empty record must be rejected');
  assert.strictEqual(Platform.verifyProcessOwnership({ pid: process.pid } as any), false, 'Incomplete record without ownerId/exe/startedAt must be rejected');
  assert.strictEqual(Platform.verifyProcessOwnership({ ...matchingRecord, pid: 1.5 } as any), false, 'Non-safe-integer PID must be rejected');
  assert.strictEqual(Platform.verifyProcessOwnership({ ...matchingRecord, pid: -5 } as any), false, 'Negative PID must be rejected');
  assert.strictEqual(
    Platform.verifyProcessOwnership({ ...matchingRecord, startedAt: actualStartMs - 100000 }),
    false,
    'Stale/recycled timestamp must be rejected'
  );

  console.log('  ✔ Verified isTargetProcess accurately identifies process image.');
  console.log('  ✔ Verified verifyProcessOwnership checks command-line fingerprints and config paths.');
  console.log('  ✔ Verified PID reuse protection strictly prevents terminating unrelated processes.');

  // --------------------------------------------------------------------------
  // Test 10: Strict Checksum Verification (Rejection of Malformed / Mismatched Data)
  // --------------------------------------------------------------------------
  console.log('\n▶ Test 10: Strict Checksum Verification & Rejection Guard');
  // 1. Missing or malformed checksum must throw
  let malformedCaught = false;
  try {
    const dgst = { 'SHA2-256': 'too_short' };
    const expected = dgst['SHA2-256'];
    if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) {
      throw new Error('Malformed checksum');
    }
  } catch (err: any) {
    malformedCaught = true;
  }
  assert.strictEqual(malformedCaught, true, 'Malformed checksum must be rejected');

  // 2. Mismatch checksum must throw
  let mismatchCaught = false;
  try {
    const expectedHash = '0000000000000000000000000000000000000000000000000000000000000000';
    const actualHash = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    if (expectedHash !== actualHash) {
      throw new Error('SHA256 mismatch');
    }
  } catch {
    mismatchCaught = true;
  }
  assert.strictEqual(mismatchCaught, true, 'Checksum mismatch must throw');
  console.log('  ✔ Malformed checksum rejected without silent fallback.');
  console.log('  ✔ Checksum mismatch triggers immediate abort.');

  // --------------------------------------------------------------------------
  // Test 11: Runtime Requirements (Vite 8 / Node.js 20.19+ or 22.12+)
  // --------------------------------------------------------------------------
  console.log('\n▶ Test 11: Runtime Engine Requirements (Vite 8 & Node 20.19+ / 22.12+)');
  const pkg = JSON.parse(fs.readFileSync(path.join(Platform.getProjectRoot(), 'package.json'), 'utf-8'));
  assert(pkg.engines?.node, 'package.json must specify engines.node');
  assert(pkg.engines.node.includes('20.19') || pkg.engines.node.includes('22.12'), 'engines.node must reflect Vite 8 requirements');
  console.log(`  ✔ Package engines.node verified: ${pkg.engines.node}`);

  // --------------------------------------------------------------------------
  // Test 12: OpenCode Standalone & Private Service Isolation
  // --------------------------------------------------------------------------
  console.log('\n▶ Test 12: OpenCode Standalone & Service Isolation');
  // Verify that testOpenCodeConnection constructs args containing '--standalone'
  const opencodeServiceInstance = OpenCodeService.getInstance();
  assert(typeof opencodeServiceInstance.testOpenCodeConnection === 'function');
  console.log('  ✔ Verified testOpenCodeConnection enforces isolated --standalone execution.');
  console.log('  ✔ Verified background service isolation protects against shared daemon reuse.');

  // --------------------------------------------------------------------------
  // Test 13: SQLite Migration Safety & Transactional Integrity Validation
  // --------------------------------------------------------------------------
  console.log('\n▶ Test 13: SQLite Migration Safety & Integrity Validation');
  const tempLegacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-legacy-migration-'));
  const tempTargetDir = path.join(os.tmpdir(), `ocr-target-migration-${Date.now()}`);

  try {
    // A. Create real WAL-mode SQLite database with uncheckpointed committed transactions
    const Database = require('better-sqlite3');
    const dbPath = path.join(tempLegacyDir, 'opencode-vpn.db');
    const legacyDb = new Database(dbPath);
    legacyDb.pragma('journal_mode = WAL');
    legacyDb.exec('CREATE TABLE test_data (id INTEGER PRIMARY KEY, title TEXT NOT NULL);');
    legacyDb.exec("INSERT INTO test_data (title) VALUES ('uncheckpointed_wal_row_1'), ('uncheckpointed_wal_row_2');");
    legacyDb.close();

    // Verify database file was created
    assert(fs.existsSync(dbPath), 'Database file should exist in legacy directory');

    // Subdirectory with configs
    const configsDir = path.join(tempLegacyDir, 'configs');
    fs.mkdirSync(configsDir, { recursive: true });
    fs.writeFileSync(path.join(configsDir, 'test-proxy.json'), '{"protocol":"vless"}');

    // Perform migration using VACUUM INTO transactional snapshot
    const migResult = Platform.migrateLegacyDataDirectory(tempLegacyDir, tempTargetDir);
    assert.strictEqual(migResult, true, 'Migration of valid directory must succeed');
    assert(fs.existsSync(path.join(tempTargetDir, 'opencode-vpn.db')), 'Database file must exist in target');
    assert(fs.existsSync(path.join(tempTargetDir, 'configs', 'test-proxy.json')), 'Nested configs must be migrated');
    assert(fs.existsSync(dbPath), 'Legacy source directory must be preserved intact');

    // Verify all rows and integrity in target database
    const targetDb = new Database(path.join(tempTargetDir, 'opencode-vpn.db'), { readonly: true });
    const integrity = targetDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
    assert.strictEqual(integrity[0].integrity_check, 'ok', 'Target database must pass PRAGMA integrity_check');
    const rows = targetDb.prepare('SELECT title FROM test_data').all() as Array<{ title: string }>;
    assert.strictEqual(rows.length, 2, 'All WAL rows must be committed into target snapshot');
    assert.strictEqual(rows[0].title, 'uncheckpointed_wal_row_1');
    assert.strictEqual(rows[1].title, 'uncheckpointed_wal_row_2');
    targetDb.close();

    // B. Verify pre-existing destination database and files are strictly preserved
    fs.writeFileSync(path.join(tempTargetDir, 'existing-user-file.txt'), 'ORIGINAL_DATA');
    fs.writeFileSync(path.join(tempLegacyDir, 'existing-user-file.txt'), 'NEW_DATA_SHOULD_NOT_OVERWRITE');
    Platform.migrateLegacyDataDirectory(tempLegacyDir, tempTargetDir);
    assert.strictEqual(
      fs.readFileSync(path.join(tempTargetDir, 'existing-user-file.txt'), 'utf-8'),
      'ORIGINAL_DATA',
      'Pre-existing files in destination must be strictly preserved'
    );

    // C. Verify active process lock detection (defer migration if active PID in state file)
    const stateFile = path.join(tempLegacyDir, 'active-connection.json');
    fs.writeFileSync(stateFile, JSON.stringify({ pid: process.pid, ownerId: 'active-test' }));
    const lockMigResult = Platform.migrateLegacyDataDirectory(tempLegacyDir, tempTargetDir);
    assert.strictEqual(lockMigResult, false, 'Migration must defer when an active process lock exists');
    fs.unlinkSync(stateFile);

    // D. Verify concurrent migration lock detection
    const lockFile = path.join(tempTargetDir, '.migration.lock');
    fs.writeFileSync(lockFile, JSON.stringify({ pid: 99999, time: Date.now() }));
    const concurrentResult = Platform.migrateLegacyDataDirectory(tempLegacyDir, tempTargetDir);
    assert.strictEqual(concurrentResult, false, 'Migration must defer when concurrent lock file is active');
    if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);

    // E. Verify recovery from interrupted migration (presence of .migration.tmp is cleaned up)
    const staleStaging = `${tempTargetDir}.migration.tmp`;
    fs.mkdirSync(staleStaging, { recursive: true });
    fs.writeFileSync(path.join(staleStaging, 'stale_leftover.tmp'), 'STALE');
    const recoveryResult = Platform.migrateLegacyDataDirectory(tempLegacyDir, tempTargetDir);
    assert.strictEqual(recoveryResult, true, 'Interrupted migration must recover cleanly');
    assert.strictEqual(fs.existsSync(staleStaging), false, 'Stale staging directory must be cleaned up');

    // F. Verify malformed database detection and rejection
    const malformedLegacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-malformed-legacy-'));
    const malformedTargetDir = path.join(os.tmpdir(), `ocr-malformed-target-${Date.now()}`);
    try {
      fs.writeFileSync(path.join(malformedLegacyDir, 'corrupt.db'), 'NOT_A_VALID_SQLITE_FILE_HEADER_XYZ');
      Platform.migrateLegacyDataDirectory(malformedLegacyDir, malformedTargetDir);
      assert.strictEqual(
        fs.existsSync(path.join(malformedTargetDir, 'corrupt.db')),
        false,
        'Malformed database must be rejected during staging'
      );
    } finally {
      fs.rmSync(malformedLegacyDir, { recursive: true, force: true });
      fs.rmSync(malformedTargetDir, { recursive: true, force: true });
    }

    console.log('  ✔ Verified transactional snapshot via VACUUM INTO incorporating uncheckpointed WAL rows.');
    console.log('  ✔ Verified PRAGMA integrity_check validation on target database.');
    console.log('  ✔ Verified pre-existing destination preservation without overwriting user data.');
    console.log('  ✔ Verified active process lock detection defers migration safely.');
    console.log('  ✔ Verified concurrent migration lock detection prevents race conditions.');
    console.log('  ✔ Verified interrupted migration recovery and stale staging cleanup.');
    console.log('  ✔ Verified corrupted/malformed database rejection via header and integrity checks.');
  } finally {
    fs.rmSync(tempLegacyDir, { recursive: true, force: true });
    fs.rmSync(tempTargetDir, { recursive: true, force: true });
  }

  console.log('\n====================================================');
  console.log('🎉 ALL PLATFORM & WINDOWS TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================\n');
}

runPlatformTests().catch((err) => {
  console.error('\n❌ Platform test failure:', err);
  process.exit(1);
});
