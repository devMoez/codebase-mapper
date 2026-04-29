import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import path from 'node:path';
import chokidar from 'chokidar';
import { parseCodebase, CodeGraph, getFullGraph, getTreeChildren, searchNodes } from './parser';
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

  app.post('/api/load-folder', async (req, res) => {
    const { folderPath } = req.body;
    try {
        currentRootDir = folderPath;
        res.json({ success: true });
        broadcast({ type: 'graph-start' });
        currentGraph = await parseCodebase(currentRootDir, (current, total) => {
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
    watcher.on('all', async () => {
        currentGraph = await parseCodebase(currentRootDir);
        broadcast({ type: 'update', graph: currentGraph });
    });
  }

  if (currentRootDir && currentGraph) setupWatcher(currentRootDir);

  server.listen(port, () => {
    console.log(`🚀 3D Visualizer: http://localhost:${port}`);
  });
}
