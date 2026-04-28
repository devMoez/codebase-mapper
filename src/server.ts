import { scanRepo } from './scanner'
import { extractMetadata } from './extractor'
import path from 'node:path'

export async function startServer(port = 3000) {
  const rootDir = process.cwd()
  
  console.log(`\x1b[36m🚀 Codebase Mapper GUI starting on http://localhost:${port}\x1b[0m`)

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Codebase Mapper Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body { background-color: #0f172a; color: #e2e8f0; }
        .file-tree::-webkit-scrollbar { width: 4px; }
        .file-tree::-webkit-scrollbar-thumb { background: #334155; border-radius: 10px; }
    </style>
</head>
<body class="h-screen flex flex-col overflow-hidden">
    <header class="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900">
        <h1 class="text-xl font-bold text-cyan-400 flex items-center gap-2">
            <span>🗺️</span> Codebase Mapper
        </h1>
        <div class="flex gap-4">
            <button onclick="copyFullMap()" class="bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-lg text-sm transition">Copy Full Map</button>
            <div id="status" class="text-sm text-slate-400 flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> Connected
            </div>
        </div>
    </header>

    <main class="flex-1 flex overflow-hidden">
        <!-- Sidebar: File Tree -->
        <aside class="w-80 border-r border-slate-800 flex flex-col bg-slate-900/50">
            <div class="p-4 border-b border-slate-800">
                <input type="text" placeholder="Search files..." class="w-full bg-slate-800 border-none rounded-md px-3 py-1.5 text-sm focus:ring-1 focus:ring-cyan-500">
            </div>
            <div id="tree" class="flex-1 overflow-y-auto p-2 file-tree text-sm">
                Loading codebase...
            </div>
        </aside>

        <!-- Main View -->
        <section class="flex-1 flex flex-col bg-slate-950">
            <!-- Breadcrumbs -->
            <nav id="breadcrumbs" class="p-3 border-b border-slate-800 text-xs text-slate-500 flex gap-2">
                root /
            </nav>

            <div class="flex-1 p-6 overflow-y-auto">
                <div id="content-view" class="max-w-4xl mx-auto space-y-6">
                    <div class="text-center py-20 opacity-50">
                        <div class="text-5xl mb-4">📂</div>
                        <p>Select a file or folder to view details and summaries</p>
                    </div>
                </div>
            </div>
        </section>

        <!-- Right Panel: The Packer -->
        <aside class="w-96 border-l border-slate-800 bg-slate-900 p-4 space-y-6">
            <h2 class="font-bold text-slate-300 flex items-center gap-2">
                <span>📦</span> AI Packer
            </h2>
            <div class="bg-slate-800/50 border border-slate-700 rounded-xl p-4 space-y-4">
                <p class="text-xs text-slate-400">Select multiple items to bundle them into a single prompt for your AI agent.</p>
                <div id="packer-list" class="space-y-2 max-h-60 overflow-y-auto">
                    <p class="text-center text-xs opacity-30 py-4 italic">No items selected</p>
                </div>
                <button onclick="generateBundle()" class="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-2 rounded-lg transition disabled:opacity-50">
                    Generate AI Bundle
                </button>
            </div>
        </aside>
    </main>

    <script>
        let scanData = null;
        const selectedForPacker = new Set();

        async function loadScan() {
            const res = await fetch('/api/scan');
            scanData = await res.json();
            renderTree();
        }

        function renderTree() {
            const treeEl = document.getElementById('tree');
            treeEl.innerHTML = '';
            
            const root = {};
            scanData.structure.forEach(path => {
                let current = root;
                path.split(/[\\\\/]/).forEach(part => {
                    if (!current[part]) current[part] = { _path: path };
                    current = current[part];
                });
            });

            function buildHtml(obj, name, depth = 0) {
                const isFile = Object.keys(obj).length === 1 && obj._path;
                const path = obj._path;
                
                let html = \`<div class="tree-item" style="padding-left: \${depth * 12}px">\`;
                if (isFile) {
                    html += \`<button onclick="viewFile('\${path}')" class="w-full text-left hover:bg-slate-800 px-2 py-1 rounded flex items-center gap-2 group transition">
                        <span class="text-slate-500">📄</span>
                        <span class="flex-1 truncate">\${name}</span>
                        <span onclick="togglePacker(event, '\${path}')" class="opacity-0 group-hover:opacity-100 text-cyan-500 text-xs">⊕</span>
                    </button>\`;
                } else {
                    html += \`<div class="font-semibold text-slate-400 px-2 py-1 mt-1 flex items-center gap-2">
                        <span>📁</span> \${name}
                    </div>\`;
                    Object.keys(obj).filter(k => k !== '_path').sort().forEach(k => {
                        html += buildHtml(obj[k], k, depth + 1);
                    });
                }
                html += '</div>';
                return html;
            }

            treeEl.innerHTML = Object.keys(root).sort().map(k => buildHtml(root[k], k)).join('');
        }

        async function viewFile(path) {
            const res = await fetch(\`/api/file?path=\${encodeURIComponent(path)}\`);
            const data = await res.json();
            
            document.getElementById('breadcrumbs').innerText = 'root / ' + path.replace(/[\\\\/]/g, ' / ');
            
            const view = document.getElementById('content-view');
            view.innerHTML = \`
                <div class="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div class="flex justify-between items-start">
                        <div>
                            <h2 class="text-2xl font-bold text-white">\${data.name}</h2>
                            <p class="text-slate-400 text-sm">\${path}</p>
                        </div>
                        <button onclick="togglePacker(null, '\${path}')" class="bg-cyan-600 hover:bg-cyan-500 px-4 py-1.5 rounded-md text-sm font-bold">Add to Packer</button>
                    </div>

                    <div class="bg-slate-900 p-4 rounded-xl border border-slate-800">
                        <h3 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Smart Summary</h3>
                        <p class="text-lg text-slate-200">\${data.summary}</p>
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div class="bg-slate-900/50 p-4 rounded-xl border border-slate-800">
                            <h3 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Exports / Symbols</h3>
                            <div class="flex flex-wrap gap-2">
                                \${data.exports.map(e => \`<span class="bg-slate-800 text-cyan-300 px-2 py-0.5 rounded text-xs border border-cyan-900/30">\${e}</span>\`).join('') || '<span class="opacity-30">None</span>'}
                            </div>
                        </div>
                        <div class="bg-slate-900/50 p-4 rounded-xl border border-slate-800">
                            <h3 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Dependencies</h3>
                            <div class="flex flex-wrap gap-2">
                                \${data.dependencies.map(d => \`<span class="bg-slate-800 text-slate-400 px-2 py-0.5 rounded text-xs">\${d}</span>\`).join('') || '<span class="opacity-30">None</span>'}
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
        }

        function renderPacker() {
            const list = document.getElementById('packer-list');
            if (selectedForPacker.size === 0) {
                list.innerHTML = '<p class="text-center text-xs opacity-30 py-4 italic">No items selected</p>';
                return;
            }
            list.innerHTML = Array.from(selectedForPacker).map(path => \`
                <div class="flex items-center justify-between bg-slate-800 px-3 py-1.5 rounded text-xs text-slate-300 group">
                    <span class="truncate flex-1">\${path.split(/[\\\\/]/).pop()}</span>
                    <button onclick="togglePacker(null, '\${path}')" class="text-slate-500 hover:text-red-400">✕</button>
                </div>
            \`).join('');
        }

        async function generateBundle() {
            const bundle = [];
            for (const path of selectedForPacker) {
                const res = await fetch(\`/api/file?path=\${encodeURIComponent(path)}\`);
                const meta = await res.json();
                bundle.push(\`File: \${path}\\nSummary: \${meta.summary}\\nExports: \${meta.exports.join(', ')}\`);
            }
            
            const text = "AI CONTEXT BUNDLE\\n=================\\n\\n" + bundle.join("\\n\\n---@---\\n\\n");
            navigator.clipboard.writeText(text);
            alert("AI Bundle copied to clipboard!");
        }

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
        const scanData = await scanRepo(rootDir)
        return Response.json(scanData)
      }

      if (url.pathname === '/api/file') {
        const filePath = url.searchParams.get('path')
        if (!filePath) return new Response('Path required', { status: 400 })
        const metadata = await extractMetadata(filePath, rootDir)
        return Response.json(metadata)
      }

      return new Response('Not Found', { status: 404 })
    }
  })
}
