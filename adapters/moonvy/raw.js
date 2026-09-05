import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { parseMoonvyUrl, getAuthToken, fetchNodeGenome, findGenomeNode } from './shared.js';

/**
 * Dump the raw genome (or one raw genome node) for debugging what Moonvy
 * actually stores. Writes to --out when given (the genome can be large).
 */
cli({
  site: 'moonvy',
  name: 'raw',
  description: 'Dump raw genome JSON (whole design, or a single node with --node) for a Moonvy design URL',
  access: 'read',
  example: 'opencli moonvy raw <url> --node "4:1224" -f json',
  domain: 'moonvy.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  defaultFormat: 'json',
  args: [
    { name: 'url', type: 'string', required: true, positional: true, help: 'Moonvy design URL' },
    { name: 'node', type: 'string', default: '', help: 'Node ID; omit for the whole genome' },
    { name: 'out', type: 'string', default: '', help: 'Write JSON to this file instead of stdout' },
  ],
  columns: ['raw'],
  func: async (page, args) => {
    const url = args.url;
    if (!url || !url.includes('moonvy')) throw new ArgumentError('url must be a valid Moonvy design URL');
    await page.goto(url, { settleMs: 3000 });
    const ids = parseMoonvyUrl(url);
    if (!ids?.projectId) throw new ArgumentError('Could not parse Moonvy URL');
    const token = await getAuthToken(page);
    if (!token) throw new ArgumentError('Not logged in to Moonvy');
    const fileId = ids.fileId || ids.dirId;
    if (!fileId) throw new ArgumentError('No file or directory ID in URL');
    const { genome } = await fetchNodeGenome(ids.projectId, fileId, token);

    let data = genome;
    if (args.node) {
      for (const p of genome.pages || []) {
        const found = findGenomeNode(p, String(args.node));
        if (found) { data = found; break; }
      }
    }
    if (args.out) {
      const fs = await import('node:fs/promises');
      await fs.writeFile(String(args.out), JSON.stringify(data, null, 2));
      return [{ raw: `written to ${args.out}` }];
    }
    return [{ raw: data }];
  },
});
