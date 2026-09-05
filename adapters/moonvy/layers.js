import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError, ArgumentError } from '@jackwener/opencli/errors';
import { parseMoonvyUrl, getAuthToken, fetchNodeGenome, extractLayers } from './shared.js';

cli({
  site: 'moonvy',
  name: 'layers',
  description: 'Return frame or page layer data from a Moonvy design URL as JSON',
  access: 'read',
  example: 'opencli moonvy layers <url> --frame frame_1 --limit 50 -f json',
  domain: 'moonvy.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  defaultFormat: 'json',
  args: [
    { name: 'url', type: 'string', required: true, positional: true, help: 'Moonvy design URL' },
    { name: 'frame', type: 'string', default: '', help: 'Filter layers by frame/page ID' },
    { name: 'limit', type: 'int', default: 5000, help: 'Max layers to return (1-5000)' },
  ],
  columns: ['id', 'name', 'type', 'x', 'y', 'width', 'height', 'text', 'visible'],
  func: async (page, args) => {
    const url = args.url;
    if (!url || !url.includes('moonvy')) throw new ArgumentError('url must be a valid Moonvy design URL');
    const limit = Number(args.limit ?? 5000);
    if (!Number.isInteger(limit) || limit <= 0) throw new ArgumentError('limit must be a positive integer');
    if (limit > 5000) throw new ArgumentError('limit must be <= 5000');
    const frame = String(args.frame || '');

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

    const { genome } = await fetchNodeGenome(ids.projectId, nodeId, token);

    // Extract layers from genome
    const layers = extractLayers(genome, frame || null, limit);
    if (layers.length === 0) throw new EmptyResultError('moonvy/layers', 'No layers found in design.');
    return layers;
  },
});
