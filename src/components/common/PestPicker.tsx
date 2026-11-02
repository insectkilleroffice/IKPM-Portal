import React, { useId, useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';

interface Option {
  value: string;
  label: string;
}

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  /** The standard list shown as suggestions. */
  options: Option[];
  placeholder?: string;
}

/**
 * Type to search the standard pests, pick with click / Enter, or add any other pest by typing its
 * name and pressing Enter (or "Add …"). Picked pests show as removable chips.
 */
export const PestPicker: React.FC<Props> = ({ value, onChange, options, placeholder = 'Type a pest, e.g. cockroach, pigeon…' }) => {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? (v === 'other' ? 'Other' : v);
  const q = text.trim().toLowerCase();

  const suggestions = useMemo(
    () => options.filter((o) => !value.includes(o.value) && (!q || o.label.toLowerCase().includes(q) || o.value.replace(/_/g, ' ').includes(q))),
    [options, value, q],
  );
  // Offer "Add …" when the typed name isn't already a standard pest or already picked
  const exact = options.find((o) => o.label.toLowerCase() === q || o.value === q);
  const alreadyPicked = value.some((v) => labelOf(v).toLowerCase() === q);
  const canAddCustom = q.length > 1 && !exact && !alreadyPicked;
  const items: { key: string; label: string; custom?: boolean }[] = [
    ...suggestions.map((o) => ({ key: o.value, label: o.label })),
    ...(canAddCustom ? [{ key: text.trim(), label: `Add "${text.trim()}"`, custom: true }] : []),
  ];

  const add = (v: string) => {
    if (!v || value.includes(v)) return;
    onChange([...value, v]);
    setText('');
    setActive(0);
    inputRef.current?.focus();
  };
  const remove = (v: string) => onChange(value.filter((x) => x !== v));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (exact && !value.includes(exact.value)) return add(exact.value);
      const item = items[active];
      if (item) add(item.key);
    } else if (e.key === 'Backspace' && !text && value.length) {
      remove(value[value.length - 1]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <div
        className="form-input"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center', minHeight: 42, height: 'auto', padding: '0.3rem 0.5rem', cursor: 'text' }}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((v) => (
          <span key={v} className="chip chip-on" style={{ margin: 0, padding: '0.15rem 0.5rem', fontSize: '0.8rem' }}>
            {labelOf(v)}
            <button type="button" aria-label={`Remove ${labelOf(v)}`} onClick={(e) => { e.stopPropagation(); remove(v); }}
              style={{ background: 'none', border: 0, padding: 0, marginLeft: 4, cursor: 'pointer', color: 'inherit', display: 'inline-flex' }}>
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={text}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          placeholder={value.length ? 'Add another…' : placeholder}
          onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          style={{ flex: 1, minWidth: 140, border: 0, outline: 'none', background: 'transparent', font: 'inherit', padding: '0.2rem' }}
        />
      </div>
      {open && items.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          style={{
            position: 'absolute', zIndex: 50, left: 0, right: 0, top: '100%', marginTop: 4, padding: '0.25rem', listStyle: 'none',
            background: 'var(--bg-surface, #fff)', border: '1px solid var(--border-color, #E2E8F0)', borderRadius: 8,
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)', maxHeight: 240, overflowY: 'auto',
          }}
        >
          {items.map((it, i) => (
            <li
              key={`${it.custom ? 'custom:' : ''}${it.key}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); add(it.key); }}
              onMouseEnter={() => setActive(i)}
              style={{
                padding: '0.45rem 0.6rem', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem',
                display: 'flex', alignItems: 'center', gap: '0.4rem',
                background: i === active ? 'var(--bg-surface-alt, #F1F5F9)' : 'transparent',
                fontWeight: it.custom ? 600 : 400, color: it.custom ? 'var(--ikpm-emerald-600, #059669)' : undefined,
              }}
            >
              {it.custom && <Plus size={14} />} {it.label}
            </li>
          ))}
        </ul>
      )}
      <div className="form-hint" style={{ marginTop: '0.3rem' }}>Start typing to pick from the list. Not listed? Type its name and press Enter.</div>
    </div>
  );
};

export default PestPicker;
