import { scanRepo } from './scanner'
import { extractMetadata } from './extractor'
import path from 'node:path'
import fs from 'node:fs/promises'

let currentRootDir = process.cwd();

export async function startServer(port = 3000) {
  console.log(`\x1b[36m🚀 Codebase Mapper GUI starting on http://localhost:${port}\x1b[0m`)

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Codebase Mapper | Interactive Mind-Map</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/force-graph"></script>
    <style>
        body { background-color: #0f172a; color: #e2e8f0; font-family: 'Inter', sans-serif; }
        .file-tree::-webkit-scrollbar { width: 4px; }
        .file-tree::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }
        .active-item { background-color: #1e293b; border-left: 2px solid #22d3ee; }
        #graph-container { height: 100%; width: 100%; }
        .tab-btn.active { border-bottom: 2px solid #22d3ee; color: #22d3ee; }
    </style>
</head>
<body class="h-screen flex flex-col overflow-hidden">
    <header class="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900 shadow-xl z-50">
        <div class="flex items-center gap-6">
            <h1 class="text-xl font-bold text-cyan-400 flex items-center gap-2">
                <span>🛰️</span> Codebase Mapper
            </h1>
            <div class="flex bg-slate-800 p-1 rounded-lg">
                <button onclick="switchTab('explorer')" id="tab-explorer" class="tab-btn active px-4 py-1 text-sm font-medium transition">Explorer</button>
                <button onclick="switchTab('graph')" id="tab-graph" class="tab-btn px-4 py-1 text-sm font-medium transition">Mind Map</button>
            </div>
        </div>
        
        <div class="flex items-center gap-4">
            <div class="flex items-center gap-2 bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700">
                <span class="text-xs text-slate-500 font-mono">ROOT:</span>
                <input id="root-input" type="text" value="${currentRootDir.replace(/\\/g, '/')}" class="bg-transparent border-none text-xs text-slate-300 w-64 focus:ring-0" />
                <button onclick="changeDir()" class="text-cyan-500 text-xs font-bold hover:text-cyan-400">CHANGE</button>
            </div>
            <button onclick="copyFullMap()" class="bg-cyan-600 hover:bg-cyan-500 px-4 py-1.5 rounded-lg text-sm font-bold transition shadow-lg shadow-cyan-900/20">Copy Map</button>
        </div>
    </header>

    <main class="flex-1 flex overflow-hidden">
        <!-- Sidebar -->
        <aside class="w-80 border-r border-slate-800 flex flex-col bg-slate-900/50">
            <div class="p-4 border-b border-slate-800">
                <input type="text" id="file-search" oninput="filterTree()" placeholder="Search files..." class="w-full bg-slate-800 border-none rounded-md px-3 py-1.5 text-sm focus:ring-1 focus:ring-cyan-500">
            </div>
            <div id="tree" class="flex-1 overflow-y-auto p-2 file-tree text-sm">
                <div class="p-4 text-center opacity-50 animate-pulse">Scanning Codebase...</div>
            </div>
        </aside>

        <!-- Main Workspace -->
        <section class="flex-1 flex flex-col bg-slate-950 relative">
            <div id="explorer-view" class="h-full flex flex-col">
                <nav id="breadcrumbs" class="p-3 border-b border-slate-800 text-[10px] uppercase tracking-widest text-slate-500 flex gap-2">
                    root /
                </nav>
                <div class="flex-1 p-6 overflow-y-auto">
                    <div id="content-view" class="max-w-4xl mx-auto space-y-6">
                        <div class="text-center py-32 opacity-20">
                            <div class="text-8xl mb-4">🛸</div>
                            <p class="text-xl font-light">Select a file to begin extraction</p>
                        </div>
                    </div>
                </div>
            </div>

            <div id="graph-view" class="h-full hidden">
                <div id="graph-container"></div>
                <div class="absolute bottom-4 right-4 bg-slate-900/80 p-3 rounded-lg border border-slate-800 text-[10px] text-slate-400">
                    <p>● Scroll to zoom</p>
                    <p>● Drag to move</p>
                    <p>● Click node to focus</p>
                </div>
            </div>
        </section>

        <!-- AI Packer -->
        <aside class="w-96 border-l border-slate-800 bg-slate-900 p-4 space-y-6 flex flex-col shadow-2xl">
            <h2 class="font-bold text-slate-300 flex items-center gap-2">
                <span>📦</span> AI Packer
            </h2>
            <div class="bg-slate-800/50 border border-slate-700 rounded-xl p-4 space-y-4 flex-1 flex flex-col">
                <p class="text-[10px] uppercase tracking-tighter text-slate-500 font-bold">Bundle Content</p>
                <div id="packer-list" class="flex-1 overflow-y-auto space-y-2 pr-2 file-tree">
                    <p class="text-center text-xs opacity-20 py-10 italic">Your bundle is empty</p>
                </div>
                <div class="pt-4 border-t border-slate-800 space-y-3">
                    <div class="flex justify-between text-xs text-slate-400">
                        <span>Items:</span>
                        <span id="packer-count">0</span>
                    </div>
                    <button id="generate-btn" disabled onclick="generateBundle()" class="w-full bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-bold py-3 rounded-lg transition-all active:scale-95">
                        Copy Bundle for AI
                    </button>
                    <button onclick="clearPacker()" class="w-full text-xs text-slate-600 hover:text-red-400 transition">Clear All</button>
                </div>
            </div>
        </aside>
    </main>

    <script>
        let scanData = null;
        let selectedForPacker = new Set();
        let currentPath = null;
        let graphInstance = null;

        async function loadScan() {
            try {
                const res = await fetch('/api/scan');
                scanData = await res.json();
                renderTree();
                if (document.getElementById('graph-view').classList.contains('hidden') === false) {
                    renderGraph();
                }
            } catch (e) {
                console.error("Scan failed", e);
            }
        }

        function switchTab(tab) {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.getElementById('tab-' + tab).classList.add('active');
            
            if (tab === 'explorer') {
                document.getElementById('explorer-view').classList.remove('hidden');
                document.getElementById('graph-view').classList.add('hidden');
            } else {
                document.getElementById('explorer-view').classList.add('hidden');
                document.getElementById('graph-view').classList.remove('hidden');
                setTimeout(renderGraph, 100);
            }
        }

        async function changeDir() {
            const newDir = document.getElementById('root-input').value;
            const res = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rootDir: newDir })
            });
            if (res.ok) {
                location.reload();
            } else {
                alert("Directory not found or inaccessible");
            }
        }

        function renderTree() {
            const treeEl = document.getElementById('tree');
            treeEl.innerHTML = '';
            
            const root = {};
            scanData.structure.forEach(path => {
                let current = root;
                const parts = path.split(/[\\\\/]/);
                parts.forEach((part, index) => {
                    if (!current[part]) current[part] = { _isDir: index < parts.length - 1 };
                    if (index === parts.length - 1) current[part]._path = path;
                    current = current[part];
                });
            });

            function buildHtml(obj, name, depth = 0) {
                const isFile = !!obj._path;
                const path = obj._path;
                const id = 'tree-' + Math.random().toString(36).substr(2, 9);
                
                let html = \`<div class="tree-item" data-name="\${name.toLowerCase()}">\`;
                if (isFile) {
                    const isActive = currentPath === path ? 'active-item' : '';
                    html += \`<button onclick="viewFile('\${path.replace(/\\\\/g, '\\\\\\\\')}')" class="w-full text-left hover:bg-slate-800 px-2 py-1.5 rounded flex items-center gap-2 group transition \${isActive}">
                        <span class="text-slate-500 text-xs">📄</span>
                        <span class="flex-1 truncate text-slate-300">\${name}</span>
                        <span onclick="togglePacker(event, '\${path.replace(/\\\\/g, '\\\\\\\\')}')" class="text-cyan-500 text-xs font-bold hover:scale-125 transition \${selectedForPacker.has(path) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}">
                            \${selectedForPacker.has(path) ? '✓' : '⊕'}
                        </span>
                    </button>\`;
                } else {
                    html += \`<div class="font-bold text-slate-500 px-2 py-1 mt-2 flex items-center gap-2 text-[10px] uppercase tracking-widest">
                        <span>📁</span> \${name}
                    </div>\`;
                    Object.keys(obj).filter(k => k !== '_path' && k !== '_isDir').sort((a,b) => {
                        const aIsDir = !obj[a]._path;
                        const bIsDir = !obj[b]._path;
                        if (aIsDir && !bIsDir) return -1;
                        if (!aIsDir && bIsDir) return 1;
                        return a.localeCompare(b);
                    }).forEach(k => {
                        html += buildHtml(obj[k], k, depth + 1);
                    });
                }
                html += '</div>';
                return html;
            }

            treeEl.innerHTML = Object.keys(root).sort().map(k => buildHtml(root[k], k)).join('');
        }

        function filterTree() {
            const query = document.getElementById('file-search').value.toLowerCase();
            document.querySelectorAll('.tree-item').forEach(item => {
                if (!item.dataset.name) return;
                const match = item.dataset.name.includes(query);
                item.style.display = match ? 'block' : 'none';
            });
        }

        async function viewFile(path) {
            currentPath = path;
            renderTree(); // Refresh for active state
            
            const res = await fetch(\`/api/file?path=\${encodeURIComponent(path)}\ house\`);
            const data = await res.json();
            
            document.getElementById('breadcrumbs').innerText = 'root / ' + path.replace(/[\\\\/]/g, ' / ');
            
            const view = document.getElementById('content-view');
            view.innerHTML = \`
                <div class="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                    <div class="flex justify-between items-start">
                        <div class="space-y-1">
                            <h2 class="text-3xl font-black text-white tracking-tight">\${data.name}</h2>
                            <p class="text-cyan-500 font-mono text-[10px] uppercase tracking-widest">\${path}</p>
                        </div>
                        <button onclick="togglePacker(null, '\${path.replace(/\\\\/g, '\\\\\\\\')}')" class="\${selectedForPacker.has(path) ? 'bg-green-600' : 'bg-cyan-600'} hover:opacity-80 px-6 py-2 rounded-lg text-sm font-black transition-all shadow-lg shadow-cyan-900/20">
                            \${selectedForPacker.has(path) ? 'Added to Bundle' : 'Add to Bundle'}
                        </button>
                    </div>

                    <div class="bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-inner">
                        <h3 class="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Logic Summary</h3>
                        <p class="text-xl text-slate-100 leading-relaxed font-light italic text-cyan-50/90">"\${data.summary}"</p>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div class="bg-slate-900/50 p-6 rounded-2xl border border-slate-800">
                            <h3 class="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">Exported Symbols</h3>
                            <div class="flex flex-wrap gap-2">
                                \${data.exports.map(e => \`<span class="bg-cyan-950/30 text-cyan-400 px-3 py-1 rounded-full text-xs border border-cyan-800/30 font-medium">\${e}</span>\`).join('') || '<span class="opacity-20 text-xs italic">No symbols exported</span>'}
                            </div>
                        </div>
                        <div class="bg-slate-900/50 p-6 rounded-2xl border border-slate-800">
                            <h3 class="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">Imports / Deps</h3>
                            <div class="flex flex-wrap gap-2">
                                \${data.dependencies.map(d => \`<span class="bg-slate-800 text-slate-400 px-3 py-1 rounded-full text-xs border border-slate-700">\${d}</span>\`).join('') || '<span class="opacity-20 text-xs italic">No external dependencies</span>'}
                            </div>
                        </div>
                    </div>
                </div>
            \`;
        }

        function togglePacker(e, path) {
            if (e) e.stopPropagation();
            if (selectedForPacker.has(path)) selectedForPacker.delete(path);
            else selectedForPacker.add(path);
            renderPacker();
            renderTree();
        }

        function clearPacker() {
            selectedForPacker.clear();
            renderPacker();
            renderTree();
        }

        function renderPacker() {
            const list = document.getElementById('packer-list');
            const count = document.getElementById('packer-count');
            const btn = document.getElementById('generate-btn');
            
            count.innerText = selectedForPacker.size;
            btn.disabled = selectedForPacker.size === 0;

            if (selectedForPacker.size === 0) {
                list.innerHTML = '<p class="text-center text-xs opacity-20 py-10 italic">Your bundle is empty</p>';
                return;
            }
            list.innerHTML = Array.from(selectedForPacker).map(path => \`
                <div class="flex items-center justify-between bg-slate-800/80 border border-slate-700/50 px-3 py-2 rounded-lg text-xs text-slate-300 group hover:border-cyan-500/30 transition">
                    <span class="truncate flex-1 font-mono text-[10px]">\${path.split(/[\\\\/]/).pop()}</span>
                    <button onclick="togglePacker(null, '\${path.replace(/\\\\/g, '\\\\\\\\')}')" class="text-slate-500 hover:text-red-400 font-bold ml-2">✕</button>
                </div>
            \`).join('');
        }

        async function generateBundle() {
            const bundle = [];
            for (const path of selectedForPacker) {
                const res = await fetch(\`/api/file?path=\${encodeURIComponent(path)}\`);
                const meta = await res.json();
                bundle.push(\`FILE: \${path}\\nSUMMARY: \${meta.summary}\\nSYMBOLS: \${meta.exports.join(', ') || 'None'}\\n\\n---\`);
            }
            
            const text = "AI NAVIGATION CONTEXT\\nGenerated by Codebase Mapper\\n\\n" + bundle.join("\\n\\n");
            navigator.clipboard.writeText(text);
            const btn = document.getElementById('generate-btn');
            const old = btn.innerText;
            btn.innerText = "COPIED!";
            btn.classList.replace('bg-cyan-600', 'bg-green-600');
            setTimeout(() => {
                btn.innerText = old;
                btn.classList.replace('bg-green-600', 'bg-cyan-600');
            }, 2000);
        }

        function renderGraph() {
            const nodes = [];
            const links = [];
            const root = { id: 'root', name: 'ROOT', val: 20, color: '#22d3ee' };
            nodes.push(root);

            const dirNodes = new Map();

            scanData.structure.forEach(path => {
                const parts = path.split(/[\\\\/]/);
                let parentId = 'root';
                
                parts.forEach((part, i) => {
                    const isLast = i === parts.length - 1;
                    const id = parts.slice(0, i + 1).join('/');
                    
                    if (!isLast) {
                        if (!dirNodes.has(id)) {
                            const node = { id, name: part, val: 5, color: '#334155' };
                            nodes.push(node);
                            links.push({ source: parentId, target: id });
                            dirNodes.set(id, node);
                        }
                        parentId = id;
                    } else {
                        const fileNode = { id, name: part, val: 2, color: '#64748b' };
                        nodes.push(fileNode);
                        links.push({ source: parentId, target: id });
                    }
                });
            });

            if (graphInstance) graphInstance._destructor();
            
            graphInstance = ForceGraph()(document.getElementById('graph-container'))
                .graphData({ nodes, links })
                .nodeLabel('name')
                .nodeColor(node => node.color)
                .nodeVal(node => node.val)
                .linkColor(() => '#1e293b')
                .backgroundColor('#0f172a')
                .onNodeClick(node => {
                    if (node.id !== 'root' && !dirNodes.has(node.id)) {
                        switchTab('explorer');
                        viewFile(node.id);
                    }
                })
                .width(document.getElementById('graph-container').offsetWidth)
                .height(document.getElementById('graph-container').offsetHeight);
        }

        window.addEventListener('resize', () => {
            if (graphInstance) {
                graphInstance.width(document.getElementById('graph-container').offsetWidth);
                graphInstance.height(document.getElementById('graph-container').offsetHeight);
            }
        });

        loadScan();
    </script>
</body>
</html>
  `;

  return Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url)

      if (url.pathname === '/') return new Response(html, { headers: { 'Content-Type': 'text/html' } })

      if (url.pathname === '/api/scan') {
        const scanData = await scanRepo(currentRootDir)
        return Response.json(scanData)
      }

      if (url.pathname === '/api/config') {
        if (req.method === 'POST') {
          const body = await req.json();
          if (body.rootDir) {
            try {
              await fs.access(body.rootDir);
              currentRootDir = body.rootDir;
              return new Response('OK');
            } catch (e) {
              return new Response('Invalid Directory', { status: 400 });
            }
          }
        }
      }

      if (url.pathname === '/api/file') {
        const filePath = url.searchParams.get('path')
        if (!filePath) return new Response('Path required', { status: 400 })
        const metadata = await extractMetadata(filePath, currentRootDir)
        return Response.json(metadata)
      }

      return new Response('Not Found', { status: 404 })
    }
  })
}
