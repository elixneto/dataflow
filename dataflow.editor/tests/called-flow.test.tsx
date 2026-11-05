import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { CalledFlowSetting } from '../src/editor/called-flow';

const start = {
  status: 'ready' as const,
  acceptsInput: false,
  inputType: '',
  parameters: [
    { name: 'since', type: 'number' as const, default: '', required: true },
    { name: 'tag', type: 'text' as const, default: 'a' },
  ],
  calls: [] as string[],
};
const render = (props: Partial<Parameters<typeof CalledFlowSetting>[0]>) =>
  renderToStaticMarkup(
    <CalledFlowSetting
      id="p"
      start={start}
      items={[]}
      sendEnvelope={false}
      onChange={() => {}}
      renderValue={(id, value, placeholder) => <input id={id} data-fx={String(value.expression)} defaultValue={value.value} placeholder={placeholder} />}
      {...props}
    />,
  );

test("a Flow Invoker's parameters: one row per parameter of the called flow's Start, its default as the placeholder", () => {
  const html = render({ items: [{ name: 'tag', value: '$tag', expression: true }, { name: 'old', value: '1', expression: false }] });
  expect(html).toContain('aria-label="parameter since"');
  // required, with no default and no value: said so
  expect(html).toContain('title="Required, with no default: give it a value"');
  expect(html).toContain('id="p-1" data-fx="true" placeholder="default: a" value="$tag"');
  // one the Start no longer has: listed, to remove
  expect(html).toContain('Not a parameter of this flow any more');
  expect(html).toContain('aria-label="Remove parameter old"');
});

test('the input the called flow takes: none (a warning when DATA is sent), or any JSON', () => {
  expect(render({})).toContain('This flow takes no input: it starts with one empty envelope per call.');
  expect(render({ sendEnvelope: true })).toContain('each call would fail');
  const open = render({ start: { ...start, acceptsInput: true, parameters: [] }, sendEnvelope: true });
  expect(open).toContain('Any JSON (its Start has no input type).');
  expect(open).toContain('The flow has no parameters.');
});

test('a called flow that calls this one back is a circular call: said above the parameters', () => {
  expect(render({ start: { ...start, calls: ['f1'] }, selfId: 'f1' })).toContain('This flow calls this one back');
  expect(render({ start: { ...start, calls: ['f2'] }, selfId: 'f1' })).not.toContain('calls this one back');
  expect(render({ start: { ...start, calls: ['f1'] } })).not.toContain('calls this one back');
});
