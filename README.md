# Markdown Viewer

一个本地运行的 Markdown 文件查看器，使用 Vue 3 构建前端界面，Node.js/Express 提供本地文件扫描与读取能力。

应用提供两种模式：

- 手动指定文件模式，作为默认模式
- 扫描模式，支持盘符扫描和全盘扫描

## 功能特性

- 默认进入手动文件模式。
- 手动模式下可直接通过系统文件选择器打开单个 `.md` 文件。
- 扫描模式下可选择某个盘符或目录，或进行全盘扫描。
- 默认扫描最近 3 天创建的 Markdown 文件，并忽略 C 盘。
- 手动选择某个盘符或文件夹后，可扫描该路径下所有时间的 Markdown 文件。
- 左侧目录树按「盘符 / Markdown 直接父文件夹 / 文件」展示。
- 目录选择弹窗只展示存在 Markdown 文件的盘符和目录。
- 保留最近 5 个打开过的 Markdown 文件，刷新页面后仍然可见。
- 右侧实时渲染 Markdown 内容。

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

## 更新日志

详细变更记录见 [CHANGELOG.md](./CHANGELOG.md)。

## 扫描规则

默认扫描模式：

- 扫描当前电脑可访问的非 C 盘磁盘。
- 只返回最近 3 天创建的 Markdown 文件。
- 最多返回 20000 个 Markdown 文件。

手动指定路径：

- 通过目录弹窗选择盘符或文件夹。
- 扫描该路径下所有时间的 Markdown 文件。
- 不套用最近 3 天限制。

## 项目结构

```text
.
├── server.js
├── src/
│   ├── App.vue
│   ├── main.js
│   └── styles.css
├── index.html
├── vite.config.js
├── package.json
└── README.md
```
