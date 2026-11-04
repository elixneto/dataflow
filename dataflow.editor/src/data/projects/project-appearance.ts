import {
  Briefcase,
  Calendar,
  ChartColumn,
  Cloud,
  Code,
  Database,
  FileText,
  Folder,
  Globe,
  Layers,
  Mail,
  Package,
  Rocket,
  Server,
  Shield,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/*
 * The icon and color a project shows in the lists. Stored by name (e.g. 'database', 'blue'), so the server keeps
 * plain text; the classes are written out in full so Tailwind finds them.
 */

export const PROJECT_ICONS = {
  folder: Folder,
  database: Database,
  chart: ChartColumn,
  cart: ShoppingCart,
  wallet: Wallet,
  package: Package,
  truck: Truck,
  users: Users,
  mail: Mail,
  globe: Globe,
  server: Server,
  file: FileText,
  zap: Zap,
  cloud: Cloud,
  briefcase: Briefcase,
  calendar: Calendar,
  shield: Shield,
  layers: Layers,
  code: Code,
  rocket: Rocket,
} satisfies Record<string, LucideIcon>;

export type ProjectIconName = keyof typeof PROJECT_ICONS;

export const PROJECT_COLORS = {
  slate: { text: 'text-slate-600 dark:text-slate-400', tile: 'bg-slate-500/15', swatch: 'bg-slate-500' },
  blue: { text: 'text-blue-600 dark:text-blue-400', tile: 'bg-blue-500/15', swatch: 'bg-blue-500' },
  violet: { text: 'text-violet-600 dark:text-violet-400', tile: 'bg-violet-500/15', swatch: 'bg-violet-500' },
  pink: { text: 'text-pink-600 dark:text-pink-400', tile: 'bg-pink-500/15', swatch: 'bg-pink-500' },
  red: { text: 'text-red-600 dark:text-red-400', tile: 'bg-red-500/15', swatch: 'bg-red-500' },
  orange: { text: 'text-orange-600 dark:text-orange-400', tile: 'bg-orange-500/15', swatch: 'bg-orange-500' },
  amber: { text: 'text-amber-600 dark:text-amber-400', tile: 'bg-amber-500/15', swatch: 'bg-amber-500' },
  green: { text: 'text-green-600 dark:text-green-400', tile: 'bg-green-500/15', swatch: 'bg-green-500' },
  teal: { text: 'text-teal-600 dark:text-teal-400', tile: 'bg-teal-500/15', swatch: 'bg-teal-500' },
  cyan: { text: 'text-cyan-600 dark:text-cyan-400', tile: 'bg-cyan-500/15', swatch: 'bg-cyan-500' },
};

export type ProjectColorName = keyof typeof PROJECT_COLORS;

export const DEFAULT_PROJECT_ICON: ProjectIconName = 'folder';
export const DEFAULT_PROJECT_COLOR: ProjectColorName = 'blue';

export const isProjectIcon = (name: string): name is ProjectIconName => Object.hasOwn(PROJECT_ICONS, name);
export const isProjectColor = (name: string): name is ProjectColorName => Object.hasOwn(PROJECT_COLORS, name);
