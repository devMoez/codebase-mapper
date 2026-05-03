import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import path from 'node:path';
import fs from 'node:fs';
import chokidar from 'chokidar';
import { parseCodebase, CodeGraph, getFullGraph, getTreeChildren, searchNodes, getTransitiveDependencies } from './parser';
import { assembleContext } from './summarizer';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function start3DServer(rootDir: string, initialGraph: CodeGraph | null) {
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });
  
  let currentRootDir = rootDir;
  let currentGraph = initialGraph;
  let watcher: chokidar.FSWatcher | null = null;
  const port = 3000;

  const publicPath = path.join(process.cwd(), 'public');
  app.use(express.static(publicPath));

  app.get('/api/graph', (req, res) => {
    res.json(currentGraph || { nodes: [], links: [] });
  });

  app.get('/api/context', async (req, res) => {
    const query = req.query.query as string;
    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }
    const context = await assembleContext(currentRootDir, query);
    res.json({ context });
  });

  app.post('/api/load-folder', async (req, res) => {
    const { folderPath } = req.body;
    if (!folderPath) return res.status(400).json({ error: 'folderPath is required' });

    try {
        const resolvedPath = path.resolve(folderPath).replace(/\\/g, '/');
        if (!fs.existsSync(resolvedPath)) {
            return res.status(404).json({ error: 'Path does not exist' });
        }

        currentRootDir = resolvedPath;
        res.json({ success: true });
        broadcast({ type: 'graph-start' });
        currentGraph = await parseCodebase(currentRootDir, true, (current, total) => {
            broadcast({ type: 'graph-progress', current, total });
        });
        setupWatcher(currentRootDir);
        broadcast({ type: 'update', graph: currentGraph });
        broadcast({ type: 'graph-done' });
    } catch (err: any) {
        broadcast({ type: 'error', message: err.message });
    }
  });

  app.get('/api/tree/children', (req, res) => {
    const parentPath = req.query.path as string || '.';
    res.json(getTreeChildren(parentPath));
  });

  app.get('/api/search', (req, res) => {
    const q = req.query.q as string;
    const limit = parseInt(req.query.limit as string) || 50;
    res.json(searchNodes(q, limit));
  });

  wss.on('connection', (ws) => {
    console.log('Client connected');
  });

  function broadcast(data: any) {
    wss.clients.forEach((client) => {
        if (client.readyState === 1) client.send(JSON.stringify(data));
    });
  }

  function setupWatcher(dir: string) {
    if (watcher) watcher.close();
    watcher = chokidar.watch(dir, {
        ignored: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/graph.sqlite*'],
        persistent: true,
        ignoreInitial: true
    });

    const updateQueue: { dir: string }[] = [];
    let isProcessing = false;

    const processQueue = async () => {
        if (isProcessing || updateQueue.length === 0) return;
        isProcessing = true;

        const { dir } = updateQueue.shift()!;
        try {
            broadcast({ type: 'graph-start' });
            currentGraph = await parseCodebase(dir, true, (current, total) => {
                broadcast({ type: 'graph-progress', current, total });
            });
            broadcast({ type: 'update', graph: currentGraph });
            broadcast({ type: 'graph-done' });
        } catch (err: any) {
            console.error('Error during 3D server background update:', err);
            broadcast({ type: 'graph-error', error: err.message });
        } finally {
            isProcessing = false;
            processQueue();
        }
    };

    watcher.on('all', async () => {
        updateQueue.push({ dir });
        processQueue();
    });
  }

  if (currentRootDir && currentGraph) setupWatcher(currentRootDir);

  const serverInstance = server.listen(port, () => {
    console.log(`🚀 3D Visualizer: http://localhost:${port}`);
  });

  // Graceful Shutdown
  const shutdown = () => {
    console.log('\n🛑 Shutting down 3D server...');
    if (watcher) watcher.close();
    serverInstance.close();
    wss.close();
    import('./parser').then(m => m.closeDb());
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
