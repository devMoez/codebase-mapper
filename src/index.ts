import { scanRepo } from './scanner'
import { generateMap } from './generator'
import { startServer } from './server'

async function main() {
  const args = process.argv.slice(2)
  
  if (args.includes('--gui')) {
    await startServer()
    return
  }

  console.log('\x1b[36m🗺️  Codebase Mapper: Creating AI navigation index...\x1b[0m')
  const rootDir = process.cwd()
  const scanData = await scanRepo(rootDir)
  console.log('\x1b[32m✅ Scan complete. Generating map files...\x1b[0m')
  await generateMap(rootDir, scanData)
  console.log('\x1b[1m\x1b[35m\n✨ Codebase Map generated at .ai/map/\x1b[0m')
  console.log('\x1b[34m👉 Add the content of .ai/map/AI_INSTRUCTIONS.md to your AI agent\'s memory.\x1b[0m')
  console.log('\x1b[33m💡 Run with --gui to open the interactive map.\x1b[0m')
}

main().catch(console.error)
