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
  meta?: {
    kind?: string;
    exports?: string[];
    summary?: string;
  };
}

export interface GraphLink {
  source: string;
  target: string;
  type: 'import' | 'containment' | 'implements';
}

export interface CodeGraph {
  nodes: GraphNode[];
  links: GraphLink[];
}

let db: Database | null = null;

function initDb(rootDir: string) {
    const configDir = path.join(rootDir, '.codemap');
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
            path TEXT,
            meta TEXT
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
    '**/.codemap/**',
  ];

  const files = await glob('**/*.{ts,tsx,js,jsx,py,go,rs}', {
    cwd: rootDir,
    ignore: ignorePatterns,
    absolute: true,
  });

  const totalFiles = files.length;
  const processedDirs = new Set<string>();

  const insertNode = db!.prepare('INSERT OR REPLACE INTO nodes (id, name, type, extension, path, meta) VALUES (?, ?, ?, ?, ?, ?)');
  const insertLink = db!.prepare('INSERT OR IGNORE INTO links (source, target, type) VALUES (?, ?, ?)');

  const runTransaction = db!.transaction((files: string[]) => {
    for (let i = 0; i < files.length; i++) {
        const filePath = files[i];
        const relativePath = path.relative(rootDir, filePath);
        const ext = path.extname(filePath);
        
        insertNode.run(relativePath, path.basename(filePath), 'file', ext, relativePath, JSON.stringify({}));

        let currentPath = path.dirname(relativePath);
        let childPath = relativePath;

        while (currentPath !== '.') {
            if (!processedDirs.has(currentPath)) {
                insertNode.run(currentPath, path.basename(currentPath), 'folder', null, currentPath, JSON.stringify({}));
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
  insertNode.run('root', path.basename(rootDir) || 'root', 'folder', null, '.', JSON.stringify({}));

  const tsFiles = files.filter(f => /\.(ts|tsx|js|jsx)$/.test(f));
  const CHUNK_SIZE = 100;
  const project = new Project({ useInMemoryFileSystem: true });

  for (let i = 0; i < tsFiles.length; i += CHUNK_SIZE) {
      const chunk = tsFiles.slice(i, i + CHUNK_SIZE);
      for (const f of chunk) {
          try {
              project.addSourceFileAtPath(f);
          } catch (e) {}
      }
      
      db!.transaction(() => {
          for (const sourceFile of project.getSourceFiles()) {
              const sourcePath = path.relative(rootDir, sourceFile.getFilePath());
              
              // 1. Imports
              const imports = sourceFile.getImportDeclarations();
              for (const imp of imports) {
                  const resolvedFile = imp.getModuleSpecifierSourceFile();
                  if (resolvedFile) {
                      const targetPath = path.relative(rootDir, resolvedFile.getFilePath());
                      insertLink.run(sourcePath, targetPath, 'import');
                  }
              }

              // 2. Metadata: Classes & Functions
              const classes = sourceFile.getClasses();
              classes.forEach(c => {
                  const name = c.getName() || 'AnonymousClass';
                  const symbolId = `${sourcePath}::${name}`;
                  insertNode.run(symbolId, name, 'symbol', null, sourcePath, JSON.stringify({ kind: 'class' }));
                  insertLink.run(sourcePath, symbolId, 'containment');
              });

              const functions = sourceFile.getFunctions();
              functions.forEach(f => {
                  const name = f.getName() || 'AnonymousFunction';
                  const symbolId = `${sourcePath}::${name}`;
                  insertNode.run(symbolId, name, 'symbol', null, sourcePath, JSON.stringify({ kind: 'function' }));
                  insertLink.run(sourcePath, symbolId, 'containment');
              });

              project.removeSourceFile(sourceFile);
          }
      })();
      
      if (onProgress) onProgress(Math.min(i + CHUNK_SIZE, tsFiles.length), tsFiles.length);
  }

  return getFullGraph();
}

export function getFullGraph(): CodeGraph {
    const rawNodes = db!.prepare('SELECT * FROM nodes').all() as any[];
    const nodes = rawNodes.map(n => ({
        ...n,
        meta: JSON.parse(n.meta || '{}')
    })) as GraphNode[];
    
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
