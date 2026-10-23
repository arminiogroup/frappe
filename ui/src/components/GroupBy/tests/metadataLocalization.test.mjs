import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const require = createRequire(resolve(root, "package.json"));
const { build } = require("esbuild");
const { parse, compileScript } = require("@vue/compiler-sfc");
const { createSSRApp } = require("vue");
const { renderToString } = require("vue/server-renderer");
const ui = resolve(root, "ui/src/components");
const host = {
  frappe: {
    _messages: {
      Name: "Nome",
      "Created On": "Creato il",
      "Last Modified": "Ultima modifica",
      "Modified By": "Modificato da",
      Owner: "Proprietario",
      "Created By": "Creato da",
      "Last Modified By": "Ultima modifica di",
      Tags: "Etichette",
      "Document Status": "Stato documento",
      Mask: "Maschera",
      "Mask:DocField": "Oscura",
      Oscura: "SECOND PASS MUST NOT RUN",
      "Status:Material Request": "Stato della richiesta",
      Status: "Stato",
      Issued: "Emesso",
      "Issued:Material Request": "Prelevato",
      "Issued:Override": "Opzione specifica",
      Group: "Raggruppa",
      "Grouped by {0}": "Raggruppato per {0}",
      Count: "Conteggio",
      Average: "Media",
      Min: "Minimo",
      Max: "Massimo",
      Sum: "Somma",
      "{0} of {1}": "{0} di {1}",
    },
  },
  jQuery: {},
};
host.window = host;
host.$ = host.jQuery;
const context = vm.createContext(host);
for (const file of ["format.js", "translate.js"])
  vm.runInContext(
    readFileSync(resolve(root, "frappe/public/js/frappe", file), "utf8"),
    context
  );
globalThis.document = { documentElement: { getAttribute: () => "light" } };
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.MutationObserver = class {
  observe() {}
};

async function load(entry, extra = "") {
  const bundled = await build({
    stdin: {
      contents: `export {default as component} from ${JSON.stringify(
        resolve(ui, entry)
      )};${extra}`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    external: ["vue", "vue/server-renderer"],
    define: { "import.meta.env.DEV": "false" },
    nodePaths: [resolve(root, "node_modules")],
    plugins: [
      {
        name: "metadata-producer-render",
        setup(builder) {
          builder.onResolve(
            { filter: /^frappe-ui(?:\/list)?$/ },
            ({ path }) => ({ path, namespace: "leaf" })
          );
          builder.onLoad({ filter: /.*/, namespace: "leaf" }, () => ({
            contents: `import {h,reactive} from 'vue';
    const simple=tag=>({props:['label','modelValue','options','text','tooltip'],setup(p,{slots,attrs,emit,expose}){expose({open(){}});return()=>h(tag,attrs,[p.label,slots.trigger?.({open:false,close(){}}),slots.default?.({close(){}})])}});
    const choice={props:['label','modelValue','options','placeholder'],emits:['update:selectedOption','update:modelValue'],setup(p,{emit,slots}){(globalThis.choices??=[]).push({props:p,emit});return()=>h('select',{'data-model':p.modelValue,placeholder:p.placeholder},[(p.options??[]).map(o=>h('option',{value:o.value},o.label)),slots.trigger?.()])}};
    const input={props:['modelValue'],setup(p){return()=>h('input',{value:p.modelValue})}};
    export const Button=simple('button'),Popover=simple('div'),Combobox=choice,Select=choice,Switch=simple('span'),TextInput=input,ScrollArea=simple('div'),Skeleton=simple('span');
    export const List=simple('table'),ListHeader=simple('thead'),ListHeaderCellSort=simple('th'),ListRow=simple('tr'),ListCell=simple('td');
    export const frappeRequest=async()=>({});export function createResource(options){return reactive({data:{docs:[globalThis.metaFixture]},fetched:true,loading:false,fetch(){},reload(){}});}`,
          }));
          builder.onResolve({ filter: /^vuedraggable$/ }, () => ({
            path: "drag",
            namespace: "drag",
          }));
          builder.onLoad({ filter: /.*/, namespace: "drag" }, () => ({
            contents: `import {h} from 'vue';export default {props:['modelValue'],setup(p,{slots}){return()=>h('div',(p.modelValue??[]).map((element,index)=>slots.item?.({element,index})))}}`,
          }));
          builder.onLoad({ filter: /\.vue$/ }, ({ path }) => {
            const { descriptor, errors } = parse(readFileSync(path, "utf8"), {
              filename: path,
            });
            assert.deepEqual(errors, []);
            const script = compileScript(descriptor, {
              id: path,
              inlineTemplate: true,
              fs: {
                fileExists: existsSync,
                readFile: (f) => readFileSync(f, "utf8"),
              },
            });
            return {
              contents: script.content,
              loader: "ts",
              resolveDir: dirname(path),
            };
          });
        },
      },
    ],
  });
  const output = { exports: {} };
  new Function("require", "module", "exports", bundled.outputFiles[0].text)(
    require,
    output,
    output.exports
  );
  return output.exports;
}
const exportsFor = (...items) =>
  items
    .map(
      ([names, path]) =>
        `export {${names}} from ${JSON.stringify(resolve(ui, path))};`
    )
    .join("");
const render = (component, props) =>
  renderToString(createSSRApp(component, props));
const metaFields = [
  {
    parent: "DocField",
    fieldname: "mask",
    fieldtype: "Check",
    label: "Mask",
    in_list_view: 1,
  },
  {
    parent: "Material Request",
    context: "Override",
    fieldname: "status",
    fieldtype: "Select",
    label: "Status",
    options: "Issued\nDraft",
    in_list_view: 1,
  },
  {
    parent: "Material Request",
    fieldname: "status_parent",
    fieldtype: "Select",
    label: "Status",
    options: "Issued\nDraft",
  },
  {
    parent: "DocField",
    fieldname: "amount",
    fieldtype: "Currency",
    label: "Mask",
    options: "currency",
    in_list_view: 1,
  },
  { fieldname: "plain", fieldtype: "Data", label: "Mask", in_list_view: 1 },
  {
    parent: "DocField",
    fieldname: "link",
    fieldtype: "Link",
    label: "Mask",
    options: "User",
  },
];
const helpers = await load(
  "GroupBy/GroupByTable.vue",
  exportsFor(
    ["getColumnOptions", "ColumnSettings/getColumnOptions.ts"],
    [
      "getDefaultColumns,foldSyntheticColumns",
      "ColumnSettings/getDefaultColumns.ts",
    ],
    ["serializeColumns,parseColumns", "ColumnSettings/columns.ts"],
    ["getSortOptions", "SortBy/getSortOptions.ts"],
    ["serializeOrderBy,parseOrderBy", "SortBy/orderBy.ts"],
    [
      "AGGREGATE_FUNCTIONS,getGroupByFields,getAggregateFields,findGroupByField,serializeGroupBy,parseGroupBy",
      "GroupBy/groupBy.ts",
    ]
  )
);

test("column producer localizes only metadata defaults, preserving declared labels and persisted column presentation", () => {
  globalThis.__ = host.__;
  const before = structuredClone(metaFields);
  const synthetic = [{ key: "_indicator", label: "Mask", type: "Status" }];
  const options = helpers.getColumnOptions(metaFields, synthetic);
  assert.equal(options.find((f) => f.fieldname === "mask").label, "Oscura");
  assert.equal(options.find((f) => f.fieldname === "plain").label, "Mask");
  assert.equal(options.find((f) => f.fieldname === "_indicator").label, "Mask");
  assert.equal(options.find((f) => f.fieldname === "name").label, "Nome");
  const defaults = helpers.getDefaultColumns(metaFields, "mask");
  assert.equal(defaults[0].label, "Oscura");
  assert.equal(
    defaults.find((f) => f.fieldname === "status").label,
    "Stato della richiesta"
  );
  assert.equal(helpers.getDefaultColumns([])[0].label, "Nome");
  assert.equal(
    helpers.foldSyntheticColumns(defaults, synthetic).at(-1).label,
    "Mask"
  );
  const stored = [
    { fieldname: "mask", label: "Mask", width: "120px" },
    { fieldname: "_indicator", label: "Custom business", width: "9rem" },
  ];
  const wire = helpers.serializeColumns(stored, metaFields, synthetic);
  assert.equal(wire[0].label, "Mask");
  assert.equal(wire[1].label, "Custom business");
  assert.deepEqual(helpers.parseColumns(wire), stored);
  assert.deepEqual(metaFields, before);
  delete globalThis.__;
});

test("sort producer translates metadata and builtin labels at use time while keeping supplied labels and order_by canonical", () => {
  globalThis.__ = host.__;
  const options = helpers.getSortOptions(metaFields);
  assert.equal(options.find((f) => f.fieldname === "mask").label, "Oscura");
  assert.equal(options.find((f) => f.fieldname === "plain").label, "Mask");
  assert.equal(options.find((f) => f.fieldname === "name").label, "Nome");
  const sorts = [
    { fieldname: "mask", direction: "desc" },
    { fieldname: "plain", direction: "asc" },
  ];
  assert.equal(helpers.serializeOrderBy(sorts), "mask desc, plain asc");
  assert.deepEqual(helpers.parseOrderBy("mask desc, plain asc"), sorts);
  delete globalThis.__;
  assert.equal(
    helpers.getSortOptions(metaFields).find((f) => f.fieldname === "mask")
      .label,
    "Mask"
  );
});

test("group producers localize metadata once and preserve options, supplied labels and grouping persistence", () => {
  globalThis.__ = host.__;
  const field = helpers
    .getGroupByFields(metaFields)
    .find((f) => f.fieldname === "status");
  assert.equal(field.label, "Stato della richiesta");
  assert.equal(field.parent, "Material Request");
  assert.equal(field.context, "Override");
  assert.equal(field.options, "Issued\nDraft");
  assert.equal(
    helpers.getGroupByFields(metaFields).find((f) => f.fieldname === "owner")
      .label,
    "Creato da"
  );
  assert.equal(
    helpers
      .getAggregateFields(metaFields, "sum")
      .find((f) => f.fieldname === "amount").label,
    "Oscura"
  );
  assert.equal(helpers.findGroupByField(metaFields, "plain").label, "Mask");
  const grouping = {
    fields: ["status", "plain"],
    aggregates: [{ function: "sum", fieldname: "amount" }],
    widths: { "sum:amount": "140px" },
    sort: [{ fieldname: "sum:amount", direction: "asc" }],
    showTotals: true,
  };
  assert.deepEqual(helpers.parseGroupBy(JSON.stringify(grouping)), grouping);
  assert.deepEqual(helpers.serializeGroupBy(grouping), {
    fields: ["status", "plain", { SUM: "amount", as: "_aggregate_0" }],
    group_by: "status, plain",
    order_by: "_aggregate_0 asc, status asc, plain asc",
  });
  delete globalThis.__;
});

test("actual column picker uses metadata labels while its saved and synthetic labels remain supplied", async () => {
  globalThis.__ = host.__;
  globalThis.metaFixture = { name: "Demo", fields: metaFields };
  globalThis.choices = [];
  const loaded = await load("ColumnSettings/ColumnSettings.vue");
  let chosen;
  const html = await render(loaded.component, {
    doctype: "Demo",
    modelValue: [{ fieldname: "plain", label: "Mask" }],
    synthetic: [{ key: "_indicator", label: "Mask" }],
    "onUpdate:modelValue": (v) => (chosen = v),
  });
  assert.match(html, />Oscura</);
  assert.match(html, /value="Mask"/);
  const picker = globalThis.choices.find((c) =>
    c.props.options?.some((f) => f.fieldname === "mask")
  );
  picker.emit(
    "update:selectedOption",
    picker.props.options.find((f) => f.fieldname === "mask")
  );
  assert.deepEqual(chosen, [
    { fieldname: "plain", label: "Mask" },
    { fieldname: "mask", label: "Oscura" },
  ]);
  delete globalThis.__;
});

test("actual sort label uses its metadata context without changing the stored sort rule", async () => {
  globalThis.__ = host.__;
  globalThis.metaFixture = { name: "Demo", fields: metaFields };
  const loaded = await load("SortBy/SortBy.vue");
  const model = [{ fieldname: "mask", direction: "desc" }];
  const before = structuredClone(model);
  assert.match(
    await render(loaded.component, { doctype: "Demo", modelValue: model }),
    />Oscura</
  );
  assert.deepEqual(model, before);
  delete globalThis.__;
});

test("actual grouping trigger, picker and aggregate header preserve producer labels without a second translation", async () => {
  globalThis.__ = host.__;
  globalThis.metaFixture = { name: "Demo", fields: metaFields };
  const loaded = await load("GroupBy/GroupBy.vue");
  const html = await render(loaded.component, {
    doctype: "Demo",
    modelValue: { fields: ["mask", "plain"], aggregates: [] },
  });
  assert.match(html, /Raggruppato per Oscura, Mask/);
  assert.match(html, />Oscura</);
  assert.doesNotMatch(html, /SECOND PASS|Maschera/);
  const table = await render(helpers.component, {
    doctype: "Demo",
    groupBy: {
      fields: ["plain"],
      aggregates: [{ function: "sum", fieldname: "amount" }],
    },
    rows: [{ plain: "Business value", _aggregate_0: 12 }],
  });
  assert.match(table, /Somma di Oscura/);
  assert.match(table, />Mask</);
  assert.doesNotMatch(table, /SECOND PASS|Maschera/);
  delete globalThis.__;
});

test("actual grouped Select cell uses metadata option context while row values, business text and query tokens remain canonical", async () => {
  globalThis.__ = host.__;
  globalThis.metaFixture = { name: "Demo", fields: metaFields };
  const rows = [
    {
      status: "Issued",
      status_parent: "Issued",
      plain: "Issued",
      link: "Issued",
    },
  ];
  const before = structuredClone(rows);
  const groupBy = {
    fields: ["status", "status_parent", "plain", "link"],
    aggregates: [],
  };
  const html = await render(helpers.component, {
    doctype: "Demo",
    groupBy,
    rows,
  });
  assert.match(html, />Opzione specifica</);
  assert.match(html, />Prelevato</);
  assert.equal((html.match(/>Issued</g) ?? []).length, 2);
  assert.deepEqual(rows, before);
  assert.deepEqual(helpers.serializeGroupBy(groupBy), {
    fields: ["status", "status_parent", "plain", "link"],
    group_by: "status, status_parent, plain, link",
    order_by: "status asc, status_parent asc, plain asc, link asc",
  });
  delete globalThis.__;
});

test("all five aggregate labels translate at use time while the public declaration and persisted functions stay canonical", async () => {
  globalThis.__ = host.__;
  globalThis.metaFixture = { name: "Demo", fields: metaFields };
  assert.deepEqual(helpers.AGGREGATE_FUNCTIONS, [
    { label: "Count", value: "count" },
    { label: "Sum", value: "sum" },
    { label: "Average", value: "avg" },
    { label: "Min", value: "min" },
    { label: "Max", value: "max" },
  ]);
  const loaded = await load("GroupBy/GroupBy.vue");
  const html = await render(loaded.component, {
    doctype: "Demo",
    modelValue: null,
  });
  for (const [fn, label] of [
    ["count", "Conteggio"],
    ["sum", "Somma"],
    ["avg", "Media"],
    ["min", "Minimo"],
    ["max", "Massimo"],
  ]) {
    assert.match(html, new RegExp(`value="${fn}">${label}<`));
    const aggregate =
      fn === "count" ? { function: fn } : { function: fn, fieldname: "amount" };
    const grouping = { fields: ["plain"], aggregates: [aggregate] };
    const before = structuredClone(grouping);
    const table = await render(helpers.component, {
      doctype: "Demo",
      groupBy: grouping,
      rows: [{ plain: "Business", _aggregate_0: 3 }],
    });
    assert.match(
      table,
      new RegExp(fn === "count" ? `>${label}<` : `${label} di Oscura`)
    );
    assert.deepEqual(grouping, before);
    assert.deepEqual(helpers.serializeGroupBy(grouping).fields[1], {
      [fn.toUpperCase()]: fn === "count" ? "name" : "amount",
      as: "_aggregate_0",
    });
  }
  delete globalThis.__;
});

test("a stale supplied aggregate keeps the existing empty function-label fallback without altering its model", async () => {
  globalThis.__ = host.__;
  globalThis.metaFixture = { name: "Demo", fields: metaFields };
  const grouping = {
    fields: [],
    aggregates: [{ function: "legacy", fieldname: "missing" }],
  };
  const before = structuredClone(grouping);
  const html = await render(helpers.component, {
    doctype: "Demo",
    groupBy: grouping,
    rows: [{ _aggregate_0: 3 }],
  });
  assert.match(html, /> di missing</);
  assert.doesNotMatch(html, /\{0\}|undefined/);
  assert.deepEqual(grouping, before);
  assert.deepEqual(
    helpers.parseGroupBy({ fields: ["plain"], aggregates: grouping.aggregates })
      .aggregates,
    []
  );
  delete globalThis.__;
});
