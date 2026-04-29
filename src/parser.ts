import { Project } from 'ts-morph';
import path from 'node:path';
import fs from 'node:fs/promises';
import { glob } from 'glob';
import Database from 'better-sqlite3';

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

let db: Database.Database | null = null;

function initDb(rootDir: string) {
    const dbPath = path.join(rootDir, 'graph.sqlite');
    db = new Database(dbPath);
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
  
  db!.prepare('DELETE FROM nodes').run();
  db!.prepare('DELETE FROM links').run();

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

        if (onProgress && i % 50 === 0) onProgress(i, totalFiles);
    }
  });

  runTransaction(files);
  insertNode.run('root', path.basename(rootDir) || 'root', 'folder', null, '.');

  const tsFiles = files.filter(f => /\.(ts|tsx|js|jsx)$/.test(f));
  const CHUNK_SIZE = 500;
  for (let i = 0; i < tsFiles.length; i += CHUNK_SIZE) {
      const chunk = tsFiles.slice(i, i + CHUNK_SIZE);
      const subProject = new Project();
      subProject.addSourceFilesAtPaths(chunk);
      
      db!.transaction(() => {
          for (const sourceFile of subProject.getSourceFiles()) {
              const sourcePath = path.relative(rootDir, sourceFile.getFilePath());
              const imports = sourceFile.getImportDeclarations();
              for (const imp of imports) {
                  const resolvedFile = imp.getModuleSpecifierSourceFile();
                  if (resolvedFile) {
                      const targetPath = path.relative(rootDir, resolvedFile.getFilePath());
                      insertLink.run(sourcePath, targetPath, 'import');
                  }
              }
          }
      })();
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
