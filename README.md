# Moonvy Design MCP

从 Moonvy 设计页面提取前端样式信息的本地工具链，基于 [OpenCLI](https://github.com/jackwener/opencli) 适配器实现。

## 功能

```bash
# 设计稿元数据（标题、画框尺寸）
opencli moonvy design <url> -f json

# 项目页面/文件列表
opencli moonvy pages <url> -f json

# 图层列表（ID、名称、类型、位置）
opencli moonvy layers <url> --limit 20 -f json

# 单个节点的样式（背景色、字号、圆角等）
opencli moonvy style <url> --node "4:1224" -f json

# 完整图层树（可附带每个节点的样式）
opencli moonvy tree <url> --with-style -f json

# 提取设计 Token（颜色、字号、圆角、间距）
opencli moonvy tokens <url> -f json

# 下载节点切图、快照或关联图片
opencli moonvy asset <url> --node "4:1224" [--type slice|snapshot|image] [--slice-format format] [--name name] [--out dir]

# 调试：某个节点在 genome 里的原始 JSON（或 --out 落盘整份 genome）
opencli moonvy raw <url> --node "4:1224" -f json
```

## 样式字段（style / tree --with-style）

归一化样式从 genome 1.9 的真实字段推导，覆盖：

| 字段 | 来源 | 说明 |
|---|---|---|
| `background` / `backgroundVariable` | `fills[]` type=color（含 `varBind` 颜色变量） | 半透明用 `rgba()`，变量按名字报出（如 `工地签`） |
| `gradient` | `fills[]` type=gradient | 含 stops / from / to / angle 与可直接用的 `css`；`background` 同时给出该 css |
| `imageFill` / `imageUrl` | `fills[]` 无 type 的项 | Sketch 导入的图片填充不带位图，只能标记；要图请用 `asset --type snapshot` 或让设计师切图 |
| `border` / `borderWidth` / `borderColor` / `borderAlign` / `strokes` | `strokes[]` | `border` 是 CSS 简写；`borderAlign` inside/center/outside |
| `borderRadius` / `borderRadii` | `borderRadius` | 四角不一致时 `borderRadii` 给四个值 |
| `opacity` / `visible` / `blendMode` / `clipsContent` | `blend` | 隐藏图层默认从 tree 中剔除（`--include-hidden` 保留） |
| `boxShadow` / `blur` / `backdropBlur` / `effects` | `effects[]` | 阴影输出 CSS box-shadow |
| `fontFamily` / `fontStyle` / `fontWeight` / `italic` | `textbox.segments[].fontName` | **genome 没有 fontWeight 字段**，数字字重由 `fontName.style`（Bold/Medium/…）与 `_macWeight` 推导 |
| `fontSize` / `lineHeight` / `letterSpacing` / `textDecoration` | 同上 | |
| `color` / `colorVariable` | segment `fills` | |
| `textAlign` / `textAlignVertical` / `paragraphSpacing` | `textbox` | |
| `mixedText` / `segments` | 多段富文本时给出每段样式 | |
| `component` / `exportable` / `sliceFormats` / `hasSnapshot` / `isFrame` / `subType` | `masterName` / `slices` / `snapshot` | `exportable=true` 表示设计师标了切图，用 `asset` 下载 |

`tree --with-style` 会省略 null / false / 空数组字段，`style` 单节点命令输出完整字段。

## 安装

下载本项目：

```bash
npx degit cinob/moonvy-design-mcp moonvy-design-mcp
cd moonvy-design-mcp
```

安装依赖并链接 Moonvy OpenCLI 适配器：

```bash
npm install     # postinstall 会自动创建符号链接到 ~/.opencli/clis/moonvy/
npm run status  # 查看链接状态
```

也可以使用 `pnpm install` 或 `bun install`，安装后同样会执行 `postinstall`。

需要已登录 Moonvy 的浏览器会话（复用本地登录状态）。

## 工作原理

```
Moonvy 页面 (需要登录)
    ↓
OpenCLI 浏览器自动化 (获取 JWT Token)
    ↓
Moonvy API: POST /v2/anynode/get (获取 genome 文件 URL)
    ↓
下载并解压 genome.json (gzip)
    ↓
解析图层树、样式、设计 Token → JSON 输出
```

## 项目结构

```
moonvy-design-mcp/
├── package.json
├── server.js                 # MCP stdio server，薄封装 opencli moonvy 命令
├── sync-adapters.sh          # link/unlink 符号链接
├── adapters/moonvy/          # 适配器源码
│   ├── shared.js             # API 客户端、genome 解析
│   ├── design.js
│   ├── pages.js
│   ├── layers.js
│   ├── style.js
│   ├── tree.js
│   └── tokens.js
└── site/                     # API 发现记录 & 验证 fixtures
    ├── notes.md
    ├── endpoints.json
    └── verify/
```

适配器通过符号链接映射到 `~/.opencli/clis/moonvy/`，修改源码立即生效。

## 脚本

```bash
./sync-adapters.sh link      # 创建符号链接
./sync-adapters.sh unlink    # 移除符号链接
./sync-adapters.sh status    # 查看当前状态

npm run link
npm run unlink
npm run status
npm run check                # 检查 MCP server 语法
npm run mcp                  # 以 stdio 方式启动 MCP server
```

## 在 Claude Code 中安装 MCP

当前 MCP server 是 OpenCLI 的薄封装，内部仍然调用 `opencli moonvy ... -f json`。

```bash
claude mcp add -s project moonvy -- node ./server.js
```

查看或移除：

```bash
claude mcp list
claude mcp get moonvy
claude mcp remove moonvy
```

暴露的 MCP 工具：

- `moonvy_get_design`
- `moonvy_list_pages`
- `moonvy_list_layers`
- `moonvy_get_node_style`
- `moonvy_get_tree`
- `moonvy_extract_tokens`
- `moonvy_sync_project`
- `moonvy_search_designs`
- `moonvy_get_tree_by_name`
- `moonvy_download_asset`
- `moonvy_get_raw_node`（调试用，返回节点原始 genome JSON）

## Claude Code 推荐工作流

`moonvy-design-mcp` 是工具项目，`.moonvy-mcp/` 应创建在真实前端项目根目录中。项目索引类工具都要求传入绝对路径 `workspaceDir`，避免误写到工具项目自身。

推荐在真实前端项目中安装 MCP 时使用工具项目的绝对路径：

```bash
claude mcp add -s project moonvy -- node /path/to/moonvy-design-mcp/server.js
```

首次使用时同步 Moonvy 项目索引：

```text
调用 moonvy_sync_project：
- projectUrl: Moonvy 项目链接
- workspaceDir: 真实前端项目根目录绝对路径
```

同步会创建：

```text
<workspaceDir>/.moonvy-mcp/catalog.json
<workspaceDir>/.moonvy-mcp/aliases.json  # 如果不存在则创建空对象
```

`catalog.json` 默认只保存 `type: "design"` 的设计图条目；如需收录其它资源类型，可在 `moonvy_sync_project` 传 `types`。保存字段是白名单：设计图 ID、名称、类型、脱敏后的链接、项目 ID、父级 ID、别名、标签和同步时间。同步不会保存 cookie、JWT、API 原始响应或完整设计树，也不会覆盖用户已维护的 `.moonvy-mcp/aliases.json`。

后续开发时可以让 Claude Code 先查索引：

```text
请读取当前项目的 .moonvy-mcp，找到“首页”设计稿，并根据它还原 pages/index/index.vue。
```

推荐流程：

1. `moonvy_search_designs` 根据页面名、组件名、文件路径或别名查找设计图。
2. `moonvy_get_tree_by_name` 通过设计图名称获取完整 tree/style。
3. Claude Code 结合现有代码实现 UI。
4. 启动真实项目验证页面效果。

业务项目建议维护：

```text
.moonvy-mcp/
├── catalog.json      # 工具同步生成，可按需提交
├── aliases.json      # 用户维护的代码文件到设计图映射
└── cache/            # 后续缓存目录，默认不需要提交
```

业务项目 `.gitignore` 建议包含：

```gitignore
.moonvy-mcp/cache/
.moonvy-mcp/*.local.json
```

如果设计图名称或链接也属于敏感信息，则不要提交整个 `.moonvy-mcp/`。

## 切图与静态资源下载

除了样式解析，工具还支持导出和下载设计稿中节点相关的切图（Slices）、画布快照（Snapshots）以及节点图片填充（Image Fills）：

```bash
# 下载指定图层的切图（默认导出 SVG 格式，可指定为 png/max 等高倍率格式）
opencli moonvy asset <url> --node "120:4603" --slice-format max --out ./assets

# 下载指定图层所处位置的快照图片
opencli moonvy asset <url> --node "58:4363" --type snapshot --name "welcome_preview"

# 下载节点的图片填充背景图
opencli moonvy asset <url> --node "59:4441" --type image
```

支持的资源类型 (`--type`)：
- `slice`: 图层配置的切图输出（通常为设计师手动标记导出的图标等）。
- `snapshot`: 节点自身的画布预览（支持自动向上级画板回溯定位快照）。
- `image`: 节点 `fills` 属性中填充的原始图片。

`--slice-format` 支持指定切图尺寸与比例：例如 `svg`、`base` (1x)、`max` (最高倍率，通常为 4x/2x)。

---

## Node ID 格式

Moonvy 使用 Figma 风格的节点 ID：`4:1221`、`I4:1222;4:1005;4:69`

可通过 `opencli moonvy layers <url>` 获取设计稿中的所有节点 ID。

## HTML 还原推荐流程

```bash
# 1. 获取 frame 尺寸
opencli moonvy design <url> -f json

# 2. 获取完整树和样式，作为生成 HTML 的主要输入
opencli moonvy tree <url> --with-style -f json

# 3. 如需快速定位节点，可限制深度
opencli moonvy tree <url> --with-style --max-depth 2 -f json
```

还原时不要只看组件父节点。按钮、表单、图标的真实颜色和圆角经常在子节点 `bg`、`text`、`Path` 上。

## 限制

- 需要已登录的浏览器会话
- 仅支持读取，不支持修改设计
- 设计数据来源为 Moonvy 的 genome 文件格式
