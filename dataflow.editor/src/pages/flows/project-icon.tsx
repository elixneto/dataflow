import { cn } from '@/lib/utils';
import {
  PROJECT_COLORS,
  PROJECT_ICONS,
  type ProjectColorName,
  type ProjectIconName,
} from '@/data/projects/project-appearance';

type Props = {
  icon: ProjectIconName;
  color: ProjectColorName;
  className?: string;
};

/** The project's icon in its color, on a tile tinted with the same color. */
export function ProjectIcon({ icon, color, className }: Props) {
  const Icon = PROJECT_ICONS[icon];
  const { text, tile } = PROJECT_COLORS[color];

  return (
    <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', tile, className)}>
      <Icon className={cn('size-5', text)} />
    </div>
  );
}
