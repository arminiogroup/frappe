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
globalThis.frappe = host.frappe;
Object.assign(host.frappe._messages, {
  Open: "Aperto",
  "Open:Communication.email_status": "Normale",
  "Open:Override": "Esplicito",
  Failed: "Non riuscito",
  "Failed:Select Option: agreement_status": "Non rispettato",
});
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
    export const Checkbox=simple('span'),Tooltip=simple('span');export const debounce=fn=>fn;export const Button=simple('button'),Popover=simple('div'),Combobox=choice,Select=choice,MultiSelect=choice,Switch=simple('span'),TextInput=input,ScrollArea=simple('div'),Skeleton=simple('span');
    export const List=simple('table'),ListHeader=simple('thead'),ListHeaderCellSort=simple('th'),ListRow=simple('tr'),ListCell=simple('td');
    export const frappeRequest=async()=>({});export function createResource(options){return reactive({data:{docs:[globalThis.metaFixture]},fetched:true,loading:false,fetch(){},reload(){}});}`,
          }));
          builder.onResolve(
            {
              filter:
                /\/(LinkField|NumberField|DateField|DatetimeField|DurationField)\.vue$/,
            },
            ({ path }) => ({ path, namespace: "field" })
          );
          builder.onLoad({ filter: /.*/, namespace: "field" }, () => ({
            contents: `import {h} from 'vue';export default {props:['field'],setup(p){return()=>h('input',{placeholder:p.field.placeholder})}}`,
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

const data = JSON.parse(
  readFileSync(
    resolve(root, "frappe/core/doctype/communication/communication.json"),
    "utf8"
  )
);
const fields = ["status", "email_status"].map((name) => ({
  ...data.fields.find((f) => f.fieldname === name),
  parent: data.name,
  in_standard_filter: 1,
}));
const producer = await load(
  "Fields/SelectField.vue",
  exportsFor(
    ["buildLayoutFromMeta", "FormLayout/buildLayoutFromMeta.ts"],
    ["getFilterableFields,pickFilterFields", "Filter/getFilterableFields.ts"],
    ["getQuickFilterFields", "QuickFilter/getQuickFilterFields.ts"],
    ["valueControl", "Filter/valueControl.ts"],
    ["serializeFilters", "Filter/filters.ts"],
    ["serializeGroupBy", "GroupBy/groupBy.ts"]
  )
);
const fieldAt = (layout) => layout[0].sections[0].columns[0].fields[0];
test.beforeEach(() => {
  globalThis.__ = host.__;
  globalThis.frappe = host.frappe;
  globalThis.choices = [];
});
test.afterEach(() => {
  delete globalThis.__;
  delete globalThis.frappe;
});

test("actual metadata layout and Select renderer separate same-parent meanings and retain emitted values", async () => {
  const before = structuredClone(fields);
  for (const [index, expected] of [
    [0, "Aperto"],
    [1, "Normale"],
  ]) {
    const field = fieldAt(producer.buildLayoutFromMeta([fields[index]]));
    let value;
    const html = await render(producer.component, {
      field,
      modelValue: "Open",
      "onUpdate:modelValue": (v) => (value = v),
    });
    assert.match(html, new RegExp(`value="Open">${expected}<`));
    assert.equal(globalThis.choices.at(-1).props.modelValue, "Open");
    globalThis.choices.at(-1).emit("update:modelValue", "Open");
    assert.equal(value, "Open");
  }
  assert.deepEqual(fields, before);
  const supplied = { ...fields[1], parent: undefined, label: "Open" };
  assert.match(
    await render(producer.component, { field: supplied, modelValue: "Open" }),
    />Open</
  );
  assert.equal(supplied.label, "Open");
  assert.match(
    await render(producer.component, {
      field: { ...fields[1], context: "Override" },
      modelValue: "Open",
    }),
    />Esplicito</
  );
});

test("actual Filter, multiselect and QuickFilter carry fieldnames and serialize canonical mail buckets", async () => {
  const field = producer
    .getFilterableFields(fields, "Communication")
    .find((f) => f.fieldname === "email_status");
  const equal = {
    fieldname: field.fieldname,
    operator: "equals",
    value: "Open",
    field,
  };
  const control = producer.valueControl(equal);
  assert.match(
    await render(producer.component, { ...control.props, modelValue: "Open" }),
    />Normale</
  );
  const multi = await load("Filter/MultiSelectInput.vue");
  const inFilter = { ...equal, operator: "in", value: ["Open"] };
  assert.match(
    await render(multi.component, {
      ...producer.valueControl(inFilter).props,
      modelValue: ["Open"],
    }),
    />Normale</
  );
  assert.deepEqual(producer.serializeFilters([equal, inFilter]), [
    ["email_status", "=", "Open"],
    ["email_status", "in", ["Open"]],
  ]);
  const quick = await load("QuickFilter/QuickFilterInputs.vue");
  const qfield = producer
    .getQuickFilterFields(fields, "Communication")
    .find((f) => f.fieldname === "email_status");
  let filters;
  assert.match(
    await render(quick.component, {
      fields: [qfield],
      filters: [],
      "onUpdate:filters": (v) => (filters = v),
    }),
    />Normale</
  );
  globalThis.choices.at(-1).emit("update:modelValue", "Open");
  await require("vue").nextTick();
  assert.deepEqual(producer.serializeFilters(filters), [
    ["email_status", "=", "Open"],
  ]);
  const supplied = { ...field, parent: undefined, label: "Open" };
  assert.match(
    await render(multi.component, { field: supplied, modelValue: [] }),
    />Open</
  );
});

test("actual grouped row Select display receives canonical key without changing persisted group configuration", async () => {
  globalThis.metaFixture = { name: "Communication", fields };
  const table = await load("GroupBy/GroupByTable.vue");
  const rows = [{ status: "Open", email_status: "Open" }];
  const groupBy = { fields: ["status", "email_status"], aggregates: [] };
  const before = structuredClone({ rows, groupBy });
  const html = await render(table.component, {
    doctype: "Communication",
    groupBy,
    rows,
  });
  assert.match(html, />Aperto</);
  assert.match(html, />Normale</);
  assert.deepEqual({ rows, groupBy }, before);
  assert.deepEqual(producer.serializeGroupBy(groupBy), {
    fields: ["status", "email_status"],
    group_by: "status, email_status",
    order_by: "status asc, email_status asc",
  });
});
