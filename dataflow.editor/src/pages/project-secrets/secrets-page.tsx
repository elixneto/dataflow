import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { Braces, Check, Copy, Ellipsis, KeyRound, Pencil, Plus, RefreshCw, Trash } from 'lucide-react';
import { ConfirmDialog, type ConfirmTarget } from '@/components/confirm-dialog';
import { FilterToolbar, NoMatch } from '@/components/filter-toolbar';
import { useUrlFilter } from '@/components/use-url-filter';
import { ResourceView } from '@/components/resource-view';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { isReadOnly, useProject } from '@/data/projects/use-project';
import { createSecret, deleteSecret, listSecrets, updateSecretValue } from '@/data/secrets/secrets-api';
import { useResource } from '@/data/use-resource';
import { createVariable, deleteVariable, listVariables, updateVariable } from '@/data/variables/variables-api';
import { formatDateTime } from '@/lib/format';
import { relativeTime } from '@/lib/relative-time';
import { matchesSearch } from '@/lib/search';
import { ProjectPage } from '@/pages/project/project-page';
import { SecretDialog, type SecretDialogTarget } from './secret-dialog';
import { VariableDialog, type VariableDialogTarget } from './variable-dialog';

const KINDS = ['all', 'secrets', 'variables'] as const;

/**
 * A project's secrets and variables (/projects/:projectId/secrets), MOCKED for now. Secrets: the value is never shown
 * (flows read SECRETS['name']). Variables: plain values, shown (flows read VARIABLES['name']). The two are separate:
 * a secret and a variable may have the same name.
 */
export function SecretsPage() {
  const { projectId = '' } = useParams();
  const project = useProject(projectId);
  const secrets = useResource(`secrets:${projectId}`, () => listSecrets(projectId));
  const variables = useResource(`variables:${projectId}`, () => listVariables(projectId));
  const readOnly = isReadOnly(project);

  const [secretDialog, setSecretDialog] = useState<SecretDialogTarget | null>(null);
  const [variableDialog, setVariableDialog] = useState<VariableDialogTarget | null>(null);
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null);
  // the filters live in the URL (?kind=variables&q=url), like Connections: a reload or a link keeps them
  const { kind, search, setFilter, clear } = useUrlFilter('kind', KINDS);
  const [copied, setCopied] = useState<string | null>(null);

  const matches = (...texts: string[]) => matchesSearch(search, ...texts);
  const secretCount = secrets.state.status === 'ready' ? secrets.state.value.filter(s => matches(s.name)).length : 0;
  const variableCount = variables.state.status === 'ready' ? variables.state.value.filter(v => matches(v.name, v.value)).length : 0;
  // a search that finds nothing in what is shown, once both lists are loaded: one message instead of the sections
  const nothing =
    search !== '' &&
    secrets.state.status === 'ready' &&
    variables.state.status === 'ready' &&
    (kind === 'secrets' ? secretCount : kind === 'variables' ? variableCount : secretCount + variableCount) === 0;

  const saveSecret = ({ name, value }: { name: string; value: string }) =>
    secretDialog?.mode === 'replace'
      ? secrets.run(updateSecretValue(projectId, secretDialog.secret.id, value))
      : secrets.run(createSecret(projectId, { name, value }));

  const saveVariable = ({ name, value }: { name: string; value: string }) =>
    variableDialog?.mode === 'edit'
      ? variables.run(updateVariable(projectId, variableDialog.variable.id, value))
      : variables.run(createVariable(projectId, { name, value }));

  const copy = async (id: string, value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(id);
    setTimeout(() => setCopied(current => (current === id ? null : current)), 1500);
  };

  const remove = (kind: 'secret' | 'variable', name: string, onConfirm: ConfirmTarget['onConfirm']) =>
    setConfirm({
      title: `Delete ${name}?`,
      description:
        kind === 'secret'
          ? 'Flows and connections that use it will fail until it is created again.'
          : 'Flows that read it will get nothing until it is created again.',
      confirmLabel: 'Delete',
      busyLabel: 'Deleting...',
      destructive: true,
      onConfirm,
    });

  return (
    <ProjectPage
      projectId={projectId}
      project={project}
      tab="secrets"
      actions={
        <>
          <Button variant="outline" onClick={() => setVariableDialog({ mode: 'create' })}>
            <Plus /> New variable
          </Button>
          <Button onClick={() => setSecretDialog({ mode: 'create' })}>
            <Plus /> New secret
          </Button>
        </>
      }
    >
      <FilterToolbar
        searchLabel="Search secrets and variables"
        search={search}
        kind={kind}
        kindLabel="Show"
        kinds={[
          { value: 'all', label: 'All', count: secretCount + variableCount },
          { value: 'secrets', label: 'Secrets', count: secretCount },
          { value: 'variables', label: 'Variables', count: variableCount },
        ]}
        onChange={setFilter}
      />

      {nothing && <NoMatch onClear={clear} />}

      {!nothing && kind !== 'variables' && (
      <Section title="Secrets" hint="Values are encrypted and never shown. Flows use SECRETS['name'].">
        <ResourceView
          state={secrets.state}
          onRetry={() => void secrets.reload()}
          empty={{ icon: KeyRound, text: 'No secrets yet.' }}
          isEmpty={value => value.length === 0}
        >
          {value => {
            const shown = value.filter(secret => matches(secret.name));
            return shown.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">No secret matches.</p>
            ) : (
              <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                {shown.map(secret => (
                  <li key={secret.id} className="flex items-center gap-3 px-4 py-3">
                    <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-mono text-sm font-medium">{secret.name}</span>
                    <span className="hidden font-mono text-sm tracking-widest text-muted-foreground sm:inline" aria-label="Value hidden">
                      ••••••••
                    </span>
                    <Updated at={secret.updatedAt} by={secret.updatedByName ?? secret.updatedBy} />
                    {!readOnly && (
                      <RowMenu name={secret.name}>
                        <DropdownMenuItem onSelect={() => setSecretDialog({ mode: 'replace', secret })}>
                          <RefreshCw /> Replace value
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onSelect={() => remove('secret', secret.name, () => secrets.run(deleteSecret(projectId, secret.id)))}>
                          <Trash /> Delete
                        </DropdownMenuItem>
                      </RowMenu>
                    )}
                  </li>
                ))}
              </ul>
            );
          }}
        </ResourceView>
      </Section>
      )}

      {!nothing && kind !== 'secrets' && (
      <Section title="Variables" hint="Plain values, shown to everyone in the project. Flows use VARIABLES['name'].">
        <ResourceView
          state={variables.state}
          onRetry={() => void variables.reload()}
          empty={{ icon: Braces, text: 'No variables yet.' }}
          isEmpty={value => value.length === 0}
        >
          {value => {
            const shown = value.filter(variable => matches(variable.name, variable.value));
            return shown.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">No variable matches.</p>
            ) : (
              <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                {shown.map(variable => (
                  <li key={variable.id} className="flex items-center gap-3 px-4 py-3">
                    <Braces className="size-4 shrink-0 text-muted-foreground" />
                    <span className="w-48 shrink-0 truncate font-mono text-sm font-medium">{variable.name}</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="min-w-0 flex-1 truncate font-mono text-sm text-muted-foreground">
                          {variable.value || <em className="not-italic opacity-60">(empty)</em>}
                        </span>
                      </TooltipTrigger>
                      {variable.value && <TooltipContent className="max-w-md font-mono whitespace-pre-wrap break-all">{variable.value}</TooltipContent>}
                    </Tooltip>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      aria-label={`Copy the value of ${variable.name}`}
                      onClick={() => void copy(variable.id, variable.value)}
                    >
                      {copied === variable.id ? <Check /> : <Copy />}
                    </Button>
                    <Updated at={variable.updatedAt} by={variable.updatedByName ?? variable.updatedBy} />
                    {!readOnly && (
                      <RowMenu name={variable.name}>
                        <DropdownMenuItem onSelect={() => setVariableDialog({ mode: 'edit', variable })}>
                          <Pencil /> Edit value
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => remove('variable', variable.name, () => variables.run(deleteVariable(projectId, variable.id)))}
                        >
                          <Trash /> Delete
                        </DropdownMenuItem>
                      </RowMenu>
                    )}
                  </li>
                ))}
              </ul>
            );
          }}
        </ResourceView>
      </Section>
      )}

      <SecretDialog
        target={secretDialog}
        existing={secrets.state.status === 'ready' ? secrets.state.value : []}
        onClose={() => setSecretDialog(null)}
        onSave={saveSecret}
      />
      <VariableDialog
        target={variableDialog}
        existing={variables.state.status === 'ready' ? variables.state.value : []}
        onClose={() => setVariableDialog(null)}
        onSave={saveVariable}
      />
      <ConfirmDialog target={confirm} onClose={() => setConfirm(null)} />
    </ProjectPage>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function Updated({ at, by }: { at: Date; by: string }) {
  return (
    <span className="hidden w-48 shrink-0 text-right text-xs text-muted-foreground md:inline" title={formatDateTime(at)}>
      Updated {relativeTime(at)} by {by}
    </span>
  );
}

function RowMenu({ name, children }: { name: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`Actions for ${name}`}>
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}
