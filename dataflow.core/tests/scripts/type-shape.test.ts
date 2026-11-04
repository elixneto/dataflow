import {expect, test} from 'bun:test';
import {emptyOfShape, inputTypeRef, scriptTypeShape, unionValue, type TypeShape} from '../../src/index';

const ORDERS = `import type {Address} from '@myproject/scripts/shared/address';

/** an order, as the API sends it */
export interface Order extends Base {
  id: number;
  customerName: string
  active: boolean;
  status: 'new' | 'paid' | 'shipped';
  tags: string[];
  items: Array<{sku: string; qty: number}>;
  shipTo?: Address;
  notes?: string | null;
  extra: Record<string, unknown>;
  total(): number;
}

interface Base { createdAt: Date }

export type Priority = 1 | 2 | 3;
export function notAType() { return 1; }
`;
const ADDRESS = 'export type Address = { street: string, city: string }';
const shapeOf = (sources: Record<string, string>, path: string, name: string) => scriptTypeShape(sources, path, name)!;
const fieldOf = (shape: TypeShape | null, name: string) => (shape?.kind === 'object' ? shape.fields.find(f => f.name === name) : undefined);

test('an interface becomes its fields: text, number, yes/no, a choice, lists, objects, its parent and imported types', () => {
  const shape = shapeOf({'orders/types': ORDERS, 'shared/address': ADDRESS}, 'orders/types', 'Order');
  expect(shape).toEqual({kind: 'object', fields: [
    {name: 'createdAt', optional: false, shape: {kind: 'string'}},
    {name: 'id', optional: false, shape: {kind: 'number'}},
    {name: 'customerName', optional: false, shape: {kind: 'string'}},
    {name: 'active', optional: false, shape: {kind: 'boolean'}},
    {name: 'status', optional: false, shape: {kind: 'enum', options: ['new', 'paid', 'shipped']}},
    {name: 'tags', optional: false, shape: {kind: 'array', of: {kind: 'string'}}},
    {name: 'items', optional: false, shape: {kind: 'array', of: {kind: 'object', fields: [
      {name: 'sku', optional: false, shape: {kind: 'string'}},
      {name: 'qty', optional: false, shape: {kind: 'number'}},
    ]}}},
    {name: 'shipTo', optional: true, shape: {kind: 'object', fields: [
      {name: 'street', optional: false, shape: {kind: 'string'}},
      {name: 'city', optional: false, shape: {kind: 'string'}},
    ]}},
    {name: 'notes', optional: true, shape: {kind: 'string'}},
    {name: 'extra', optional: false, shape: {kind: 'record', of: {kind: 'json'}}},
  ]});
  expect(shapeOf({'orders/types': ORDERS}, 'orders/types', 'Priority')).toEqual({kind: 'enum', options: [1, 2, 3]});
  // an imported script not loaded yet: JSON for now
  expect(fieldOf(shapeOf({'orders/types': ORDERS}, 'orders/types', 'Order'), 'shipTo')?.shape).toEqual({kind: 'json'});
  expect(scriptTypeShape({'orders/types': ORDERS}, 'orders/types', 'Missing')).toBeNull();
});

test('a TypeScript enum is a choice of its values (strings, or numbers counting on), used directly or imported', () => {
  const common = `export enum Priority { Low = 'low', Normal = 'normal', High = 'high' }
export enum Level { One = 1, Two, Five = 5, Six }
export const enum Plain { A, B }`;
  const sources = {common, task: `import {Priority, Level} from '@myproject/scripts/common';
export interface Task { priority: Priority; level?: Level; urgent: Priority.High }`};
  expect(shapeOf(sources, 'common', 'Plain')).toEqual({kind: 'enum', options: [0, 1]});
  expect(shapeOf(sources, 'task', 'Task')).toEqual({kind: 'object', fields: [
    {name: 'priority', optional: false, shape: {kind: 'enum', options: ['low', 'normal', 'high']}},
    {name: 'level', optional: true, shape: {kind: 'enum', options: [1, 2, 5, 6]}},
    {name: 'urgent', optional: false, shape: {kind: 'enum', options: ['low', 'normal', 'high']}},
  ]});
});

test('a union of objects told apart by a literal field: one variant at a time; without such a field, JSON', () => {
  const code = `export type Discount =
  | { type: 'percent'; percent: number }
  | { type: 'fixed'; value: { amount: number } }
  | { type: 'coupon'; code: string; expiresAt?: string };
export type Loose = { a: string } | { b: number };`;
  const discount = shapeOf({d: code}, 'd', 'Discount');
  expect(discount).toEqual({kind: 'union', tag: 'type', variants: [
    {value: 'percent', fields: [{name: 'percent', optional: false, shape: {kind: 'number'}}]},
    {value: 'fixed', fields: [{name: 'value', optional: false, shape: {kind: 'object', fields: [{name: 'amount', optional: false, shape: {kind: 'number'}}]}}]},
    {value: 'coupon', fields: [{name: 'code', optional: false, shape: {kind: 'string'}}, {name: 'expiresAt', optional: true, shape: {kind: 'string'}}]},
  ]});
  expect(emptyOfShape(discount)).toEqual({type: 'percent', percent: 0});
  expect(unionValue(discount as Extract<TypeShape, {kind: 'union'}>, 'coupon')).toEqual({type: 'coupon', code: ''});
  expect(shapeOf({d: code}, 'd', 'Loose')).toEqual({kind: 'json'});
});

test('Record<string, T> and an index signature are keys and values; with other fields, the fields', () => {
  const code = `export interface NoteMap { [key: string]: string }
export interface Counts { readonly [sku: string]: { qty: number } }
export type Allocation = Record<string, number>;
export interface Mixed { name: string; [extra: string]: string }`;
  expect(shapeOf({c: code}, 'c', 'NoteMap')).toEqual({kind: 'record', of: {kind: 'string'}});
  expect(shapeOf({c: code}, 'c', 'Counts')).toEqual({kind: 'record', of: {kind: 'object', fields: [{name: 'qty', optional: false, shape: {kind: 'number'}}]}});
  expect(shapeOf({c: code}, 'c', 'Allocation')).toEqual({kind: 'record', of: {kind: 'number'}});
  expect(shapeOf({c: code}, 'c', 'Mixed')).toEqual({kind: 'object', fields: [{name: 'name', optional: false, shape: {kind: 'string'}}]});
  expect(emptyOfShape(shapeOf({c: code}, 'c', 'NoteMap'))).toEqual({});
});

test('a tuple is its positions; with an optional or rest element, JSON', () => {
  const code = `export type Size = [number, number, number];
export type Named = [width: number, label: string];
export type Open = [number, ...string[]];`;
  expect(shapeOf({c: code}, 'c', 'Size')).toEqual({kind: 'tuple', items: [{kind: 'number'}, {kind: 'number'}, {kind: 'number'}]});
  expect(shapeOf({c: code}, 'c', 'Named')).toEqual({kind: 'tuple', items: [{kind: 'number'}, {kind: 'string'}]});
  expect(emptyOfShape(shapeOf({c: code}, 'c', 'Size'))).toEqual([0, 0, 0]);
  expect(shapeOf({c: code}, 'c', 'Open')).toEqual({kind: 'json'});
});

test('Pick, Omit, Partial, Required and Readonly applied; generics with their arguments (and defaults)', () => {
  const code = `interface Customer { id: string; name: string; email?: string; tags: string[] }
export type Ref = Pick<Customer, 'id' | 'name'>;
export type NoTags = Omit<Customer, 'tags'>;
export type Draft = Partial<Omit<Customer, 'tags' | 'email'>>;
export type Full = Required<Readonly<Customer>>;
export interface Page<T, M = { total: number }> { items: T[]; meta: M; next?: string | null }
export type Customers = Page<Ref>;`;
  const s = {c: code};
  const field = (name: string, shape: TypeShape, optional = false) => ({name, optional, shape});
  expect(shapeOf(s, 'c', 'Ref')).toEqual({kind: 'object', fields: [field('id', {kind: 'string'}), field('name', {kind: 'string'})]});
  expect(shapeOf(s, 'c', 'NoTags')).toEqual({kind: 'object', fields: [field('id', {kind: 'string'}), field('name', {kind: 'string'}), field('email', {kind: 'string'}, true)]});
  expect(shapeOf(s, 'c', 'Draft')).toEqual({kind: 'object', fields: [field('id', {kind: 'string'}, true), field('name', {kind: 'string'}, true)]});
  expect(fieldOf(shapeOf(s, 'c', 'Full'), 'email')?.optional).toBe(false);
  expect(shapeOf(s, 'c', 'Customers')).toEqual({kind: 'object', fields: [
    field('items', {kind: 'array', of: {kind: 'object', fields: [field('id', {kind: 'string'}), field('name', {kind: 'string'})]}}),
    field('meta', {kind: 'object', fields: [field('total', {kind: 'number'})]}),
    field('next', {kind: 'string'}, true),
  ]});
});

test('members over several lines (a union one option per line) and what stays JSON: any, unknown, functions, intersections', () => {
  const code = `export interface Shipment {
  status:
    | 'packed'
    | 'sent';
  raw: any;
  extra: unknown;
  onDone: (ok: boolean) => void;
  both: { a: string } & { b: string };
}`;
  expect(shapeOf({c: code}, 'c', 'Shipment')).toEqual({kind: 'object', fields: [
    {name: 'status', optional: false, shape: {kind: 'enum', options: ['packed', 'sent']}},
    {name: 'raw', optional: false, shape: {kind: 'json'}},
    {name: 'extra', optional: false, shape: {kind: 'json'}},
    {name: 'onDone', optional: false, shape: {kind: 'json'}},
    {name: 'both', optional: false, shape: {kind: 'json'}},
  ]});
});

test('an empty value of a shape (required fields only), and the setting as path#Name', () => {
  const shape = shapeOf({'orders/types': ORDERS, 'shared/address': ADDRESS}, 'orders/types', 'Order');
  expect(emptyOfShape(shape)).toEqual({createdAt: '', id: 0, customerName: '', active: false, status: 'new', tags: [], items: [], extra: {}});
  expect(inputTypeRef('orders/types#Order')).toEqual({path: 'orders/types', name: 'Order'});
  expect(inputTypeRef('')).toBeNull();
});
