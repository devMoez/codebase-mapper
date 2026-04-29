# 🌌 Codebase Mapper 3D

Generate an interactive, high-performance 3D force-directed graph of your codebase. Stop wasting tokens on exploration and visualize your architecture in real-time.

## 🚀 Features

1.  **3D Force-Directed Graph**: Interactive visualization of files, folders, and dependencies.
2.  **Command Palette (⌘K / Ctrl+K)**: Universal search to jump to any node instantly.
3.  **Impact View**: Trace transitive dependencies to see the blast radius of changes.
4.  **Real-Time Live Updates**: Powered by `chokidar` and WebSockets; watch the graph evolve as you code.
5.  **Path Finding**: Select two nodes to find the shortest dependency path between them.
6.  **Smart Filtering**: Toggle between structural containment and import/export views.

## 🛠️ Usage

```bash
# Install dependencies
bun install

# Run the 3D visualizer
bun src/index.ts --3d [path/to/project]
```

The visualizer will open automatically at `http://localhost:3000`.

## 📦 Tech Stack

- **Backend**: Bun, Express, `ts-morph` (for AST parsing), `chokidar`.
- **Frontend**: `3d-force-graph` (Three.js), Tailwind CSS.

## 🛡️ Requirements

- [Bun](https://bun.sh/) installed.
- TypeScript codebase for best results (supports Python/Go/Rust with basic file-level links).
