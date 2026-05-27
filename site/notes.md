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
- `opencli moonvy design <url> -f json` - returns title, frames, frameCount
- `opencli moonvy layers <url> --limit N -f json` - returns layer tree
- `opencli moonvy style <url> --node <id> -f json` - returns normalized style
- `opencli moonvy tokens <url> -f json` - returns colors, fontSizes, radii, spacing
