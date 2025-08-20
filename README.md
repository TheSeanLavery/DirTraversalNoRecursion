## DirTraversalNoRecursion

**Claim**: "You cannot traverse directories without recursion" — Not true. This project provides a non-recursive traversal using an explicit work queue with a pool of async agents, plus a standard recursive baseline. Tests validate correctness on randomized directory trees, and a benchmark compares performance.

### Requirements
- Node.js >= 16

### Install
```bash
npm install
```

### API
- **Non-recursive**: `walkDirs(root, { concurrency, maxDepth, followSymlinks, filter, onFile })`
- **Recursive baseline**: `walkDirsRecursive(root, { maxDepth, followSymlinks, filter, onFile })`

Both call `onFile(fullPath, depth)` for each file. Use `filter(fullPath, dirent)` to include/exclude entries.

### Run tests
Tests build a randomized tree (up to 10 layers, up to 100 directories per layer, a few files per directory), traverse it, assert parity, and tear down.
```bash
npm test
```

### Benchmark
Generate a random tree, traverse with both implementations, and write a JSON report under `reports/`.
```bash
npm run bench
```

Example report fields:
```json
{
  "root": "/var/folders/.../walk-bench-xyz",
  "nonRecursive": { "ms": 123.45, "files": 4200 },
  "recursive": { "ms": 156.78, "files": 4200 }
}
```

### Why non-recursive traversal works
Recursion is just one way to express tree exploration. The non-recursive version uses an explicit FIFO queue of directories and a pool of async agents that `opendir` directories, enqueue child directories, and invoke `onFile` for files. This is equivalent to a breadth-first traversal and avoids call-stack growth while enabling parallelism via controlled concurrency.


