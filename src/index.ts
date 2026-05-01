#!/usr/bin/env bun
import path from "node:path";
import { start3DServer } from './3d-server'
import { parseCodebase } from './parser'

async function main() {
  const args = process.argv.slice(2)
  
  // Handle both 'cm 3d [path]' and direct '3d [path]'
  let customPath: string | undefined;
  
  if (args[0] === '3d') {
    customPath = args[1];
  } else {
    customPath = args[0];
  }

  // Default to current directory if no path provided
  const rootDir = customPath ? path.resolve(process.cwd(), customPath) : process.cwd();
  
  console.log(`🚀 Mapping codebase at: ${rootDir}`);
  const graph = await parseCodebase(rootDir)
  await start3DServer(rootDir, graph)
}

main().catch(console.error)
