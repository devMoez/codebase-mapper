#!/usr/bin/env bun
import path from "node:path";
import { start3DServer } from './3d-server'
import { parseCodebase } from './parser'

import { generateAISummary } from './summarizer'

async function main() {
  const args = process.argv.slice(2)
  
  // Decide which mode to run in
  const is3D = args[0] === '3d';
  const isMap = args[0] === 'map';
  
  // Extract path: if subcommand used, path is index 1, else index 0
  let rawPath: string | undefined;
  if (is3D || isMap) {
    rawPath = args[1];
  } else {
    rawPath = args[0];
  }

  const rootDir = rawPath ? path.resolve(process.cwd(), rawPath) : process.cwd();
  
  if (is3D) {
    console.log(`🚀 Starting 3D Visualizer for: ${rootDir}`);
    // For 3D, we need a fresh graph
    const graph = await parseCodebase(rootDir)
    await start3DServer(rootDir, graph)
    return;
  }

  // Default / Indexing mode
  console.log(`\x1b[36m🗺️  Codebase Mapper: Indexing ${rootDir}...\x1b[0m`);
  const graph = await parseCodebase(rootDir, (current, total) => {
    process.stdout.write(`\rProgress: ${Math.round((current / total) * 100)}% (${current}/${total} files)`);
  });
  console.log('\n\x1b[32m✅ Indexing complete. Generating AI summary...\x1b[0m');
  
  await generateAISummary(rootDir, graph);
  
  console.log(`\n\x1b[1m\x1b[35m✨ Codebase Map generated at .codemap/\x1b[0m`);
  console.log('\x1b[34m👉 Tell your AI agent to read .codemap/README.md or .codemap/summary.json to understand this project.\x1b[0m');
  console.log('\x1b[34m👉 To see the 3D map, run: 3d 3d\x1b[0m');
}

main().catch(console.error)
