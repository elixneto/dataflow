import { CircleAlert, CircleCheck, LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DraftSave } from '@/editor/flow-save';

/**
 * Where the flow's draft stands, in the top bar: Saving…, Saved, Not saved (with Retry), or changed elsewhere (with
 * Reload). It saves by itself; Ctrl+S saves now.
 */
export function SaveStatus({ save }: { save: DraftSave | null }) {
  if (!save) {
    return null;
  }

  const { state } = save;
  switch (state.status) {
    case 'loading':
      return <Status icon={<LoaderCircle className="size-3.5 animate-spin" />} text="Opening…" />;
    case 'pending':
    case 'saving':
      return <Status icon={<LoaderCircle className="size-3.5 animate-spin" />} text="Saving…" />;
    case 'saved':
      return <Status icon={<CircleCheck className="size-3.5 text-green-600 dark:text-green-400" />} text="Saved" title="Saved (it saves by itself; Ctrl+S saves now)" />;
    case 'error':
      return (
        <span className="flex items-center gap-1.5">
          <Status icon={<CircleAlert className="size-3.5 text-destructive" />} text="Not saved" title={state.message} />
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={save.saveNow}>
            Retry
          </Button>
        </span>
      );
    case 'conflict':
      return (
        <span className="flex items-center gap-1.5">
          <Status icon={<CircleAlert className="size-3.5 text-amber-600 dark:text-amber-400" />} text="Changed elsewhere" title="This flow was changed elsewhere: reload it to see the latest version (your changes here are not saved)" />
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={save.reload}>
            <RefreshCw /> Reload
          </Button>
        </span>
      );
  }
}

function Status({ icon, text, title }: { icon: React.ReactNode; text: string; title?: string }) {
  return (
    <span role="status" title={title ?? text} className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {icon}
      {text}
    </span>
  );
}
