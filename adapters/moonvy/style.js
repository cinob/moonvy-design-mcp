import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError, ArgumentError } from '@jackwener/opencli/errors';
import { parseMoonvyUrl, getAuthToken, fetchNodeGenome, extractNodeStyle } from './shared.js';

cli({
  site: 'moonvy',
  name: 'style',
  description: 'Return full normalized style (fills, gradient, border, radius, shadow, font family/weight/size/line-height, alignment, variables) for one node in a Moonvy design',
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
  columns: ['id', 'name', 'type', 'bboxX', 'bboxY', 'bboxW', 'bboxH', 'text', 'background', 'backgroundVariable', 'gradient', 'imageFill', 'border', 'borderWidth', 'borderColor', 'borderRadius', 'opacity', 'visible', 'boxShadow', 'blur', 'color', 'colorVariable', 'fontFamily', 'fontStyle', 'fontWeight', 'fontSize', 'lineHeight', 'letterSpacing', 'textAlign', 'textDecoration', 'segments', 'component', 'exportable'],
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

    let genome;
    try {
      ({ genome } = await fetchNodeGenome(ids.projectId, fileId, token));
    } catch (err) {
      if (/No genome file/i.test(err?.message || '')) {
        throw new ArgumentError(
          `URL ${url} does not point at a specific design. ` +
          'Use a design URL: /project/:projectId/:dirId/:designId ' +
          '(get one from the moonvy pages tool), then retry.',
        );
      }
      throw err;
    }

    // Extract style for the specific node
    let rows = extractNodeStyle(genome, nodeId, fileId);

    // 请求的节点是设计稿（画板）本身时，它在自己的 genome 里不存在——
    // 回落到 genome 根页（即同一画板的内容树），id 仍报告请求值
    if (rows.length === 1 && rows[0].name === 'Unknown Node') {
      const page0 = (genome.pages || []).find(
        (p) => p && (String(p.id) === nodeId || p.id?.includes?.(nodeId)),
      ) || (genome.pages || [])[0];
      if (page0) {
        rows = extractNodeStyle(genome, page0.id);
        rows[0].id = nodeId;
      }
    }
    if (rows.length === 0) throw new EmptyResultError('moonvy/style', `Node "${nodeId}" not found in design.`);
    return rows;
  },
});
