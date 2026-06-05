// Minimal markdown parsing: title, relative links, headings.

export type MdLink = {
  text: string;
  targetRel: string; // path relative to the linking file's dir (decoded)
  raw: string;
};

export type ParsedDoc = {
  relPath: string;
  title: string;
  headings: Array<[number, string]>;
  links: MdLink[];
  text: string;
};

const H1 = /^#\s+(.+?)\s*$/m;
const HEADING = /^(#{1,6})\s+(.+?)\s*$/gm;
// [text](target) where target is a relative path ending in .md (optionally #anchor)
const MD_LINK = /\[([^\]]*)\]\((\.\.?\/[^)]+?\.md)(#[^)]*)?\)/g;

const stem = (relPath: string): string => {
  const base = relPath.split('/').at(-1) ?? relPath;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
};

const deriveTitle = (text: string, relPath: string): string => {
  const m = H1.exec(text);
  return m ? m[1]!.trim() : stem(relPath);
};

const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export const parse = (text: string, relPath: string): ParsedDoc => {
  const headings: Array<[number, string]> = [];
  for (const m of text.matchAll(HEADING)) headings.push([m[1]!.length, m[2]!.trim()]);
  const links: MdLink[] = [];
  for (const m of text.matchAll(MD_LINK)) {
    links.push({ text: m[1]!, targetRel: safeDecode(m[2]!), raw: m[0] });
  }
  return { relPath, title: deriveTitle(text, relPath), headings, links, text };
};
