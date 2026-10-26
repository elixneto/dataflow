import type {Edge} from '@xyflow/react';
import type {EnvelopeData} from '@dataflow/core';
import type {ComponentNode} from '#editor/component-node';
import type {GroupNode} from '#editor/group-node';
import type {Flow} from '#data/flows';

/*
 * The showcase examples: two flows that use every component of the palette, each with a small child flow called by the
 * Workflow Invoker. They run as they are in the editor's Run (no database, secret or network): the components that read
 * from outside or need a connection are pinned with sample data (in Run for real the pins are ignored and they execute).
 * Only types are imported, so a script can run them through the engine as they are (data/flows.ts lists them).
 */

export const SHOWCASE_ORDERS_ID = 'showcase-orders';
export const SHOWCASE_REGISTER_ID = 'showcase-orders-register-customer';
export const SHOWCASE_PRICES_ID = 'showcase-prices';
export const SHOWCASE_APPROVE_ID = 'showcase-prices-approve-product';

// grid of the layout: a card is w-72 (288 px) wide
const COLUMN = 380;
const ROW = 280;
// the tallest cards (a Mapper with several fields, a pinned node) are about 240 px
const CARD = {width: 288, height: 240};

type Options = {pinned?: Record<string, EnvelopeData[]>; outputKey?: string; override?: boolean};

/** a component at column `col` and row `row` of the grid */
function node(id: string, type: string, label: string, col: number, row: number, config: Record<string, unknown> = {}, options: Options = {}): ComponentNode {
  return {id, type: 'component', position: {x: col * COLUMN, y: row * ROW}, data: {type, label, config, ...options}};
}

function connect(source: string, target: string, output = 'out-0', input = 'in-0'): Edge {
  return {id: `e-${source}-${output}-${target}-${input}`, source, sourceHandle: output, target, targetHandle: input};
}

/** colored rectangle behind the given nodes */
function group(id: string, title: string, color: string, members: ComponentNode[]): GroupNode {
  const pad = 40;
  const xs = members.map(m => m.position.x);
  const ys = members.map(m => m.position.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad - 24;
  return {
    id, type: 'group', zIndex: -1, position: {x, y},
    width: Math.max(...xs) + CARD.width + pad - x, height: Math.max(...ys) + CARD.height + pad - y,
    data: {title, color},
  };
}

const flow = (id: string, name: string, description: string, parameters: Flow['parameters'], nodes: Flow['nodes'], edges: Edge[]): Flow =>
  ({id, name, description, status: 'draft', version: 0, updatedAt: new Date().toISOString(), parameters, nodes, edges});

// ---------- 1. Daily order sync: ERP → CRM and warehouse ----------

const ORDER_LINES = [
  [1001, 'C10', 'SKU-100', 2, 49.9, 'OPEN'],
  [1001, 'C10', 'SKU-200', 1, 129, 'OPEN'],
  [1002, 'C20', 'SKU-300', 5, 9.5, 'OPEN'],
  [1003, 'C30', 'SKU-100', 1, 49.9, 'CANCELLED'],
  [1004, 'C10', 'SKU-400', 3, 19.9, 'OPEN'],
  [1004, 'C10', 'SKU-400', 3, 19.9, 'OPEN'],
  [1005, 'C99', 'SKU-200', 2, 129, 'OPEN'],
  [1006, 'C20', 'SKU-100', 4, 49.9, 'OPEN'],
  [1006, 'C20', 'SKU-500', 1, 349, 'OPEN'],
  [1007, 'C40', 'SKU-300', 10, 9.5, 'OPEN'],
] as const;

const orderLines = (): EnvelopeData[] => ORDER_LINES.map(([orderId, customerCode, sku, qty, unitPrice, status], i) => ({
  orderId, customerCode, sku, qty, unitPrice, status, createdAt: `2026-10-25T${String(8 + i).padStart(2, '0')}:00:00.000Z`,
}));

const PRODUCTS: EnvelopeData[] = [
  {_id: '671a0c0e8f1b2a0001a1b100', sku: 'SKU-100', name: 'Desk lamp', warehouse: 'EAST', bin: 'A-01', weightKg: 1.2},
  {_id: '671a0c0e8f1b2a0001a1b200', sku: 'SKU-200', name: 'Office chair', warehouse: 'EAST', bin: 'C-07', weightKg: 14},
  {_id: '671a0c0e8f1b2a0001a1b300', sku: 'SKU-300', name: 'Notebook pack', warehouse: 'WEST', bin: 'B-12', weightKg: 0.8},
  {_id: '671a0c0e8f1b2a0001a1b400', sku: 'SKU-400', name: 'Cable kit', warehouse: 'WEST', bin: 'B-03', weightKg: 0.5},
  {_id: '671a0c0e8f1b2a0001a1b500', sku: 'SKU-500', name: 'Standing desk', warehouse: 'EAST', bin: 'D-01', weightKg: 32},
];

const BUILD_ORDERS = `type Line = {orderId: number; sku: string; qty: number; lineTotal: number; discountPct: number; crmId: string; customerName: string}

async function process($input: {lines: Line[]}): Promise<Data[]> {
  const orders = new Map<number, Line[]>()
  for (const line of $input.lines) orders.set(line.orderId, [...(orders.get(line.orderId) ?? []), line])
  log(\`\${$input.lines.length} line(s) in \${orders.size} order(s)\`)
  return [...orders.entries()].map(([orderId, lines]) => ({
    orderId,
    crmId: lines[0].crmId,
    customerName: lines[0].customerName,
    total: round(lines.reduce((sum, l) => sum + l.lineTotal * (1 - l.discountPct / 100), 0)),
    lines: lines.map(l => ({orderId, sku: l.sku, qty: l.qty})),
    syncedAt: $WORKFLOW_CURRENT_RUN.startedAt,
  }))
}

function round(value: number) {
  return Math.round(value * 100) / 100
}
`;

function ordersShowcase(): Flow {
  const unknownLine = {...orderLines()[6], customer: null, lineTotal: 258, crmId: null, customerName: null, tier: null};
  const nodes = {
    start: node('start', 'start', 'Start', 0, 1.5),
    copy: node('copy', 'copy', 'Fan out', 1, 1.5, {outputCount: 4}),
    clean: node('clean', 'mongodb-delete', 'Clear picked queue', 2, -1.9, {
      connection: 'WAREHOUSE_MONGO', database: 'warehouse', collection: 'pickQueue',
      filter: '{\n  status: "PICKED",\n  pickedAt: { $lt: ISODate($PARAMETERS.since) }\n}',
    }, {outputKey: 'cleanup', pinned: {'out-0': [{cleanup: {deleted: 42}}]}}),
    cleaned: node('cleaned', 'log', 'Queue cleared', 3, -1.9, {level: 'info', message: '`Pick queue: ${$cleanup.deleted} old document(s) removed`'}),
    erp: node('erp', 'sqlserver', 'ERP order lines', 2, 1.5, {
      connection: 'ERP_SQL',
      sql: 'SELECT o.id AS orderId, o.customerCode, l.sku, l.qty, l.unitPrice, o.status, o.createdAt\nFROM Orders o\nJOIN OrderLines l ON l.orderId = o.id\nWHERE o.createdAt >= @since\nORDER BY o.id',
      parameters: [{name: 'since', value: '$PARAMETERS.since', expression: true}],
      timeoutS: 120,
    }, {pinned: {'out-0': orderLines()}}),
    customers: node('customers', 'datagrid', 'Customer mapping', 2, 3, {
      columns: [{name: 'customerCode', type: 'text'}, {name: 'crmId', type: 'text'}, {name: 'name', type: 'text'}, {name: 'tier', type: 'text'}],
      rows: [['C10', 'CRM-0010', 'Alpha Inc.', 'VIP'], ['C20', 'CRM-0020', 'Beta LLC', 'Standard'], ['C30', 'CRM-0030', 'Gamma Co.', 'Standard'], ['C40', 'CRM-0040', 'Delta Ltd.', 'VIP']],
    }),
    catalog: node('catalog', 'mongodb-pipeline', 'Product catalog', 2, 4, {
      connection: 'WAREHOUSE_MONGO', database: 'warehouse', collection: 'products',
      pipeline: '[\n  { $match: { active: true } },\n  { $project: { sku: 1, name: 1, warehouse: 1, bin: 1, weightKg: 1 } },\n]',
      timeoutS: 60,
    }, {pinned: {'out-0': PRODUCTS}}),
    unique: node('unique', 'distinct', 'One per order line', 3, 1.5, {keys: ['$orderId', '$sku']}),
    duplicate: node('duplicate', 'log', 'Duplicate line', 4, -0.9, {level: 'warn', message: '`Duplicate line ignored: order ${$orderId}, ${$sku}`'}),
    open: node('open', 'filter', 'Not cancelled', 4, 1.5, {condition: '$status !== "CANCELLED"'}),
    customer: node('customer', 'lookup', 'Find customer', 5, 1.5, {keys: [{main: '$customerCode', lookup: '$customerCode'}], ifNotFound: 'null'}, {outputKey: 'customer'}),
    line: node('line', 'mapper', 'Order line', 6, 1.5, {fields: [
      {target: 'lineTotal', value: 'Math.round($qty * $unitPrice * 100) / 100', expression: true},
      {target: 'crmId', value: '$customer?.crmId ?? null', expression: true},
      {target: 'customerName', value: '$customer?.name ?? null', expression: true},
      {target: 'tier', value: '$customer?.tier ?? null', expression: true},
    ]}),
    tier: node('tier', 'router', 'By customer tier', 7, 1.5, {cases: [
      {label: 'VIP', condition: '$tier === "VIP"'},
      {label: 'Standard', condition: '$crmId !== null'},
    ]}),
    vip: node('vip', 'mapper', 'VIP discount', 8, 0.5, {fields: [{target: 'discountPct', value: '10', expression: true}]}),
    standard: node('standard', 'mapper', 'List price', 8, 1.5, {fields: [{target: 'discountPct', value: '0', expression: true}]}),
    crm: node('crm', 'http-request', 'Search the CRM', 8, 2.5, {
      method: 'GET', url: {value: '"https://crm.example.com/api/customers/" + $customerCode', expression: true},
      headers: [{name: 'Authorization', value: "'Bearer ' + $SECRETS.CRM_TOKEN", expression: true}],
      failOnError: false, timeoutS: 30, concurrency: 4,
    }, {outputKey: 'crmSearch', pinned: {'out-0': [{...unknownLine, crmSearch: {status: 404, headers: {'content-type': 'application/json'}, body: {error: 'Customer not found'}}}]}}),
    register: node('register', 'workflow', 'Register customer', 9, 2.5, {
      workflowId: SHOWCASE_REGISTER_ID, sendEnvelope: true,
      parameters: [{name: 'tier', value: 'Standard', expression: false}],
    }),
    union: node('union', 'union', 'All lines', 10, 1.5, {inputCount: 3}),
    batch: node('batch', 'aggregate', 'All lines together', 11, 1.5, {size: 1000, field: 'lines'}),
    orders: node('orders', 'typescript', 'Build orders', 12, 1.5, {code: BUILD_ORDERS}, {override: true}),
    sort: node('sort', 'sort', 'Biggest first', 13, 1.5, {keys: [{value: '$total', direction: 'desc'}]}),
    copy2: node('copy2', 'copy', 'CRM, warehouse, report', 14, 1.5, {outputCount: 3}),
    upsert: node('upsert', 'mongodb-upsert', 'Orders in the CRM', 15, 0.5, {
      connection: 'CRM_MONGO', database: 'crm', collection: 'orders',
      filter: [{field: 'orderId', value: '$orderId', expression: true}], source: 'data', batchSize: 500,
    }, {outputKey: 'crmWrite', pinned: {'out-0': [1006, 1005, 1001, 1007, 1004, 1002].map((orderId, i) =>
      ({orderId, crmWrite: {matched: i % 2, upsertedId: i % 2 ? null : `671b2f0a9c3e4d0001c0f${orderId}`}}))}}),
    split: node('split', 'split', 'One per line', 15, 3.5, {list: '$lines'}),
    product: node('product', 'lookup', 'Find product', 16, 3.5, {keys: [{main: '$sku', lookup: '$sku'}], ifNotFound: 'null'}, {outputKey: 'product'}),
    pick: node('pick', 'mapper', 'Pick line', 17, 3.5, {fields: [
      {target: 'orderId', value: '$orderId', expression: true},
      {target: 'sku', value: '$sku', expression: true},
      {target: 'qty', value: '$qty', expression: true},
      {target: 'warehouse', value: '$product?.warehouse ?? "MAIN"', expression: true},
      {target: 'bin', value: '$product?.bin ?? null', expression: true},
      {target: 'weightKg', value: '$qty * ($product?.weightKg ?? 0)', expression: true},
    ]}, {override: true}),
    picks: node('picks', 'aggregate', 'Batches of 50', 18, 3.5, {size: 50, field: 'picks'}),
    warehouse: node('warehouse', 'http-request', 'Send to warehouse', 19, 3.5, {
      method: 'POST', url: {value: 'https://warehouse.example.com/api/pick-batches', expression: false},
      headers: [{name: 'Authorization', value: "'Bearer ' + $SECRETS.WAREHOUSE_TOKEN", expression: true}],
      body: {value: '({source: "erp-sync", count: $picks.length, picks: $picks})', expression: true},
      failOnError: true, timeoutS: 30, concurrency: 1,
    }, {outputKey: 'warehouseAnswer'}),
    top: node('top', 'limit', 'Top 3', 15, 1.5, {mode: 'top', count: 3}),
    report: node('report', 'log', 'Top orders', 16, 1.5, {level: 'info', message: '`#${$orderId} ${$customerName}: $ ${$total.toFixed(2)}`'}),
    end: node('end', 'end', 'End', 20, -0.5),
  };
  const n = nodes;
  return flow(SHOWCASE_ORDERS_ID, 'Showcase: daily order sync',
    'ERP order lines are deduplicated, enriched with the customer, priced by tier (unknown customers are searched and registered by a child flow), grouped into orders and written to the CRM, sent to the warehouse in pick batches and reported.',
    [{name: 'since', type: 'text', default: '2026-10-25'}],
    [
      group('g-extract', 'Extract', '#3b82f6', [n.clean, n.erp, n.customers, n.catalog]),
      group('g-clean', 'Clean', '#64748b', [n.cleaned, n.unique, n.open, n.duplicate]),
      group('g-enrich', 'Enrich and route', '#22c55e', [n.customer, n.line, n.tier, n.vip, n.standard, n.crm, n.register, n.union]),
      group('g-orders', 'Build orders', '#a855f7', [n.batch, n.orders, n.sort]),
      group('g-load', 'Load', '#f59e0b', [n.upsert, n.split, n.product, n.pick, n.picks, n.warehouse, n.top, n.report]),
      ...Object.values(nodes),
    ],
    [
      connect('start', 'copy'),
      connect('copy', 'clean', 'out-0'), connect('copy', 'erp', 'out-1'), connect('copy', 'customers', 'out-2'), connect('copy', 'catalog', 'out-3'),
      connect('clean', 'cleaned'), connect('cleaned', 'end'),
      connect('erp', 'unique'), connect('unique', 'open', 'out-0'), connect('unique', 'duplicate', 'out-1'), connect('duplicate', 'end'),
      connect('open', 'customer', 'out-0', 'in-0'), connect('customers', 'customer', 'out-0', 'in-1'),
      connect('customer', 'line'), connect('line', 'tier'),
      connect('tier', 'vip', 'out-0'), connect('tier', 'standard', 'out-1'), connect('tier', 'crm', 'out-2'), connect('crm', 'register'),
      connect('vip', 'union', 'out-0', 'in-0'), connect('standard', 'union', 'out-0', 'in-1'), connect('register', 'union', 'out-0', 'in-2'),
      connect('union', 'batch'), connect('batch', 'orders'), connect('orders', 'sort'), connect('sort', 'copy2'),
      connect('copy2', 'upsert', 'out-0'), connect('upsert', 'end'),
      connect('copy2', 'split', 'out-2'), connect('split', 'product', 'out-0', 'in-0'), connect('catalog', 'product', 'out-0', 'in-1'),
      connect('product', 'pick'), connect('pick', 'picks'), connect('picks', 'warehouse'), connect('warehouse', 'end'),
      connect('copy2', 'top', 'out-1'), connect('top', 'report'), connect('report', 'end'),
    ],
  );
}

function registerCustomer(): Flow {
  return flow(SHOWCASE_REGISTER_ID, 'Showcase: register customer',
    'Called by "Showcase: daily order sync" for each line of an unknown customer: gives it a new CRM id and the tier parameter.',
    [{name: 'tier', type: 'text', default: 'Standard'}],
    [
      node('start', 'start', 'Start', 0, 1, {acceptsInput: true, testInput: JSON.stringify({orderId: 1005, customerCode: 'C99', sku: 'SKU-200'}, null, 2)}),
      node('new', 'mapper', 'New customer', 1, 1, {fields: [
        {target: 'crmId', value: '"NEW-" + $customerCode', expression: true},
        {target: 'customerName', value: '"Customer " + $customerCode', expression: true},
        {target: 'tier', value: '$PARAMETERS.tier', expression: true},
        {target: 'discountPct', value: '0', expression: true},
      ]}),
      node('end', 'end', 'End', 2, 1),
    ],
    [connect('start', 'new'), connect('new', 'end')],
  );
}

// ---------- 2. Supplier price sync: price list → catalog and storefront ----------

const PRICE_LIST = [
  ['ACM-001', 'Steel water bottle', 'kitchen', 8.4, true],
  ['ACM-002', 'Bamboo cutting board', 'kitchen', 11.2, true],
  ['ACM-003', 'LED desk lamp', 'office', 21.5, true],
  ['ACM-004', 'Ergonomic mouse', 'office', 17.8, true],
  ['ACM-002', 'Bamboo cutting board', 'kitchen', 11.2, true],
  ['ACM-005', 'Yoga mat', 'sports', 14.9, true],
  ['ACM-006', 'Old fan', 'home', 19, false],
  ['ACM-007', 'Trail backpack', 'sports', 36, true],
  ['ACM-008', 'Linen curtains', 'home', 0, true],
] as const;

const CATALOG: EnvelopeData[] = [
  {_id: '671a0d118f1b2a0001b2c001', sku: 'ACM-001', price: 12.99, publishedAt: '2026-09-01T10:00:00.000Z'},
  {_id: '671a0d118f1b2a0001b2c002', sku: 'ACM-002', price: 14.99, publishedAt: '2026-09-01T10:00:00.000Z'},
  {_id: '671a0d118f1b2a0001b2c003', sku: 'ACM-003', price: 25.99, publishedAt: '2026-09-15T10:00:00.000Z'},
  {_id: '671a0d118f1b2a0001b2c004', sku: 'ACM-004', price: 26.99, publishedAt: '2026-09-15T10:00:00.000Z'},
  {_id: '671a0d118f1b2a0001b2c005', sku: 'ACM-005', price: 21.99, publishedAt: '2026-10-01T10:00:00.000Z'},
  {_id: '671a0d118f1b2a0001b2c006', sku: 'ACM-006', price: 29.99, publishedAt: '2026-08-01T10:00:00.000Z'},
];

const STOCK: EnvelopeData[] = [
  {sku: 'ACM-001', onHand: 120, reserved: 20},
  {sku: 'ACM-002', onHand: 40, reserved: 38},
  {sku: 'ACM-003', onHand: 15, reserved: 0},
  {sku: 'ACM-004', onHand: 0, reserved: 0},
  {sku: 'ACM-005', onHand: 64, reserved: 4},
  {sku: 'ACM-007', onHand: 9, reserved: 1},
];

const PRICE_RULES = `type Product = {
  sku: string
  cost: number
  current: {price: number} | null
  margin: {marginPct: number} | null
  stock: {onHand: number; reserved: number} | null
}

async function process($input: Product): Promise<Data> {
  const marginPct = $input.margin?.marginPct ?? 30
  const price = charm($input.cost * (1 + marginPct / 100))
  const old = $input.current?.price
  return {
    price,
    changePct: old ? Math.round((price - old) / old * 1000) / 10 : 0,
    available: Math.max(0, ($input.stock?.onHand ?? 0) - ($input.stock?.reserved ?? 0)),
  }
}

/** a price that ends in .99: 23.40 → 23.99 */
function charm(price: number) {
  return Math.floor(price) + 0.99
}
`;

function pricesShowcase(): Flow {
  const items = PRICE_LIST.map(([sku, name, category, cost, active]) => ({sku, name, category, cost, active}));
  const nodes = {
    start: node('start', 'start', 'Start', 0, 1.5),
    copy: node('copy', 'copy', 'Fan out', 1, 1.5, {outputCount: 4}),
    supplier: node('supplier', 'http-request', 'Supplier price list', 2, 0, {
      method: 'GET', url: {value: '"https://supplier.example.com/api/" + $PARAMETERS.supplier + "/price-list"', expression: true},
      query: [{name: 'currency', value: 'USD', expression: false}],
      headers: [{name: 'X-Api-Key', value: '$SECRETS.SUPPLIER_KEY', expression: true}],
      failOnError: true, timeoutS: 60, concurrency: 1,
    }, {outputKey: 'priceList', pinned: {'out-0': [{priceList: {status: 200, headers: {'content-type': 'application/json'}, body: {supplier: 'acme', currency: 'USD', items}}}]}}),
    catalog: node('catalog', 'mongodb-pipeline', 'Published catalog', 2, 1.5, {
      connection: 'SHOP_MONGO', database: 'shop', collection: 'products',
      pipeline: '[\n  { $match: { supplier: $PARAMETERS.supplier } },\n  { $project: { sku: 1, price: 1, publishedAt: 1 } },\n]',
      timeoutS: 60,
    }, {pinned: {'out-0': CATALOG}}),
    margins: node('margins', 'datagrid', 'Category margins', 2, 3, {
      columns: [{name: 'category', type: 'text'}, {name: 'marginPct', type: 'number'}],
      rows: [['kitchen', '45'], ['office', '35'], ['sports', '50'], ['home', '40']],
    }),
    stock: node('stock', 'sqlserver', 'Stock in the ERP', 2, 4.5, {
      connection: 'ERP_SQL',
      sql: 'SELECT sku, onHand, reserved\nFROM Stock\nWHERE supplier = @supplier',
      parameters: [{name: 'supplier', value: '$PARAMETERS.supplier', expression: true}],
      timeoutS: 120,
    }, {pinned: {'out-0': STOCK}}),
    split: node('split', 'split', 'One per item', 3, 0, {list: '$priceList.body.items'}),
    unique: node('unique', 'distinct', 'One per SKU', 4, 0, {keys: ['$sku']}),
    duplicate: node('duplicate', 'log', 'Repeated SKU', 5, -1.9, {level: 'warn', message: '`${$sku} came more than once in the price list`'}),
    sellable: node('sellable', 'filter', 'Active with a cost', 5, 0, {condition: '$active && $cost > 0'}),
    remove: node('remove', 'mongodb-delete', 'Remove from the shop', 6, -0.9, {
      connection: 'SHOP_MONGO', database: 'shop', collection: 'products', filter: '{\n  sku: $sku\n}',
    }, {outputKey: 'removed', pinned: {'out-0': [{sku: 'ACM-006', removed: {deleted: 1}}, {sku: 'ACM-008', removed: {deleted: 0}}]}}),
    current: node('current', 'lookup', 'Current listing', 6, 1.5, {keys: [{main: '$sku', lookup: '$sku'}], ifNotFound: 'null'}, {outputKey: 'current'}),
    margin: node('margin', 'lookup', 'Margin', 7, 3, {keys: [{main: '$category', lookup: '$category'}], ifNotFound: 'null'}, {outputKey: 'margin'}),
    onHand: node('onHand', 'lookup', 'Stock', 8, 4.5, {keys: [{main: '$sku', lookup: '$sku'}], ifNotFound: 'null'}, {outputKey: 'stock'}),
    rules: node('rules', 'typescript', 'Price rules', 9, 3, {code: PRICE_RULES}, {outputKey: 'pricing'}),
    listing: node('listing', 'mapper', 'Listing', 10, 3, {fields: [
      {target: 'price', value: '$pricing.price', expression: true},
      {target: 'changePct', value: '$pricing.changePct', expression: true},
      {target: 'available', value: '$pricing.available', expression: true},
      {target: 'isNew', value: '$current === null', expression: true},
    ]}),
    change: node('change', 'router', 'Price change', 11, 3, {cases: [
      {label: 'New', condition: '$isNew'},
      {label: 'Big', condition: 'Math.abs($changePct) >= 10'},
      {label: 'Small', condition: '$changePct !== 0'},
    ]}),
    approve: node('approve', 'workflow', 'Approve new product', 12, 1.75, {
      workflowId: SHOWCASE_APPROVE_ID, sendEnvelope: true, onError: 'divert',
      parameters: [{name: 'maxPrice', value: '$PARAMETERS.autoApproveUpTo', expression: true}],
    }),
    failed: node('failed', 'log', 'Approval failed', 13, 1.25, {level: 'error', message: '`Could not approve ${$sku}: ${$errors[0].message}`'}),
    big: node('big', 'log', 'Big change', 12, 3, {level: 'warn', message: '`${$sku}: ${$current.price} → ${$price} (${$changePct}%)`'}),
    small: node('small', 'mapper', 'Small change', 12, 4.25, {fields: [{target: 'changeType', value: 'SMALL', expression: false}]}),
    union: node('union', 'union', 'To publish', 13, 3, {inputCount: 3}),
    sort: node('sort', 'sort', 'Biggest change first', 14, 3, {keys: [{value: 'Math.abs($changePct)', direction: 'desc'}, {value: '$sku', direction: 'asc'}]}),
    copy2: node('copy2', 'copy', 'Catalog, shop, report', 15, 3, {outputCount: 3}),
    upsert: node('upsert', 'mongodb-upsert', 'Save to the catalog', 16, 2, {
      connection: 'SHOP_MONGO', database: 'shop', collection: 'products',
      filter: [{field: 'sku', value: '$sku', expression: true}],
      source: 'expression',
      document: {value: '({sku: $sku, name: $name, category: $category, price: $price, available: $available, approval: typeof $approval === "undefined" ? "AUTO" : $approval, updatedAt: new Date()})', expression: true},
      batchSize: 500,
    }, {outputKey: 'saved', pinned: {'out-0': ['ACM-003', 'ACM-002', 'ACM-004', 'ACM-005', 'ACM-007'].map(sku =>
      ({sku, saved: sku === 'ACM-007' ? {matched: 0, upsertedId: '671b30c29c3e4d0001c1a007'} : {matched: 1, upsertedId: null}}))}}),
    batches: node('batches', 'aggregate', 'Batches of 100', 16, 4, {size: 100, field: 'products'}),
    publish: node('publish', 'http-request', 'Publish to the shop', 17, 4, {
      method: 'POST', url: {value: 'https://shop.example.com/api/products/bulk', expression: false},
      headers: [{name: 'Authorization', value: "'Bearer ' + $SECRETS.SHOP_TOKEN", expression: true}],
      body: {value: '({products: $products.map(p => ({sku: p.sku, price: p.price, available: p.available}))})', expression: true},
      failOnError: true, timeoutS: 60, concurrency: 2,
    }, {outputKey: 'shopAnswer'}),
    published: node('published', 'log', 'Published', 18, 4, {level: 'info', message: '`${$products.length} product(s) sent to the shop`'}),
    top: node('top', 'limit', 'Top 5', 16, 3, {mode: 'top', count: 5}),
    report: node('report', 'mapper', 'Change report', 17, 3, {fields: [
      {target: 'sku', value: '$sku', expression: true},
      {target: 'from', value: '$current?.price ?? null', expression: true},
      {target: 'to', value: '$price', expression: true},
      {target: 'changePct', value: '$changePct', expression: true},
    ]}, {override: true}),
    end: node('end', 'end', 'End', 19, 2.5),
  };
  const n = nodes;
  return flow(SHOWCASE_PRICES_ID, 'Showcase: supplier price sync',
    "A supplier's price list is split, deduplicated and filtered (discontinued items leave the shop), joined to the current listing, the category margin and the ERP stock, repriced in TypeScript, routed by the size of the change (new products are approved by a child flow) and saved, published in batches and reported.",
    [{name: 'supplier', type: 'text', default: 'acme'}, {name: 'autoApproveUpTo', type: 'number', default: '30'}],
    [
      group('g-extract', 'Extract', '#3b82f6', [n.supplier, n.catalog, n.margins, n.stock]),
      group('g-clean', 'Clean', '#64748b', [n.split, n.unique, n.duplicate, n.sellable, n.remove]),
      group('g-price', 'Enrich and price', '#22c55e', [n.current, n.margin, n.onHand, n.rules, n.listing]),
      group('g-route', 'Route', '#a855f7', [n.change, n.approve, n.failed, n.big, n.small, n.union, n.sort]),
      group('g-load', 'Load', '#f59e0b', [n.upsert, n.batches, n.publish, n.published, n.top, n.report]),
      ...Object.values(nodes),
    ],
    [
      connect('start', 'copy'),
      connect('copy', 'supplier', 'out-0'), connect('copy', 'catalog', 'out-1'), connect('copy', 'margins', 'out-2'), connect('copy', 'stock', 'out-3'),
      connect('supplier', 'split'), connect('split', 'unique'),
      connect('unique', 'sellable', 'out-0'), connect('unique', 'duplicate', 'out-1'), connect('duplicate', 'end'),
      connect('sellable', 'current', 'out-0', 'in-0'), connect('sellable', 'remove', 'out-1'), connect('remove', 'end'),
      connect('catalog', 'current', 'out-0', 'in-1'),
      connect('current', 'margin', 'out-0', 'in-0'), connect('margins', 'margin', 'out-0', 'in-1'),
      connect('margin', 'onHand', 'out-0', 'in-0'), connect('stock', 'onHand', 'out-0', 'in-1'),
      connect('onHand', 'rules'), connect('rules', 'listing'), connect('listing', 'change'),
      connect('change', 'approve', 'out-0'), connect('change', 'big', 'out-1'), connect('change', 'small', 'out-2'), connect('small', 'union', 'out-0', 'in-2'),
      connect('approve', 'union', 'out-0', 'in-0'), connect('approve', 'failed', 'error'), connect('failed', 'end'),
      connect('big', 'union', 'out-0', 'in-1'),
      connect('union', 'sort'), connect('sort', 'copy2'),
      connect('copy2', 'upsert', 'out-0'), connect('upsert', 'end'),
      connect('copy2', 'batches', 'out-2'), connect('batches', 'publish'), connect('publish', 'published'), connect('published', 'end'),
      connect('copy2', 'top', 'out-1'), connect('top', 'report'), connect('report', 'end'),
    ],
  );
}

function approveProduct(): Flow {
  return flow(SHOWCASE_APPROVE_ID, 'Showcase: approve new product',
    'Called by "Showcase: supplier price sync" for each new product: approves it up to the maxPrice parameter, otherwise holds it for review.',
    [{name: 'maxPrice', type: 'number', default: '30', required: true}],
    [
      node('start', 'start', 'Start', 0, 1, {acceptsInput: true, testInput: JSON.stringify({sku: 'ACM-007', price: 54.99, available: 8}, null, 2)}),
      node('cheap', 'filter', 'Up to maxPrice', 1, 1, {condition: '$price <= $PARAMETERS.maxPrice'}),
      node('auto', 'mapper', 'Approved', 2, 0.5, {fields: [{target: 'approval', value: 'AUTO', expression: false}]}),
      node('review', 'mapper', 'Needs review', 2, 1.5, {fields: [
        {target: 'approval', value: 'REVIEW', expression: false},
        {target: 'available', value: '0', expression: true},
      ]}),
      node('end', 'end', 'End', 3, 1),
    ],
    [connect('start', 'cheap'), connect('cheap', 'auto', 'out-0'), connect('cheap', 'review', 'out-1'), connect('auto', 'end'), connect('review', 'end')],
  );
}

/** The showcase flows (their folder is "Showcase"). */
export const showcaseFlows = (): Flow[] => [ordersShowcase(), registerCustomer(), pricesShowcase(), approveProduct()];
