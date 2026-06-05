// Vault layout, content hashing, and scope-aware markdown discovery.
//
// All of kg's truth lives under `<vault>/meta/kg/`. A document's identity is
// the sha256 of its bytes — paths are resolved through the registry, never
// stored as the anchor itself.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const KG_DIR = 'meta/kg';
export const REGISTRY_NAME = 'registry.jsonl';
export const CONCEPTS_NAME = 'concepts.json';
export const METADATA_DIRNAME = 'metadata';

// Dirs skipped at any depth. meta/kg itself is filtered explicitly below.
export const EXCLUDE_DIRS = new Set(['.git', 'node_modules', '.venv', '__pycache__', 'meta']);

export class VaultError extends Error {}

export const kgRoot = (vault: string): string => join(vault, KG_DIR);
export const registryPath = (vault: string): string => join(kgRoot(vault), REGISTRY_NAME);
export const conceptsPath = (vault: string): string => join(kgRoot(vault), CONCEPTS_NAME);
export const metadataDir = (vault: string): string => join(kgRoot(vault), METADATA_DIRNAME);
export const metadataPath = (vault: string, docHash: string): string =>
  join(metadataDir(vault), `${docHash}.json`);

export const resolveVault = (raw: string): string => {
  const vault = resolve(raw);
  if (!existsSync(vault) || !statSync(vault).isDirectory()) {
    throw new VaultError(`not a directory: ${vault}`);
  }
  return vault;
};

export const ensureKgDirs = (vault: string): void => {
  mkdirSync(metadataDir(vault), { recursive: true });
};

export const hashBytes = (data: Buffer | string): string =>
  createHash('sha256').update(data).digest('hex');

const scopeRoots = (vault: string, scope: string): string[] => {
  if (scope === 'all') return [vault];
  return scope
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => join(vault, name))
    .filter((root) => existsSync(root) && statSync(root).isDirectory());
};

const walkMd = (dir: string, out: string[]): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.has(entry.name)) walkMd(join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(join(dir, entry.name));
    }
  }
};

export type MdFile = { rel: string; abs: string };

/** Every .md in scope as vault-relative posix path + absolute path, sorted. */
export const iterMarkdown = (vault: string, scope = 'all'): MdFile[] => {
  const files: string[] = [];
  for (const root of scopeRoots(vault, scope)) walkMd(root, files);
  return files
    .map((abs) => ({
      rel: abs
        .slice(vault.length + 1)
        .split('\\')
        .join('/'),
      abs,
    }))
    .filter(({ rel }) => !rel.split('/').some((part) => EXCLUDE_DIRS.has(part)))
    .sort((a, b) => (a.rel < b.rel ? -1 : 1));
};
