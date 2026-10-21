import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';

export interface RowMenuItem {
  icon?: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  run: () => void;
  hide?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** Shown as a tooltip when the item is disabled. */
  disabledReason?: string;
}

interface RowMenuProps {
  items: RowMenuItem[];
  /** Controlled mode (e.g. one open menu per table); omit both for self-managed state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  minWidth?: number;
  iconSize?: number;
  iconColor?: string;
}

const GAP = 6;
const MARGIN = 8;

/**
 * "⋮" row action menu. The panel is portalled into document.body with position: fixed,
 * so it is never clipped by an overflow: hidden/auto table container or modal body.
 */
export const RowMenu: React.FC<RowMenuProps> = ({ items, open: openProp, onOpenChange, title = 'More actions', minWidth = 220, iconSize = 16, iconColor }) => {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = useCallback((v: boolean) => {
    if (openProp === undefined) setOpenState(v);
    onOpenChange?.(v);
  }, [openProp, onOpenChange]);

  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; zIndex: number; maxHeight: number } | null>(null);
  const visible = items.filter((i) => !i.hide);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    setPos(null);
    if (restoreFocus) btnRef.current?.focus();
  }, [setOpen]);

  // Position from the trigger; flip upward when there isn't room below, clamp horizontally.
  useLayoutEffect(() => {
    if (!open) return;
    const btn = btnRef.current;
    const panel = panelRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = panel?.offsetWidth || minWidth;
    const height = panel?.scrollHeight || 0;
    const below = vh - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    const flipUp = height > below && above > below;
    const maxHeight = Math.max(120, flipUp ? above : below);
    const shown = Math.min(height, maxHeight);
    const top = flipUp ? r.top - GAP - shown : r.bottom + GAP;
    let left = r.right - width;
    left = Math.min(Math.max(MARGIN, left), vw - width - MARGIN);
    const inModal = Boolean(btn.closest('.modal-overlay, .modal-content'));
    // The panel is already in the DOM (rendered off-screen), so its real size is measurable here.
    setPos({ top, left: Math.max(MARGIN, left), zIndex: inModal ? 220 : 120, maxHeight });
  }, [open, minWidth]);

  // Close on outside click, Escape, scroll (window or any scroll container) and resize.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    };
    const onScroll = (e: Event) => {
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return;
      close(false);
    };
    const onResize = () => close(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close]);

  // Focus the first enabled item when opened.
  useEffect(() => {
    if (!open || !pos) return;
    panelRef.current?.querySelector<HTMLButtonElement>('button[aria-disabled="false"]')?.focus();
  }, [open, pos]);

  const onPanelKey = (e: React.KeyboardEvent) => {
    const buttons = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? []);
    if (!buttons.length) return;
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(i + 1) % buttons.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); buttons[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); buttons[buttons.length - 1].focus(); }
    else if (e.key === 'Tab') close(false);
  };

  if (!visible.length) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="icon-btn"
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); if (open) close(false); else setOpen(true); }}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}
      >
        <MoreVertical size={iconSize} color={iconColor} />
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          role="menu"
          className="dropdown-panel row-menu-panel"
          onKeyDown={onPanelKey}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            right: 'auto',
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            minWidth,
            maxWidth: `calc(100vw - ${MARGIN * 2}px)`,
            maxHeight: pos?.maxHeight,
            overflowY: 'auto',
            zIndex: pos?.zIndex ?? 120,
            visibility: pos ? 'visible' : 'hidden',
          }}
        >
          {visible.map((i) => (
            <button
              key={i.label}
              type="button"
              role="menuitem"
              className={`dropdown-item ${i.danger ? 'danger' : ''}`}
              aria-disabled={Boolean(i.disabled)}
              title={i.disabled ? i.disabledReason : undefined}
              style={i.disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
              onClick={() => { if (i.disabled) return; close(); i.run(); }}
            >
              {i.icon && <i.icon size={15} />} {i.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
};

export default RowMenu;
