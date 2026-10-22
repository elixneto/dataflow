import type {ReactNode} from 'react'
import {Link} from 'react-router'
import {Workflow} from 'lucide-react'
import {ThemeButton} from '@/ui/theme'

/** Header of the pages outside the editor: brand, breadcrumb (Projects / ...) and actions on the right. */
export function Header({breadcrumb = [], children}: {breadcrumb?: {label: string; to?: string}[]; children?: ReactNode}) {
  return (
    <header className="flex h-14 items-center gap-3 border-b border-border px-6">
      <Link to="/" className="flex items-center gap-2 text-sm font-medium hover:text-primary">
        <Workflow className="size-5 text-primary" aria-hidden="true"/>
        Workflows
      </Link>
      {breadcrumb.map((t, i) => (
        <span key={i} className="flex min-w-0 items-center gap-3 text-sm">
          <span className="text-muted-foreground" aria-hidden="true">/</span>
          {t.to ? <Link to={t.to} className="truncate text-muted-foreground hover:text-foreground">{t.label}</Link> : <span className="truncate font-medium">{t.label}</span>}
        </span>
      ))}
      <span className="ml-2 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground" title="Projects and flows stored only in this browser">
        mock data
      </span>
      <div className="ml-auto flex items-center gap-2">
        <ThemeButton/>
        {children}
      </div>
    </header>
  )
}

export const shortDate = (iso: string) => new Date(iso).toLocaleString('en-US', {day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit'})
