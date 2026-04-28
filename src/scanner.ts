import fs from 'node:fs/promises'
import path from 'node:path'

export interface ScanData {
  structure: string[]
  techStack: string[]
  entryPoints: string[]
  categories: Record<string, string>
}

async function getFiles(dir: string, baseDir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = await Promise.all(entries.map((entry) => {
    const res = path.resolve(dir, entry.name)
    const relative = path.relative(baseDir, res)
    
    const ignoreList = [
      'node_modules', '.git', 'dist', 'build', 'venv', 
      '.turbo', '.next', '.claude', '.claire', '.vscode', 
      '.zed', 'patches', '__pycache__', 'out', 'bundle'
    ]
    
    const parts = relative.split(path.sep)
    if (parts.some(p => ignoreList.includes(p))) return []
    
    return entry.isDirectory() ? getFiles(res, baseDir) : relative
  }))
  return Array.prototype.concat(...files)
}

export async function scanRepo(rootDir: string): Promise<ScanData> {
  const allFiles = await getFiles(rootDir, rootDir)
  const structure = allFiles.filter(f => f.length > 0)
  const techStack: string[] = []
  const entryPoints: string[] = []
  const categories: Record<string, string> = {}

  const rootFiles = await fs.readdir(rootDir)
  if (rootFiles.includes('package.json')) techStack.push('Node/Bun (JS/TS)')
  if (rootFiles.includes('requirements.txt') || rootFiles.includes('pyproject.toml')) techStack.push('Python')
  if (rootFiles.includes('Cargo.toml')) techStack.push('Rust')
  if (rootFiles.includes('go.mod')) techStack.push('Go')

  for (const item of structure) {
    const dir = path.dirname(item)
    if (dir === '.') continue

    if (!categories[dir]) {
      const low = item.toLowerCase()
      if (low.includes('routes') || low.includes('api')) categories[dir] = 'API / Routing'
      else if (low.includes('controllers')) categories[dir] = 'Business Logic'
      else if (low.includes('models') || low.includes('schema')) categories[dir] = 'Data Layer'
      else if (low.includes('agents') || low.includes('swarm') || low.includes('orchestrator')) categories[dir] = 'AI / Agents'
      else if (low.includes('components') || low.includes('ui')) categories[dir] = 'UI Components'
      else if (low.includes('utils') || low.includes('helpers') || low.includes('shared')) categories[dir] = 'Utilities'
      else if (low.includes('test') || low.includes('spec')) categories[dir] = 'Testing'
    }
    
    const fileName = path.basename(item)
    if (['index.ts', 'index.js', 'main.py', 'app.ts', 'server.ts', 'main.go'].includes(fileName)) {
      entryPoints.push(item)
    }
  }

  return { structure, techStack, entryPoints, categories }
}
