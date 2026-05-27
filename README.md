# Moonvy Design MCP

从 Moonvy 设计页面提取前端样式信息的本地工具链，基于 [OpenCLI](https://github.com/jackwener/opencli) 适配器实现。

## 功能

```bash
# 设计稿元数据（标题、画框尺寸）
opencli moonvy design <url> -f json

# 图层列表（ID、名称、类型、位置）
opencli moonvy layers <url> --limit 20 -f json

# 单个节点的样式（背景色、字号、圆角等）
opencli moonvy style <url> --node "4:1224" -f json

# 提取设计 Token（颜色、字号、圆角、间距）
opencli moonvy tokens <url> -f json
```

## 安装

```bash
npm install
npm run link    # 创建符号链接到 ~/.opencli/clis/moonvy/
```

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
├── sync-adapters.sh          # link/unlink 符号链接
├── adapters/moonvy/          # 适配器源码
│   ├── shared.js             # API 客户端、genome 解析
│   ├── design.js
│   ├── layers.js
│   ├── style.js
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
```

## Node ID 格式

Moonvy 使用 Figma 风格的节点 ID：`4:1221`、`I4:1222;4:1005;4:69`

可通过 `opencli moonvy layers <url>` 获取设计稿中的所有节点 ID。

## 限制

- 需要已登录的浏览器会话
- 仅支持读取，不支持修改设计
- 设计数据来源为 Moonvy 的 genome 文件格式
