import type { ApiResult } from '@/lib/api';
import { ConfirmDialog } from './confirm-dialog';

type Props = {
  /** what is being archived (a project, a flow); null = closed */
  name: string | null;
  onClose: () => void;
  onArchive: () => Promise<ApiResult<unknown>>;
};

/** "Archive <name>?" before archiving; an error shows here and keeps it open. */
export function ArchiveDialog({ name, onClose, onArchive }: Props) {
  return (
    <ConfirmDialog
      target={
        name === null
          ? null
          : {
              title: `Archive ${name}?`,
              description: 'It moves to Archived and can be restored.',
              confirmLabel: 'Archive',
              busyLabel: 'Archiving...',
              onConfirm: onArchive,
            }
      }
      onClose={onClose}
    />
  );
}
