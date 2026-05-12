<script setup>
import MarkdownIt from 'markdown-it';
import { computed, onMounted, ref } from 'vue';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
});

const RECENT_FILES_KEY = 'markdown-viewer-recent-files';

const config = ref(null);
const rootPath = ref('');
const query = ref('');
const files = ref([]);
const recentFiles = ref(loadRecentFiles());
const scanErrors = ref([]);
const selectedPath = ref('');
const currentFile = ref(null);
const isScanning = ref(false);
const isLoadingFile = ref(false);
const errorMessage = ref('');
const truncated = ref(false);
const expandedTreeKeys = ref(new Set());
const isPathDialogOpen = ref(false);
const directoryRows = ref([]);
const directoryExpandedKeys = ref(new Set());
const directoryLoadingKeys = ref(new Set());
const isLoadingRootDirectories = ref(false);
const pendingScanPath = ref('*');
const directoryError = ref('');
const scanSummary = ref({
  createdWithinDays: 3,
  ignoredDrives: ['C:']
});

const scanTimeLabel = computed(() => {
  if (scanSummary.value.createdWithinDays === null) return '全部时间';
  return `最近 ${scanSummary.value.createdWithinDays} 天创建`;
});

const filteredFiles = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  if (!keyword) return files.value;

  return files.value.filter((file) => {
    return (
      file.name.toLowerCase().includes(keyword) ||
      file.path.toLowerCase().includes(keyword)
    );
  });
});

const fileTree = computed(() => {
  const tree = buildFileTree(filteredFiles.value);
  if (recentFiles.value.length === 0) return tree;

  return [
    {
      kind: 'recent',
      key: '__recent__',
      label: '最近打开',
      secondary: `${recentFiles.value.length} 个文件`,
      count: recentFiles.value.length,
      file: null,
      children: recentFiles.value.map((file) => ({
        kind: 'file',
        key: `recent:${file.path}`,
        label: file.name,
        secondary: file.path,
        count: 1,
        file,
        children: []
      }))
    },
    ...tree
  ];
});

const visibleTreeRows = computed(() => {
  const rows = [];
  const forceExpand = Boolean(query.value.trim());

  for (const node of fileTree.value) {
    collectVisibleRows(node, 0, rows, forceExpand);
  }

  return rows;
});

const visibleDirectoryRows = computed(() => {
  const rows = [];

  for (const node of directoryRows.value) {
    collectDirectoryRows(node, 0, rows);
  }

  return rows;
});

const selectedPathLabel = computed(() => {
  if (rootPath.value === '*') return '全部磁盘';
  return rootPath.value || '未选择';
});

const renderedMarkdown = computed(() => {
  if (!currentFile.value?.content) return '';
  return md.render(currentFile.value.content);
});

const selectedMeta = computed(() => {
  if (!currentFile.value) return '';
  const createdAt = new Date(currentFile.value.birthtimeMs).toLocaleString();
  return `${formatBytes(currentFile.value.size)} / 创建于 ${createdAt}`;
});

onMounted(async () => {
  await loadConfig();
  await scanAllDrives();
});

async function loadConfig() {
  const response = await fetch('/api/config');
  config.value = await response.json();
  rootPath.value = '*';
}

async function scanFiles(nextRoot = rootPath.value, options = {}) {
  if (!nextRoot.trim()) return;

  isScanning.value = true;
  errorMessage.value = '';
  currentFile.value = null;
  selectedPath.value = '';

  try {
    const params = new URLSearchParams({ root: nextRoot.trim() });
    if (options.createdWithinDays !== undefined) {
      params.set('createdWithinDays', String(options.createdWithinDays));
    }

    const response = await fetch(`/api/files?${params.toString()}`);
    const data = await readJsonResponse(response);
    files.value = data.files || [];
    scanErrors.value = data.errors || [];
    scanSummary.value = {
      createdWithinDays: data.createdWithinDays ?? null,
      ignoredDrives: data.ignoredDrives || []
    };
    truncated.value = Boolean(data.truncated);
    expandedTreeKeys.value = getDefaultExpandedKeys(files.value);
    expandedTreeKeys.value.add('__recent__');

    if (files.value.length > 0) {
      await openFile(files.value[0]);
    }
  } catch (error) {
    files.value = [];
    scanErrors.value = [];
    truncated.value = false;
    errorMessage.value = error.message;
  } finally {
    isScanning.value = false;
  }
}

async function scanAllDrives() {
  rootPath.value = '*';
  pendingScanPath.value = '*';
  await scanFiles('*', { createdWithinDays: config.value?.createdWithinDays || 3 });
}

async function openPathDialog() {
  isPathDialogOpen.value = true;
  pendingScanPath.value = rootPath.value || '*';
  directoryError.value = '';

  if (directoryRows.value.length === 0) {
    await loadRootDirectories();
  }
}

function closePathDialog() {
  isPathDialogOpen.value = false;
}

async function confirmPathSelection() {
  rootPath.value = pendingScanPath.value;
  closePathDialog();
  if (rootPath.value === '*') {
    await scanAllDrives();
    return;
  }

  await scanFiles(rootPath.value, { createdWithinDays: 'all' });
}

async function loadRootDirectories() {
  isLoadingRootDirectories.value = true;
  directoryError.value = '';
  try {
    const response = await fetch('/api/directories?createdWithinDays=all');
    const data = await readJsonResponse(response);
    directoryRows.value = data.directories.map(createDirectoryNode);
  } catch (error) {
    directoryError.value = error.message;
  } finally {
    isLoadingRootDirectories.value = false;
  }
}

async function toggleDirectory(node) {
  pendingScanPath.value = node.path;

  const next = new Set(directoryExpandedKeys.value);
  if (next.has(node.path)) {
    next.delete(node.path);
    directoryExpandedKeys.value = next;
    return;
  }

  next.add(node.path);
  directoryExpandedKeys.value = next;

  if (!node.loaded) {
    await loadChildDirectories(node);
  }
}

async function loadChildDirectories(node) {
  const loading = new Set(directoryLoadingKeys.value);
  loading.add(node.path);
  directoryLoadingKeys.value = loading;
  directoryError.value = '';

  try {
    const response = await fetch(
      `/api/directories?path=${encodeURIComponent(node.path)}&createdWithinDays=all`
    );
    const data = await readJsonResponse(response);
    node.children = data.directories.map(createDirectoryNode);
    node.loaded = true;
  } catch (error) {
    node.children = [];
    node.loaded = true;
    directoryError.value = error.message;
  } finally {
    const nextLoading = new Set(directoryLoadingKeys.value);
    nextLoading.delete(node.path);
    directoryLoadingKeys.value = nextLoading;
  }
}

async function openFile(file) {
  selectedPath.value = file.path;
  expandAncestors(file);
  isLoadingFile.value = true;
  errorMessage.value = '';

  try {
    const response = await fetch(`/api/file?path=${encodeURIComponent(file.path)}`);
    currentFile.value = await readJsonResponse(response);
    rememberRecentFile({
      ...file,
      name: currentFile.value.name,
      directory: file.directory || getDirectoryFromPath(currentFile.value.path),
      size: currentFile.value.size,
      sizeText: formatBytes(currentFile.value.size),
      birthtimeMs: currentFile.value.birthtimeMs,
      mtimeMs: currentFile.value.mtimeMs
    });
  } catch (error) {
    currentFile.value = null;
    errorMessage.value = error.message;
  } finally {
    isLoadingFile.value = false;
  }
}

async function readJsonResponse(response) {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || '请求失败。');
  }
  return data;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function buildFileTree(fileList) {
  const driveMap = new Map();

  for (const file of fileList) {
    const drive = getDriveLabel(file.path);
    const folderPath = normalizeDirectory(file.directory);
    const folderLabel = getFolderLabel(folderPath);

    if (!driveMap.has(drive)) {
      driveMap.set(drive, createTreeNode('drive', drive, drive, null));
    }

    const driveNode = driveMap.get(drive);
    driveNode.count += 1;

    let folder = driveNode.children.find((child) => child.key === folderPath);
    if (!folder) {
      folder = createTreeNode('folder', folderLabel, folderPath, null);
      folder.secondary = folderPath;
      driveNode.children.push(folder);
    }

    folder.count += 1;
    folder.children.push({
      kind: 'file',
      key: file.path,
      label: file.name,
      secondary: file.path,
      count: 1,
      file,
      children: []
    });
  }

  const tree = [...driveMap.values()];
  sortTree(tree);
  return tree;
}

function createTreeNode(kind, label, key, file) {
  return {
    kind,
    key,
    label,
    secondary: '',
    count: 0,
    file,
    children: []
  };
}

function sortTree(nodes) {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) {
      const order = { recent: 0, drive: 1, folder: 2, file: 3 };
      return order[a.kind] - order[b.kind];
    }
    return a.label.localeCompare(b.label, 'zh-CN', { numeric: true });
  });

  for (const node of nodes) {
    if (node.kind === 'drive') {
      node.secondary = `${node.count} 个文件`;
    }

    if (node.kind === 'folder') {
      node.secondary = `${node.secondary} / ${node.count} 个文件`;
    }

    if (node.children.length) {
      sortTree(node.children);
    }
  }
}

function collectVisibleRows(node, depth, rows, forceExpand) {
  rows.push({ node, depth });

  if (node.kind === 'file') return;
  if (!forceExpand && !expandedTreeKeys.value.has(node.key)) return;

  for (const child of node.children) {
    collectVisibleRows(child, depth + 1, rows, forceExpand);
  }
}

function toggleNode(node) {
  if (node.kind === 'file') {
    openFile(node.file);
    return;
  }

  const next = new Set(expandedTreeKeys.value);
  if (next.has(node.key)) {
    next.delete(node.key);
  } else {
    next.add(node.key);
  }
  expandedTreeKeys.value = next;
}

function expandAncestors(file) {
  const next = new Set(expandedTreeKeys.value);
  const drive = getDriveLabel(file.path);
  next.add(drive);
  next.add(normalizeDirectory(file.directory));

  expandedTreeKeys.value = next;
}

function getDefaultExpandedKeys(fileList) {
  const keys = new Set();
  keys.add('__recent__');

  for (const file of fileList) {
    keys.add(getDriveLabel(file.path));
  }

  return keys;
}

function getDriveLabel(filePath) {
  const normalized = filePath.replaceAll('\\', '/');
  const windowsDrive = normalized.match(/^([A-Za-z]:)\//);
  if (windowsDrive) return windowsDrive[1].toUpperCase();
  if (normalized.startsWith('/')) return '/';
  return '本地';
}

function normalizeDirectory(directory) {
  return directory.replaceAll('\\', '/').replace(/\/+$/, '');
}

function getFolderLabel(directory) {
  const normalized = normalizeDirectory(directory);
  const parts = normalized.split('/').filter(Boolean);
  return parts.at(-1) || normalized || '根目录';
}

function rememberRecentFile(file) {
  const normalizedFile = {
    path: file.path,
    name: file.name,
    directory: file.directory || getDirectoryFromPath(file.path),
    size: file.size || 0,
    sizeText: file.sizeText || formatBytes(file.size || 0),
    birthtimeMs: file.birthtimeMs || 0,
    mtimeMs: file.mtimeMs || 0
  };
  const next = [
    normalizedFile,
    ...recentFiles.value.filter((item) => item.path !== normalizedFile.path)
  ].slice(0, 5);

  recentFiles.value = next;
  localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(next));
}

function loadRecentFiles() {
  try {
    const value = localStorage.getItem(RECENT_FILES_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((file) => file?.path && file?.name)
      .slice(0, 5);
  } catch {
    return [];
  }
}

function getDirectoryFromPath(filePath) {
  const normalized = filePath.replaceAll('\\', '/');
  const index = normalized.lastIndexOf('/');
  if (index <= 0) return '';
  return normalized.slice(0, index);
}

function createDirectoryNode(directory) {
  return {
    ...directory,
    children: [],
    loaded: false
  };
}

function collectDirectoryRows(node, depth, rows) {
  rows.push({ node, depth });

  if (!directoryExpandedKeys.value.has(node.path)) {
    return;
  }

  for (const child of node.children) {
    collectDirectoryRows(child, depth + 1, rows);
  }
}
</script>

<template>
  <main class="app-shell">
    <aside class="sidebar">
      <header class="toolbar">
        <div>
          <h1>Markdown 查看器</h1>
          <p>{{ scanTimeLabel }} / {{ filteredFiles.length }} / {{ files.length }} 个文件</p>
        </div>
        <button class="icon-button" :disabled="isScanning" title="重新扫描" @click="scanFiles()">
          ↻
        </button>
      </header>

      <section class="path-form">
        <label>扫描路径</label>
        <div class="path-row">
          <div class="path-display" :title="selectedPathLabel">{{ selectedPathLabel }}</div>
          <button type="button" @click="openPathDialog">选择</button>
        </div>
      </section>

      <div class="search-box">
        <input v-model="query" placeholder="搜索文件名或路径" spellcheck="false" />
      </div>

      <div v-if="isScanning" class="status">正在扫描 Markdown 文件...</div>
      <div v-else-if="errorMessage && files.length === 0" class="status error">{{ errorMessage }}</div>
      <div v-else-if="files.length === 0" class="status">没有找到 .md 文件。</div>

      <div v-if="truncated" class="notice">结果已达到上限，只显示前 20000 个文件。</div>
      <div v-if="scanSummary.ignoredDrives.length" class="notice">
        默认已忽略 {{ scanSummary.ignoredDrives.join('、') }} 盘。
      </div>
      <div v-if="scanErrors.length" class="notice">有 {{ scanErrors.length }} 个目录无法读取，已跳过。</div>

      <nav class="tree-list" aria-label="Markdown 文件目录树">
        <button
          v-for="{ node, depth } in visibleTreeRows"
          :key="node.key"
          class="tree-item"
          :class="[
            `tree-${node.kind}`,
            { active: node.kind === 'file' && node.file.path === selectedPath }
          ]"
          :style="{ '--depth': depth }"
          @click="toggleNode(node)"
        >
          <span class="tree-twist">{{ node.kind === 'file' ? '' : expandedTreeKeys.has(node.key) || query.trim() ? '▾' : '▸' }}</span>
          <span class="tree-icon">{{ node.kind === 'recent' ? 'REC' : node.kind === 'drive' ? '▣' : node.kind === 'folder' ? '□' : 'MD' }}</span>
          <span class="tree-text">
            <span class="tree-label">{{ node.label }}</span>
            <span class="tree-secondary">{{ node.secondary }}</span>
          </span>
        </button>
      </nav>
    </aside>

    <section class="viewer">
      <header class="viewer-header">
        <div v-if="currentFile">
          <h2>{{ currentFile.name }}</h2>
          <p>{{ currentFile.path }}</p>
        </div>
        <div v-else>
          <h2>选择一个 Markdown 文件</h2>
          <p>左侧列表会显示扫描到的 .md 文件。</p>
        </div>
        <span v-if="currentFile" class="viewer-meta">{{ selectedMeta }}</span>
      </header>

      <div v-if="isLoadingFile" class="viewer-empty">正在读取文件...</div>
      <div v-else-if="errorMessage && selectedPath" class="viewer-empty error">{{ errorMessage }}</div>
      <article v-else-if="currentFile" class="markdown-body" v-html="renderedMarkdown"></article>
      <div v-else class="viewer-empty">暂无内容</div>
    </section>

    <div v-if="isPathDialogOpen" class="modal-backdrop" @click.self="closePathDialog">
      <section class="path-dialog" role="dialog" aria-modal="true" aria-labelledby="pathDialogTitle">
        <header class="dialog-header">
          <div>
            <h2 id="pathDialogTitle">选择扫描路径</h2>
            <p>{{ pendingScanPath === '*' ? '全部磁盘' : pendingScanPath }}</p>
          </div>
          <button class="icon-button" type="button" title="关闭" @click="closePathDialog">×</button>
        </header>

        <div class="dialog-actions">
          <button type="button" :class="{ active: pendingScanPath === '*' }" @click="pendingScanPath = '*'">
            全部磁盘
          </button>
          <button type="button" @click="loadRootDirectories">刷新目录</button>
        </div>

        <div v-if="directoryError" class="status error">{{ directoryError }}</div>
        <div v-if="isLoadingRootDirectories" class="status">正在查找包含 Markdown 的盘符和目录...</div>

        <div class="directory-tree">
          <div v-if="!isLoadingRootDirectories && visibleDirectoryRows.length === 0" class="directory-empty">
            没有找到包含 Markdown 文件的路径。
          </div>
          <button
            v-for="{ node, depth } in visibleDirectoryRows"
            :key="node.path"
            type="button"
            class="directory-item"
            :class="{ selected: pendingScanPath === node.path }"
            :style="{ '--depth': depth }"
            @click="toggleDirectory(node)"
          >
            <span class="tree-twist">
              {{ directoryLoadingKeys.has(node.path) ? '…' : directoryExpandedKeys.has(node.path) ? '▾' : '▸' }}
            </span>
            <span class="tree-icon">{{ node.kind === 'drive' ? '▣' : '□' }}</span>
            <span class="tree-text">
              <span class="tree-label">{{ node.name }}</span>
              <span class="tree-secondary">{{ node.path }}</span>
            </span>
          </button>
        </div>

        <footer class="dialog-footer">
          <button type="button" @click="closePathDialog">取消</button>
          <button type="button" class="primary-button" @click="confirmPathSelection">扫描所选路径</button>
        </footer>
      </section>
    </div>
  </main>
</template>
