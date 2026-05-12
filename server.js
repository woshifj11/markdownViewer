import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const app = express();
const PORT = Number(process.env.PORT || 3001);
const MAX_FILES = Number(process.env.MAX_FILES || 20000);
const MAX_FILE_BYTES = Number(process.env.MAX_FILE_BYTES || 5 * 1024 * 1024);
const DEFAULT_CREATED_WITHIN_DAYS = Number(process.env.CREATED_WITHIN_DAYS || 3);
const DEFAULT_IGNORED_DRIVES = new Set(
  String(process.env.IGNORE_DRIVES || 'C:')
    .split(',')
    .map((drive) => drive.trim().toUpperCase())
    .filter(Boolean)
);

const ignoredDirectoryNames = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.vite',
  'AppData',
  '$Recycle.Bin',
  'System Volume Information',
  'Windows'
]);

app.use(express.json());

app.get('/api/config', async (_req, res) => {
  res.json({
    cwd: process.cwd(),
    home: os.homedir(),
    platform: process.platform,
    createdWithinDays: DEFAULT_CREATED_WITHIN_DAYS,
    ignoredDrives: [...DEFAULT_IGNORED_DRIVES],
    drives: await getWindowsDrives()
  });
});

app.get('/api/files', async (req, res) => {
  const root = String(req.query.root || process.cwd()).trim();
  const createdWithinDays = parseCreatedWithinDays(req.query.createdWithinDays, {
    defaultDays: root === '*' ? DEFAULT_CREATED_WITHIN_DAYS : null
  });
  const createdAfterMs = getCreatedAfterMs(createdWithinDays);

  try {
    const roots = root === '*' ? await getScanRoots() : [path.resolve(root)];
    const files = [];
    const errors = [];

    for (const scanRoot of roots) {
      await scanMarkdownFiles(scanRoot, files, errors, { createdAfterMs });
      if (files.length >= MAX_FILES) {
        break;
      }
    }

    files.sort((a, b) => b.birthtimeMs - a.birthtimeMs);
    res.json({
      root,
      createdWithinDays,
      ignoredDrives: root === '*' ? [...DEFAULT_IGNORED_DRIVES] : [],
      files: files.slice(0, MAX_FILES),
      errors: errors.slice(0, 30),
      truncated: files.length >= MAX_FILES
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.get('/api/directories', async (req, res) => {
  const requestedPath = String(req.query.path || '').trim();
  const createdWithinDays = parseCreatedWithinDays(req.query.createdWithinDays, {
    defaultDays: null
  });
  const createdAfterMs = getCreatedAfterMs(createdWithinDays);

  try {
    if (!requestedPath) {
      const drives = process.platform === 'win32' ? await getWindowsDrives() : ['/'];
      const directories = [];

      for (const drive of drives) {
        if (await containsMarkdownFile(drive, { createdAfterMs })) {
          directories.push({
            name: drive.replace(/\\$/, ''),
            path: drive,
            kind: 'drive',
            hasChildren: true
          });
        }
      }

      res.json({
        path: '',
        createdWithinDays,
        directories
      });
      return;
    }

    const resolved = path.resolve(requestedPath);
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    const directories = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || ignoredDirectoryNames.has(entry.name)) {
        continue;
      }

      const fullPath = path.join(resolved, entry.name);
      if (await containsMarkdownFile(fullPath, { createdAfterMs })) {
        directories.push({
          name: entry.name,
          path: fullPath,
          kind: 'directory',
          hasChildren: true
        });
      }
    }

    directories.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
    res.json({ path: resolved, createdWithinDays, directories });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.get('/api/file', async (req, res) => {
  const filePath = String(req.query.path || '').trim();

  if (!filePath) {
    res.status(400).json({ message: '缺少文件路径。' });
    return;
  }

  try {
    const resolved = path.resolve(filePath);
    const stat = await fs.stat(resolved);

    if (!stat.isFile() || path.extname(resolved).toLowerCase() !== '.md') {
      res.status(400).json({ message: '只能打开 .md 文件。' });
      return;
    }

    if (stat.size > MAX_FILE_BYTES) {
      res.status(413).json({ message: `文件超过 ${formatBytes(MAX_FILE_BYTES)}，请用编辑器打开。` });
      return;
    }

    const content = await fs.readFile(resolved, 'utf8');
    res.json({
      path: resolved,
      name: path.basename(resolved),
      size: stat.size,
      birthtimeMs: stat.birthtimeMs,
      mtimeMs: stat.mtimeMs,
      content
    });
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
});

async function scanMarkdownFiles(root, files, errors, options = {}) {
  const queue = [root];
  const visited = new Set();
  const createdAfterMs = options.createdAfterMs || 0;

  while (queue.length > 0 && files.length < MAX_FILES) {
    const current = queue.shift();

    try {
      const realPath = await fs.realpath(current);
      if (visited.has(realPath)) {
        continue;
      }
      visited.add(realPath);

      const entries = await fs.readdir(current, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);

        if (entry.isDirectory()) {
          if (!ignoredDirectoryNames.has(entry.name)) {
            queue.push(fullPath);
          }
          continue;
        }

        if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md') {
          try {
            const stat = await fs.stat(fullPath);
            if (stat.birthtimeMs < createdAfterMs) {
              continue;
            }

            files.push({
              path: fullPath,
              name: entry.name,
              directory: path.dirname(fullPath),
              relative: path.relative(root, fullPath) || entry.name,
              size: stat.size,
              sizeText: formatBytes(stat.size),
              birthtimeMs: stat.birthtimeMs,
              createdAt: stat.birthtime.toISOString(),
              mtimeMs: stat.mtimeMs,
              modifiedAt: stat.mtime.toISOString()
            });
          } catch (error) {
            errors.push({ path: fullPath, message: error.message });
          }
        }
      }
    } catch (error) {
      errors.push({ path: current, message: error.message });
    }
  }
}

async function containsMarkdownFile(root, options = {}) {
  const queue = [root];
  const visited = new Set();
  const createdAfterMs = options.createdAfterMs || 0;

  while (queue.length > 0) {
    const current = queue.shift();

    try {
      const realPath = await fs.realpath(current);
      if (visited.has(realPath)) {
        continue;
      }
      visited.add(realPath);

      const entries = await fs.readdir(current, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);

        if (entry.isDirectory()) {
          if (!ignoredDirectoryNames.has(entry.name)) {
            queue.push(fullPath);
          }
          continue;
        }

        if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md') {
          const stat = await fs.stat(fullPath);
          if (stat.birthtimeMs >= createdAfterMs) {
            return true;
          }
        }
      }
    } catch {
      // Unreadable directories are ignored in the picker.
    }
  }

  return false;
}

async function getScanRoots() {
  if (process.platform === 'win32') {
    const drives = await getWindowsDrives();
    return drives.filter((drive) => !DEFAULT_IGNORED_DRIVES.has(drive.replace(/\\$/, '').toUpperCase()));
  }

  return ['/'];
}

async function getWindowsDrives() {
  if (process.platform !== 'win32') {
    return ['/'];
  }

  const drives = [];
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  await Promise.all(
    [...letters].map(async (letter) => {
      const drive = `${letter}:\\`;
      try {
        await fs.access(drive);
        drives.push(drive);
      } catch {
        // Drive is not available.
      }
    })
  );

  return drives.sort();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function parseCreatedWithinDays(value, options = {}) {
  if (value === 'all') {
    return null;
  }

  if (value !== undefined) {
    const days = Number(value);
    return Number.isFinite(days) ? Math.max(0, days) : options.defaultDays ?? null;
  }

  return options.defaultDays ?? null;
}

function getCreatedAfterMs(createdWithinDays) {
  if (createdWithinDays === null) {
    return 0;
  }

  return Date.now() - createdWithinDays * 24 * 60 * 60 * 1000;
}

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Markdown file API running at http://127.0.0.1:${PORT}`);
});
