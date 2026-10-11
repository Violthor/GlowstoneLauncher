import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';

// 可输入筛选的下拉：既可以点选，也可以直接打字快速定位（替代只能滚动选择的 Radix Select）。
// 不引入新依赖，纯 React + Tailwind。options: {value,label}[]。
export type SearchableOption = { value: string; label: string };

export function SearchableSelect({
  value, onChange, options, placeholder = '请选择', className = '', triggerClassName = '',
  searchable = true, disabled = false, listMaxH = 'max-h-56',
}: {
  value: string;
  onChange: (v: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  searchable?: boolean;
  disabled?: boolean;
  listMaxH?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const current = options.find((o) => o.value === value);
  const needle = q.trim().toLowerCase();
  const filtered = searchable && needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setOpen((o) => !o); setQ(''); }}
        className={`flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-50 ${triggerClassName}`}
      >
        <span className={`truncate text-left ${current ? '' : 'text-muted-foreground'}`}>{current ? current.label : placeholder}</span>
        <ChevronDown className={`size-4 shrink-0 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-[60] mt-1 w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md flex flex-col">
          {searchable && (
            <div className="relative border-b p-1.5">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="输入关键字筛选…"
                className="h-8 w-full rounded bg-transparent pl-8 pr-2 text-sm outline-none"
              />
            </div>
          )}
          <div className={`overflow-y-auto ${listMaxH}`}>
            {filtered.length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">无匹配项</div>}
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false); }}
                className={`block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-accent ${o.value === value ? 'bg-accent font-medium' : ''}`}
                title={o.label}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
