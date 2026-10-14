import type { EmailArchiveFolder, EmailSourceFolder, EmailFolderPreferences } from "../types/emailArchive";

export interface EmailFolderNode {
  key: string;
  name: string;
  path: string;
  folderId: string | null;
  sourceId: string;
  source: string;
  accountKind?: string;
  count: number;
  total: number;
  children: EmailFolderNode[];
  importedOrder?: number | null;
  sortKey?: string | null;
}

// Paths without explicit parent rows occur in old archives. Create structural
// parents without treating them as real folders or merging separate accounts.
export function buildEmailFolderTree(folders: (EmailArchiveFolder | EmailSourceFolder)[], preferences: EmailFolderPreferences = {}): EmailFolderNode[] {
  const roots: EmailFolderNode[] = [];
  const nodes = new Map<string, EmailFolderNode>();
  for (const folder of folders) {
    const parts = folder.path.split("/").filter(Boolean);
    if (!parts.length) continue;
    const sourceId = folder.sourceId || `${folder.source}:${parts[0]}`;
    let parent: EmailFolderNode | undefined;
    parts.forEach((name, index) => {
      const path = parts.slice(0, index + 1).join("/");
      const key = JSON.stringify([folder.source, sourceId, path]);
      let node = nodes.get(key);
      if (!node) {
        node = { key, name, path, folderId: null, sourceId, source: folder.source, accountKind:folder.accountKind, count: 0, total: 0, children: [], importedOrder:folder.importedOrder };
        nodes.set(key, node);
        (parent ? parent.children : roots).push(node);
      }
      if (folder.accountKind) node.accountKind = folder.accountKind;
      if (index === parts.length - 1) {
        node.folderId = folder.id;
        node.name = folder.name;
        node.count = "count" in folder ? folder.count : 0;
        node.importedOrder = folder.importedOrder ?? node.importedOrder;
        node.sortKey = folder.sortKey;
      }
      parent = node;
    });
  }
  const sort = (siblings: EmailFolderNode[], scope: string) => {
    const saved = new Map((preferences[scope] ?? []).map((key, index) => [key, index]));
    const hasBinaryOrder = scope !== "roots" && siblings.some(node => !!node.sortKey);
    siblings.sort((a, b) => {
      if (saved.size) { const preference = (saved.get(a.key) ?? Infinity) - (saved.get(b.key) ?? Infinity); if (!Number.isNaN(preference) && preference !== 0) return preference; }
      if (hasBinaryOrder) { const left = a.sortKey ?? "", right = b.sortKey ?? ""; if (left !== right) return left < right ? -1 : 1; }
      const imported = (a.importedOrder ?? Infinity) - (b.importedOrder ?? Infinity);
      if (!hasBinaryOrder && !Number.isNaN(imported) && imported !== 0) return imported;
      return a.name.localeCompare(b.name, "de", { numeric: true, sensitivity: "base" });
    });
    for (const node of siblings) {
      sort(node.children, node.key);
      node.total = node.count + node.children.reduce((sum, child) => sum + child.total, 0);
    }
  };
  sort(roots, "roots");
  return roots;
}

export function emailFolderSiblings(nodes: EmailFolderNode[], key: string, scope = "roots"): { scope: string; siblings: EmailFolderNode[] } | null {
  if (nodes.some(node => node.key === key)) return { scope, siblings:nodes };
  for (const node of nodes) { const found = emailFolderSiblings(node.children, key, node.key); if (found) return found; }
  return null;
}

// Reorder siblings only. Neither the hierarchy nor any message location changes.
export function reorderedEmailFolders(nodes: EmailFolderNode[], key: string, target: string, after = false) {
  const group = emailFolderSiblings(nodes, key);
  if (!group || key === target || !group.siblings.some(node => node.key === target)) return null;
  const keys = group.siblings.map(node => node.key).filter(item => item !== key);
  keys.splice(keys.indexOf(target) + Number(after), 0, key);
  return { scope:group.scope, keys };
}

export function emailFolderKeys(nodes: EmailFolderNode[]): string[] {
  return nodes.flatMap(node => [node.key, ...emailFolderKeys(node.children)]);
}
