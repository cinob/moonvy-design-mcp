/**
 * Shared utilities for Moonvy adapters.
 * API-based extraction using Moonvy's /anynode/get endpoint and genome files.
 */

const MOONVY_API_BASE = 'https://global-api.moonvy.com/v2';

/**
 * Get the JWT auth token from the Moonvy app instance in the browser.
 */
export async function getAuthToken(page) {
  return await page.evaluate(() => {
    return window.app?.api?.$options?.token || null;
  });
}

/**
 * Parse a Moonvy URL to extract projectId, dirId, and fileId.
 * URL format: /project/:projectId/:dirId/:fileId
 */
export function parseMoonvyUrl(url) {
  const match = url.match(/\/project\/([^/?#]+)(?:\/([^/?#]+))?(?:\/([^/?#]+))?/);
  if (!match) return null;
  return {
    projectId: match[1] || null,
    dirId: match[2] || null,
    fileId: match[3] || null,
  };
}

/**
 * Make an authenticated API call to Moonvy.
 */
export async function moonvyApi(path, body, token) {
  const resp = await fetch(`${MOONVY_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Moonvy API ${path} returned ${resp.status}: ${text.slice(0, 200)}`);
  }
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Moonvy API ${path} returned non-JSON: ${text.slice(0, 200)}`);
  }
}

/**
 * Fetch and decompress a genome JSON file from Moonvy's file server.
 */
export async function fetchGenome(genomeUrl) {
  const zlib = await import('node:zlib');
  const resp = await fetch(genomeUrl);
  if (!resp.ok) throw new Error(`Genome fetch failed: ${resp.status}`);

  const arrayBuf = await resp.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);

  // Check if response is already JSON (not compressed)
  const str = buffer.toString('utf-8');
  if (str[0] === '{' || str[0] === '[') {
    return JSON.parse(str);
  }

  // Try gunzip
  return JSON.parse(zlib.gunzipSync(buffer).toString('utf-8'));
}

/**
 * Fetch a node from the Moonvy API with full detail (includes genome URL).
 */
export async function fetchNodeFull(projectId, nodeId, token) {
  return moonvyApi('/anynode/get', { projectId, id: nodeId, lv: 'full' }, token);
}

export async function fetchNodeListPage(projectId, pageIndex, token) {
  return moonvyApi('/anynode/list', { projectId, pageIndex }, token);
}

/**
 * Fetch a node and its genome data.
 */
export async function fetchNodeGenome(projectId, nodeId, token) {
  const node = await fetchNodeFull(projectId, nodeId, token);
  const genomeUrl = node?.files?.genome?.url;
  if (!genomeUrl) throw new Error('No genome file found for node');
  const genome = await fetchGenome(genomeUrl);
  return { node, genome };
}

/**
 * Recursively collect all nodes from a genome tree.
 */
export function collectGenomeNodes(node, depth = 0) {
  const result = [{
    id: node.id,
    name: node.name,
    type: node.type,
    rect: node.rect,
    depth,
  }];
  for (const child of node.children || []) {
    result.push(...collectGenomeNodes(child, depth + 1));
  }
  return result;
}

/**
 * Find a node by ID in the genome tree.
 */
export function findGenomeNode(node, targetId) {
  if (node.id === targetId) return node;
  for (const child of node.children || []) {
    const found = findGenomeNode(child, targetId);
    if (found) return found;
  }
  return null;
}

/**
 * Resolve a color from genome fill data.
 */
function resolveFillColor(fill) {
  if (!fill || fill.type !== 'color') return null;
  const c = fill.color || {};
  const r = Math.round(Math.min(255, Math.max(0, c.r || 0)));
  const g = Math.round(Math.min(255, Math.max(0, c.g || 0)));
  const b = Math.round(Math.min(255, Math.max(0, c.b || 0)));
  const a = fill.opacity != null ? fill.opacity : 1;
  if (a < 1) return `rgba(${r},${g},${b},${a.toFixed(2)})`;
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Extract design metadata from genome data.
 */
export function extractDesignMeta(genome, nodeMeta) {
  const pages = genome.pages || [];
  const frames = pages.map((p) => ({
    id: p.id,
    name: p.name || 'Untitled',
    width: Math.round(p.rect?.w || 0),
    height: Math.round(p.rect?.h || 0),
  }));
  return {
    title: nodeMeta?.name || pages[0]?.name || 'Untitled',
    frames,
    frameCount: frames.length,
  };
}

/**
 * Extract layers from genome data.
 */
export function extractLayers(genome, frameFilter, limit = 50) {
  const pages = genome.pages || [];
  let allNodes = [];
  for (const page of pages) {
    if (frameFilter && page.id !== frameFilter) continue;
    allNodes.push(...collectGenomeNodes(page));
  }
  return allNodes.slice(0, limit).map((n) => ({
    id: String(n.id || ''),
    name: String(n.name || ''),
    type: String(n.type || ''),
    x: Math.round(n.rect?.x || 0),
    y: Math.round(n.rect?.y || 0),
    width: Math.round(n.rect?.w || 0),
    height: Math.round(n.rect?.h || 0),
  }));
}

/**
 * Extract style data for a specific node from genome data.
 */
export function extractNodeStyle(genome, nodeId) {
  const pages = genome.pages || [];
  let raw = null;
  for (const page of pages) {
    raw = findGenomeNode(page, nodeId);
    if (raw) break;
  }
  if (!raw) return [];

  const style = extractRawNodeStyle(genome, raw);
  return [{
    id: String(raw.id || ''),
    name: String(raw.name || ''),
    bboxX: Math.round(raw.rect?.x || 0),
    bboxY: Math.round(raw.rect?.y || 0),
    bboxW: Math.round(raw.rect?.w || 0),
    bboxH: Math.round(raw.rect?.h || 0),
    background: style.background,
    color: style.color,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    borderRadius: style.borderRadius,
    opacity: style.opacity,
    fontFamily: style.fontFamily,
  }];
}

export function extractRawNodeStyle(genome, raw) {
  let fillColor = null;
  if (raw.fills && raw.fills.length > 0) {
    fillColor = resolveFillColor(raw.fills[0]);
  } else if (raw.fillLink) {
    const linked = (genome.styles?.fillStyles || []).find((s) => s.id === raw.fillLink);
    if (linked?.data?.[0]) fillColor = resolveFillColor(linked.data[0]);
  }

  let color = null, fontSize = null, fontWeight = null, fontFamily = null, lineHeight = null, letterSpacing = null;
  if (raw.textbox?.segments?.length > 0) {
    const seg = raw.textbox.segments[0];
    fontSize = seg.fontSize || null;
    fontWeight = seg.fontWeight || null;
    fontFamily = seg.fontName?.family || null;
    lineHeight = seg.lineHeight?.value || null;
    letterSpacing = seg.letterSpacing?.value ?? null;
    color = seg.fills?.[0] ? resolveFillColor(seg.fills[0]) : fillColor;
  }

  return {
    background: raw.type === 'text' ? null : fillColor,
    color,
    fontSize,
    fontWeight,
    borderRadius: raw.borderRadius || null,
    opacity: raw.blend?.opacity != null ? raw.blend.opacity : null,
    fontFamily,
    lineHeight,
    letterSpacing,
  };
}

export function extractTree(genome, frameFilter, options = {}) {
  const withStyle = Boolean(options.withStyle);
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : 99;

  function toNode(raw, depth = 0) {
    const node = {
      id: String(raw.id || ''),
      name: String(raw.name || ''),
      type: String(raw.type || ''),
      x: Math.round(raw.rect?.x || 0),
      y: Math.round(raw.rect?.y || 0),
      width: Math.round(raw.rect?.w || 0),
      height: Math.round(raw.rect?.h || 0),
    };
    if (raw.textbox?.text) node.text = raw.textbox.text;
    if (withStyle) node.style = extractRawNodeStyle(genome, raw);
    if ((raw.children || []).length > 0 && depth < maxDepth) {
      node.children = raw.children.map((child) => toNode(child, depth + 1));
    }
    return node;
  }

  return (genome.pages || [])
    .filter((page) => !frameFilter || page.id === frameFilter)
    .map((page) => toNode(page, 0));
}

/**
 * Extract design tokens from genome data.
 */
export function extractTokens(genome) {
  const colors = new Set();
  const fontSizes = new Set();
  const radii = new Set();
  const spacing = new Set();

  // From styles
  for (const style of genome.styles?.fillStyles || []) {
    for (const fill of style.data || []) {
      const c = resolveFillColor(fill);
      if (c) colors.add(c);
    }
  }

  // Recursively collect from nodes
  function walk(node) {
    if (node.fills) {
      for (const fill of node.fills) {
        const c = resolveFillColor(fill);
        if (c) colors.add(c);
      }
    }
    if (node.borderRadius) radii.add(Math.round(node.borderRadius));
    if (node.rect) {
      spacing.add(Math.round(node.rect.x));
      spacing.add(Math.round(node.rect.y));
    }
    if (node.textbox?.segments) {
      for (const seg of node.textbox.segments) {
        if (seg.fontSize) fontSizes.add(seg.fontSize);
        if (seg.fills) {
          for (const fill of seg.fills) {
            const c = resolveFillColor(fill);
            if (c) colors.add(c);
          }
        }
      }
    }
    for (const child of node.children || []) walk(child);
  }
  for (const page of genome.pages || []) walk(page);

  return {
    colors: [...colors].sort(),
    fontSizes: [...fontSizes].sort((a, b) => a - b),
    radii: [...radii].sort((a, b) => a - b),
    spacing: [...spacing].filter((s) => s > 0).sort((a, b) => a - b),
  };
}

// Legacy exports for backward compatibility
export const INTERCEPTOR_JS = `(function(){
  if(window.__mv_net) return;
  window.__mv_net=[];
  var M=100, B=524288, F=window.fetch;
  function cap(u,m,s,t,ct){
    if(window.__mv_net.length>=M) return;
    var fl=t?t.length:0, tr=fl>B, st=tr?t.slice(0:B):t, body=null;
    if(st){try{body=JSON.parse(st)}catch(e){body=st}}
    var e={url:u,method:m||'GET',status:s,size:fl,ct:ct,body:body,ts:Date.now()};
    if(tr){e.bodyTruncated=true;e.bodyFullSize=fl}
    window.__mv_net.push(e);
  }
  window.fetch=async function(){
    var r=await F.apply(this,arguments);
    try{
      var ct=r.headers.get('content-type')||'';
      if(ct.includes('json')||ct.includes('text')){
        var c=r.clone(),t=await c.text();
        cap(r.url||(arguments[0]&&arguments[0].url)||String(arguments[0]),
            (arguments[1]&&arguments[1].method)||'GET',r.status,t,ct);
      }
    }catch(e){}
    return r;
  };
  var X=XMLHttpRequest.prototype,O=X.open,S=X.send;
  X.open=function(m,u){this._m=m;this._u=u;return O.apply(this,arguments)};
  X.send=function(){
    var x=this;
    x.addEventListener('load',function(){
      try{
        var ct=x.getResponseHeader('content-type')||'';
        if(ct.includes('json')||ct.includes('text'))
          cap(x._u,x._m||'GET',x.status,x.responseText||'',ct);
      }catch(e){}
    });
    return S.apply(this,arguments);
  };
})()`;

export async function readNetwork(page) {
  const raw = await page.evaluate(
    '(function(){ var out = window.__opencli_net || window.__mv_net || []; window.__opencli_net = []; window.__mv_net = []; return JSON.stringify(out); })()'
  );
  try { return JSON.parse(raw); } catch { return []; }
}

export function filterApiResponses(items) {
  return items
    .filter((r) => {
      const ct = (r.ct || r.contentType || '').toLowerCase();
      return (
        (ct.includes('json') || ct.includes('text/plain') || ct.includes('javascript')) &&
        !/\.(js|css|png|jpg|gif|svg|woff|ico|map|ttf|otf)(\?|$)/i.test(r.url || '') &&
        !/analytics|tracking|telemetry|beacon|pixel|gtag|fbevents/i.test(r.url || '')
      );
    })
    .map((r) => {
      let body = r.body;
      if (body && typeof body === 'string') { try { body = JSON.parse(body); } catch {} }
      return { url: r.url, status: r.status, ct: r.ct || r.contentType, body };
    })
    .filter((r) => r.status >= 200 && r.status < 400 && r.body && typeof r.body === 'object');
}

export function findBestResponse(apiResponses) {
  if (apiResponses.length === 0) return null;
  for (const r of apiResponses) {
    const b = r.body;
    if (b && (b.data || b.result || b.design || b.document || b.project)) return b;
  }
  return apiResponses.reduce((best, r) => {
    const size = JSON.stringify(r.body).length;
    const bestSize = best ? JSON.stringify(best.body).length : 0;
    return size > bestSize ? r : best;
  }, apiResponses[0])?.body || null;
}

export function matchesNodeId(raw, nodeId) {
  if (!raw || typeof raw !== 'object') return false;
  return String(raw.id || raw.key || raw.nodeId || '') === nodeId;
}
