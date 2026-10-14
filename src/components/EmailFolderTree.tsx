import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, Folder, FolderOpen, Mail, ChevronsDownUp, ChevronsUpDown, Search, Info, Trash2, ArrowUp, ArrowDown, Undo2 } from "lucide-react";
import { emailFolderKeys, emailFolderSiblings, reorderedEmailFolders, type EmailFolderNode } from "../utils/emailFolderTree";
import type { EmailFolderPreferences } from "../types/emailArchive";

interface Props {
  nodes: EmailFolderNode[];
  label: string;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  selectedSources?: Set<string>;
  onSourceChange?: (id: string, checked: boolean) => void;
  disabled?: boolean;
  onSearch?: (id: string) => void;
  onRemove?: (node: EmailFolderNode) => void;
  preferences?: EmailFolderPreferences;
  onReorder?: (scope: string, keys: string[] | null) => Promise<boolean>;
}

export function EmailFolderTree({ nodes, label, selectedId, onSelect, selectedSources, onSourceChange, disabled = false, onSearch, onRemove, preferences = {}, onReorder }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const seenRoots = useRef(new Set<string>());
  const tree = useRef<HTMLDivElement>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [context, setContext] = useState<{ node: EmailFolderNode; level: number; x: number; y: number; trigger: HTMLElement } | null>(null);
  const [properties, setProperties] = useState<EmailFolderNode | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const propertiesDialog = useRef<HTMLDialogElement>(null);
  const propertiesTitle = useId();
  const propertiesTrigger = useRef<HTMLElement | null>(null);
  const [drag, setDrag] = useState<{ key:string; pointerId:number; x:number; y:number } | null>(null);
  const [dropMark, setDropMark] = useState<{ key:string; after:boolean } | null>(null);
  const suppressClick = useRef(false);
  const focusNode = (key: string) => { setFocusKey(key); Array.from(tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []).find(row => row.dataset.emailKey === key)?.focus(); };
  const moveNode = async (node: EmailFolderNode, direction: number) => {
    if (!onReorder || disabled) return;
    const group = emailFolderSiblings(nodes, node.key);
    const index = group?.siblings.findIndex(item => item.key === node.key) ?? -1;
    const target = group?.siblings[index + direction];
    if (!target) return;
    const order = reorderedEmailFolders(nodes, node.key, target.key, direction > 0);
    if (order && await onReorder(order.scope, order.keys)) focusNode(node.key);
  };
  useEffect(() => {
    if (!drag || !onReorder || disabled) return;
    let started = false, mark: { key:string; after:boolean } | null = null;
    let position = { x:drag.x, y:drag.y };
    const update = () => {
      const row = document.elementFromPoint(position.x, position.y)?.closest<HTMLElement>('[role="treeitem"]');
      const key = row?.dataset.emailKey;
      const group = emailFolderSiblings(nodes, drag.key);
      if (!row || !tree.current?.contains(row) || !key || !group?.siblings.some(item => item.key === key) || key === drag.key) mark = null;
      else { const rect = row.getBoundingClientRect(); mark = { key, after:position.y > rect.top + rect.height / 2 }; }
      setDropMark(current => current?.key === mark?.key && current?.after === mark?.after ? current : mark);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) return;
      position = { x:event.clientX, y:event.clientY };
      if (!started && Math.hypot(position.x - drag.x, position.y - drag.y) < 6) return;
      started = true; event.preventDefault(); update();
    };
    const finish = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) return;
      if (started) {
        suppressClick.current = true; window.setTimeout(() => { suppressClick.current = false; }, 0);
        const order = mark && reorderedEmailFolders(nodes, drag.key, mark.key, mark.after);
        if (order) void onReorder(order.scope, order.keys).then(saved => { if (saved) focusNode(drag.key); });
      }
      setDrag(null); setDropMark(null);
    };
    const cancel = () => { setDrag(null); setDropMark(null); };
    let frame = 0;
    const scroll = () => {
      if (started && tree.current) {
        const rect = tree.current.getBoundingClientRect();
        if (position.x >= rect.left && position.x <= rect.right) {
          const delta = position.y < rect.top + 24 ? -6 : position.y > rect.bottom - 24 ? 6 : 0;
          if (delta) { tree.current.scrollTop += delta; update(); }
        }
      }
      frame = window.requestAnimationFrame(scroll);
    };
    frame = window.requestAnimationFrame(scroll);
    window.addEventListener("pointermove", move, { passive:false }); window.addEventListener("pointerup", finish); window.addEventListener("pointercancel", cancel);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", cancel); };
  }, [drag, nodes, onReorder, disabled]);
  const closeMenu = (restoreFocus = true) => { if (restoreFocus) context?.trigger.focus(); setContext(null); };
  useLayoutEffect(() => {
    if (!context || !menu.current) return;
    const rect = menu.current.getBoundingClientRect();
    menu.current.style.left = `${Math.max(8, Math.min(context.x, window.innerWidth - rect.width - 8))}px`;
    menu.current.style.top = `${Math.max(8, Math.min(context.y, window.innerHeight - rect.height - 8))}px`;
    menu.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [context]);
  useEffect(() => {
    if (!context) return;
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) setContext(null); };
    const close = (event: Event) => { if (!menu.current?.contains(event.target as Node)) setContext(null); };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", close); window.removeEventListener("scroll", close, true); };
  }, [context]);
  useEffect(() => { setContext(null); setProperties(null); }, [nodes]);
  useEffect(() => {
    if (properties && propertiesDialog.current && !propertiesDialog.current.open) propertiesDialog.current.showModal();
  }, [properties]);
  const openContext = (node: EmailFolderNode, level: number, trigger: HTMLElement, x?: number, y?: number) => {
    const rect = trigger.getBoundingClientRect();
    setContext({ node, level, trigger, x: x ?? rect.left + 30, y: y ?? rect.bottom });
  };
  useEffect(() => {
    const newRoots = nodes.filter(node => !seenRoots.current.has(node.key));
    newRoots.forEach(node => seenRoots.current.add(node.key));
    if (newRoots.length) setExpanded(current => new Set([...current, ...newRoots.map(node => node.key)]));
  }, [nodes]);

  const toggle = (key: string, open?: boolean) => setExpanded(current => {
    const next = new Set(current);
    if (open ?? !next.has(key)) next.add(key); else next.delete(key);
    return next;
  });
  const visibleKeys = (siblings: EmailFolderNode[]): string[] => siblings.flatMap(node => [node.key, ...(expanded.has(node.key) ? visibleKeys(node.children) : [])]);
  const visible = visibleKeys(nodes);
  const focusableKey = focusKey && visible.includes(focusKey) ? focusKey : visible[0];
  const keyboard = (event: KeyboardEvent<HTMLDivElement>, node: EmailFolderNode) => {
    if (event.target !== event.currentTarget) return;
    if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key) && onReorder) { event.preventDefault(); void moveNode(node, event.key === "ArrowUp" ? -1 : 1); return; }
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); openContext(node, Number(event.currentTarget.dataset.level), event.currentTarget); return; }
    const rows = Array.from(tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []);
    const index = rows.indexOf(event.currentTarget);
    let target: HTMLElement | undefined;
    if (event.key === "ArrowDown") target = rows[Math.min(rows.length - 1, index + 1)];
    else if (event.key === "ArrowUp") target = rows[Math.max(0, index - 1)];
    else if (event.key === "Home") target = rows[0];
    else if (event.key === "End") target = rows[rows.length - 1];
    else if (event.key === "ArrowRight" && node.children.length) { if (!expanded.has(node.key)) toggle(node.key, true); else target = rows[index + 1]; }
    else if (event.key === "ArrowLeft") {
      if (expanded.has(node.key)) toggle(node.key, false);
      else { const level = Number(event.currentTarget.dataset.level); target = rows.slice(0, index).reverse().find(row => Number(row.dataset.level) < level); }
    } else if (event.key === "Enter" || event.key === " ") {
      const accountHeader = event.currentTarget.dataset.level === "1" && node.count === 0 && node.children.length > 0;
      if (node.folderId && onSelect && !accountHeader) onSelect(node.folderId); else if (node.children.length) toggle(node.key);
    } else return;
    event.preventDefault();
    target?.focus();
  };
  const render = (siblings: EmailFolderNode[], level: number) => siblings.map(node => {
    const open = expanded.has(node.key);
    const sourceChoice = level === 1 && selectedSources !== undefined;
    const sourceLabel = node.source === "outlook" ? `Outlook${node.accountKind ? ` · ${node.accountKind}` : " Classic"}` : "Thunderbird";
    const nodeLabel = `${node.name}${level === 1 && node.accountKind ? ` · ${sourceLabel}` : ""}`;
    return <div key={node.key} role="none">
      <div role="treeitem" className={`email-folder-row${selectedId === node.folderId && node.folderId ? " active" : ""}${level === 1 ? " account" : ""}${dropMark?.key === node.key ? dropMark.after ? " drop-after" : " drop-before" : ""}${drag?.key === node.key && dropMark ? " dragging" : ""}`}
        aria-label={`${nodeLabel}${onSelect && (level === 1 ? node.total : node.count) > 0 ? ` ${level === 1 ? node.total : node.count}` : ""}`}
        aria-level={level} aria-expanded={node.children.length ? open : undefined} aria-selected={onSelect ? selectedId === node.folderId && node.folderId !== null : undefined}
        data-level={level} data-email-key={node.key} tabIndex={focusableKey === node.key ? 0 : -1}
        style={{ paddingLeft: 8 + (level - 1) * 16 }} title={`${sourceLabel}\n${node.path}`}
        onFocus={() => setFocusKey(node.key)} onKeyDown={event => keyboard(event, node)}
        onContextMenu={event => { event.preventDefault(); event.stopPropagation(); openContext(node, level, event.currentTarget, event.clientX, event.clientY); }}
        onPointerDown={event => { if (onReorder && !disabled && event.button === 0 && event.pointerType !== "touch" && !(event.target as HTMLElement).closest("button,input") && !event.altKey && !event.ctrlKey && !event.metaKey) setDrag({ key:node.key, pointerId:event.pointerId, x:event.clientX, y:event.clientY }); }}
        onClick={() => { if (suppressClick.current) return; if (node.folderId && onSelect && !(level === 1 && node.count === 0 && node.children.length > 0)) onSelect(node.folderId); else if (node.children.length) toggle(node.key); }}>
        {node.children.length ? <button className="email-tree-disclosure" type="button" tabIndex={-1} aria-label={`${node.name} ${open ? "zuklappen" : "aufklappen"}`} onClick={event => { event.stopPropagation(); toggle(node.key); }}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : <span className="email-tree-spacer" />}
        {sourceChoice && <input type="checkbox" aria-label={nodeLabel} checked={selectedSources.has(node.sourceId)} disabled={disabled} onClick={event => event.stopPropagation()} onChange={event => onSourceChange?.(node.sourceId, event.target.checked)} />}
        {level === 1 ? <Mail size={16} /> : open ? <FolderOpen size={16} /> : <Folder size={16} />}
        <span className="email-folder-name">{node.name}</span>{level === 1 && node.accountKind && <span className="email-account-kind" aria-hidden="true">{node.accountKind}</span>}{onSelect && (level === 1 ? node.total : node.count) > 0 && <small>{level === 1 ? node.total : node.count}</small>}
      </div>
      {open && node.children.length > 0 && <div role="group">{render(node.children, level + 1)}</div>}
    </div>;
  });
  const contextGroup = context && emailFolderSiblings(nodes, context.node.key);
  const contextIndex = contextGroup?.siblings.findIndex(node => node.key === context?.node.key) ?? -1;
  return <div className="email-folder-tree">
    <div className="email-tree-tools"><span>Ordnerstruktur</span><button className="email-small-icon" type="button" aria-label="Alle Ordner aufklappen" title="Alle Ordner aufklappen" onClick={() => setExpanded(new Set(emailFolderKeys(nodes)))}><ChevronsUpDown size={16} /></button><button className="email-small-icon" type="button" aria-label="Alle Ordner zuklappen" title="Alle Ordner zuklappen" onClick={() => setExpanded(new Set())}><ChevronsDownUp size={16} /></button></div>
    <div ref={tree} role="tree" aria-label={label} className="email-tree-scroll">{nodes.length ? render(nodes, 1) : <p className="email-pane-empty">Noch keine Ordner vorhanden.</p>}</div>
    {onReorder && <small className="email-tree-order-help">Reihenfolge: Ziehen oder Rechtsklick · Alt + ↑/↓</small>}
    {context && createPortal(<div ref={menu} role="menu" aria-label={`Aktionen für ${context.node.name}`} className="email-folder-context-menu" style={{ left:context.x, top:context.y }} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
      if (event.key === "Escape" || event.key === "Tab") { if (event.key === "Escape") event.preventDefault(); closeMenu(); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }}>
      {context.node.folderId && onSelect && !(context.level === 1 && context.node.count === 0 && context.node.children.length) && <button type="button" role="menuitem" onClick={() => { onSelect(context.node.folderId!); closeMenu(); }}><FolderOpen size={16} /> Öffnen</button>}
      {context.node.folderId && onSearch && !(context.level === 1 && context.node.count === 0 && context.node.children.length) && <button type="button" role="menuitem" onClick={() => { onSearch(context.node.folderId!); closeMenu(false); }}><Search size={16} /> In diesem Ordner suchen</button>}
      {onReorder && contextGroup && <>
        <button type="button" role="menuitem" disabled={disabled || contextIndex <= 0} onClick={() => { void moveNode(context.node, -1); closeMenu(); }}><ArrowUp size={16} /> Nach oben</button>
        <button type="button" role="menuitem" disabled={disabled || contextIndex >= contextGroup.siblings.length - 1} onClick={() => { void moveNode(context.node, 1); closeMenu(); }}><ArrowDown size={16} /> Nach unten</button>
        <button type="button" role="menuitem" disabled={disabled || !preferences[contextGroup.scope]} onClick={() => { void onReorder(contextGroup.scope, null); closeMenu(); }}><Undo2 size={16} /> Importierte Reihenfolge wiederherstellen</button>
        <div role="separator" />
      </>}
      {context.node.children.length > 0 && <>
        <button type="button" role="menuitem" onClick={() => { toggle(context.node.key); closeMenu(); }}><ChevronRight size={16} /> {expanded.has(context.node.key) ? "Zuklappen" : "Aufklappen"}</button>
        <button type="button" role="menuitem" onClick={() => { const keys = emailFolderKeys([context.node]); setExpanded(current => new Set([...current, ...keys])); closeMenu(); }}><ChevronsUpDown size={16} /> Unterordner aufklappen</button>
        <button type="button" role="menuitem" onClick={() => { const keys = new Set(emailFolderKeys([context.node])); setExpanded(current => new Set([...current].filter(key => !keys.has(key)))); closeMenu(); }}><ChevronsDownUp size={16} /> Unterordner zuklappen</button>
      </>}
      <button type="button" role="menuitem" onClick={() => { propertiesTrigger.current = context.trigger; setProperties(context.node); closeMenu(false); }}><Info size={16} /> Eigenschaften</button>
      {onRemove && <><div role="separator" /><button type="button" role="menuitem" className="danger" disabled={disabled} onClick={() => { closeMenu(); onRemove(context.node); }}><Trash2 size={16} /> {context.level === 1 ? "Postfach aus Archiv entfernen …" : "Ordner aus Archiv entfernen …"}</button></>}
    </div>, document.body)}
    {properties && createPortal(<dialog ref={propertiesDialog} aria-labelledby={propertiesTitle} className="email-folder-properties" onCancel={() => { setProperties(null); propertiesTrigger.current?.focus(); }} onClose={() => { setProperties(null); propertiesTrigger.current?.focus(); }}><h3 id={propertiesTitle}>Eigenschaften</h3><dl><dt>Name</dt><dd>{properties.name}</dd><dt>Ordnerpfad</dt><dd>{properties.path}</dd><dt>Quelle</dt><dd>{properties.source === "outlook" ? `Outlook Classic${properties.accountKind ? ` · ${properties.accountKind}` : ""}` : "Thunderbird"}</dd>{onSelect && <><dt>Nachrichten mit Unterordnern</dt><dd>{properties.total}</dd></>}</dl><button type="button" onClick={() => { setProperties(null); propertiesTrigger.current?.focus(); }}>Schließen</button></dialog>, document.body)}
  </div>;
}
