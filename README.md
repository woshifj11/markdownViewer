# Markdown Viewer

一个本地运行的 Markdown 文件查看器，使用 Vue 3 构建前端界面，Node.js/Express 提供本地文件扫描与读取能力。

应用会在启动后自动扫描本机 Markdown 文件，并以「盘符 / Markdown 所在文件夹 / 文件」的结构展示。左侧负责文件导航，右侧负责渲染 Markdown 内容。

## 功能特性

- 启动后自动扫描本地 Markdown 文件。
- 默认只展示最近 3 天创建的 `.md` 文件。
- 默认全盘扫描时忽略 C 盘，减少系统目录扫描成本。
- 支持通过弹窗目录树选择扫描盘符或文件夹。
- 手动选择盘符或文件夹后，会扫描该路径下所有时间的 Markdown 文件。
- 目录选择弹窗只展示存在 Markdown 文件的盘符和目录。
- 左侧文件树按「盘符 / Markdown 直接父文件夹 / Markdown 文件」展示，不展开完整多级路径。
- Markdown 文件下方显示完整精准路径。
- 保留最近 5 个打开过的 Markdown 文件，刷新页面后仍然可见。
- 右侧实时渲染 Markdown 内容。
- 自动跳过 `node_modules`、`.git`、`Windows`、`AppData` 等常见大目录或系统目录。

## 技术栈

- Vue 3
- Vite
- Express
- markdown-it
- Node.js 文件系统 API

## 本地运行

安装依赖：

```bash
npm install
```

启动开发服务：

```bash
npm run dev
```

默认访问地址：

```text
http://127.0.0.1:5173
```

本地 API 默认运行在：

```text
http://127.0.0.1:3001
```

## 构建

```bash
npm run build
```

构建产物会输出到 `dist/`。

## 扫描规则

默认打开软件时：

- 扫描当前电脑可访问的非 C 盘磁盘。
- 只返回最近 3 天创建的 Markdown 文件。
- 最多返回 20000 个 Markdown 文件。
- 单个 Markdown 文件预览上限为 5 MB。

手动选择扫描路径时：

- 可以选择某个盘符或文件夹。
- 会扫描该路径下所有时间的 Markdown 文件。
- 不会套用「最近 3 天」限制。

## 界面结构

```text
┌──────────────────────────────┬─────────────────────────────────────┐
│ 左侧文件导航                   │ 右侧 Markdown 预览                  │
│                              │                                     │
│ 最近打开                      │  文件名                              │
│   README.md                  │  完整路径                            │
│                              │                                     │
│ E:                           │  渲染后的 Markdown 内容              │
│   docs                       │                                     │
│     README.md                │                                     │
│     E:\project\docs\README.md│                                     │
└──────────────────────────────┴─────────────────────────────────────┘
```

## 项目结构

```text
.
├── server.js          # 本地 Express API，负责扫描目录和读取 Markdown 文件
├── src/
│   ├── App.vue        # 主界面和交互逻辑
│   ├── main.js        # Vue 入口
│   └── styles.css     # 全局样式
├── index.html
├── vite.config.js
├── package.json
└── README.md
```

## 注意事项

- 这是本地工具，不需要部署到服务器。
- 浏览器本身不能直接扫描磁盘，所以项目使用本地 Node.js 服务完成文件扫描。
- 如果手动选择很大的磁盘或目录，首次扫描可能需要一些时间。
- 目录选择弹窗会递归判断目录内是否存在 Markdown 文件，因此第一次打开也可能需要等待。
