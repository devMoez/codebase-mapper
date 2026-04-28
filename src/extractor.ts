import fs from 'node:fs/promises'
import path from 'node:path'

export interface FileMetadata {
  path: string
  name: string
  extension: string
  summary: string
  exports: string[]
  dependencies: string[]
  size: number
}

export async function extractMetadata(filePath: string, rootDir: string): Promise<FileMetadata> {
  const fullPath = path.resolve(rootDir, filePath)
  const content = await fs.readFile(fullPath, 'utf-8')
  const stats = await fs.stat(fullPath)
  const ext = path.extname(filePath)
  
  let summary = ''
  let exports: string[] = []
  let dependencies: string[] = []

  // Basic Parser for TS/JS/Python
  if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
    // Extract JSDoc or top-level comments
    const commentMatch = content.match(/\/\*\*([\s\S]*?)\*\//)
    if (commentMatch) {
      summary = commentMatch[1].replace(/\*/g, '').trim().split('\n')[0]
    }

    // Extract Exports (simple regex)
    const exportMatches = content.matchAll(/export (const|function|class|type|interface) (\w+)/g)
    exports = Array.from(exportMatches).map(m => m[2])

    // Extract Imports
    const importMatches = content.matchAll(/import .* from ['"](.*)['"]/g)
    dependencies = Array.from(importMatches).map(m => m[1])
  } 
  else if (ext === '.py') {
    // Extract Python Docstrings
    const docMatch = content.match(/"""([\s\S]*?)"""|'''([\s\S]*?)'''/)
    if (docMatch) {
      summary = (docMatch[1] || docMatch[2]).trim().split('\n')[0]
    }

    // Extract Classes and Functions
    const pyMatches = content.matchAll(/(class|def) (\w+)/g)
    exports = Array.from(pyMatches).map(m => m[2])
  }

  // Fallback summary if nothing found
  if (!summary) {
    if (exports.length > 0) {
      summary = `Handles ${exports.slice(0, 3).join(', ')}${exports.length > 3 ? '...' : ''}`
    } else {
      summary = 'System utility or configuration file.'
    }
  }

  return {
    path: filePath,
    name: path.basename(filePath),
    extension: ext,
    summary,
    exports,
    dependencies,
    size: stats.size
  }
}
