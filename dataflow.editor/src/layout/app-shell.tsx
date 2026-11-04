import { Outlet } from 'react-router';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { AppSidebar } from './app-sidebar';
import { ConnectionStatus } from './connection-status';
import { ThemeToggle } from './theme-toggle';

// the sidebar component writes this cookie when it opens or closes; reading it here keeps the choice across reloads
const sidebarWasClosed = () => document.cookie.split('; ').includes('sidebar_state=false');

/** Every page: the sidebar on the left, a top bar and the page in the middle. */
export function AppShell() {
  return (
    <SidebarProvider defaultOpen={!sidebarWasClosed()}>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <div className="ml-auto flex items-center gap-1">
            <ConnectionStatus />
            <ThemeToggle />
          </div>
        </header>
        <main className="flex flex-1 flex-col p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
