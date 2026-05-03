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
  
  // Decide which mode to run in
  const is3D = args.includes('3d');
  const isMap = args.includes('map');
  const isWatch = args.includes('--watch') || args.includes('-w');
  const isStubs = args.includes('--stubs');
  const isMarkdown = args.includes('--markdown');
  const isJson = args.includes('--json');
  const isDot = args.includes('--dot');
  const contextIdx = args.indexOf('--context');
  
  // Load config
  let configRoots: string[] = [];
  let configIgnore: string[] = [];
  if (fs.existsSync('cortex_config.json')) {
    try {
      const config = JSON.parse(fs.readFileSync('cortex_config.json', 'utf8'));
      if (config.roots) configRoots = config.roots;
      if (config.ignore) configIgnore = config.ignore;
    } catch (e) {}
  }

  // Extract paths: filter out flags, subcommands, and context query
  const paths = args.filter((a, i) => {
    if (a.startsWith('-') || a === '3d' || a === 'map') return false;
    if (i > 0 && args[i-1] === '--context') return false;
    return true;
  });
  
  let rootDirs = paths.length > 0 ? paths.map(p => path.resolve(process.cwd(), p)) : (configRoots.length > 0 ? configRoots.map(p => path.resolve(process.cwd(), p)) : [process.cwd()]);
  const primaryRoot = rootDirs[0];

  if (is3D) {
    console.log(`🚀 Starting 3D Visualizer for: ${primaryRoot}`);
    const graph = await parseCodebase(rootDirs, true)
    await start3DServer(primaryRoot, graph)
    return;
  }

  // Initial scan
  console.log(`\x1b[36m🗺️  Codebase Mapper: Indexing ${rootDirs.join(', ')}...\x1b[0m`);
  const graph = await parseCodebase(rootDirs, true, (current, total) => {
    process.stdout.write(`\rProgress: ${Math.round((current / total) * 100)}% (${current}/${total} files)`);
  });
  console.log('\n\x1b[32m✅ Scan complete.\x1b[0m');
  
  await generateAISummary(primaryRoot, graph);
  if (isMarkdown) await generateMarkdownMap(primaryRoot, graph);
  if (isJson) await generateJsonMap(primaryRoot, graph);
  if (isDot) await generateDotGraph(primaryRoot, graph);
  
  saveSnapshot();
  
  if (isStubs) {
    await generateStubs(primaryRoot);
  }

  if (contextIdx !== -1 && args[contextIdx + 1]) {
    const query = args[contextIdx + 1];
    const context = await assembleContext(primaryRoot, query);
    console.log('\n' + context);
  }

  console.log(`\n\x1b[1m\x1b[35m✨ Codebase Map generated at .codemap/\x1b[0m`);
  
  if (isWatch) {
    console.log(`\x1b[33m👀 Watch mode active. Monitoring for changes...\x1b[0m`);
    const watcher = chokidar.watch(rootDirs, {
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
            console.log(`\r\x1b[36m🔄 File ${action}: ${path.relative(primaryRoot, filePath)}\x1b[0m`);
            await updateFile(primaryRoot, filePath);
            const newGraph = getFullGraph();
            await generateAISummary(primaryRoot, newGraph);
            if (isMarkdown) await generateMarkdownMap(primaryRoot, newGraph);
            if (isJson) await generateJsonMap(primaryRoot, newGraph);
            if (isDot) await generateDotGraph(primaryRoot, newGraph);
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
        import('./parser').then(m => m.closeDb());
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    return; // Keep process alive
  }

  console.log('\x1b[34m👉 Tell your AI agent to read .codemap/README.md or .codemap/summary.json to understand this project.\x1b[0m');
  console.log('\x1b[34m👉 To see the 3D map, run: 3d 3d\x1b[0m');
}

// Triggering incremental scan test
main().catch(console.error)
