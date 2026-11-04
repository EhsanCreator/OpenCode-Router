import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { db, initDatabase, getSetting, setSetting } from './db/database';
import { VpnEngine } from './vpn/vpn-engine';
import { OpenCodeService } from './opencode/opencode-service';
import { ConnectionOrchestrator } from './orchestrator/connection-orchestrator';
import { ConfigFetcher } from './discovery/config-fetcher';
import { LatencyTester } from './tester/latency-tester';
import { PrivilegeWizard } from './security/privilege-wizard';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Initialize SQLite database
initDatabase();

const orchestrator = ConnectionOrchestrator.getInstance();
const vpn = VpnEngine.getInstance();
const opencode = OpenCodeService.getInstance();

// Server-Sent Events (SSE) clients
const sseClients: Set<Response> = new Set();

orchestrator.on('progress', (data) => {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
});

// SSE endpoint
app.get('/api/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);

  // Send initial state immediately
  res.write(`data: ${JSON.stringify({
    phase: orchestrator.getStatus().phase,
    message: orchestrator.getStatus().message,
    stats: orchestrator.getStatus().stats,
    activeConnection: vpn.getActiveConfig()
  })}\n\n`);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

// Dashboard Status
app.get('/api/status', async (req: Request, res: Response) => {
  const status = orchestrator.getStatus();
  const normalIp = await LatencyTester.getNormalPublicIp();
  res.json({
    ...status,
    normalIp,
    socksPort: getSetting('socks_port', '10808'),
    httpPort: getSetting('http_port', '10809')
  });
});

// Trigger "Find Working Connection"
app.post('/api/workflow/start', async (req: Request, res: Response) => {
  const forceRefresh = Boolean(req.body.forceRefresh);
  if (orchestrator.getStatus().isRunning) {
    return res.status(409).json({ error: 'Testing workflow already running' });
  }

  // Run asynchronously so response is returned immediately
  orchestrator.findWorkingConnection(forceRefresh).catch((err) => {
    console.error('Workflow error:', err);
  });

  res.json({ success: true, message: 'Workflow started' });
});

// Stop Testing
app.post('/api/workflow/stop', (req: Request, res: Response) => {
  orchestrator.stopTesting();
  res.json({ success: true, message: 'Workflow cancellation requested' });
});

// Disconnect VPN
app.post('/api/vpn/disconnect', async (req: Request, res: Response) => {
  await vpn.stop();
  res.json({ success: true, message: 'VPN disconnected' });
});

// Test current active connection
app.post('/api/vpn/test-current', async (req: Request, res: Response) => {
  const active = vpn.getActiveConfig();
  if (!active) {
    return res.status(400).json({ error: 'No active VPN configuration' });
  }

  const httpPort = parseInt(getSetting('http_port', '10809'), 10);
  const socksPort = parseInt(getSetting('socks_port', '10808'), 10);

  const proxyTest = await LatencyTester.testProxyHttp(httpPort, 3000);
  const opencodeTest = await opencode.testOpenCodeConnection(httpPort, socksPort, 15);

  res.json({
    active,
    proxyTest,
    opencodeTest
  });
});

// Get Paginated & Filtered Configurations
app.get('/api/configs', (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
  const offset = (page - 1) * limit;
  const status = (req.query.status as string) || '';
  const protocol = (req.query.protocol as string) || '';
  const search = (req.query.search as string) || '';

  let whereClauses: string[] = [];
  let params: any[] = [];

  if (status) {
    whereClauses.push('last_status = ?');
    params.push(status);
  }
  if (protocol) {
    whereClauses.push('protocol = ?');
    params.push(protocol);
  }
  if (search) {
    whereClauses.push('(remark LIKE ? OR address LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const total = (db.prepare(`SELECT COUNT(*) as count FROM configs ${whereStr}`).get(...params) as any)?.count || 0;
  const items = db.prepare(`
    SELECT
      id, protocol, address, port, remark, security, network,
      last_tested_at, last_latency_ms, last_status, consecutive_failures, success_count, is_active, created_at
    FROM configs
    ${whereStr}
    ORDER BY is_active DESC, success_count DESC, id ASC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
});

// Manually test a single configuration
app.post('/api/configs/test-single', async (req: Request, res: Response) => {
  const configId = parseInt(req.body.id, 10);
  const row = db.prepare('SELECT * FROM configs WHERE id = ?').get(configId) as any;
  if (!row) {
    return res.status(404).json({ error: 'Configuration not found' });
  }

  const httpPort = parseInt(getSetting('http_port', '10809'), 10);
  const socksPort = parseInt(getSetting('socks_port', '10808'), 10);

  const tcp = await LatencyTester.testRemoteTcp(row.address, row.port, 2000);
  if (!tcp.reachable) {
    return res.json({
      success: false,
      step: 'tcp',
      error: `TCP Unreachable: ${tcp.error}`
    });
  }

  const started = await vpn.start(row, socksPort, httpPort);
  if (!started) {
    return res.json({
      success: false,
      step: 'vpn_start',
      error: 'Proxy engine failed to start'
    });
  }

  const proxyTest = await LatencyTester.testProxyHttp(httpPort, 3500);
  if (!proxyTest.success) {
    await vpn.stop();
    return res.json({
      success: false,
      step: 'proxy_probe',
      error: proxyTest.error
    });
  }

  const opencodeTest = await opencode.testOpenCodeConnection(httpPort, socksPort, 15);
  await vpn.stop();

  res.json({
    success: opencodeTest.category === 'SUCCESS',
    tcp,
    proxyTest,
    opencodeTest
  });
});

// Delete a configuration
app.delete('/api/configs/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  db.prepare('DELETE FROM configs WHERE id = ?').run(id);
  res.json({ success: true, message: 'Configuration deleted' });
});

// Import Configurations or raw text
app.post('/api/configs/import', (req: Request, res: Response) => {
  const { rawText, name } = req.body;
  if (!rawText || typeof rawText !== 'string') {
    return res.status(400).json({ error: 'Missing rawText parameter' });
  }

  const result = ConfigFetcher.importRawText(rawText, name);
  res.json({ success: true, ...result });
});

// Get GitHub Sources
app.get('/api/sources', (req: Request, res: Response) => {
  const sources = db.prepare('SELECT * FROM sources ORDER BY id ASC').all();
  res.json({ sources });
});

// Add Source
app.post('/api/sources', (req: Request, res: Response) => {
  const { name, url } = req.body;
  if (!name || !url) {
    return res.status(400).json({ error: 'Name and URL are required' });
  }

  try {
    const result = db.prepare('INSERT INTO sources (name, url) VALUES (?, ?)').run(name, url);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err: any) {
    res.status(409).json({ error: 'Source URL already exists' });
  }
});

// Refresh single source
app.post('/api/sources/:id/refresh', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const summaries = await ConfigFetcher.fetchAllSources(id);
  res.json({ success: true, summary: summaries[0] });
});

// Refresh all sources
app.post('/api/sources/refresh-all', async (req: Request, res: Response) => {
  const summaries = await ConfigFetcher.fetchAllSources();
  res.json({ success: true, summaries });
});

// Delete Source
app.delete('/api/sources/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  db.prepare('DELETE FROM sources WHERE id = ?').run(id);
  res.json({ success: true });
});

// Diagnostics
app.get('/api/diagnostics', (req: Request, res: Response) => {
  const opencodeInfo = opencode.getInfo();
  const privilegeStatus = PrivilegeWizard.checkStatus();
  const history = db.prepare(`
    SELECT h.*, c.remark, c.protocol, c.address, c.port
    FROM test_history h
    JOIN configs c ON h.config_id = c.id
    ORDER BY h.id DESC
    LIMIT 15
  `).all();

  res.json({
    opencode: opencodeInfo,
    privilege: privilegeStatus,
    launcherScript: opencode.getLauncherPath(),
    history
  });
});

// Serve static frontend files if built
const frontendDist = path.resolve(__dirname, '../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.use((req: Request, res: Response) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

export function startServer(port: number = PORT) {
  return app.listen(port, () => {
    console.log(`[OpenCode VPN Manager] Backend server running on http://localhost:${port}`);
  });
}

if (require.main === module) {
  startServer();
}
