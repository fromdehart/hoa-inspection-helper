/**
 * Restore letterTemplateDocs.templateText from a Convex export zip.
 *
 * Usage:
 *   npx tsx scripts/restore-letter-template-from-backup.ts \
 *     "/path/to/snapshot.zip" \
 *     k17bwp871pmwtp7kysqqwgw5yn85j6wy
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function main() {
  const zipPath = process.argv[2];
  const docId = process.argv[3];
  if (!zipPath || !docId) {
    throw new Error(
      "Usage: npx tsx scripts/restore-letter-template-from-backup.ts <snapshot.zip> <letterTemplateDocsId>",
    );
  }

  const jsonl = execSync(`unzip -p "${zipPath}" letterTemplateDocs/documents.jsonl`, {
    encoding: "utf8",
  });
  const doc = jsonl
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { _id: string; templateText?: string })
    .find((row) => row._id === docId);

  if (!doc?.templateText?.trim()) {
    throw new Error(`No non-empty templateText found for ${docId} in ${zipPath}`);
  }

  const argsPath = join(tmpdir(), `restore-template-args-${Date.now()}.json`);
  const zipBase = zipPath.split("/").pop() ?? zipPath;
  writeFileSync(
    argsPath,
    JSON.stringify({
      id: docId,
      templateText: doc.templateText,
      note: `Restored from backup zip: ${zipBase}`,
    }),
    "utf8",
  );
  try {
    execSync(
      `npx convex run internal.letterTemplateDocs.internalRestoreTemplateText "$(cat ${JSON.stringify(argsPath)})"`,
      { stdio: "inherit", cwd: process.cwd() },
    );
  } finally {
    try {
      execSync(`rm -f ${JSON.stringify(argsPath)}`);
    } catch {
      /* ignore */
    }
  }

  console.log(`Restored templateText (${doc.templateText.length} chars) to ${docId}`);
}

main();
