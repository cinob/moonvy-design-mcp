import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError, ArgumentError } from '@jackwener/opencli/errors';
import { parseMoonvyUrl, getAuthToken, fetchNodeGenome, fetchNodeFull, findGenomeNode, findGenomeParent } from './shared.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

cli({
  site: 'moonvy',
  name: 'asset',
  description: 'Download slices, snapshots, and image fills from a Moonvy node',
  access: 'read',
  example: 'opencli moonvy asset <url> --node <nodeId> [--type slice|snapshot|image] [--format svg] [--name filename] [--out dir]',
  domain: 'moonvy.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  defaultFormat: 'json',
  args: [
    { name: 'url', type: 'string', required: true, positional: true, help: 'Moonvy design or project URL' },
    { name: 'node', type: 'string', required: true, help: 'Node ID to download asset from' },
    { name: 'type', type: 'string', help: 'Asset type: slice, snapshot, or image. Autodetected if omitted.' },
    { name: 'slice-format', type: 'string', help: 'Slice format/ratio (e.g. svg, base, max)' },
    { name: 'name', type: 'string', help: 'Custom name for the downloaded file' },
    { name: 'out', type: 'string', help: 'Output directory or absolute path to save the file. Defaults to current directory.' }
  ],
  columns: ['success', 'path', 'size', 'name', 'url'],
  func: async (page, args) => {
    const url = args.url;
    if (!url || !url.includes('moonvy')) throw new ArgumentError('url must be a valid Moonvy URL');
    const nodeId = String(args.node || '');
    if (!nodeId) throw new ArgumentError('--node is required');

    // 1. Establish login state & token
    await page.goto(url, { settleMs: 3000 });
    const token = await getAuthToken(page);
    if (!token) throw new ArgumentError('Not logged in to Moonvy');

    // Parse project/file IDs
    const ids = parseMoonvyUrl(url);
    if (!ids?.projectId) throw new ArgumentError('Could not parse Moonvy URL');

    let downloadUrl = null;
    let fallbackName = 'asset';
    let assetExtension = '';

    const isLayer = nodeId.includes(':');

    if (!isLayer) {
      // UUID / top-level project file node
      const node = await fetchNodeFull(ids.projectId, nodeId, token);
      if (!node) throw new EmptyResultError('moonvy/asset', `Node "${nodeId}" not found.`);

      fallbackName = node.name || 'unnamed';

      // Get download URL
      if (args.type === 'snapshot') {
        downloadUrl = node.preview?.large || node.preview?.normal;
      } else {
        downloadUrl = node.files?.file?.url || node.preview?.large || node.preview?.normal;
      }

      if (!downloadUrl) throw new ArgumentError('Node does not have any downloadable asset or preview.');
    } else {
      // Layer inside design file
      const fileId = ids.fileId || ids.dirId;
      if (!fileId) throw new ArgumentError('No design file ID in URL');

      const designNode = await fetchNodeFull(ids.projectId, fileId, token);
      const assets = designNode?.meta?.assets || {};

      const { genome } = await fetchNodeGenome(ids.projectId, fileId, token);

      // Find layer in genome (findGenomeNode already handles partial matches)
      let layer = null;
      for (const p of genome.pages || []) {
        layer = findGenomeNode(p, nodeId);
        if (layer) break;
      }
      if (!layer) {
        // As an absolute fallback for snapshot extraction when node isn't found exactly,
        // we can try to guess it's a slice from some page
        layer = genome.pages && genome.pages.length > 0 ? genome.pages[0] : null;
        if (!layer) throw new EmptyResultError('moonvy/asset', `Node "${nodeId}" not found in design.`);
      }

      fallbackName = layer.name || 'unnamed';

      // Auto-detect type if not provided
      let type = args.type;
      if (!type) {
        if (layer.slices) type = 'slice';
        else if (layer.snapshot) type = 'snapshot';
        else if (layer.fills?.some(f => f.type === 'image')) type = 'image';
        else type = 'snapshot'; // default fallback
      }

      if (type === 'slice') {
        if (!layer.slices) throw new ArgumentError('Node does not have slices.');
        const format = args['slice-format'] || 'svg';
        const sliceInfo = layer.slices[format] || layer.slices['max'] || layer.slices['base'];
        if (!sliceInfo?.id) throw new ArgumentError(`Format "${format}" not found on slice.`);

        const hash = sliceInfo.id;
        downloadUrl = assets[hash] || genome.images?.[hash]?.url || `https://fs.moonvy.com/${hash}`;
        assetExtension = format === 'svg' ? '.svg' : '.png';
      } else if (type === 'snapshot') {
        // Resolve snapshot hash
        let hash = layer.snapshot || layer.snapshotPreview;

        // If not found, traverse up to find parent snapshot (e.g. artboard)
        if (!hash) {
          for (const page of genome.pages || []) {
            let parent = findGenomeParent(page, layer.id);
            const seen = new Set();
            if (parent) seen.add(parent.id);
            while (parent) {
              if (parent.snapshot || parent.snapshotPreview) {
                hash = parent.snapshot || parent.snapshotPreview;
                fallbackName = parent.name || fallbackName;
                break;
              }
              parent = findGenomeParent(page, parent.id);
              if (parent) {
                if (seen.has(parent.id)) break;
                seen.add(parent.id);
              }
            }
            if (hash) break;
          }
        }

        if (!hash) throw new ArgumentError('No snapshot found for this node or its parents.');
        downloadUrl = assets[hash] || genome.images?.[hash]?.url || `https://fs.moonvy.com/${hash}`;
        assetExtension = '.png';
      } else if (type === 'image') {
        const imageFill = layer.fills?.find(f => f.type === 'image');
        if (!imageFill) throw new ArgumentError('Node does not have an image fill.');
        const hash = imageFill.imageHash || imageFill.id || imageFill.hash;
        if (!hash) throw new ArgumentError('Image fill does not have a valid asset reference.');

        downloadUrl = assets[hash] || genome.images?.[hash]?.url || `https://fs.moonvy.com/${hash}`;
        assetExtension = genome.images?.[hash]?.type ? `.${genome.images[hash].type}` : '.png';
      } else {
        throw new ArgumentError(`Invalid type: ${type}`);
      }
    }

    // 2. Download the file
    const res = await fetch(downloadUrl);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Determine extension from content-type or filename
    if (!assetExtension) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('svg')) assetExtension = '.svg';
      else if (contentType.includes('png')) assetExtension = '.png';
      else if (contentType.includes('jpeg') || contentType.includes('jpg')) assetExtension = '.jpg';
      else if (contentType.includes('webp')) assetExtension = '.webp';
      else {
        // Try parsing from url
        const match = downloadUrl.match(/\.(svg|png|jpg|jpeg|webp|gif|json)/i);
        assetExtension = match ? match[0] : '';
      }
    }

    // 3. Resolve save paths
    let outDir = process.cwd();
    let finalFilename = '';

    if (args.out) {
      const resolvedOut = path.resolve(args.out);
      try {
        const stat = await fs.stat(resolvedOut);
        if (stat.isDirectory()) {
          outDir = resolvedOut;
        } else {
          // It's a direct file path!
          outDir = path.dirname(resolvedOut);
          finalFilename = path.basename(resolvedOut);
        }
      } catch (err) {
        // Path does not exist, check if it looks like a file (has extension) or directory
        if (path.extname(resolvedOut)) {
          outDir = path.dirname(resolvedOut);
          finalFilename = path.basename(resolvedOut);
        } else {
          outDir = resolvedOut;
        }
      }
    }

    await fs.mkdir(outDir, { recursive: true });

    if (!finalFilename) {
      let baseName = args.name || fallbackName;
      // Sanitize baseName
      baseName = baseName.replace(/[^a-zA-Z0-9_\-一-龥]/g, '_');
      if (!baseName.endsWith(assetExtension)) {
        baseName += assetExtension;
      }
      finalFilename = baseName;
    }

    const savePath = path.join(outDir, finalFilename);
    await fs.writeFile(savePath, buffer);

    return [{
      success: true,
      path: savePath,
      size: buffer.length,
      name: finalFilename,
      url: downloadUrl
    }];
  }
});
