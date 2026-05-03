// Purpose: Core logic for generateAISummary, assembleContext, getHotspots
import fs from 'node:fs/promises';
import path from 'node:path';
import { CodeGraph, getTreeChildren, GraphNode, searchNodes, getTransitiveDependencies, getUnusedFiles } from './parser';

export async function generateMarkdownMap(rootDir: string, graph: CodeGraph) {
    const mapperDir = path.join(rootDir, '.codemap');
    let md = "# Codebase Map\n\n";
    
    for (const node of graph.nodes.filter(n => n.type === 'file')) {
        md += `## ${node.id}\n`;
        const symbols = graph.nodes.filter(s => s.type === 'symbol' && s.id.startsWith(`${node.id}::`));
        if (symbols.length > 0) {
            md += "### Symbols\n";
            for (const s of symbols) {
                md += `- \`${s.name}\` (${s.meta.kind || 'unknown'})\n`;
            }
            md += "\n";
        }
        
        const deps = graph.links.filter(l => l.source === node.id && l.type === 'import');
        if (deps.length > 0) {
            md += "### Dependencies\n";
            for (const d of deps) {
                md += `- ${d.target}\n`;
            }
            md += "\n";
        }
        md += "---\n\n";
    }
    await fs.writeFile(path.join(mapperDir, 'map.md'), md);
    await fs.writeFile(path.join(rootDir, 'map.md'), md);
}

export async function generateJsonMap(rootDir: string, graph: CodeGraph) {
    const mapperDir = path.join(rootDir, '.codemap');
    const unused = getUnusedFiles();
    const jsonMap = graph.nodes.filter(n => n.type === 'file').map(node => {
        const symbols = graph.nodes.filter(s => s.type === 'symbol' && s.id.startsWith(`${node.id}::`)).map(s => s.name);
        const deps = graph.links.filter(l => l.source === node.id && l.type === 'import').map(l => l.target);
        const transitive = getTransitiveDependencies(node.id);
        
        return {
            path: node.id,
            purpose: node.meta.summary || "",
            symbols: symbols,
            dependencies: deps,
            transitive_dependencies: transitive,
            is_unused: unused.some(u => u.id === node.id)
        };
    });
    
    const content = JSON.stringify(jsonMap, null, 4);
    await fs.writeFile(path.join(mapperDir, 'map.json'), content);
    await fs.writeFile(path.join(rootDir, 'map.json'), content);
}

export async function generateDotGraph(rootDir: string, graph: CodeGraph) {
    const mapperDir = path.join(rootDir, '.codemap');
    let dot = 'digraph G {\n  rankdir=LR;\n  node [shape=box, fontname="Arial"];\n';
    
    for (const node of graph.nodes.filter(n => n.type === 'file')) {
        dot += `  "${node.id}" [label="${node.name}"];\n`;
        const deps = graph.links.filter(l => l.source === node.id && l.type === 'import');
        for (const dep of deps) {
            dot += `  "${node.id}" -> "${dep.target}";\n`;
        }
    }
    dot += '}\n';
    
    await fs.writeFile(path.join(mapperDir, 'map.dot'), dot);
    await fs.writeFile(path.join(rootDir, 'map.dot'), dot);
}

export async function generateAISummary(rootDir: string, graph: CodeGraph) {
    const mapperDir = path.join(rootDir, '.codemap');
    await fs.mkdir(mapperDir, { recursive: true });

    // 1. Generate Plain Directory Tree (tree.txt)
    function buildTreeString(parentPath: string, indent: string = ''): string {
        let result = '';
        const children = getTreeChildren(parentPath);
        
        children.sort((a, b) => {
            if (a.type === b.type) return a.name.localeCompare(b.name);
            return a.type === 'folder' ? -1 : 1;
        });

        children.forEach((child, index) => {
            if (child.type === 'symbol') return;
            const isLast = index === children.length - 1;
            const prefix = isLast ? '└── ' : '├── ';
            result += `${indent}${prefix}${child.name}${child.type === 'folder' ? '/' : ''}\n`;
            if (child.type === 'folder') {
                result += buildTreeString(child.id, indent + (isLast ? '    ' : '│   '));
            }
        });
        return result;
    }

    const treeStr = buildTreeString('.');
    await fs.writeFile(path.join(mapperDir, 'tree.txt'), treeStr);

    // 2. Identify Entry Points
    const entryPointPatterns = ['index', 'main', 'app', 'server', 'entry'];
    const entryPoints = graph.nodes.filter(n => 
        n.type === 'file' && entryPointPatterns.some(p => n.name.toLowerCase().includes(p))
    );

    // 3. Generate summary.json
    const hotspots = getHotspots(graph);
    const unused = getUnusedFiles();
    const summaryJson = {
        project: path.basename(rootDir),
        stats: {
            files: graph.nodes.filter(n => n.type === 'file').length,
            folders: graph.nodes.filter(n => n.type === 'folder').length,
            symbols: graph.nodes.filter(n => n.type === 'symbol').length,
        },
        entryPoints: entryPoints.map(e => e.id),
        structure: treeStr.split('\n').filter(line => line.trim() !== ''),
        hotspots: hotspots.map(h => h.path),
        nodes: graph.nodes.map(n => ({
            id: n.id,
            name: n.name,
            type: n.type,
            path: n.id,
            meta: n.meta
        }))
    };
    await fs.writeFile(path.join(mapperDir, 'summary.json'), JSON.stringify(summaryJson, null, 2));

    // 4. Generate README.md
    const readmeContent = `# 🌌 Project Map: ${path.basename(rootDir)}

> **AI INSTRUCTIONS:** Use this map to navigate instead of broad searches. 
> The dependency graph is available in \`.codemap/summary.json\`.

## 🌲 Directory Structure
\`\`\`text
${treeStr}
\`\`\`

## 📍 Logic Entry Points
These are the primary entry points discovered in the project:
${entryPoints.map(e => `- \`${e.id}\``).join('\n')}

## 🚀 Architectural Hotspots
Most imported files (Likely core logic or shared types):
${hotspots.map(h => `- \`${h.path}\` (${h.count} imports)`).join('\n')}

## 💀 Dead Code (Potential)
Files that are not imported by any other file:
${unused.map(u => `- \`${u.id}\``).join('\n')}

## ⚙️ How to use
- **Read:** \`.codemap/summary.json\` for the full knowledge graph.
- **Visualize:** Run \`3d 3d\` in the root to start the 3D server.

---
*Generated by Codebase Mapper*`;

    await fs.writeFile(path.join(mapperDir, 'README.md'), readmeContent);
    
    // 5. Update .gitignore
    const gitignorePath = path.join(rootDir, '.gitignore');
    try {
        const gitignore = await fs.readFile(gitignorePath, 'utf8');
        if (!gitignore.includes('.codemap/')) {
            await fs.appendFile(gitignorePath, '\n# Codebase Mapper\n.codemap/\n');
        }
    } catch (e) {
        await fs.writeFile(gitignorePath, '# Codebase Mapper\n.codemap/\n');
    }
}

export async function assembleContext(rootDir: string, query: string, tokenLimit: number = 4000): Promise<string> {
    const matches = searchNodes(query, 5);
    
    let context = `### 🧠 AI CONTEXT PACKET: "${query}"\n\n`;
    context += `The following project structure and files are relevant to your query:\n\n`;

    const relevantPaths = new Set<string>();
    matches.forEach(m => {
        relevantPaths.add(m.id);
        getTransitiveDependencies(m.id).forEach(d => relevantPaths.add(d));
    });

    context += `#### 🌲 Relevant Structure\n`;
    relevantPaths.forEach(p => context += `- ${p}\n`);
    
    context += `\n#### 📄 File Contents\n`;
    for (const p of Array.from(relevantPaths).slice(0, 5)) {
        try {
            const absPath = path.resolve(rootDir, p).replace(/\\/g, '/');
            const content = await fs.readFile(absPath, 'utf8');
            context += `\n--- FILE: ${p} ---\n\`\`\`typescript\n${content.slice(0, 2000)}\n\`\`\`\n`;
        } catch (e) {}
    }

    return context;
}

function getHotspots(graph: CodeGraph) {
    const importCounts = new Map<string, number>();
    graph.links.filter(l => l.type === 'import').forEach(link => {
        importCounts.set(link.target, (importCounts.get(link.target) || 0) + 1);
    });

    return Array.from(importCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([path, count]) => ({ path, count }));
}
