import { XrayProvisioner } from '../src/backend/vpn/xray-provisioner';

async function main() {
  console.log('==========================================================');
  console.log('🛡️  OpenCode Router — Xray-core Provisioning');
  console.log('==========================================================');

  const result = await XrayProvisioner.provision({
    onProgress: (percent, message) => {
      console.log(`[${percent}%] ${message}`);
    }
  });

  if (result.success) {
    console.log(`\n✅ Xray successfully provisioned at: ${result.binaryPath}`);
    console.log(`   Version: ${result.version} (${result.platform} / ${result.arch})`);
    console.log(`   SHA256 Verified: ${result.sha256Verified ? 'YES' : 'SKIPPED'}\n`);
    process.exit(0);
  } else {
    console.error(`\n❌ Failed to provision Xray: ${result.error}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error during Xray provisioning:', err);
  process.exit(1);
});
