import { Project, SourceFile } from 'ts-morph';
import path from 'node:path';
import fs from 'node:fs/promises';
import { glob } from 'glob';

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

export async function parseCodebase(rootDir: string): Promise<CodeGraph> {
  const project = new Project();
  
  // Find all files excluding node_modules, dist, etc.
  const ignorePatterns = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/coverage/**',
  ];

  const files = await glob('**/*.{ts,tsx,js,jsx,py,go,rs}', {
    cwd: rootDir,
    ignore: ignorePatterns,
    absolute: true,
  });

  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const processedDirs = new Set<string>();

  // Add files to ts-morph project
  const tsFiles = files.filter(f => /\.(ts|tsx|js|jsx)$/.test(f));
  project.addSourceFilesAtPaths(tsFiles);

  for (const filePath of files) {
    const relativePath = path.relative(rootDir, filePath);
    const ext = path.extname(filePath);
    
    // Add file node
    nodes.push({
      id: relativePath,
      name: path.basename(filePath),
      type: 'file',
      extension: ext,
      path: relativePath,
    });

    // Add directory nodes and containment links
    let currentPath = path.dirname(relativePath);
    let childPath = relativePath;

    while (currentPath !== '.') {
      if (!processedDirs.has(currentPath)) {
        nodes.push({
          id: currentPath,
          name: path.basename(currentPath),
          type: 'folder',
          path: currentPath,
        });
        processedDirs.add(currentPath);
      }
      
      links.push({
        source: currentPath,
        target: childPath,
        type: 'containment',
      });

      childPath = currentPath;
      currentPath = path.dirname(currentPath);
    }
    
    // Add link from root ('.') to top-level items if needed
    if (childPath !== relativePath || !relativePath.includes(path.sep)) {
        links.push({
            source: 'root',
            target: childPath,
            type: 'containment'
        });
    }
  }
  
  // Add root node
  nodes.push({ id: 'root', name: path.basename(rootDir) || 'root', type: 'folder', path: '.' });

  // Analyze TS dependencies
  for (const sourceFile of project.getSourceFiles()) {
    const sourcePath = path.relative(rootDir, sourceFile.getFilePath());
    
    const imports = sourceFile.getImportDeclarations();
    for (const imp of imports) {
      const moduleSpecifier = imp.getModuleSpecifierValue();
      const resolvedFile = imp.getModuleSpecifierSourceFile();
      
      if (resolvedFile) {
        const targetPath = path.relative(rootDir, resolvedFile.getFilePath());
        links.push({
          source: sourcePath,
          target: targetPath,
          type: 'import',
        });
      }
    }
    
    // Simple export analysis could be added here
  }

  // Deduplicate links
  const uniqueLinks = Array.from(new Set(links.map(l => `${l.source}|${l.target}|${l.type}`)))
    .map(s => {
      const [source, target, type] = s.split('|');
      return { source, target, type: type as any };
    });

  return { nodes, links: uniqueLinks };
}
