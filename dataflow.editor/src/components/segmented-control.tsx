import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type Option<T extends string> = { value: T; label: string; icon?: LucideIcon };

type Props<T extends string> = {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
};

/**
 * One choice among a few, side by side (e.g. Tree | Cards). The chosen one is filled with the primary color, so it
 * stands out in light and dark whatever the page background.
 */
export function SegmentedControl<T extends string>({ label, value, options, onChange }: Props<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border bg-card p-0.5">
      {options.map(option => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4',
              selected ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.icon && <option.icon />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
