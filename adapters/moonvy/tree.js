import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError, ArgumentError } from '@jackwener/opencli/errors';
import { parseMoonvyUrl, getAuthToken, fetchNodeGenome, extractTree } from './shared.js';

cli({
  site: 'moonvy',
  name: 'tree',
  description: 'Return the full Moonvy layer tree, optionally including normalized style data',
  access: 'read',
  example: 'opencli moonvy tree <url> --with-style -f json',
  domain: 'moonvy.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  defaultFormat: 'json',
  args: [
    { name: 'url', type: 'string', required: true, positional: true, help: 'Moonvy design URL' },
    { name: 'frame', type: 'string', default: '', help: 'Filter tree by frame/page ID' },
    { name: 'with-style', type: 'boolean', default: false, help: 'Include normalized style data for every node' },
    { name: 'max-depth', type: 'int', default: 99, help: 'Maximum child depth to include' },
  ],
  columns: ['id', 'name', 'type', 'x', 'y', 'width', 'height', 'text', 'style', 'children'],
  func: async (page, args) => {
    const url = args.url;
    if (!url || !url.includes('moonvy')) throw new ArgumentError('url must be a valid Moonvy design URL');

    const maxDepth = Number(args['max-depth'] ?? args.maxDepth ?? 99);
    if (!Number.isInteger(maxDepth) || maxDepth < 0) throw new ArgumentError('--max-depth must be a non-negative integer');

    await page.goto(url, { settleMs: 3000 });

    const ids = parseMoonvyUrl(url);
    if (!ids?.projectId) throw new ArgumentError('Could not parse Moonvy URL');

    const token = await getAuthToken(page);
    if (!token) throw new ArgumentError('Not logged in to Moonvy');

    const nodeId = ids.fileId || ids.dirId;
    if (!nodeId) throw new ArgumentError('No file or directory ID in URL');

    const { genome } = await fetchNodeGenome(ids.projectId, nodeId, token);
    const tree = extractTree(genome, args.frame || null, {
      withStyle: Boolean(args['with-style'] ?? args.withStyle),
      maxDepth,
    });

    if (tree.length === 0) throw new EmptyResultError('moonvy/tree', 'No tree found in design.');
    return tree;
  },
});
