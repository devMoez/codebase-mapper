import { scanRepo } from './scanner'
import { extractMetadata } from './extractor'
import path from 'node:path'
import fs from 'node:fs/promises'

let currentRootDir = ""; // Start empty to force user selection

export async function startServer(port = 3000) {
  console.log(`\x1b[36m🚀 Codebase Mapper GUI starting on http://localhost:${port}\x1b[0m`)

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Codebase Mapper | AI Navigation</title>
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
    <!-- Initial Directory Picker Modal -->
    <div id="dir-modal" class="fixed inset-0 z-[100] bg-slate-950/90 flex items-center justify-center">
        <div class="bg-slate-900 p-8 rounded-2xl border border-slate-700 w-96 text-center shadow-2xl">
            <h2 class="text-2xl font-black mb-4">Select Codebase</h2>
            <input id="initial-dir" type="text" placeholder="Enter absolute path..." class="w-full bg-slate-800 p-3 rounded-lg mb-4 font-mono text-sm">
            <button onclick="setDir()" class="w-full bg-cyan-600 py-3 rounded-lg font-bold">Initialize Map</button>
        </div>
    </div>

    <header class="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900 shadow-xl">
        <div class="flex items-center gap-6">
            <h1 class="text-xl font-bold text-cyan-400"><span>🗺️</span> Codebase Mapper</h1>
            <div class="flex bg-slate-800 p-1 rounded-lg">
                <button onclick="switchTab('explorer')" id="tab-explorer" class="tab-btn active px-4 py-1 text-sm font-medium transition">Explorer</button>
                <button onclick="switchTab('graph')" id="tab-graph" class="tab-btn px-4 py-1 text-sm font-medium transition">Mind Map</button>
            </div>
        </div>
        <div class="flex gap-4">
            <button onclick="copyFullMap()" class="bg-slate-800 px-4 py-1.5 rounded-lg text-xs font-bold text-slate-300">Copy Map</button>
        </div>
    </header>

    <main class="flex-1 flex overflow-hidden">
        <aside class="w-80 border-r border-slate-800 flex flex-col bg-slate-900/50">
            <div class="p-4"><input type="text" id="file-search" oninput="filterTree()" placeholder="Search..." class="w-full bg-slate-800 p-2 rounded text-sm"></div>
            <div id="tree" class="flex-1 overflow-y-auto p-2 file-tree text-sm"></div>
        </aside>

        <section class="flex-1 flex flex-col bg-slate-950">
            <div id="explorer-view" class="h-full p-6"><div id="content-view"></div></div>
            <div id="graph-view" class="h-full hidden"><div id="graph-container"></div></div>
        </section>

        <aside class="w-96 border-l border-slate-800 bg-slate-900 p-4">
            <h2 class="font-bold mb-4">📦 AI Context Bundle</h2>
            <div id="packer-list" class="flex-1 space-y-2 mb-4"></div>
            <button id="generate-btn" onclick="generateBundle()" class="w-full bg-cyan-600 py-3 rounded-lg font-bold">Copy Context Bundle</button>
        </aside>
    </main>

    <script>
        let scanData = null;
        let selectedForPacker = new Set();
        let graphInstance = null;

        async function setDir() {
            const dir = document.getElementById('initial-dir').value;
            const res = await fetch('/api/config', { method: 'POST', body: JSON.stringify({ rootDir: dir }) });
            if (res.ok) { document.getElementById('dir-modal').style.display = 'none'; loadScan(); }
            else alert("Invalid path");
        }

        async function loadScan() {
            const res = await fetch('/api/scan');
            scanData = await res.json();
            renderTree();
        }

        function filterTree() {
            const query = document.getElementById('file-search').value.toLowerCase();
            document.querySelectorAll('.tree-item').forEach(el => el.style.display = el.dataset.name.includes(query) ? 'block' : 'none');
        }

        function renderTree() {
            const root = {};
            scanData.structure.forEach(path => {
                let curr = root;
                path.split(/[\\\\/]/).forEach((part, i, arr) => {
                    if(!curr[part]) curr[part] = { _path: i === arr.length - 1 ? path : null };
                    curr = curr[part];
                });
            });

            function html(obj, name) {
                const isFile = !!obj._path;
                let s = \`<div class="tree-item" data-name="\${name.toLowerCase()}">\`;
                if(isFile) s += \`<button onclick="viewFile('\${obj._path.replace(/\\\\/g, '\\\\\\\\')}')" class="text-xs p-1 hover:text-cyan-400">\${name}</button>\`;
                else {
                    s += \`<div class="text-[10px] font-bold text-slate-500 uppercase mt-2">\${name}</div>\`;
                    Object.keys(obj).filter(k => k !== '_path').forEach(k => s += html(obj[k], k));
                }
                return s + '</div>';
            }
            document.getElementById('tree').innerHTML = Object.keys(root).map(k => html(root[k], k)).join('');
        }

        async function viewFile(path) {
            const res = await fetch(\`/api/file?path=\${encodeURIComponent(path)}\`);
            const data = await res.json();
            document.getElementById('content-view').innerHTML = \`
                <h2 class="text-2xl font-black">\${data.name}</h2>
                <p class="text-cyan-500 font-mono text-xs">\${path}</p>
                <div class="bg-slate-900 p-4 mt-4 rounded">Summary: \${data.summary}</div>
                <button onclick="togglePacker('\${path.replace(/\\\\/g, '\\\\\\\\')}')" class="mt-4 bg-cyan-600 px-4 py-2 rounded">Add to Bundle</button>
            \`;
        }

        function togglePacker(path) {
            if (selectedForPacker.has(path)) selectedForPacker.delete(path);
            else selectedForPacker.add(path);
            renderPacker();
        }

        function renderPacker() {
            document.getElementById('packer-list').innerHTML = Array.from(selectedForPacker).map(p => \`<div class="bg-slate-800 p-2 text-xs truncate">\${p}</div>\`).join('');
        }

        async function generateBundle() {
            let bundle = "AI CONTEXT BUNDLE\\n=================\\n\\n";
            for (const path of selectedForPacker) {
                const res = await fetch(\`/api/file?path=\${encodeURIComponent(path)}\`);
                const meta = await res.json();
                bundle += \`FILE: \${path}\\nSUMMARY: \${meta.summary}\\n\\n---\\n\\n\`;
            }
            navigator.clipboard.writeText(bundle);
            alert("Context copied!");
        }

        function renderGraph() {
            const nodes = scanData.structure.map(p => ({ id: p, name: p.split(/[\\\\/]/).pop() }));
            graphInstance = ForceGraph()(document.getElementById('graph-container'))
                .graphData({ nodes, links: [] })
                .nodeLabel('name')
                .width(document.getElementById('graph-container').offsetWidth)
                .height(document.getElementById('graph-container').offsetHeight);
        }

        function switchTab(t) {
            document.getElementById('explorer-view').classList.toggle('hidden', t !== 'explorer');
            document.getElementById('graph-view').classList.toggle('hidden', t !== 'graph');
            if(t === 'graph') renderGraph();
        }
    </script>
</body>
</html>
  `;

  return Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/') return new Response(html, { headers: { 'Content-Type': 'text/html' } })
      if (url.pathname === '/api/scan') return Response.json(await scanRepo(currentRootDir))
      if (url.pathname === '/api/config') {
          const body = await req.json();
          try { await fs.access(body.rootDir); currentRootDir = body.rootDir; return new Response('OK'); }
          catch (e) { return new Response('Err', { status: 400 }); }
      }
      if (url.pathname === '/api/file') return Response.json(await extractMetadata(url.searchParams.get('path')!, currentRootDir))
      return new Response('Not Found', { status: 404 })
    }
  })
}
