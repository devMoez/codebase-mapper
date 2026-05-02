# 🗺️ Codebase Mapper: "Central Nervous System" Upgrade Plan ✅

This document tracks the implementation of advanced features to turn Codebase Mapper into the structural core of an AI-driven development environment.

## 🛠️ Roadmap

### 1. 🔄 Incremental / Watch Mode ✅
- [x] Integrate `chokidar` for real-time file system monitoring.
- [x] Implement partial re-parsing: only update changed files in the SQLite DB.
- [x] Add a `--watch` CLI flag.

### 2. 🔍 Syntax-Aware Symbol Extraction (Deep AST) ✅
- [x] Expand `ts-morph` usage to capture:
    - [x] Function signatures (params, return types).
    - [x] Class hierarchies (extends/implements).
    - [x] Interface/Trait definitions.
    - [x] Variable/Constant exports.

### 3. 🔗 Advanced Dependency Resolution ✅
- [x] Implement transitive dependency calculation (A -> B -> C => A -> C).
- [x] Identify unused dependencies (files with 0 incoming imports).
- [x] Track "Dynamic Imports" (e.g., `import()`) as potential links.

### 4. 🏢 Multi-Project / Monorepo Support ✅
- [x] Support a `codemap.yaml` or manifest file for multiple roots.
- [x] Unified graph for cross-project dependencies.

### 5. 🛡️ Intelligent Ignore & Config ✅
- [x] Auto-detect and respect `.gitignore`, `.dockerignore`.
- [x] Support `.codemapignore`.

### 6. 📄 Multi-Format Output ✅
- [x] **Markdown**: Rich, clickable documentation.
- [x] **DOT (Graphviz)**: For visual graph rendering.
- [x] **SQLite**: Optimized schema for direct memory kernel ingestion.

### 7. 🤖 AI-Ready Context Packets ✅
- [x] Implement a context generator that finds relevant files based on a query.
- [x] Assemble "perfect context" strings (structure + purpose + code snippets).

### 8. 📜 History & Versioning ✅
- [x] Track graph snapshots in the SQLite DB.
- [x] Implement basic diffing between snapshots.

### 9. 📝 Self-Documentation Stub Generator ✅
- [x] Logic to write `// Purpose: [extracted symbols]` comments back to files that lack them.

---

## 📅 Execution Strategy
1. **Infrastructure**: Setup Intelligent Ignore and Multi-Project support.
2. **Deep Scanning**: Upgrade AST extraction and Dependency logic.
3. **Dynamics**: Implement Watch Mode and History.
4. **Interface**: Add the Context Packet generator and Multi-Format outputs.
