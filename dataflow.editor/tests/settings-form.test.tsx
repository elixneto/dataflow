import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { componentSettings } from '@dataflow/core';
import { ProjectResourcesContext } from '../src/editor/project-resources';
import { SettingsForm } from '../src/editor/settings-form';

const render = (type: string, values: Record<string, unknown>) =>
  renderToStaticMarkup(<SettingsForm id="n" fields={componentSettings(type)} values={values} onChange={() => {}} />);

describe("a component's settings form, from the core's settings", () => {
  test('a Router: one row per case (name and condition) and Add case', () => {
    const html = render('router', { cases: [{ label: 'big', condition: '$total > 1000' }, { label: '', condition: '' }] });
    expect(html).toContain('Cases');
    expect(html.match(/role="group"/g)?.length).toBe(2);
    expect(html).toContain('value="big"');
    expect(html).toContain('$total &gt; 1000');
    expect(html).toContain('Add case');
  });

  test("a Mapper's rows read as in the PoC: Source (value) → Key in the envelope, an arrow between them", () => {
    const html = render('mapper', { fields: [{ target: 'total', value: '$a', expression: true }] });
    const text = html.replace(/<svg[^>]*lucide-arrow-right[^>]*>.*?<\/svg>/g, '→').replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
    expect(text).toContain('|Source (value)|Key in the envelope|');
    // the row: the value, the arrow, the key
    expect(html.indexOf('$a')).toBeLessThan(html.lastIndexOf('lucide-arrow-right'));
    expect(html.lastIndexOf('lucide-arrow-right')).toBeLessThan(html.indexOf('value="total"'));
  });

  test("a Mapper's value has the fx toggle; a Limit has its select and number with the defaults", () => {
    expect(render('mapper', { fields: [{ target: 'total', value: '$a', expression: true }] })).toContain('aria-pressed="true"');
    const limit = render('limit', {});
    expect(limit).toContain('<option value="top" selected="">First</option>');
    expect(limit).toContain('value="10"');
  });

  test('a Log: level and message', () => {
    const html = render('log', { level: 'warn', message: '$id' });
    expect(html).toContain('<option value="warn" selected="">Warn</option>');
    expect(html).toContain('>$id</textarea>');
  });

  test("a flat list (Distinct's keys) edits the values themselves", () => {
    const html = render('distinct', { keys: ['$email', '$name'] });
    expect(html.match(/role="group"/g)?.length).toBe(2);
    expect(html).toContain('>$email</textarea>');
    expect(html).toContain('Add key');
  });

  test('a Sort key has its order; an Aggregate starts with its defaults', () => {
    expect(render('sort', { keys: [{ value: '$price', direction: 'desc' }] })).toContain('<option value="desc" selected="">Descending</option>');
    const aggregate = render('aggregate', {});
    expect(aggregate).toContain('value="500"');
    expect(aggregate).toContain('value="items"');
  });

  test("a database component: the project's profiles of its type; without one, its own fields with secrets to pick", () => {
    const resources = {
      projectId: 'p1',
      connections: [
        { id: 'erp', name: 'ERP', type: 'sqlserver' },
        { id: 'atlas', name: 'Atlas', type: 'mongodb' },
      ],
      secrets: ['ERP_PW'],
      variables: [],
      flows: [],
    };
    const form = (values: Record<string, unknown>) =>
      renderToStaticMarkup(
        <ProjectResourcesContext.Provider value={resources}>
          <SettingsForm id="n" fields={componentSettings('sqlserver')} values={values} onChange={() => {}} />
        </ProjectResourcesContext.Provider>,
      );
    const none = form({});
    expect(none).toContain('<option value="erp">ERP</option>');
    expect(none).not.toContain('Atlas');
    expect(none).toContain('Host');
    expect(none).toContain('<option value="ERP_PW">ERP_PW</option>');
    expect(none).toContain('href="/projects/p1/connections"');
    // with a profile, its own fields are gone
    const picked = form({ connection: 'erp' });
    expect(picked).toContain('<option value="erp" selected="">ERP</option>');
    expect(picked).not.toContain('Host');
  });

  test('a Data Grid: its columns (name, type) and one row of cells per record', () => {
    const html = render('datagrid', { columns: [{ name: 'id', type: 'number' }, { name: 'name', type: 'text' }], rows: [['1', 'ana'], ['2', 'bia']] });
    expect(html.match(/role="row"/g)?.length).toBe(3);
    expect(html).toContain('value="ana"');
    expect(html).toContain('<option value="number" selected="">Number</option>');
    expect(html).toContain('Add row');
  });

  test("a Flow Invoker: the project's flows to pick and its parameters; a TypeScript: its code", () => {
    const resources = { projectId: 'p1', connections: [], secrets: [], variables: [], flows: [{ id: 'f2', name: 'Load orders' }] };
    const html = renderToStaticMarkup(
      <ProjectResourcesContext.Provider value={resources}>
        <SettingsForm id="n" fields={componentSettings('flow')} values={{ flowId: 'f2' }} onChange={() => {}} />
      </ProjectResourcesContext.Provider>,
    );
    expect(html).toContain('<option value="f2" selected="">Load orders</option>');
    // its parameters: the called flow's Start ones, once its draft is read
    expect(html).toContain('Reading the flow…');
    // its code editor (Monaco) loads on demand: its empty frame meanwhile, never a plain text box to type in
    const ts = render('typescript', {});
    expect(ts).toContain('aria-label="Code (loading)"');
    expect(ts).not.toContain('<textarea');
    // by path (expression): the flow path field, the parameters typed by hand (the flow is known only in the run)
    const dynamic = renderToStaticMarkup(
      <ProjectResourcesContext.Provider value={resources}>
        <SettingsForm id="n" fields={componentSettings('flow')} values={{ flowId: '$dynamic' }} onChange={() => {}} />
      </ProjectResourcesContext.Provider>,
    );
    expect(dynamic).toContain('<option value="$dynamic" selected="">By path (expression)</option>');
    expect(dynamic).toContain('Flow path');
    expect(dynamic).not.toContain('Reading the flow…');
    expect(dynamic).not.toContain('Missing flow');
  });

  test('the Start: Accepts input, its default input only when on, and the parameters with type and Required', () => {
    expect(render('start', {})).not.toContain('Default input');
    const html = render('start', { acceptsInput: true, testInput: '{"n": 5}', parameters: [{ name: 'since', type: 'number', default: '10', required: true }] });
    expect(html).toContain('Default input (JSON)');
    expect(html).toContain('value="since"');
    expect(html).toContain('<option value="number" selected="">Number</option>');
    expect(html).toMatch(/aria-label="Required" class="[^"]*" checked=""/);
    expect(html).toContain('Add parameter');
  });

  test("a list item's fixed-or-expression value is read from the item itself ({name, value, expression}) in both modes", () => {
    const html = render('http-request', {
      headers: [
        { name: 'Accept', value: 'application/json', expression: false },
        { name: 'X-Id', value: '$id', expression: true },
      ],
    });
    expect(html).toContain('value="application/json"');
    expect(html).toContain('>$id</textarea>');
    expect(html).not.toContain('[object Object]');
  });

  test("an HTTP Request lists the project's API connections of any kind (OAuth 2.0, basic, HTTP client), not a database's", () => {
    const resources = {
      projectId: 'p1',
      connections: [
        { id: 'wf', name: 'Tasks API', type: 'rest-oauth2' },
        { id: 'b', name: 'Basic API', type: 'rest-basic' },
        { id: 'erp', name: 'ERP', type: 'sqlserver' },
      ],
      secrets: [],
      variables: [],
      flows: [],
    };
    const html = renderToStaticMarkup(
      <ProjectResourcesContext.Provider value={resources}>
        <SettingsForm id="n" fields={componentSettings('http-request')} values={{}} onChange={() => {}} />
      </ProjectResourcesContext.Provider>,
    );
    expect(html).toContain('<option value="wf">Tasks API</option>');
    expect(html).toContain('<option value="b">Basic API</option>');
    expect(html).not.toContain('ERP');
  });
});
