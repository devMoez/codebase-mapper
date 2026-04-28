# 🗺️ Codebase Mapper

**Stop wasting AI tokens on "exploration" turns.**

Codebase Mapper is a lightweight, zero-dependency tool that generates a high-signal navigation map for AI coding agents (Claude, GPT, Gemini). It scans your repository, categorizes logic, builds a visual tree, and provides a "Source of Truth" that tells agents exactly where to go.

## 🚀 Why use this?

Most AI agents waste 3-5 turns just "looking around" your folders. This costs you money (tokens) and time.
Codebase Mapper fixes this by providing:
- **Graphified Tree:** A full visual representation of your repo.
- **Categorized Logic:** Automatically identifies API routes, UI components, AI logic, and more.
- **AI Instructions:** A ready-to-paste snippet that forces the agent to use the map instead of searching.

## 🛠️ Installation & Usage

### 1. Run it directly (Recommended)
You can run it in any project root using [Bun](https://bun.sh):

```bash
bun x codebase-mapper
```

*Or if you have the repo locally:*
```bash
bun src/index.ts
```

### 2. What happens next?
The tool creates a `.ai/map/` directory in your project root with 4 files:
1. `STRUCTURE.md`: The full architectural map.
2. `TECH_STACK.md`: Standards and frameworks.
3. `ENTRY_POINTS.md`: Where the logic starts.
4. `AI_INSTRUCTIONS.md`: **The most important file.**

### 3. Give it to your AI Agent
Copy the content of `.ai/map/AI_INSTRUCTIONS.md` and paste it into:
- Claude's Custom Instructions
- ChatGPT's Memory / Custom Instructions
- Cursor's `.cursorrules`
- Gemini CLI's memory files

## 📂 Project Structure
- `src/scanner.ts`: The brains. Crawls and categorizes files.
- `src/generator.ts`: The architect. Builds the markdown maps and tree.
- `src/index.ts`: The entry point.

## 🛡️ Privacy & Safety
- **Zero dependencies:** No supply chain risks.
- **Local only:** Your code never leaves your machine.
- **Smart ignore:** Automatically ignores `.git`, `node_modules`, `venv`, and other junk.

---
Built with ❤️ for AI-native developers.
