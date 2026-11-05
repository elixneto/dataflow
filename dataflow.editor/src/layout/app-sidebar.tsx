import { FolderKanban, History, House, Workflow } from 'lucide-react';
import { NavLink, useLocation } from 'react-router';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { PROJECTS_PATH, RUNS_PATH } from '@/app/paths';
import { mockUser } from '@/auth/mock-user';
import { useRunNumbers } from '@/data/runs/use-runs';
import { NavUser } from './nav-user';

/** a page of the menu: a new page is one more line here */
const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: House },
  { to: PROJECTS_PATH, label: 'Projects', icon: FolderKanban },
  { to: RUNS_PATH, label: 'Runs', icon: History },
];

/** Runs: how many run now (a dot and the count; nothing when none) */
function RunningBadge() {
  const { state } = useRunNumbers();
  const running = state.status === 'ready' ? state.value.running : 0;
  if (running === 0) {
    return null;
  }

  return (
    <SidebarMenuBadge className="gap-1 text-sky-600 dark:text-sky-400" title={`${running} running now`}>
      <span className="size-1.5 rounded-full bg-sky-500" aria-hidden />
      {running}
    </SidebarMenuBadge>
  );
}

// Home only on '/'; any other item also on its sub-pages (/projects/...)
function isActive(to: string, pathname: string): boolean {
  if (to === '/') {
    return pathname === '/';
  }

  return pathname === to || pathname.startsWith(`${to}/`);
}

export function AppSidebar() {
  const { pathname } = useLocation();

  return (
    <Sidebar collapsible="icon">
      {/* same height and bottom border as the top bar (app-shell.tsx), so the line runs straight across */}
      <SidebarHeader className="h-14 justify-center border-b">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <NavLink to="/">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Workflow className="size-4" />
                </div>
                {/* collapsed (icons only): just the logo */}
                <span className="truncate font-semibold group-data-[collapsible=icon]:hidden">dataflow</span>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {NAV_ITEMS.map(item => (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton isActive={isActive(item.to, pathname)} tooltip={item.label} asChild>
                  <NavLink to={item.to}>
                    <item.icon />
                    <span>{item.label}</span>
                  </NavLink>
                </SidebarMenuButton>
                {item.to === RUNS_PATH && <RunningBadge />}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <NavUser user={mockUser} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
