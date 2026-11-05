import { useState, type ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { ApiResult } from '@/lib/api';

export type ConfirmTarget = {
  /** text, or text with a name in bold */
  title: ReactNode;
  description: ReactNode;
  /** e.g. "Archive", "Delete" */
  confirmLabel: string;
  /** e.g. "Deleting..." */
  busyLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<ApiResult<unknown>>;
};

type Props = {
  /** null = closed */
  target: ConfirmTarget | null;
  onClose: () => void;
};

/** "Are you sure?" before an action; an error shows here and keeps it open. */
export function ConfirmDialog({ target, onClose }: Props) {
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => {
    setFailure('');
    onClose();
  };

  const confirm = async (event: React.MouseEvent) => {
    event.preventDefault(); // stays open until the answer
    if (!target) {
      return;
    }

    setBusy(true);
    const result = await target.onConfirm();
    setBusy(false);
    if (result.ok) {
      close();
    } else {
      setFailure(result.error.message);
    }
  };

  return (
    <AlertDialog open={target !== null} onOpenChange={open => !open && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{target?.title}</AlertDialogTitle>
          <AlertDialogDescription>{target?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {failure && <p className="text-sm text-destructive">{failure}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={event => void confirm(event)}
            className={target?.destructive ? 'bg-destructive text-white hover:bg-destructive/90' : undefined}
          >
            {busy ? target?.busyLabel : target?.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
