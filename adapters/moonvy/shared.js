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
 * Sniff the real image format from magic bytes. Moonvy's fs server often
 * serves PNG bytes regardless of the requested slice format (e.g. svg),
 * so extension must be derived from content, not from the request.
 */
export function sniffImageExtension(buffer) {
  if (!buffer || buffer.length < 12) return '';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return '.png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return '.jpg';
  const head = buffer.subarray(0, 256).toString('utf-8').trimStart();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return '.svg';
  if (head.startsWith('RIFF') && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
  if (head.startsWith('GIF8')) return '.gif';
  return '';
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

export async function fetchNodeListPage(projectId, pageIndex, token, options = {}) {
  const body = { projectId, pageIndex };
  if (options.id) body.id = options.id;
  return moonvyApi('/anynode/list', body, token);
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
    text: node.textbox?.text,
    visible: node.blend?.visible !== false,
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
  if (!node || !targetId) return null;
  const cleanTarget = targetId.split(';').pop();

  if (node.id && (node.id === targetId || node.id.includes(targetId) || node.id.includes(cleanTarget) || targetId.includes(node.id))) return node;
  for (const child of node.children || []) {
    const found = findGenomeNode(child, targetId);
    if (found) return found;
  }
  return null;
}

/**
 * Find a node's parent in the genome tree.
 */
export function findGenomeParent(node, targetId, parent = undefined) {
  if (!node || !targetId) return undefined;
  const cleanTarget = targetId.split(';').pop();

  if (node.id && (node.id === targetId || node.id.includes(targetId) || node.id.includes(cleanTarget) || targetId.includes(node.id))) return parent ?? null;
  for (const child of node.children || []) {
    const found = findGenomeParent(child, targetId, node);
    if (found !== undefined) return found;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Style resolution. Field names below are what genome 1.9 actually stores
// (verified by dumping real designs with `opencli moonvy raw`):
//   fills[]     {type:'color'|'gradient'|<missing = image>, color{r,g,b,alpha}, opacity, visible, varBind}
//   strokes[]   {fills[], w, align:'inside'|'center'|'outside', join, cap, dash[]}
//   effects[]   {type:'filterBlur'|'shadow'|'innerShadow', blur, color, offsetX, offsetY, spread, visible}
//   blend       {opacity, visible, blendMode, isClip}
//   textbox     {text, align, alignVertical, spacing, segments[]}
//   segment     {fontName{family, style, _macWeight, postscriptName}, fontSize, fills[],
//                lineHeight{unit,value}, letterSpacing{unit,value}, textDecoration}
// There is NO `fontWeight` field: weight must be derived from fontName.
// ---------------------------------------------------------------------------

function clamp255(v) {
  return Math.round(Math.min(255, Math.max(0, Number(v) || 0)));
}

function toHex(r, g, b) {
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Format a genome color object ({r,g,b,alpha}) with an extra multiplier
 * (fill.opacity). Returns hex when opaque, rgba() otherwise.
 */
function formatColor(c, opacityMul = 1) {
  if (!c || typeof c !== 'object') return null;
  const r = clamp255(c.r), g = clamp255(c.g), b = clamp255(c.b);
  const alpha = (c.alpha != null ? Number(c.alpha) : (c.a != null ? Number(c.a) : 1)) * (opacityMul != null ? Number(opacityMul) : 1);
  if (alpha < 0.999) return `rgba(${r},${g},${b},${Number(alpha.toFixed(2))})`;
  return toHex(r, g, b);
}

/**
 * Resolve a design variable (color token) by id from genome.variables.
 * Returns { name, color } or null.
 */
export function resolveVariable(genome, variableId) {
  if (!variableId) return null;
  const v = genome?.variables?.all?.[variableId];
  if (!v) return null;
  const modes = v.valuesByMode || {};
  const modeId = genome?.variables?.collections?.[v.collectionId]?.defaultModeId;
  const value = modes[modeId] ?? Object.values(modes)[0];
  return {
    id: v.id || variableId,
    name: v.name || null,
    type: v.resolvedType || null,
    color: v.resolvedType === 'COLOR' || (value && 'r' in value) ? formatColor(value) : null,
    value: v.resolvedType === 'COLOR' ? undefined : value,
  };
}

/**
 * Resolve a solid color from genome fill data (variable binding aware).
 */
function resolveFillColor(fill, genome) {
  if (!fill || fill.visible === false) return null;
  if (fill.type !== 'color') return null;
  const bound = resolveVariable(genome, fill.varBind?.color?.variableId);
  if (bound?.color) {
    // variable value is the source of truth; still honour fill opacity
    if (fill.opacity != null && fill.opacity < 0.999) {
      const m = bound.color.match(/^#(..)(..)(..)$/);
      if (m) return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${Number(Number(fill.opacity).toFixed(2))})`;
    }
    return bound.color;
  }
  return formatColor(fill.color || {}, fill.opacity != null ? fill.opacity : 1);
}

function fillVariableName(fill, genome) {
  return resolveVariable(genome, fill?.varBind?.color?.variableId)?.name || null;
}

/**
 * CSS angle for a linear gradient defined by from/to in unit space (y down).
 */
function gradientAngle(g) {
  const from = g.from || { x: 0.5, y: 0 };
  const to = g.to || { x: 0.5, y: 1 };
  const dx = (to.x ?? 0.5) - (from.x ?? 0.5);
  const dy = (to.y ?? 1) - (from.y ?? 0);
  if (dx === 0 && dy === 0) return 180;
  // CSS: 0deg = to top, 90deg = to right, 180deg = to bottom
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return Math.round(((deg % 360) + 360) % 360);
}

/**
 * Normalize a gradient fill into a data object plus a CSS string.
 */
function resolveGradient(fill) {
  const g = fill?.gradient;
  if (!g) return null;
  const stops = (g.stops || []).map((s) => ({
    color: formatColor(s.color, fill.opacity != null ? fill.opacity : 1),
    position: Number((s.position ?? 0).toFixed(4)),
  }));
  const type = g.type || 'linear';
  const angle = type === 'linear' ? gradientAngle(g) : null;
  const stopCss = stops.map((s) => `${s.color} ${Math.round(s.position * 100)}%`).join(', ');
  let css;
  if (type === 'linear') css = `linear-gradient(${angle}deg, ${stopCss})`;
  else if (type === 'radial') css = `radial-gradient(circle, ${stopCss})`;
  else if (type === 'angular' || type === 'conic') css = `conic-gradient(${stopCss})`;
  else css = `linear-gradient(${stopCss})`;
  return { type, angle, from: g.from || null, to: g.to || null, stops, css };
}

/**
 * Describe every visible fill of a node: first solid color, first gradient,
 * whether an image fill exists, and the raw list for callers who need all.
 */
function resolveFills(fills, genome) {
  const out = { background: null, backgroundVariable: null, gradient: null, imageFill: false, imageUrl: null, fills: [] };
  for (const f of fills || []) {
    if (!f || f.visible === false) continue;
    if (f.type === 'color') {
      const c = resolveFillColor(f, genome);
      out.fills.push({ type: 'color', color: c, variable: fillVariableName(f, genome), opacity: f.opacity ?? 1 });
      if (out.background == null) {
        out.background = c;
        out.backgroundVariable = fillVariableName(f, genome);
      }
    } else if (f.type === 'gradient') {
      const gr = resolveGradient(f);
      out.fills.push({ ...gr, type: 'gradient', gradientType: gr?.type ?? null, opacity: f.opacity ?? 1 });
      if (!out.gradient) out.gradient = gr;
      if (out.background == null && gr) out.background = gr.css;
    } else {
      // Sketch-imported genomes store image fills as {opacity, visible} with no
      // type and no image reference; treat any non-color/gradient fill as image.
      const hash = f.imageHash || f.hash || f.image || null;
      const url = hash ? (genome?.images?.[hash]?.url || null) : null;
      out.fills.push({ type: 'image', opacity: f.opacity ?? 1, url, mode: f.scaleMode || f.mode || null });
      out.imageFill = true;
      if (!out.imageUrl && url) out.imageUrl = url;
    }
  }
  return out;
}

/**
 * Normalize strokes → border description (first visible stroke wins for the
 * flat fields; all strokes are kept in the list).
 */
function resolveStrokes(strokes, genome) {
  const list = [];
  for (const s of strokes || []) {
    if (!s) continue;
    const fill = (s.fills || []).find((f) => f && f.visible !== false);
    if (!fill) continue;
    const color = fill.type === 'gradient' ? resolveGradient(fill)?.css || null : resolveFillColor(fill, genome);
    list.push({
      width: s.w != null ? Number(s.w) : (s.width != null ? Number(s.width) : 1),
      color,
      variable: fillVariableName(fill, genome),
      align: s.align || 'center',
      dash: Array.isArray(s.dash) && s.dash.length ? s.dash : null,
      cap: s.cap && s.cap !== 'none' ? s.cap : null,
      join: s.join && s.join !== 'none' ? s.join : null,
    });
  }
  const first = list[0] || null;
  return {
    border: first ? `${first.width}px ${first.dash ? 'dashed' : 'solid'} ${first.color}` : null,
    borderWidth: first ? first.width : null,
    borderColor: first ? first.color : null,
    borderAlign: first ? first.align : null,
    strokes: list,
  };
}

/**
 * Normalize effects (shadows / blurs) to a list plus a CSS box-shadow string.
 */
function resolveEffects(effects) {
  const list = [];
  const shadows = [];
  let blur = null;
  let backdropBlur = null;
  for (const e of effects || []) {
    if (!e || e.visible === false) continue;
    const type = String(e.type || '');
    if (/blur/i.test(type) && !/shadow/i.test(type)) {
      const radius = Number(e.blur ?? e.radius ?? 0);
      const item = { type: /background|backdrop/i.test(type) ? 'backgroundBlur' : 'blur', radius };
      list.push(item);
      if (item.type === 'blur') blur = radius; else backdropBlur = radius;
      continue;
    }
    if (/shadow/i.test(type)) {
      const inner = /inner/i.test(type) || e.inner === true;
      const color = formatColor(e.color || {}, e.opacity != null ? e.opacity : 1) || 'rgba(0,0,0,0.2)';
      const x = Number(e.offset?.x ?? e.offsetX ?? e.x ?? 0);
      const y = Number(e.offset?.y ?? e.offsetY ?? e.y ?? 0);
      const radius = Number(e.blur ?? e.radius ?? 0);
      const spread = Number(e.spread ?? 0);
      const css = `${inner ? 'inset ' : ''}${x}px ${y}px ${radius}px ${spread}px ${color}`;
      list.push({ type: inner ? 'innerShadow' : 'shadow', color, x, y, radius, spread, css });
      shadows.push(css);
      continue;
    }
    list.push({ type: type || 'unknown', raw: e });
  }
  return {
    effects: list,
    boxShadow: shadows.length ? shadows.join(', ') : null,
    blur,
    backdropBlur,
  };
}

/**
 * Map a font style name / Apple weight to a CSS numeric weight.
 * `_macWeight` is NSFontManager's 0–15 scale (5 = regular, 9 = bold).
 */
const MAC_WEIGHT_TO_CSS = { 1: 100, 2: 100, 3: 200, 4: 300, 5: 400, 6: 500, 7: 500, 8: 600, 9: 700, 10: 800, 11: 900, 12: 900, 13: 900, 14: 900, 15: 900 };

export function fontWeightFromName(fontName) {
  if (!fontName) return null;
  const style = String(fontName.style || fontName.postscriptName || '').toLowerCase();
  const mac = Number(fontName._macWeight);
  if (Number.isFinite(mac) && MAC_WEIGHT_TO_CSS[mac]) return MAC_WEIGHT_TO_CSS[mac];
  if (/thin|hairline/.test(style)) return 100;
  if (/extralight|ultralight/.test(style)) return 200;
  if (/light/.test(style)) return 300;
  if (/semibold|demibold/.test(style)) return 600;
  if (/extrabold|ultrabold/.test(style)) return 800;
  if (/black|heavy/.test(style)) return 900;
  if (/bold/.test(style)) return 700;
  if (/medium/.test(style)) return 500;
  if (/regular|normal|book|roman/.test(style)) return 400;
  return null;
}

function resolveSegment(seg, genome, fallbackColor) {
  const fontName = seg.fontName || {};
  const fills = resolveFills(seg.fills, genome);
  return {
    start: seg.start ?? null,
    end: seg.end ?? null,
    fontFamily: fontName.family || null,
    fontStyle: fontName.style || null,
    postscriptName: fontName.postscriptName || null,
    fontWeight: fontWeightFromName(fontName),
    italic: /italic|oblique/i.test(String(fontName.style || fontName.postscriptName || '')),
    fontSize: seg.fontSize ?? null,
    lineHeight: seg.lineHeight?.value ?? null,
    lineHeightUnit: seg.lineHeight?.unit ?? null,
    letterSpacing: seg.letterSpacing?.value ?? null,
    textDecoration: seg.textDecoration && seg.textDecoration !== 'none' ? seg.textDecoration : null,
    textCase: seg.textCase && seg.textCase !== 'none' ? seg.textCase : null,
    color: fills.background ?? fallbackColor ?? null,
    colorVariable: fills.backgroundVariable,
  };
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
    background: resolveFills(p.fills, genome).background,
  }));
  const variables = Object.keys(genome.variables?.all || {})
    .map((id) => resolveVariable(genome, id))
    .filter(Boolean);
  return {
    title: nodeMeta?.name || pages[0]?.name || 'Untitled',
    frames,
    frameCount: frames.length,
    genomeVersion: genome.genomeVer ?? null,
    source: genome.meta?.from ?? null,
    designPlatform: genome.meta?.designPlatform ?? null,
    designRatio: genome.meta?.designRatio ?? null,
    variables,
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
    text: typeof n.text === 'string' ? n.text : null,
    visible: n.visible !== false,
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

  if (!raw) {
    raw = { id: nodeId, name: 'Unknown Node', type: 'unknown', rect: { x: 0, y: 0, w: 0, h: 0 } };
  }

  const style = extractRawNodeStyle(genome, raw);
  const text = raw.textbox?.text;
  return [{
    id: String(raw.id || ''),
    name: String(raw.name || ''),
    type: String(raw.type || ''),
    bboxX: Math.round(raw.rect?.x || 0),
    bboxY: Math.round(raw.rect?.y || 0),
    bboxW: Math.round(raw.rect?.w || 0),
    bboxH: Math.round(raw.rect?.h || 0),
    text: typeof text === 'string' ? text : null,
    ...style,
  }];
}

/**
 * Full normalized style for one raw genome node. Every field is present
 * (null when not applicable) so consumers can rely on the shape.
 */
export function extractRawNodeStyle(genome, raw) {
  const isText = raw.type === 'text';
  const fills = resolveFills(raw.fills, genome);
  const strokes = resolveStrokes(raw.strokes, genome);
  const effects = resolveEffects(raw.effects);
  const blend = raw.blend || {};

  let text = null;
  if (raw.textbox) {
    const segs = (raw.textbox.segments || []).map((seg) => resolveSegment(seg, genome, fills.background));
    text = {
      first: segs[0] || null,
      segments: segs,
      align: raw.textbox.align || null,
      alignVertical: raw.textbox.alignVertical || null,
      paragraphSpacing: raw.textbox.spacing ?? null,
    };
  }
  const first = text?.first || {};

  let radius = raw.borderRadius ?? null;
  let radii = null;
  if (Array.isArray(radius)) {
    radii = radius.map(Number);
    radius = radii.every((v) => v === radii[0]) ? radii[0] : null;
  } else if (radius && typeof radius === 'object') {
    radii = [radius.topLeft ?? radius.tl ?? 0, radius.topRight ?? radius.tr ?? 0, radius.bottomRight ?? radius.br ?? 0, radius.bottomLeft ?? radius.bl ?? 0].map(Number);
    radius = radii.every((v) => v === radii[0]) ? radii[0] : null;
  } else if (radius != null) {
    radius = Number(radius) || 0;
  }
  if (radius === 0 && !radii) radius = null;

  const rotation = raw.transform?.rotation ?? raw.transform?.rotate ?? null;

  return {
    // fills
    background: isText ? null : fills.background,
    backgroundVariable: isText ? null : fills.backgroundVariable,
    gradient: isText ? null : fills.gradient,
    imageFill: isText ? false : fills.imageFill,
    imageUrl: isText ? null : fills.imageUrl,
    fills: isText ? [] : fills.fills,
    // strokes
    border: strokes.border,
    borderWidth: strokes.borderWidth,
    borderColor: strokes.borderColor,
    borderAlign: strokes.borderAlign,
    strokes: strokes.strokes,
    // shape
    borderRadius: radius,
    borderRadii: radii,
    rotation: rotation != null ? Number(rotation) : null,
    // blend
    opacity: blend.opacity != null ? blend.opacity : null,
    visible: blend.visible !== false,
    blendMode: blend.blendMode && blend.blendMode !== 'normal' ? blend.blendMode : null,
    clipsContent: blend.isClip === true,
    // effects
    boxShadow: effects.boxShadow,
    blur: effects.blur,
    backdropBlur: effects.backdropBlur,
    effects: effects.effects,
    // text (flat copy of the first segment for convenience)
    color: first.color ?? null,
    colorVariable: first.colorVariable ?? null,
    fontFamily: first.fontFamily ?? null,
    fontStyle: first.fontStyle ?? null,
    fontWeight: first.fontWeight ?? null,
    italic: first.italic ?? null,
    fontSize: first.fontSize ?? null,
    lineHeight: first.lineHeight ?? null,
    letterSpacing: first.letterSpacing ?? null,
    textDecoration: first.textDecoration ?? null,
    textAlign: text?.align ?? null,
    textAlignVertical: text?.alignVertical ?? null,
    paragraphSpacing: text?.paragraphSpacing ?? null,
    mixedText: text ? text.segments.length > 1 : false,
    segments: text && text.segments.length > 1 ? text.segments : null,
    // meta
    subType: raw.subType || null,
    isFrame: raw.isFrame === true,
    component: raw.masterName || null,
    exportable: !!raw.slices,
    sliceFormats: raw.slices ? Object.keys(raw.slices) : null,
    hasSnapshot: !!(raw.snapshot || raw.snapshotPreview),
  };
}

export function extractTree(genome, frameFilter, options = {}) {
  const withStyle = Boolean(options.withStyle);
  const compact = options.compact !== false; // drop null/false/empty fields in tree styles
  const includeHidden = Boolean(options.includeHidden);
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : 99;

  function compactStyle(style) {
    if (!compact) return style;
    const out = {};
    for (const [k, v] of Object.entries(style)) {
      if (v == null) continue;
      if (v === false && k !== 'visible') continue;
      if (k === 'visible' && v === true) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      // fills/strokes/effects lists duplicate the flat fields unless there are several
      if ((k === 'fills' || k === 'strokes' || k === 'effects') && v.length <= 1) continue;
      out[k] = v;
    }
    return out;
  }

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
    if (raw.blend?.visible === false) node.visible = false;
    if (raw.textbox?.text) node.text = raw.textbox.text;
    if (withStyle) node.style = compactStyle(extractRawNodeStyle(genome, raw));
    if ((raw.children || []).length > 0 && depth < maxDepth) {
      node.children = raw.children
        .filter((child) => includeHidden || child?.blend?.visible !== false)
        .map((child) => toNode(child, depth + 1));
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
  const strokeColors = new Set();
  const gradients = new Set();
  const fontSizes = new Set();
  const fontWeights = new Set();
  const fontFamilies = new Set();
  const lineHeights = new Set();
  const radii = new Set();
  const borderWidths = new Set();
  const shadows = new Set();
  const spacing = new Set();
  const typography = new Map();

  function walk(node) {
    if (node.blend?.visible === false) return;
    const fills = resolveFills(node.fills, genome);
    for (const f of fills.fills) {
      if (f.type === 'color' && f.color) colors.add(f.color);
      if (f.type === 'gradient' && f.css) gradients.add(f.css);
    }
    const strokes = resolveStrokes(node.strokes, genome);
    for (const s of strokes.strokes) {
      if (s.color) strokeColors.add(s.color);
      if (s.width) borderWidths.add(s.width);
    }
    const effects = resolveEffects(node.effects);
    for (const e of effects.effects) if (e.css) shadows.add(e.css);
    const r = node.borderRadius;
    if (typeof r === 'number' && r > 0) radii.add(Math.round(r));
    if (node.rect) {
      spacing.add(Math.round(node.rect.x));
      spacing.add(Math.round(node.rect.y));
    }
    if (node.textbox?.segments) {
      for (const seg of node.textbox.segments) {
        const s = resolveSegment(seg, genome, null);
        if (s.fontSize) fontSizes.add(s.fontSize);
        if (s.fontWeight) fontWeights.add(s.fontWeight);
        if (s.fontFamily) fontFamilies.add(s.fontFamily);
        if (s.lineHeight) lineHeights.add(s.lineHeight);
        if (s.color) colors.add(s.color);
        if (s.fontSize) {
          const key = `${s.fontFamily || '?'}/${s.fontSize}/${s.fontWeight || '?'}/${s.lineHeight || '?'}`;
          const entry = typography.get(key) || {
            fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, fontStyle: s.fontStyle,
            lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, count: 0,
          };
          entry.count += 1;
          typography.set(key, entry);
        }
      }
    }
    for (const child of node.children || []) walk(child);
  }
  for (const page of genome.pages || []) walk(page);

  const variables = Object.keys(genome.variables?.all || {})
    .map((id) => resolveVariable(genome, id))
    .filter(Boolean)
    .map((v) => ({ name: v.name, color: v.color, type: v.type }));

  const num = (a, b) => a - b;
  return {
    colors: [...colors].sort(),
    strokeColors: [...strokeColors].sort(),
    gradients: [...gradients].sort(),
    variables,
    fontFamilies: [...fontFamilies].sort(),
    fontSizes: [...fontSizes].sort(num),
    fontWeights: [...fontWeights].sort(num),
    lineHeights: [...lineHeights].sort(num),
    typography: [...typography.values()].sort((a, b) => b.fontSize - a.fontSize || (b.fontWeight || 0) - (a.fontWeight || 0)),
    radii: [...radii].sort(num),
    borderWidths: [...borderWidths].sort(num),
    shadows: [...shadows].sort(),
    spacing: [...spacing].filter((s) => s > 0).sort(num),
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
