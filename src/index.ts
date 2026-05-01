import path from "node:path";
import { start3DServer } from './3d-server'
import { parseCodebase } from './parser'

async function main() {
  const args = process.argv.slice(2)
  const subcommand = args[0]

  if (subcommand === '3d') {
    // The path is the second argument (if provided)
    const customPath = args[1];

    // If no path provided, use current working directory
    const rootDir = customPath ? path.resolve(process.cwd(), customPath) : process.cwd();
    
    console.log(`🚀 Mapping codebase at: ${rootDir}`);
    const graph = await parseCodebase(rootDir)
    await start3DServer(rootDir, graph)
    return
  }

  console.log('Usage: cm 3d [path]');
}

main().catch(console.error)
