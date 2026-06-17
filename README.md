# everything-mcp

MCP (Model Context Protocol) server for [Everything](https://www.voidtools.com/) — the lightning-fast Windows file search engine.

Uses [ffi-rs](https://github.com/zhangyuang/node-ffi-rs) to call the Everything SDK natively and [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) for the MCP server protocol.

## Prerequisites

- **Windows** (the Everything SDK is Windows-only)
- **Everything 1.5+** installed and running ([download](https://www.voidtools.com/))
- **Node.js 18+** and **pnpm**

## Installation

```bash
pnpm install
pnpm build
```

## Usage

### Running the MCP server

```bash
node dist/index.js
```

The server communicates via stdin/stdout (MCP stdio transport).

### Configuring in Claude Desktop / VS Code Copilot

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "everything": {
      "command": "node",
      "args": ["w:\\projects\\everything-mcp\\dist\\index.js"]
    }
  }
}
```

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `EVERYTHING_SDK_DIR` | Path to the Everything SDK directory | `./Everything-SDK-3.0.0.9/dll` |
| `EVERYTHING_DLL_PATH` | Full path to the Everything DLL | `$SDK_DIR/Everything3_x64.dll` |

## Tools

### `everything_search`

Search for files and folders using Everything search syntax.

**Parameters:**
- `query` (required) — Search query using Everything syntax
- `maxResults` — Max results (default: 50, max: 1000)
- `offset` — Zero-based offset for pagination
- `matchCase` — Case-sensitive search
- `matchWholeWord` — Match whole words only
- `matchPath` — Match against full path
- `regex` — Treat query as regex

**Everything search syntax examples:**
- `*.txt` — all .txt files
- `foo bar` — files containing both "foo" AND "bar"
- `foo|bar` — files containing "foo" OR "bar"
- `ext:jpg size:>1mb` — JPEGs larger than 1 MB
- `folder:node_modules` — folders named node_modules
- `content:TODO` — files containing "TODO" in their content
- `datemodified:today` — files modified today
- `parent:C:\Projects` — files under C:\Projects

### `everything_version`

Get the version information of the running Everything instance.

### `everything_status`

Check if Everything is running and its database is loaded.

### `everything_file_info`

Get Windows file attributes and run count for a specific file path.

**Parameters:**
- `path` (required) — Full path to the file or folder

## Architecture

```
src/
├── index.ts              # MCP server entry point (tools, request handlers)
├── everything-client.ts  # High-level Everything client wrapper
└── ffi-bindings.ts       # Low-level FFI bindings to Everything3_x64.dll
```

## License

MIT
