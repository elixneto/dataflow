import { Wifi, WifiOff } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useServerConnection, type ServerConnection } from '@/lib/server-connection';

function label(connection: ServerConnection): string {
  if (connection.state === 'checking') {
    return 'Checking the server...';
  }

  if (connection.state === 'offline') {
    return 'Server unreachable, retrying';
  }

  return connection.environment ? `Connected to the server (${connection.environment})` : 'Connected to the server';
}

/** Green wifi while dataflow.server answers, red when it stops answering (gray during the first check). */
export function ConnectionStatus() {
  const connection = useServerConnection();
  const Icon = connection.state === 'offline' ? WifiOff : Wifi;
  const text = label(connection);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="status" aria-label={text} className="flex size-9 items-center justify-center">
          <Icon
            className={cn(
              'size-4',
              connection.state === 'checking' && 'text-muted-foreground',
              connection.state === 'online' && 'text-green-600 dark:text-green-400',
              connection.state === 'offline' && 'text-red-600 dark:text-red-400',
            )}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}
