// SHA-256 の一覧（manifest.sha256）。`sha256sum -c manifest.sha256` でも照合できる形にする

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const MANIFEST_FILE = "manifest.sha256";

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** フォルダの中のファイル（一覧そのものを除く）の SHA-256 を、名前の順に書く */
export async function writeManifest(dir: string): Promise<string[]> {
  const files = (await readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isFile() && e.name !== MANIFEST_FILE)
    .map((e) => e.name)
    .sort();
  const lines: string[] = [];
  for (const file of files) lines.push(`${await sha256(join(dir, file))}  ${file}`);
  await writeFile(join(dir, MANIFEST_FILE), `${lines.join("\n")}\n`, { flag: "wx" });
  return files;
}

export interface ManifestProblem {
  file: string;
  problem: "missing" | "mismatch" | "unlisted";
}

/** 一覧と中身を突き合わせる（復元の訓練で使う）。問題が無ければ空 */
export async function verifyManifest(dir: string): Promise<ManifestProblem[]> {
  const text = await readFile(join(dir, MANIFEST_FILE), "utf8");
  const listed = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
    if (m) listed.set(m[2]!, m[1]!);
  }
  const present = new Set(
    (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name !== MANIFEST_FILE)
      .map((e) => e.name),
  );
  const problems: ManifestProblem[] = [];
  for (const [file, hash] of listed) {
    if (!present.has(file)) problems.push({ file, problem: "missing" });
    else if ((await sha256(join(dir, file))) !== hash) problems.push({ file, problem: "mismatch" });
  }
  for (const file of present) {
    if (!listed.has(file)) problems.push({ file, problem: "unlisted" });
  }
  return problems;
}
