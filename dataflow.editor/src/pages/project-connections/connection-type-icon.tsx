import { BrandIcon } from '@/components/brand-icon';
import { connectionType, groupColor, type ConnectionTypeName } from '@/data/connections/connection-types';
import { cn } from '@/lib/utils';

/** A connection type's icon: the product's logo when there is one, otherwise its lucide icon in the group's color. */
export function ConnectionTypeIcon({ type, className }: { type: ConnectionTypeName; className?: string }) {
  const kind = connectionType(type);
  if (kind.brand) {
    return <BrandIcon icon={kind.brand} className={className} />;
  }

  return <kind.icon className={cn('shrink-0', className)} style={{ color: groupColor(kind.group) }} />;
}
