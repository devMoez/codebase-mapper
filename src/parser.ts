import { Project } from 'ts-morph';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { glob } from 'glob';
import { Database } from 'bun:sqlite';

export interface GraphNode {
  id: string;
  name: string;
  type: 'file' | 'folder' | 'symbol';
  extension?: string;
  path: string;
}

export interface GraphLink {
  source: string;
  target: string;
  type: 'import' | 'containment';
}

export interface CodeGraph {
  nodes: GraphNode[];
  links: GraphLink[];
}

let db: Database | null = null;

function initDb(rootDir: string) {
    const configDir = path.join(rootDir, '.codebase-mapper');
    const dbPath = path.join(configDir, 'graph.sqlite');
    
    // Ensure the directory exists synchronously before opening the DB
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }

    db = new Database(dbPath);
    // Optimize for performance
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = OFF;');
    db.exec(`
        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            name TEXT,
            type TEXT,
            extension TEXT,
            path TEXT
        );
        CREATE TABLE IF NOT EXISTS links (
            source TEXT,
            target TEXT,
            type TEXT,
            UNIQUE(source, target, type)
        );
        CREATE INDEX IF NOT EXISTS idx_links_source ON links(source);
        CREATE INDEX IF NOT EXISTS idx_links_target ON links(target);
    `);
}

export async function parseCodebase(rootDir: string, onProgress?: (current: number, total: number) => void): Promise<CodeGraph> {
  if (!db) initDb(rootDir);
  
  db!.exec('BEGIN;');
  db!.prepare('DELETE FROM nodes').run();
  db!.prepare('DELETE FROM links').run();
  db!.exec('COMMIT;');

  const ignorePatterns = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/coverage/**',
    '**/*.sqlite*',
  ];

  const files = await glob('**/*.{ts,tsx,js,jsx,py,go,rs}', {
    cwd: rootDir,
    ignore: ignorePatterns,
    absolute: true,
  });

  const totalFiles = files.length;
  const processedDirs = new Set<string>();

  const insertNode = db!.prepare('INSERT OR REPLACE INTO nodes (id, name, type, extension, path) VALUES (?, ?, ?, ?, ?)');
  const insertLink = db!.prepare('INSERT OR IGNORE INTO links (source, target, type) VALUES (?, ?, ?)');

  const runTransaction = db!.transaction((files: string[]) => {
    for (let i = 0; i < files.length; i++) {
        const filePath = files[i];
        const relativePath = path.relative(rootDir, filePath);
        const ext = path.extname(filePath);
        
        insertNode.run(relativePath, path.basename(filePath), 'file', ext, relativePath);

        let currentPath = path.dirname(relativePath);
        let childPath = relativePath;

        while (currentPath !== '.') {
            if (!processedDirs.has(currentPath)) {
                insertNode.run(currentPath, path.basename(currentPath), 'folder', null, currentPath);
                processedDirs.add(currentPath);
            }
            insertLink.run(currentPath, childPath, 'containment');
            childPath = currentPath;
            currentPath = path.dirname(currentPath);
        }
        
        if (childPath !== relativePath || !relativePath.includes(path.sep)) {
            insertLink.run('root', childPath, 'containment');
        }

        if (onProgress && i % 100 === 0) onProgress(i, totalFiles);
    }
  });

  runTransaction(files);
  insertNode.run('root', path.basename(rootDir) || 'root', 'folder', null, '.');

  const tsFiles = files.filter(f => /\.(ts|tsx|js|jsx)$/.test(f));
  const CHUNK_SIZE = 200;
  const project = new Project({ useInMemoryFileSystem: true });

  for (let i = 0; i < tsFiles.length; i += CHUNK_SIZE) {
      const chunk = tsFiles.slice(i, i + CHUNK_SIZE);
      // Process chunk by chunk to avoid memory issues while keeping speed
      for (const f of chunk) {
          try {
              project.addSourceFileAtPath(f);
          } catch (e) {
              // Skip files that can't be added
          }
      }
      
      const importTx = db!.transaction(() => {
          for (const sourceFile of project.getSourceFiles()) {
              const sourcePath = path.relative(rootDir, sourceFile.getFilePath());
              const imports = sourceFile.getImportDeclarations();
              for (const imp of imports) {
                  const resolvedFile = imp.getModuleSpecifierSourceFile();
                  if (resolvedFile) {
                      const targetPath = path.relative(rootDir, resolvedFile.getFilePath());
                      insertLink.run(sourcePath, targetPath, 'import');
                  }
              }
              // Remove file from project to free memory for next chunk
              project.removeSourceFile(sourceFile);
          }
      });
      importTx();
      
      if (onProgress) onProgress(Math.min(i + CHUNK_SIZE, tsFiles.length), tsFiles.length);
  }

  return getFullGraph();
}

export function getFullGraph(): CodeGraph {
    const nodes = db!.prepare('SELECT * FROM nodes').all() as GraphNode[];
    const links = db!.prepare('SELECT * FROM links').all() as GraphLink[];
    return { nodes, links };
}

export function getTreeChildren(parentPath: string): GraphNode[] {
    const query = parentPath === '.' ? 'root' : parentPath;
    return db!.prepare(`
        SELECT n.* FROM nodes n
        JOIN links l ON n.id = l.target
        WHERE l.source = ? AND l.type = 'containment'
    `).all(query) as GraphNode[];
}

export function searchNodes(query: string, limit: number = 50): GraphNode[] {
    return db!.prepare('SELECT * FROM nodes WHERE name LIKE ? OR path LIKE ? LIMIT ?')
        .all(`%${query}%`, `%${query}%`, limit) as GraphNode[];
}
