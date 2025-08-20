// node >= 16
import { opendir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Traverse a directory tree without recursion using a pool of agents.
 * @param {string} root - starting folder
 * @param {object} opts
 * @param {number} [opts.concurrency=8] - number of agents
 * @param {number} [opts.maxDepth=Infinity]
 * @param {boolean} [opts.followSymlinks=false]
 * @param {(fullPath: string, depth: number) => (void|Promise<void>)} [opts.onFile]
 * @param {(fullPath: string, dirent: import('fs').Dirent) => boolean} [opts.filter]
 */
export async function walkDirs(
  root,
  {
    concurrency = 8,
    maxDepth = Infinity,
    followSymlinks = false,
    onFile = async () => {},
    filter = () => true,
  } = {}
)
{
  const queue = [];
  const waiters = [];
  let pending = 0;
  let closed = false;

  function pushDir(item) {
    if (closed) return;
    pending++;
    if (waiters.length) waiters.shift()(item);
    else queue.push(item);
  }

  async function popDir() {
    if (queue.length) return queue.shift();
    if (pending === 0) return null;
    return new Promise((resolve) => waiters.push(resolve));
  }

  function closeQueue() {
    closed = true;
    while (waiters.length) waiters.shift()(null);
  }

  pushDir({ dir: path.resolve(root), depth: 0 });

  async function agent() {
    for (;;) {
      const item = await popDir();
      if (item === null) return;

      const { dir, depth } = item;
      let d;
      try {
        d = await opendir(dir);
        for await (const ent of d) {
          const full = path.join(dir, ent.name);
          if (!filter(full, ent)) continue;

          if (ent.isDirectory()) {
            if (depth + 1 <= maxDepth) pushDir({ dir: full, depth: depth + 1 });
          } else if (ent.isFile()) {
            await onFile(full, depth);
          } else if (followSymlinks && ent.isSymbolicLink()) {
            try {
              const s = await stat(full);
              if (s.isDirectory()) {
                if (depth + 1 <= maxDepth) pushDir({ dir: full, depth: depth + 1 });
              } else if (s.isFile()) {
                await onFile(full, depth);
              }
            } catch {
              // ignore broken symlinks or perms
            }
          }
        }
      } catch {
        // ignore permission or transient errors on this dir
      } finally {
        try { if (d) await d.close(); } catch {}
        pending--;
        if (pending === 0) closeQueue();
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => agent()));
}

// Example usage when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] || ".";
  await walkDirs(root, {
    concurrency: 12,
    maxDepth: Infinity,
    followSymlinks: false,
    filter: (p, ent) => !p.includes("node_modules") && ent.name[0] !== ".",
    onFile: (f) => { console.log(f); },
  });
}


