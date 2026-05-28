#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';

const require = createRequire(import.meta.url);
const projectDir = dirname(fileURLToPath(import.meta.url));
const opencliMain = require.resolve('@jackwener/opencli');
const OUTPUT_LIMIT = 25 * 1024 * 1024;

const server = new McpServer({
  name: 'moonvy-design-mcp',
  version: '1.0.0',
});

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function extractJson(output) {
  const clean = stripAnsi(output).trim();
  if (!clean) throw new Error('OpenCLI returned empty stdout');

  try {
    return JSON.parse(clean);
  } catch {}

  const starts = [];
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === '[' || clean[i] === '{') starts.push(i);
  }

  for (const start of starts) {
    const stack = [];
    let inString = false;
    let escaped = false;

    for (let i = start; i < clean.length; i++) {
      const ch = clean[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '[' || ch === '{') {
        stack.push(ch);
        continue;
      }

      if (ch === ']' || ch === '}') {
        const open = stack.pop();
        if ((ch === ']' && open !== '[') || (ch === '}' && open !== '{')) break;
        if (stack.length === 0) {
          const candidate = clean.slice(start, i + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            break;
          }
        }
      }
    }
  }

  throw new Error(`Could not parse JSON from OpenCLI stdout: ${clean.slice(0, 500)}`);
}

function runOpenCli(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const cliArgs = [opencliMain, 'moonvy', command, ...args, '-f', 'json'];

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, cliArgs, {
      cwd: projectDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let outputSize = 0;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`opencli moonvy ${command} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    function append(which, chunk) {
      outputSize += chunk.length;
      if (outputSize > OUTPUT_LIMIT) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          child.kill('SIGTERM');
          reject(new Error(`opencli moonvy ${command} output exceeded ${OUTPUT_LIMIT} bytes`));
        }
        return;
      }
      if (which === 'stdout') stdout += chunk;
      else stderr += chunk;
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => append('stdout', chunk));
    child.stderr.on('data', (chunk) => append('stderr', chunk));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        const details = [
          `opencli moonvy ${command} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`,
          stderr.trim() ? `stderr: ${stderr.trim().slice(0, 1000)}` : null,
          stdout.trim() ? `stdout: ${stdout.trim().slice(0, 1000)}` : null,
        ].filter(Boolean).join('\n');
        reject(new Error(details));
        return;
      }

      try {
        resolve(extractJson(stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function jsonResponse(result) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

function optionalStringArg(args, name, value) {
  if (value && String(value).trim()) args.push(name, String(value));
}

server.registerTool('moonvy_get_design', {
  title: 'Get Moonvy design metadata',
  description: 'Return design/page/frame metadata for a Moonvy design URL.',
  inputSchema: {
    url: z.string().min(1).describe('Moonvy design URL'),
  },
}, async ({ url }) => {
  const result = await runOpenCli('design', [url]);
  return jsonResponse(result);
});

server.registerTool('moonvy_list_layers', {
  title: 'List Moonvy layers',
  description: 'Return flattened layer data from a Moonvy design URL.',
  inputSchema: {
    url: z.string().min(1).describe('Moonvy design URL'),
    frame: z.string().optional().describe('Optional frame/page ID filter'),
    limit: z.number().int().min(1).max(500).default(50).describe('Maximum layers to return'),
  },
}, async ({ url, frame, limit }) => {
  const args = [url, '--limit', String(limit ?? 50)];
  optionalStringArg(args, '--frame', frame);
  const result = await runOpenCli('layers', args);
  return jsonResponse(result);
});

server.registerTool('moonvy_list_pages', {
  title: 'List Moonvy project pages',
  description: 'Return pages/files available in a Moonvy project URL.',
  inputSchema: {
    url: z.string().min(1).describe('Moonvy project URL'),
    limit: z.number().int().min(1).max(2000).default(500).describe('Maximum pages/files to return'),
    maxPages: z.number().int().min(1).max(200).default(50).describe('Maximum API pages to scan'),
  },
}, async ({ url, limit, maxPages }) => {
  const args = [
    url,
    '--limit', String(limit ?? 500),
    '--max-pages', String(maxPages ?? 50),
  ];
  const result = await runOpenCli('pages', args);
  return jsonResponse(result);
});

server.registerTool('moonvy_get_node_style', {
  title: 'Get Moonvy node style',
  description: 'Return normalized style data for a specific Moonvy node ID.',
  inputSchema: {
    url: z.string().min(1).describe('Moonvy design URL'),
    node: z.string().min(1).describe('Moonvy/Figma-style node ID, e.g. 4:1224'),
  },
}, async ({ url, node }) => {
  const result = await runOpenCli('style', [url, '--node', node]);
  return jsonResponse(result);
});

server.registerTool('moonvy_get_tree', {
  title: 'Get Moonvy layer tree',
  description: 'Return the full Moonvy layer tree, optionally including normalized style data for every node.',
  inputSchema: {
    url: z.string().min(1).describe('Moonvy design URL'),
    frame: z.string().optional().describe('Optional frame/page ID filter'),
    withStyle: z.boolean().default(false).describe('Include normalized style data for every node'),
    maxDepth: z.number().int().min(0).default(99).describe('Maximum child depth to include'),
  },
}, async ({ url, frame, withStyle, maxDepth }) => {
  const args = [url, '--max-depth', String(maxDepth ?? 99)];
  optionalStringArg(args, '--frame', frame);
  if (withStyle) args.push('--with-style');
  const result = await runOpenCli('tree', args, { timeoutMs: 180_000 });
  return jsonResponse(result);
});

server.registerTool('moonvy_extract_tokens', {
  title: 'Extract Moonvy design tokens',
  description: 'Extract reusable design tokens from a Moonvy design URL.',
  inputSchema: {
    url: z.string().min(1).describe('Moonvy design URL'),
  },
}, async ({ url }) => {
  const result = await runOpenCli('tokens', [url]);
  return jsonResponse(result);
});

const transport = new StdioServerTransport();
await server.connect(transport);
