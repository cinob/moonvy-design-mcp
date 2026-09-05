## 2026-05-27

API-based Moonvy adapter implementation complete:

### API Discovery
- **Base URL**: `https://global-api.moonvy.com/v2`
- **Auth**: JWT token from `app.api.$options.token` in browser context
- **Key endpoints**:
  - `POST /anynode/get` with `{projectId, id, lv}` - get node data
    - `lv: "base"` - basic metadata
    - `lv: "full"` - includes `files.genome.url` for design data
  - `POST /anynode/list` with `{projectId, pageIndex}` - list nodes in directory

### Data Flow
1. Parse Moonvy URL: `/project/:projectId/:dirId/:fileId`
2. Navigate to page to establish login state
3. Get JWT token from `app.api.$options.token`
4. Call `/anynode/get` with `{projectId, id: fileId, lv: "full"}`
5. Fetch genome JSON from `node.files.genome.url` (gzip-compressed)
6. Decompress and parse genome data

### Genome Structure
- `genomeVer`: version number
- `styles`: fillStyles, effectStyles, textStyles
- `pages`: array of page objects, each with `children` (layer tree)
- Each node has: `id`, `name`, `type`, `rect`, `fills`, `textbox`, `blend`, `borderRadius`
- Text nodes have `textbox.segments` with font info

### Node ID Format
Figma-style IDs: `4:1221`, `I4:1222;4:1005;4:69`

### Verified Commands
- `opencli moonvy pages <url> --limit N -f json` - returns project pages/files
- `opencli moonvy design <url> -f json` - returns title, frames, frameCount
- `opencli moonvy layers <url> --limit N -f json` - returns layer tree
- `opencli moonvy style <url> --node <id> -f json` - returns normalized style
- `opencli moonvy tokens <url> -f json` - returns colors, fontSizes, radii, spacing

## 2026-09-05

对照 5 份真实 genome（Sketch 导入，genomeVer 1.9）逐字段核对，补齐适配器漏掉的样式：

- 字重：genome **没有** `segment.fontWeight`，只有 `fontName.style`（Regular/Medium/Bold…）、`fontName._macWeight`（NSFont 0–15，5=Regular 9=Bold）、`postscriptName`。旧代码读不存在的字段导致永远 null。
- 描边：`strokes[] {fills, w, align, join, cap, dash}` 之前完全未解析。
- 渐变：`fills[].type='gradient'`，`gradient {type, stops[{color,position}], from, to}`，旧 resolveFillColor 直接返回 null。
- 颜色变量：`fill.varBind.color.variableId` → `genome.variables.all[id].valuesByMode[collection.defaultModeId]`。
- 颜色 alpha 在 `color.alpha`，与 `fill.opacity` 相乘；旧代码忽略 alpha。
- 效果：`effects[] {type:'shadow'|'filterBlur', offsetX, offsetY, blur, spread, color}`。
- 图片填充：Sketch 导入后 fills 项只有 `{opacity, visible}`，genome.images 只含切图和快照哈希，位图不可得。
- 其它：`blend.visible`（隐藏）、`blend.isClip`、`textbox.align/alignVertical/spacing`、`textDecoration`、`masterName`、`slices`、`subType`、`isFrame`。
- `styles`（fillStyles/textStyles）在这些 genome 中为空对象，fillLink 分支保留但未见使用。
