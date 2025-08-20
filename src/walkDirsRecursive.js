import { opendir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Recursive directory traversal (baseline) with similar options to non-recursive version.
 * @param {string} root
 * @param {object} opts
 * @param {number} [opts.maxDepth=Infinity]
 * @param {boolean} [opts.followSymlinks=false]
 * @param {(fullPath: string, depth: number) => (void|Promise<void>)} [opts.onFile]
 * @param {(fullPath: string, dirent: import('fs').Dirent) => boolean} [opts.filter]
 */
export async function walkDirsRecursive(
  root,
  {
    maxDepth = Infinity,
    followSymlinks = false,
    onFile = async () => {},
    filter = () => true,
  } = {}
) {
  const start = path.resolve(root);

  async function visit(dir, depth) {
    if (depth > maxDepth) return;
    let d;
    try {
      d = await opendir(dir);
      for await (const ent of d) {
        const full = path.join(dir, ent.name);
        if (!filter(full, ent)) continue;

        if (ent.isDirectory()) {
          await visit(full, depth + 1);
        } else if (ent.isFile()) {
          await onFile(full, depth);
        } else if (followSymlinks && ent.isSymbolicLink()) {
          try {
            const s = await stat(full);
            if (s.isDirectory()) {
              await visit(full, depth + 1);
            } else if (s.isFile()) {
              await onFile(full, depth);
            }
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore perms/transient errors
    } finally {
      try { if (d) await d.close(); } catch {}
    }
  }

  await visit(start, 0);
}


