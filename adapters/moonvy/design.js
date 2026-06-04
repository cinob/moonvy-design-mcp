import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { parseMoonvyUrl, getAuthToken, fetchNodeGenome, extractDesignMeta } from './shared.js';

cli({
  site: 'moonvy',
  name: 'design',
  description: 'Open a Moonvy design URL and return design/page/frame metadata as JSON',
  access: 'read',
  example: 'opencli moonvy design <url> -f json',
  domain: 'moonvy.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  defaultFormat: 'json',
  args: [
    { name: 'url', type: 'string', required: true, positional: true, help: 'Moonvy design URL' },
  ],
  columns: ['title', 'frameCount'],
  func: async (page, args) => {
    const url = args.url;
    if (!url || !url.includes('moonvy')) throw new ArgumentError('url must be a valid Moonvy design URL');

    // Navigate to page to establish login state
    await page.goto(url, { settleMs: 3000 });

    // Extract project/file IDs from URL
    const ids = parseMoonvyUrl(url);
    if (!ids?.projectId) throw new ArgumentError('Could not parse Moonvy URL');

    // Get auth token from browser
    const token = await getAuthToken(page);
    if (!token) throw new ArgumentError('Not logged in to Moonvy');

    // Fetch node and genome data
    const nodeId = ids.fileId || ids.dirId;
    if (!nodeId) throw new ArgumentError('No file or directory ID in URL');

    const { node, genome } = await fetchNodeGenome(ids.projectId, nodeId, token);

    // Extract design metadata from genome
    const meta = extractDesignMeta(genome, node);
    return [{ title: meta.title, frameCount: meta.frameCount }];
  },
});
