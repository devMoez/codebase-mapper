import path from "node:path";
import { start3DServer } from './3d-server'
import { parseCodebase } from './parser'

async function main() {
  const args = process.argv.slice(2)
  const is3D = args.includes('--3d')

  if (is3D) {
    console.log('\x1b[36m🚀 Starting 3D Codebase Visualizer...\x1b[0m')
    const customPath = args.find(a => !a.startsWith("-")); const rootDir = customPath ? path.resolve(process.cwd(), customPath) : process.cwd()
    
    // Initial parse
    console.log('\x1b[32m🔍 Parsing codebase...\x1b[0m')
    const graph = await parseCodebase(rootDir)
    
    // Start server
    await start3DServer(rootDir, graph)
    return
  }

  // Fallback or old behavior if any remains (but user said replace old GUI)
  console.log('Usage: codebase-map --3d')
  console.log('Or use the old scan logic (deprecated):')
  // (Old logic removed as per instructions)
}

main().catch(console.error)

