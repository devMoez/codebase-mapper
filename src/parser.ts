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
    db!.exec(`
        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            name TEXT,
            type TEXT,
            extension TEXT,
            path TEXT,
            mtime INTEGER,
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
        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            data TEXT
        );
    `);

    // Migration: Add mtime column if it doesn't exist
    try {
        db!.exec('ALTER TABLE nodes ADD COLUMN mtime INTEGER;');
    } catch (e) {
        // Column already exists or table doesn't exist yet
    }
    }

function extractSymbols(sourceFile: any, sourcePath: string, insertNode: any, insertLink: any) {
    // Classes
    sourceFile.getClasses().forEach((c: any) => {
        const name = c.getName() || 'AnonymousClass';
        const symbolId = `${sourcePath}::${name}`;
        const baseClass = c.getBaseClass()?.getName();
        const interfaces = c.getImplements().map((i: any) => i.getText());
        
        insertNode.run(symbolId, name, 'symbol', null, sourcePath, null, JSON.stringify({ 
          kind: 'class',
          extends: baseClass,
          implements: interfaces,
          isExported: c.isExported()
        }));
        insertLink.run(sourcePath, symbolId, 'containment');
    });

    // Interfaces
    sourceFile.getInterfaces().forEach((i: any) => {
        const name = i.getName();
        const symbolId = `${sourcePath}::${name}`;
        const extendsTypes = i.getExtends().map((e: any) => e.getText());
        
        insertNode.run(symbolId, name, 'symbol', null, sourcePath, null, JSON.stringify({ 
          kind: 'interface',
          extends: extendsTypes,
          isExported: i.isExported()
        }));
        insertLink.run(sourcePath, symbolId, 'containment');
    });

    // Functions
    sourceFile.getFunctions().forEach((f: any) => {
        const name = f.getName() || 'AnonymousFunction';
        const symbolId = `${sourcePath}::${name}`;
        const params = f.getParameters().map((p: any) => ({
          name: p.getName(),
          type: p.getType().getText()
        }));
        const returnType = f.getReturnType().getText();
        
        insertNode.run(symbolId, name, 'symbol', null, sourcePath, null, JSON.stringify({ 
          kind: 'function',
          params,
          returnType,
          isExported: f.isExported()
        }));
        insertLink.run(sourcePath, symbolId, 'containment');
    });

    // Variables
    sourceFile.getVariableStatements().forEach((v: any) => {
        if (v.isExported()) {
            v.getDeclarations().forEach((d: any) => {
                const name = d.getName();
                const symbolId = `${sourcePath}::${name}`;
                insertNode.run(symbolId, name, 'symbol', null, sourcePath, null, JSON.stringify({ 
                  kind: 'variable',
                  type: d.getType().getText(),
                  isExported: true
                }));
                insertLink.run(sourcePath, symbolId, 'containment');
            });
        }
    });
}

export async function updateFile(rootDir: string, filePath: string) {
    const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');
    const absPath = path.resolve(rootDir, filePath);
    const stats = fs.statSync(absPath);
    const mtime = stats.mtimeMs;

    // 1. Remove old data
    db!.transaction(() => {
        db!.prepare('DELETE FROM nodes WHERE id = ? OR id LIKE ?').run(relativePath, `${relativePath}::%`);
        db!.prepare('DELETE FROM links WHERE source = ? OR target = ?').run(relativePath, relativePath);
    })();

    // 2. Re-parse
    const ext = path.extname(absPath);
    const insertNode = db!.prepare('INSERT OR REPLACE INTO nodes (id, name, type, extension, path, mtime, meta) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insertLink = db!.prepare('INSERT OR IGNORE INTO links (source, target, type) VALUES (?, ?, ?)');

    insertNode.run(relativePath, path.basename(absPath), 'file', ext, relativePath, mtime, JSON.stringify({}));
    
    let currentPath = path.dirname(relativePath).replace(/\\/g, '/');
    let childPath = relativePath;

    while (currentPath !== '.' && currentPath !== '' && currentPath !== '/') {
        insertNode.run(currentPath, path.basename(currentPath), 'folder', null, currentPath, null, JSON.stringify({}));
        insertLink.run(currentPath, childPath, 'containment');
        childPath = currentPath;
        currentPath = path.dirname(currentPath).replace(/\\/g, '/');
    }
    
    if (childPath !== relativePath || !relativePath.includes('/')) {
        insertLink.run('root', childPath, 'containment');
    }

    if (/\.(ts|tsx|js|jsx)$/.test(absPath)) {
        const project = new Project({ useInMemoryFileSystem: true });
        try {
            const sourceFile = project.addSourceFileAtPath(absPath);
            const imports = sourceFile.getImportDeclarations();
            for (const imp of imports) {
                const resolvedFile = imp.getModuleSpecifierSourceFile();
                if (resolvedFile) {
                    const targetPath = path.relative(rootDir, resolvedFile.getFilePath()).replace(/\\/g, '/');
                    insertLink.run(relativePath, targetPath, 'import');
                }
            }
            extractSymbols(sourceFile, relativePath, insertNode, insertLink);
        } catch (e) {}
    }
}

export function saveSnapshot() {
    const graph = getFullGraph();
    db!.prepare('INSERT INTO snapshots (data) VALUES (?)').run(JSON.stringify(graph));
}

import ignore from 'ignore';

export async function parseCodebase(rootDirs: string | string[], incremental = true, onProgress?: (current: number, total: number) => void): Promise<CodeGraph> {
  const roots = Array.isArray(rootDirs) ? rootDirs : [rootDirs];
  const primaryRoot = roots[0];
  if (!db) initDb(primaryRoot);
  
  if (!incremental) {
    db!.exec('BEGIN;');
    db!.prepare('DELETE FROM nodes').run();
    db!.prepare('DELETE FROM links').run();
    db!.exec('COMMIT;');
  }

  const ig = ignore();
  
  // Load ignore patterns from all roots
  for (const root of roots) {
    const ignoreFiles = ['.gitignore', '.dockerignore', '.codemapignore'];
    for (const file of ignoreFiles) {
      try {
        const content = fs.readFileSync(path.join(root, file), 'utf8');
        ig.add(content);
      } catch (e) {}
    }
  }
  // Add hardcoded defaults
  ig.add(['node_modules', '.git', '.codemap', 'dist', 'build', 'coverage', '*.sqlite*']);

  let allFiles: { root: string, abs: string, rel: string, mtime: number }[] = [];

  for (const root of roots) {
    const files = await glob('**/*.{ts,tsx,js,jsx,py,go,rs}', {
      cwd: root,
      absolute: true,
      nodir: true,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**']
    });

    for (const f of files) {
      const rel = path.relative(root, f).replace(/\\/g, '/');
      if (!ig.ignores(rel)) {
        const stats = fs.statSync(f);
        allFiles.push({ root, abs: f.replace(/\\/g, '/'), rel: path.join(path.basename(root), rel).replace(/\\/g, '/'), mtime: stats.mtimeMs });
      }
    }
  }

  const totalFiles = allFiles.length;
  const processedDirs = new Set<string>();

  const insertNode = db!.prepare('INSERT OR REPLACE INTO nodes (id, name, type, extension, path, mtime, meta) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insertLink = db!.prepare('INSERT OR IGNORE INTO links (source, target, type) VALUES (?, ?, ?)');

  const changedFiles: typeof allFiles = [];

  db!.transaction(() => {
    for (let i = 0; i < allFiles.length; i++) {
        const file = allFiles[i];
        const relativePath = file.rel;
        
        const existing = db!.prepare('SELECT mtime FROM nodes WHERE id = ?').get(relativePath) as { mtime: number } | undefined;
        
        if (!incremental || !existing || existing.mtime < file.mtime) {
            changedFiles.push(file);
            // Clear old symbols and links for this file
            db!.prepare('DELETE FROM nodes WHERE id LIKE ?').run(`${relativePath}::%`);
            db!.prepare('DELETE FROM links WHERE source = ? OR target = ?').run(relativePath, relativePath);
        }

        const ext = path.extname(file.abs);
        insertNode.run(relativePath, path.basename(file.abs), 'file', ext, relativePath, file.mtime, JSON.stringify({}));

        let currentPath = path.dirname(relativePath).replace(/\\/g, '/');
        let childPath = relativePath;

        while (currentPath !== '.' && currentPath !== '' && currentPath !== '/') {
            if (!processedDirs.has(currentPath)) {
                insertNode.run(currentPath, path.basename(currentPath), 'folder', null, currentPath, null, JSON.stringify({}));
                processedDirs.add(currentPath);
            }
            insertLink.run(currentPath, childPath, 'containment');
            childPath = currentPath;
            currentPath = path.dirname(currentPath).replace(/\\/g, '/');
        }
        
        if (childPath !== relativePath || !relativePath.includes('/')) {
            insertLink.run('root', childPath, 'containment');
        }
    }

    // Cleanup files that no longer exist
    if (incremental) {
        const dbFiles = db!.prepare("SELECT id FROM nodes WHERE type = 'file'").all() as { id: string }[];
        const currentRelPaths = new Set(allFiles.map(f => f.rel));
        for (const dbFile of dbFiles) {
            if (!currentRelPaths.has(dbFile.id)) {
                db!.prepare('DELETE FROM nodes WHERE id = ? OR id LIKE ?').run(dbFile.id, `${dbFile.id}::%`);
                db!.prepare('DELETE FROM links WHERE source = ? OR target = ?').run(dbFile.id, dbFile.id);
            }
        }
    }
  })();

  insertNode.run('root', 'Project Root', 'folder', null, '.', null, JSON.stringify({}));

  const tsFiles = changedFiles.filter(f => /\.(ts|tsx|js|jsx)$/.test(f.abs));
  const CHUNK_SIZE = 100;
  const project = new Project();

  for (let i = 0; i < tsFiles.length; i += CHUNK_SIZE) {
      const chunk = tsFiles.slice(i, i + CHUNK_SIZE);
      for (const f of chunk) {
          try {
              project.addSourceFileAtPath(f.abs);
          } catch (e) {
              console.error(`Error adding file ${f.abs}:`, e);
          }
      }
      
      const sourceFiles = project.getSourceFiles();
      
      db!.transaction(() => {
          for (const sourceFile of sourceFiles) {
              const filePath = sourceFile.getFilePath().replace(/\\/g, '/');
              const fileInfo = tsFiles.find(tf => tf.abs.toLowerCase() === filePath.toLowerCase());
              
              if (!fileInfo) {
                  continue;
              }

              const sourcePath = fileInfo.rel;
              // 1. Imports
              const imports = sourceFile.getImportDeclarations();
              for (const imp of imports) {
                  const resolvedFile = imp.getModuleSpecifierSourceFile();
                  if (resolvedFile) {
                      const targetAbs = resolvedFile.getFilePath().replace(/\\/g, '/');
                      const targetInfo = allFiles.find(af => af.abs.toLowerCase() === targetAbs.toLowerCase());
                      if (targetInfo) {
                        insertLink.run(sourcePath, targetInfo.rel, 'import');
                      }
                  }
              }

              // 2. Metadata Extraction
              extractSymbols(sourceFile, sourcePath, insertNode, insertLink);

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

export function getTransitiveDependencies(nodeId: string): string[] {
    const dependencies = new Set<string>();
    const stack = [nodeId];
    
    while (stack.length > 0) {
        const current = stack.pop()!;
        const direct = db!.prepare(`
            SELECT target FROM links 
            WHERE source = ? AND type = 'import'
        `).all(current) as { target: string }[];
        
        for (const d of direct) {
            if (!dependencies.has(d.target)) {
                dependencies.add(d.target);
                stack.push(d.target);
            }
        }
    }
    
    return Array.from(dependencies);
}

export function getUnusedFiles(): GraphNode[] {
    return db!.prepare(`
        SELECT * FROM nodes 
        WHERE type = 'file' 
        AND id NOT IN (SELECT target FROM links WHERE type = 'import')
        AND id NOT IN (SELECT id FROM nodes WHERE name LIKE 'index%' OR name LIKE 'main%' OR name LIKE 'app%')
    `).all() as GraphNode[];
}

export async function generateStubs(rootDir: string) {
    const files = db!.prepare("SELECT * FROM nodes WHERE type = 'file' AND extension IN ('.ts', '.tsx', '.js', '.jsx')").all() as GraphNode[];
    console.log(`\n📝 Checking ${files.length} files for missing stubs...`);
    
    for (const file of files) {
        const absPath = path.resolve(rootDir, '..', file.id); // Go up one because file.id starts with basename(root)
        try {
            let content = await fsp.readFile(absPath, 'utf8');
            if (!content.includes('// Purpose:')) {
                const symbols = db!.prepare("SELECT name, meta FROM nodes WHERE id LIKE ?").all(`${file.id}::%`) as any[];
                if (symbols.length > 0) {
                    const symbolList = symbols.map(s => s.name).join(', ');
                    const purpose = `// Purpose: Core logic for ${symbolList}\n`;
                    
                    if (content.startsWith('#!')) {
                        const lines = content.split('\n');
                        lines.splice(1, 0, purpose);
                        content = lines.join('\n');
                    } else {
                        content = purpose + content;
                    }
                    
                    await fsp.writeFile(absPath, content);
                    console.log(`\x1b[32m✅ Added stub to: ${file.id}\x1b[0m`);
                }
            }
        } catch (e) {
            console.error(`Error reading ${absPath}:`, e);
        }
    }
}

export function searchNodes(query: string, limit: number = 50): GraphNode[] {
    return db!.prepare('SELECT * FROM nodes WHERE name LIKE ? OR path LIKE ? LIMIT ?')
        .all(`%${query}%`, `%${query}%`, limit) as GraphNode[];
}
