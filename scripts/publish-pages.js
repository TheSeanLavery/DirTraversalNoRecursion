import { readdir, stat, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';

async function findLatestReport(dir) {
  const entries = await readdir(dir);
  const htmls = entries.filter(f => /^report-\d+\.html$/.test(f));
  if (htmls.length === 0) return null;
  // Prefer timestamp in filename; fallback to mtime
  htmls.sort((a, b) => {
    const ta = Number(a.match(/report-(\d+)\.html/)[1]);
    const tb = Number(b.match(/report-(\d+)\.html/)[1]);
    return tb - ta;
  });
  const latestHtml = htmls[0];
  const jsonCandidate = latestHtml.replace(/\.html$/, '.json');
  return { html: latestHtml, json: jsonCandidate };
}

async function main() {
  const reportsDir = path.resolve('reports');
  const docsDir = path.resolve('docs');
  const latest = await findLatestReport(reportsDir);
  if (!latest) {
    console.error('No reports found in', reportsDir);
    process.exit(1);
  }

  await mkdir(docsDir, { recursive: true });

  const srcHtml = path.join(reportsDir, latest.html);
  const dstHtml = path.join(docsDir, 'index.html');
  await copyFile(srcHtml, dstHtml);

  // Also copy JSON as a stable name for reference if needed
  const srcJson = path.join(reportsDir, latest.json);
  try {
    await stat(srcJson);
    const dstJson = path.join(docsDir, 'report.json');
    await copyFile(srcJson, dstJson);
  } catch {
    // ignore if JSON missing
  }

  // Create a tiny README in docs for clarity
  const docsReadme = path.join(docsDir, 'README.md');
  await writeFile(docsReadme, '# GitHub Pages\n\nThis directory is published via GitHub Pages. The latest benchmark report is available as index.html.');

  console.log('Published latest report to', dstHtml);
}

main().catch((err) => { console.error(err); process.exit(1); });


