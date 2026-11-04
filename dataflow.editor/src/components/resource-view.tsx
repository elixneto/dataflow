import type { ReactNode } from 'react';
import { RotateCw, TriangleAlert, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { ResourceState } from '@/data/use-resource';

type Props<T> = {
  state: ResourceState<T>;
  onRetry: () => void;
  /** shown when `isEmpty` says the value has nothing */
  empty: { icon: LucideIcon; text: string };
  isEmpty: (value: T) => boolean;
  children: (value: T) => ReactNode;
};

/** A list from the api in its states: skeleton while loading, the error with Try again, empty, or the list. */
export function ResourceView<T>({ state, onRetry, empty, isEmpty, children }: Props<T>) {
  if (state.status === 'loading') {
    return (
      <div className="grid gap-2" aria-busy="true">
        {[0, 1, 2].map(i => (
          <Skeleton key={i} className="h-12 rounded-lg" />
        ))}
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-12 text-center">
        <TriangleAlert className="size-8 text-destructive" />
        <p className="text-sm text-muted-foreground">{state.error.message}</p>
        <Button variant="outline" onClick={onRetry}>
          <RotateCw /> Try again
        </Button>
      </div>
    );
  }

  if (isEmpty(state.value)) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-12 text-center">
        <empty.icon className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{empty.text}</p>
      </div>
    );
  }

  return <>{children(state.value)}</>;
}
