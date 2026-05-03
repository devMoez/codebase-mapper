#!/usr/bin/env bun
// Purpose: Core logic for main
import path from "node:path";
import fs from 'node:fs';
import chokidar from 'chokidar';
import { start3DServer } from './3d-server';
import { updateFile, saveSnapshot, getFullGraph, parseCodebase, generateStubs } from './parser';
import { generateAISummary, generateMarkdownMap, generateJsonMap, generateDotGraph, assembleContext } from './summarizer';

async function main() {
  const args = process.argv.slice(2)
  
  // 1. Determine if visualizer mode is requested
  const is3D = args.includes('3d');
  
  // 2. Extract path argument
  // Filter out the '3d' command and any flags
  const pathArgs = args.filter(a => a !== '3d' && !a.startsWith('--') && a !== '-w');
  const targetDir = pathArgs.length > 0 ? path.resolve(process.cwd(), pathArgs[0]) : process.cwd();

  // 3. Keep other flags
  const isWatch = args.includes('--watch') || args.includes('-w');
  const isStubs = args.includes('--stubs');
  const isMarkdown = args.includes('--markdown');
  const isJson = args.includes('--json');
  const isDot = args.includes('--dot');
  const contextIdx = args.indexOf('--context');
  
  // Load config
  let configIgnore: string[] = [];
  if (fs.existsSync('cortex_config.json')) {
    try {
      const config = JSON.parse(fs.readFileSync('cortex_config.json', 'utf8'));
      if (config.ignore) configIgnore = config.ignore;
    } catch (e) {}
  }

  if (is3D) {
    console.log(`🚀 Starting 3D Visualizer for: ${targetDir}`);
    const graph = await parseCodebase([targetDir], true)
    await start3DServer(targetDir, graph)
    return;
  }

  // Indexing mode
  console.log(`\x1b[36m🗺️  Codebase Mapper: Indexing ${targetDir}...\x1b[0m`);
  const graph = await parseCodebase([targetDir], true, (current, total) => {
    process.stdout.write(`\rProgress: ${Math.round((current / total) * 100)}% (${current}/${total} files)`);
  });
  console.log('\n\x1b[32m✅ Scan complete.\x1b[0m');
  
  await generateAISummary(targetDir, graph);
  if (isMarkdown) await generateMarkdownMap(targetDir, graph);
  if (isJson) await generateJsonMap(targetDir, graph);
  if (isDot) await generateDotGraph(targetDir, graph);
  
  saveSnapshot();
  
  if (isStubs) {
    await generateStubs(targetDir);
  }

  if (contextIdx !== -1 && args[contextIdx + 1]) {
    const query = args[contextIdx + 1];
    const context = await assembleContext(targetDir, query);
    console.log('\n' + context);
  }

  console.log(`\n\x1b[1m\x1b[35m✨ Codebase Map generated at ${path.join(targetDir, '.codemap/')}\x1b[0m`);
  
  if (isWatch) {
    console.log(`\x1b[33m👀 Watch mode active. Monitoring for changes...\x1b[0m`);
    const watcher = chokidar.watch(targetDir, {
        ignored: [/(^|[\/\\])\../, '**/node_modules/**', '**/.codemap/**', ...configIgnore],
        persistent: true,
        ignoreInitial: true
    });

    const updateQueue: { path: string, action: string }[] = [];
    let isProcessing = false;

    const processQueue = async () => {
        if (isProcessing || updateQueue.length === 0) return;
        isProcessing = true;

        const { path: filePath, action } = updateQueue.shift()!;
        try {
            console.log(`\r\x1b[36m🔄 File ${action}: ${path.relative(targetDir, filePath)}\x1b[0m`);
            await updateFile(targetDir, filePath);
            const newGraph = getFullGraph();
            await generateAISummary(targetDir, newGraph);
            if (isMarkdown) await generateMarkdownMap(targetDir, newGraph);
            if (isJson) await generateJsonMap(targetDir, newGraph);
            if (isDot) await generateDotGraph(targetDir, newGraph);
        } catch (e) {
            console.error('\x1b[31mError during update:\x1b[0m', e);
        } finally {
            isProcessing = false;
            processQueue();
        }
    };

    const triggerUpdate = (filePath: string, action: string) => {
        updateQueue.push({ path: filePath, action });
        processQueue();
    };

    watcher.on('change', (p) => triggerUpdate(p, 'changed'));
    watcher.on('add', (p) => triggerUpdate(p, 'added'));

    const shutdown = () => {
        console.log('\n🛑 Watcher stopped.');
        watcher.close();
        closeDb();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    return;
  }
}

  console.log('\x1b[34m👉 Tell your AI agent to read .codemap/README.md or .codemap/summary.json to understand this project.\x1b[0m');
  console.log('\x1b[34m👉 To see the 3D map, run: 3d 3d\x1b[0m');
}

// Triggering incremental scan test
main().catch(console.error)
