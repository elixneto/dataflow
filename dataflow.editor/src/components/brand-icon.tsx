import type { SimpleIcon } from 'simple-icons';
import { cn } from '@/lib/utils';

/** a brand color too dark to see on a dark background (e.g. Kafka's near black) */
function isDark(hex: string): boolean {
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 0.25;
}

/**
 * A product's logo (Simple Icons, CC0) in its brand color, the size of a lucide icon (className sets it). A logo
 * whose color is near black is drawn in the text color in dark mode, so it stays visible.
 */
export function BrandIcon({ icon, className }: { icon: SimpleIcon; className?: string }) {
  const dark = isDark(icon.hex);
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      aria-label={icon.title}
      fill="currentColor"
      style={{ '--brand': `#${icon.hex}` } as React.CSSProperties}
      className={cn('size-4 shrink-0 text-[var(--brand)]', dark && 'dark:text-foreground', className)}
    >
      <path d={icon.path} />
    </svg>
  );
}
