import { Search, X } from 'lucide-react';
import { SegmentedControl } from '@/components/segmented-control';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Props<K extends string> = {
  /** e.g. "Search connections" */
  searchLabel: string;
  search: string;
  kind: K;
  /** the segments, with how many items each one has under the current search */
  kinds: { value: K; label: string; count: number }[];
  kindLabel: string;
  onChange: (changes: { kind?: K; search?: string }) => void;
};

/** A list's toolbar: the search on the left (X or Esc clears it), the kind (All | ...) with counts on the right. */
export function FilterToolbar<K extends string>({ searchLabel, search, kind, kinds, kindLabel, onChange }: Props<K>) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="relative w-full sm:w-72">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          placeholder={searchLabel}
          aria-label={searchLabel}
          className="px-9"
          onChange={event => onChange({ search: event.target.value })}
          onKeyDown={event => event.key === 'Escape' && onChange({ search: '' })}
        />
        {search && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
            aria-label="Clear the search"
            onClick={() => onChange({ search: '' })}
          >
            <X />
          </Button>
        )}
      </div>
      <SegmentedControl
        label={kindLabel}
        value={kind}
        onChange={value => onChange({ kind: value })}
        options={kinds.map(k => ({ value: k.value, label: `${k.label} (${k.count})` }))}
      />
    </div>
  );
}

/** "Nothing matches." with the button that clears every filter */
export function NoMatch({ text = 'Nothing matches.', onClear }: { text?: string; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
      <Button variant="outline" size="sm" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  );
}
