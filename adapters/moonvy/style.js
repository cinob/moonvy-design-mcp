import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError, ArgumentError } from '@jackwener/opencli/errors';
import { parseMoonvyUrl, getAuthToken, fetchNodeGenome, extractNodeStyle } from './shared.js';

cli({
  site: 'moonvy',
  name: 'style',
  description: 'Return normalized style data for a specific node in a Moonvy design',
  access: 'read',
  example: 'opencli moonvy style <url> --node node_1 -f json',
  domain: 'moonvy.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  defaultFormat: 'json',
  args: [
    { name: 'url', type: 'string', required: true, positional: true, help: 'Moonvy design URL' },
    { name: 'node', type: 'string', required: true, help: 'Node ID to extract style from' },
  ],
  columns: ['id', 'name', 'bboxX', 'bboxY', 'bboxW', 'bboxH', 'background', 'color', 'fontSize', 'fontWeight', 'borderRadius', 'opacity'],
  func: async (page, args) => {
    const url = args.url;
    if (!url || !url.includes('moonvy')) throw new ArgumentError('url must be a valid Moonvy design URL');
    const nodeId = String(args.node || '');
    if (!nodeId) throw new ArgumentError('--node is required');

    // Navigate to page to establish login state
    await page.goto(url, { settleMs: 3000 });

    // Extract project/file IDs from URL
    const ids = parseMoonvyUrl(url);
    if (!ids?.projectId) throw new ArgumentError('Could not parse Moonvy URL');

    // Get auth token from browser
    const token = await getAuthToken(page);
    if (!token) throw new ArgumentError('Not logged in to Moonvy');

    // Fetch node and genome data
    const fileId = ids.fileId || ids.dirId;
    if (!fileId) throw new ArgumentError('No file or directory ID in URL');

    const { genome } = await fetchNodeGenome(ids.projectId, fileId, token);

    // Extract style for the specific node
    const rows = extractNodeStyle(genome, nodeId);
    if (rows.length === 0) throw new EmptyResultError('moonvy/style', `Node "${nodeId}" not found in design.`);
    return rows;
  },
});
