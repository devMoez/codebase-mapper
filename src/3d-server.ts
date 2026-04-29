import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import path from 'node:path';
import chokidar from 'chokidar';
import { parseCodebase, CodeGraph } from './parser';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function start3DServer(rootDir: string, initialGraph: CodeGraph) {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });
  
  let currentGraph = initialGraph;
  const port = 3000;

  // Serve static files from 'public' directory
  const publicPath = path.join(process.cwd(), 'public');
  app.use(express.static(publicPath));

  app.get('/api/graph', (req, res) => {
    res.json(currentGraph);
  });

  // WebSocket connection for real-time updates
  wss.on('connection', (ws) => {
    console.log('Client connected to 3D visualizer');
  });

  // Watch for file changes
  const watcher = chokidar.watch(rootDir, {
    ignored: [
        '**/node_modules/**', 
        '**/dist/**', 
        '**/.git/**',
        '**/graph.json'
    ],
    persistent: true,
    ignoreInitial: true
  });

  watcher.on('all', async (event, filePath) => {
    console.log(`File change detected: ${event} ${filePath}`);
    try {
      currentGraph = await parseCodebase(rootDir);
      // Notify all clients
      wss.clients.forEach((client) => {
        if (client.readyState === 1) { // OPEN
          client.send(JSON.stringify({ type: 'update', graph: currentGraph }));
        }
      });
    } catch (err) {
      console.error('Error during incremental parse:', err);
    }
  });

  server.listen(port, () => {
    console.log(`\x1b[36m🚀 3D Visualizer running at http://localhost:${port}\x1b[0m`);
    // Try to open browser
    const open = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    import('node:child_process').then(({ exec }) => {
        exec(`${open} http://localhost:${port}`);
    });
  });
}
