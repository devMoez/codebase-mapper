import path from "node:path";
import { start3DServer } from './3d-server'
import { parseCodebase } from './parser'

async function main() {
  const args = process.argv.slice(2)
  const is3D = args.includes('--3d')

  if (is3D) {
    const customPath = args.find(a => !a.startsWith("-")); 

    if (customPath) {
        const rootDir = path.resolve(process.cwd(), customPath)
        const graph = await parseCodebase(rootDir)
        await start3DServer(rootDir, graph)
    } else {
        await start3DServer('', null)
    }
    return
  }

  console.log('Usage: codebase-map --3d [path]');
}

main().catch(console.error)
