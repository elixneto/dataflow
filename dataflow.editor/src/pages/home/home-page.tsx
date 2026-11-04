import { House } from 'lucide-react';

export function HomePage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-12 text-center">
        <House className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      </div>
    </div>
  );
}
