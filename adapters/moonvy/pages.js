import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError, ArgumentError } from '@jackwener/opencli/errors';
import { parseMoonvyUrl, getAuthToken, fetchNodeListPage } from './shared.js';

function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

function pick(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function pickPath(obj, paths) {
  for (const path of paths) {
    const value = getPath(obj, path);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function extractItems(response) {
  const candidates = [
    response,
    response?.data,
    response?.data?.list,
    response?.data?.records,
    response?.data?.items,
    response?.data?.rows,
    response?.result,
    response?.result?.list,
    response?.result?.records,
    response?.result?.items,
    response?.list,
    response?.records,
    response?.items,
    response?.rows,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function normalizeTime(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  return String(value);
}

function normalizeItem(item, projectId, inputDirId) {
  const id = pick(item, ['id', 'nodeId', 'fileId', '_id', 'uuid']);
  if (!id) return null;

  const normalized = {
    id: String(id),
    name: String(pick(item, ['name', 'title', 'displayName']) || ''),
    type: String(pick(item, ['type', 'nodeType', 'kind', 'fileType']) || ''),
    parentId: pick(item, ['parentId', 'pid', 'dirId', 'folderId', 'parent_id']),
    projectId,
    url: null,
    createdAt: normalizeTime(pick(item, ['createdAt', 'created_at', 'createTime', 'ctime'])),
    updatedAt: normalizeTime(pick(item, ['updatedAt', 'updated_at', 'updateTime', 'mtime'])),
  };

  if (normalized.parentId !== null) normalized.parentId = String(normalized.parentId);
  const parentForUrl = normalized.parentId || inputDirId;
  normalized.url = parentForUrl && parentForUrl !== normalized.id
    ? `https://moonvy.com/project/${projectId}/${parentForUrl}/${normalized.id}`
    : `https://moonvy.com/project/${projectId}/${normalized.id}`;

  return normalized;
}

function numberFromResponse(response, paths) {
  const value = pickPath(response, paths);
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function isLastPage(response, pageIndex, collectedCount) {
  const hasMore = pickPath(response, [
    'hasMore',
    'data.hasMore',
    'result.hasMore',
    'pagination.hasMore',
    'data.pagination.hasMore',
    'result.pagination.hasMore',
  ]);
  if (hasMore === false) return true;

  const total = numberFromResponse(response, [
    'total',
    'data.total',
    'result.total',
    'pagination.total',
    'data.pagination.total',
    'result.pagination.total',
  ]);
  if (total !== null && collectedCount >= total) return true;

  const totalPages = numberFromResponse(response, [
    'totalPages',
    'pageCount',
    'data.totalPages',
    'data.pageCount',
    'result.totalPages',
    'result.pageCount',
    'pagination.totalPages',
    'pagination.pageCount',
    'data.pagination.totalPages',
    'data.pagination.pageCount',
  ]);
  return totalPages !== null && pageIndex >= totalPages;
}

cli({
  site: 'moonvy',
  name: 'pages',
  description: 'List pages/files in a Moonvy project',
  access: 'read',
  example: 'opencli moonvy pages <url> --limit 50 -f json',
  domain: 'moonvy.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  defaultFormat: 'json',
  args: [
    { name: 'url', type: 'string', required: true, positional: true, help: 'Moonvy project URL' },
    { name: 'limit', type: 'int', default: 500, help: 'Max pages/files to return (1-2000)' },
    { name: 'max-pages', type: 'int', default: 50, help: 'Max API pages to scan (1-200)' },
  ],
  columns: ['id', 'name', 'type', 'parentId', 'projectId', 'url', 'createdAt', 'updatedAt'],
  func: async (page, args) => {
    const url = args.url;
    if (!url || !url.includes('moonvy')) throw new ArgumentError('url must be a valid Moonvy project URL');

    const limit = Number(args.limit ?? 500);
    if (!Number.isInteger(limit) || limit <= 0) throw new ArgumentError('limit must be a positive integer');
    if (limit > 2000) throw new ArgumentError('limit must be <= 2000');

    const maxPages = Number(args['max-pages'] ?? args.maxPages ?? 50);
    if (!Number.isInteger(maxPages) || maxPages <= 0) throw new ArgumentError('--max-pages must be a positive integer');
    if (maxPages > 200) throw new ArgumentError('--max-pages must be <= 200');

    await page.goto(url, { settleMs: 3000 });

    const ids = parseMoonvyUrl(url);
    if (!ids?.projectId) throw new ArgumentError('Could not parse Moonvy URL');

    const token = await getAuthToken(page);
    if (!token) throw new ArgumentError('Not logged in to Moonvy');

    const rows = [];
    const seen = new Set();

    for (let pageIndex = 1; pageIndex <= maxPages && rows.length < limit; pageIndex++) {
      const response = await fetchNodeListPage(ids.projectId, pageIndex, token);
      const items = extractItems(response);
      if (items.length === 0) break;

      let added = 0;
      for (const item of items) {
        const row = normalizeItem(item, ids.projectId, ids.dirId);
        if (!row || seen.has(row.id)) continue;
        seen.add(row.id);
        rows.push(row);
        added++;
        if (rows.length >= limit) break;
      }

      if (added === 0 || isLastPage(response, pageIndex, rows.length)) break;
    }

    if (rows.length === 0) throw new EmptyResultError('moonvy/pages', 'No pages/files found in project.');
    return rows;
  },
});
