#!/usr/bin/env node
/**
 * everything-mcp — MCP server for the Everything file search engine.
 *
 * Provides tools for lightning-fast file search on Windows via Everything.
 *
 * Tools:
 *   - everything_search     Search files/folders using Everything syntax
 *   - everything_version    Get Everything version info
 *   - everything_status     Check if Everything is running and DB is loaded
 *   - everything_file_info  Get file attributes via Everything
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { EverythingClient } from './everything-client.js';
import { getArchInfo } from './ffi-bindings.js';

// ─── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name: 'everything_search',
    description: `Search for files and folders on Windows using Everything.

Everything search syntax supports:
- Basic search: "foo.txt" finds files named foo.txt
- Wildcards: "*.txt", "foo*", "*.jpg|*.png"
- Boolean operators: "foo bar" (AND), "foo|bar" (OR), "!" prefix (NOT)
- Content search: "content:hello" searches file contents
- Size filters: "size:>1mb", "size:100kb..1mb"
- Date filters: "datemodified:today", "datecreated:2024-01-01"
- Path filters: "path:Downloads", "parent:C:\\Projects"
- Attribute filters: "attrib:readonly", "attrib:hidden"
- Type filters: "ext:jpg", "type:audio"
- Regex: enable regex mode for regex patterns
- And many more...

Examples: "ext:jpg size:>1mb", "*.ts", "folder:node_modules", "content:TODO"`,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query using Everything search syntax.',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results to return (default: 50, max: 1000).',
          default: 50,
        },
        offset: {
          type: 'number',
          description: 'Zero-based offset for pagination (default: 0).',
          default: 0,
        },
        matchCase: {
          type: 'boolean',
          description: 'Match case (default: false).',
          default: false,
        },
        matchWholeWord: {
          type: 'boolean',
          description: 'Match whole words only (default: false).',
          default: false,
        },
        matchPath: {
          type: 'boolean',
          description: 'Match against full path, not just filename (default: false).',
          default: false,
        },
        regex: {
          type: 'boolean',
          description: 'Treat query as a regular expression (default: false).',
          default: false,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'everything_version',
    description: 'Get the version information of the running Everything search engine.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'everything_status',
    description: 'Check if the Everything search engine is running and its database is loaded.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'everything_file_info',
    description: 'Get file attributes (Windows attributes, run count) for a specific file path using Everything.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Full path to the file or folder.',
        },
      },
      required: ['path'],
    },
  },
];

// ─── Server setup ──────────────────────────────────────────────────────────────

const server = new Server(
  {
    name: 'everything-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

const everything = new EverythingClient();

// ─── Handle ListTools ──────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// ─── Handle CallTool ───────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'everything_search': {
        const query = args?.query as string;
        if (!query) {
          return {
            content: [{ type: 'text', text: 'Error: "query" parameter is required.' }],
            isError: true,
          };
        }

        if (!everything.connected) {
          everything.connect();
        }

        // Ensure the database is loaded before searching
        if (!everything.isDBLoaded()) {
          const ready = await everything.waitForDBLoaded(5000, 500);
          if (!ready) {
            return {
              content: [{ type: 'text', text: 'Everything database is not yet loaded. Please wait for Everything to finish indexing and try again.' }],
              isError: true,
            };
          }
        }

        const results = everything.search({
          query,
          maxResults: (args?.maxResults as number) ?? 50,
          offset: (args?.offset as number) ?? 0,
          matchCase: (args?.matchCase as boolean) ?? false,
          matchWholeWord: (args?.matchWholeWord as boolean) ?? false,
          matchPath: (args?.matchPath as boolean) ?? false,
          regex: (args?.regex as boolean) ?? false,
        });

        if (results.length === 0) {
          return {
            content: [{ type: 'text', text: `No results found for query: "${query}"` }],
          };
        }

        // Format results as a table-like text
        const lines: string[] = [
          `Found ${results.length} result(s) for: "${query}"`,
          '',
          ...results.map((r, i) => {
            const icon = r.isFolder ? '[DIR]' : '[FILE]';
            const size = formatSize(r.size);
            const date = r.dateModified?.toISOString().split('T')[0] ?? 'N/A';
            return `${i + 1}. ${icon} ${r.fullPath}\n   Size: ${size} | Modified: ${date} | Type: ${r.type || r.extension}`;
          }),
        ];

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      }

      case 'everything_version': {
        if (!everything.connected) {
          everything.connect();
        }
        const version = everything.getVersion();
        return {
          content: [
            {
              type: 'text',
              text: `Everything Version ${version.major}.${version.minor}.${version.revision}.${version.build}\nTarget Machine: ${version.targetMachine}`,
            },
          ],
        };
      }

      case 'everything_status': {
        const archInfo = getArchInfo();
        let connected = false;
        let dbLoaded = false;

        try {
          if (!everything.connected) {
            everything.connect();
          }
          connected = true;

          // Wait briefly for the DB to load (Everything may still be indexing)
          dbLoaded = await everything.waitForDBLoaded(5000, 500);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text', text: `Everything is NOT accessible: ${msg}` }],
          };
        }

        const lines = [
          `Everything Status:`,
          `- Connected: ${connected ? 'Yes ✓' : 'No ✗'}`,
          `- Database Loaded: ${dbLoaded ? 'Yes ✓' : 'No ✗ (may still be indexing)'}`,
          `- Instance: ${everything.instanceName ?? '(default unnamed)'}`,
          `- Detected Arch: ${archInfo.arch}`,
          `- DLL: ${archInfo.dll}`,
        ];

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      }

      case 'everything_file_info': {
        const filePath = args?.path as string;
        if (!filePath) {
          return {
            content: [{ type: 'text', text: 'Error: "path" parameter is required.' }],
            isError: true,
          };
        }

        if (!everything.connected) {
          everything.connect();
        }

        const info = everything.getFileInfo(filePath);
        if (!info) {
          return {
            content: [{ type: 'text', text: `File not found or inaccessible: "${filePath}"` }],
          };
        }

        const attrLines = parseAttributes(info.attributes);
        return {
          content: [
            {
              type: 'text',
              text: `File: ${filePath}\nAttributes: 0x${info.attributes.toString(16).toUpperCase()}\n${attrLines.join('\n')}\nRun Count: ${info.runCount}`,
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: `Error: ${msg}` }],
      isError: true,
    };
  }
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatSize(bytes: bigint): string {
  if (bytes === 0n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let size = Number(bytes);
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function parseAttributes(attrs: number): string[] {
  const flags: [number, string][] = [
    [0x00000001, 'ReadOnly'],
    [0x00000002, 'Hidden'],
    [0x00000004, 'System'],
    [0x00000010, 'Directory'],
    [0x00000020, 'Archive'],
    [0x00000040, 'Device'],
    [0x00000080, 'Normal'],
    [0x00000100, 'Temporary'],
    [0x00000200, 'SparseFile'],
    [0x00000400, 'ReparsePoint'],
    [0x00000800, 'Compressed'],
    [0x00001000, 'Offline'],
    [0x00002000, 'NotContentIndexed'],
    [0x00004000, 'Encrypted'],
  ];

  const set: string[] = [];
  for (const [flag, name] of flags) {
    if (attrs & flag) set.push(`- ${name}`);
  }
  return set.length > 0 ? set : ['- (none)'];
}

// ─── Startup ───────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Clean up on exit
  process.on('SIGINT', () => {
    everything.disconnect();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    everything.disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal error starting everything-mcp server:', err);
  process.exit(1);
});
