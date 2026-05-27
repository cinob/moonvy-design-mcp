import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError, ArgumentError } from '@jackwener/opencli/errors';
import { parseMoonvyUrl, getAuthToken, fetchNodeGenome, extractTokens } from './shared.js';

cli({
  site: 'moonvy',
  name: 'tokens',
  description: 'Extract reusable design tokens (colors, fontSizes, radii, spacing) from a Moonvy design',
  access: 'read',
  example: 'opencli moonvy tokens <url> -f json',
  domain: 'moonvy.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  defaultFormat: 'json',
  args: [
    { name: 'url', type: 'string', required: true, positional: true, help: 'Moonvy design URL' },
  ],
  columns: ['colors', 'fontSizes', 'radii', 'spacing'],
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

    const { genome } = await fetchNodeGenome(ids.projectId, nodeId, token);

    // Extract tokens from genome
    const tokens = extractTokens(genome);

    if ((!tokens.colors || tokens.colors.length === 0) &&
        (!tokens.fontSizes || tokens.fontSizes.length === 0) &&
        (!tokens.radii || tokens.radii.length === 0) &&
        (!tokens.spacing || tokens.spacing.length === 0)) {
      throw new EmptyResultError('moonvy/tokens', 'No design tokens found in design.');
    }

    return [{
      colors: tokens.colors || [],
      fontSizes: tokens.fontSizes || [],
      radii: tokens.radii || [],
      spacing: tokens.spacing || [],
    }];
  },
});
