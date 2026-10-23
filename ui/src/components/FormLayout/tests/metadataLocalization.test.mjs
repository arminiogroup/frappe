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
const { createSSRApp, nextTick } = require("vue");
const { renderToString } = require("vue/server-renderer");
const ui = resolve(root, "ui/src/components");
const host = {
  frappe: {
    _messages: {
      Name: "Nome",
      Status: "Stato",
      "Status:Material Request": "Stato della richiesta",
      Issued: "Emesso",
      "Issued:Material Request": "Prelevato",
      "Issued:Override": "Opzione specifica",
      "In Process": "In lavorazione",
      "In Process:Quality Inspection": "Durante la produzione",
      Mask: "Maschera",
      "Mask:DocField": "Oscura",
      "Run:Automation Event Subscription": "Evento",
      Run: "Esegui",
      "More:Material Request": "Altri dettagli",
      "Column:Material Request": "Colonna della richiesta",
      "Tab:Material Request": "Scheda della richiesta",
      "Help <b>{0}</b>:Material Request": "Istruzioni <b>{0}</b>",
      Yes: "Sì",
      No: "No",
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
        name: "metadata-localization",
        setup(builder) {
          builder.onResolve({ filter: /^frappe-ui$/ }, () => ({
            path: "ui",
            namespace: "leaf",
          }));
          builder.onLoad({ filter: /.*/, namespace: "leaf" }, () => ({
            contents: `import {h} from 'vue';
            const simple={props:['label','text','modelValue'],setup(p,{slots}){return()=>h('span',[p.label,slots.default?.()])}};
            const choice={props:['options','modelValue','placeholder','label','description'],emits:['update:modelValue'],setup(p,{emit}){(globalThis.choices??=[]).push({props:p,emit});return()=>h('select',{placeholder:p.placeholder,'data-label':p.label,'data-description':p.description},(p.options??[]).map(o=>h('option',{value:o.value,selected:o.value===p.modelValue},o.label)))}};
            export const Select=choice,MultiSelect=choice,Button=simple,Checkbox=simple,Tooltip=simple,TextInput=simple;export const debounce=fn=>fn;`,
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

const exportsFor = (...names) =>
  names
    .map(
      ([name, path]) =>
        `export {${name}} from ${JSON.stringify(resolve(ui, path))};`
    )
    .join("");
const fixture = {
  parent: "Material Request",
  fieldname: "status",
  fieldtype: "Select",
  label: "Status",
  options: "\nIssued\nDraft",
  description: "Help <b>{0}</b>",
  in_standard_filter: 1,
};
const render = (component, props) =>
  renderToString(createSSRApp(component, props));
const fieldAt = (layout) => layout[0].sections[0].columns[0].fields[0];

// Load producers before installing the host translator, as an island bundle does.
const producer = await load(
  "Fields/SelectField.vue",
  exportsFor(
    ["buildLayoutFromMeta", "FormLayout/buildLayoutFromMeta.ts"],
    ["getFilterableFields", "Filter/getFilterableFields.ts"],
    ["pickFilterFields", "Filter/getFilterableFields.ts"],
    ["getQuickFilterFields", "QuickFilter/getQuickFilterFields.ts"],
    ["valueControl", "Filter/valueControl.ts"],
    ["serializeFilters", "Filter/filters.ts"]
  )
);

test("FormLayout localizes owned metadata labels and help, including breaks and child layouts, without changing raw fields", () => {
  globalThis.__ = host.__;
  const fields = [
    { ...fixture, fieldtype: "Tab Break", fieldname: "tab", label: "Tab" },
    {
      ...fixture,
      fieldtype: "Section Break",
      fieldname: "section",
      label: "More",
    },
    {
      ...fixture,
      fieldtype: "Column Break",
      fieldname: "column",
      label: "Column",
    },
    fixture,
    {
      parent: "Material Request",
      fieldname: "items",
      fieldtype: "Table",
      options: "DocField",
    },
  ];
  const before = structuredClone(fields);
  const layout = producer.buildLayoutFromMeta(fields, {
    childMetas: {
      DocField: [
        {
          parent: "DocField",
          fieldname: "mask",
          fieldtype: "Check",
          label: "Mask",
          in_list_view: 1,
        },
      ],
    },
  });
  assert.equal(layout[0].label, "Scheda della richiesta");
  assert.equal(layout[0].sections[0].label, "Altri dettagli");
  assert.equal(
    layout[0].sections[0].columns[0].label,
    "Colonna della richiesta"
  );
  const field = fieldAt(layout);
  assert.equal(field.label, "Stato della richiesta");
  assert.equal(field.description, "Istruzioni <b>{0}</b>");
  assert.equal(field.parent, "Material Request");
  assert.equal(field.options, fixture.options);
  const table = layout[0].sections[0].columns[0].fields[1];
  assert.equal(table.options, "DocField");
  assert.equal(table.childFields[0].label, "Oscura");
  assert.equal(fieldAt(table.childLayout).label, "Oscura");
  assert.deepEqual(fields, before);
  const plain = {
    fieldname: "user_label",
    fieldtype: "Data",
    label: "Status",
    description: fixture.description,
  };
  assert.equal(fieldAt(producer.buildLayoutFromMeta([plain])).label, "Status");
  assert.equal(
    fieldAt(producer.buildLayoutFromMeta([plain])).description,
    fixture.description
  );
  assert.equal(
    fieldAt(producer.buildLayoutFromMeta([{ ...plain, parent: "Unknown" }]))
      .label,
    "Stato"
  );
  delete globalThis.__;
  assert.equal(
    fieldAt(producer.buildLayoutFromMeta([fixture])).label,
    "Status"
  );
});

test("Filter and QuickFilter producers retain metadata context and canonical values while declarations stay exact", () => {
  globalThis.__ = host.__;
  const raw = { ...fixture, context: "Override" };
  const before = structuredClone(raw);
  for (const values of [
    producer.getFilterableFields([raw], "Material Request"),
    producer.getQuickFilterFields([raw], "Material Request"),
  ]) {
    const field = values.find((f) => f.fieldname === "status");
    assert.equal(field.label, "Stato della richiesta");
    assert.equal(field.parent, "Material Request");
    assert.equal(field.context, "Override");
    assert.equal(field.options, raw.options);
    assert.equal(field.value, "status");
  }
  assert.equal(
    producer.getQuickFilterFields([], "Material Request")[0].label,
    "Nome"
  );
  const supplied = {
    fieldname: "computed",
    fieldtype: "Select",
    label: "Status",
    options: "Issued\nIn Process",
  };
  assert.deepEqual(producer.pickFilterFields([], [supplied]), [
    { ...supplied, value: "computed" },
  ]);
  assert.deepEqual(raw, before);
  delete globalThis.__;
});

test("Select uses the metadata parent and explicit option context, retaining values, model and arbitrary supplied options", async () => {
  globalThis.__ = host.__;
  globalThis.choices = [];
  const field = fieldAt(producer.buildLayoutFromMeta([fixture]));
  let selected;
  const html = await render(producer.component, {
    field,
    modelValue: "Issued",
    "onUpdate:modelValue": (value) => (selected = value),
  });
  assert.match(html, /value="Issued" selected>Prelevato/);
  assert.match(html, /data-label="Stato della richiesta"/);
  assert.equal(globalThis.choices.at(-1).props.modelValue, "Issued");
  globalThis.choices.at(-1).emit("update:modelValue", "Draft");
  assert.equal(selected, "Draft");
  assert.match(
    await render(producer.component, {
      field: { ...field, context: "Override" },
      modelValue: "Issued",
    }),
    />Opzione specifica</
  );
  assert.match(
    await render(producer.component, {
      field: { ...field, parent: "Quality Inspection", options: "In Process" },
      modelValue: "In Process",
    }),
    />Durante la produzione</
  );
  assert.match(
    await render(producer.component, {
      field: { ...field, parent: undefined, context: undefined },
      modelValue: "Issued",
    }),
    />Issued</
  );
  assert.match(
    await render(producer.component, {
      field: { ...field, fieldtype: "Autocomplete" },
      modelValue: "Issued",
    }),
    />Issued</
  );
  const fallback = await render(producer.component, {
    field: { ...field, parent: "Unknown" },
    modelValue: "Issued",
  });
  assert.match(fallback, />Emesso</);
  delete globalThis.__;
});

test("Filter equals and in controls share metadata option context and emit unchanged wire tokens", async () => {
  globalThis.__ = host.__;
  const field = producer
    .getFilterableFields([fixture], "Material Request")
    .find((f) => f.fieldname === "status");
  const equal = {
    fieldname: "status",
    operator: "equals",
    value: "Issued",
    field,
  };
  const control = producer.valueControl(equal);
  assert.equal(control.props.field.parent, "Material Request");
  assert.match(
    await render(producer.component, {
      ...control.props,
      modelValue: "Issued",
    }),
    />Prelevato</
  );
  const multi = await load("Filter/MultiSelectInput.vue");
  const inFilter = { ...equal, operator: "in", value: ["Issued"] };
  const inControl = producer.valueControl(inFilter);
  const html = await render(multi.component, {
    ...inControl.props,
    modelValue: ["Issued"],
  });
  assert.match(html, />Prelevato</);
  assert.deepEqual(producer.serializeFilters([equal, inFilter]), [
    ["status", "=", "Issued"],
    ["status", "in", ["Issued"]],
  ]);
  const custom = { ...field, parent: undefined, context: undefined };
  assert.match(
    await render(multi.component, { field: custom, modelValue: [] }),
    />Issued</
  );
  assert.match(
    await render(multi.component, {
      field: { ...field, fieldtype: "Autocomplete" },
      modelValue: [],
    }),
    />Issued</
  );
  delete globalThis.__;
});

test("QuickFilter passes provenance into real Select controls while preserving custom field models and boolean serialization", async () => {
  globalThis.__ = host.__;
  const quick = await load("QuickFilter/QuickFilterInputs.vue");
  const field = producer
    .getQuickFilterFields([fixture], "Material Request")
    .find((f) => f.fieldname === "status");
  let filters;
  globalThis.choices = [];
  const html = await render(quick.component, {
    fields: [field],
    filters: [],
    "onUpdate:filters": (v) => (filters = v),
  });
  assert.match(html, />Prelevato</);
  assert.match(html, /placeholder="Stato della richiesta"/);
  globalThis.choices.at(-1).emit("update:modelValue", "Issued");
  await nextTick();
  assert.deepEqual(producer.serializeFilters(filters), [
    ["status", "=", "Issued"],
  ]);
  const supplied = {
    ...field,
    parent: undefined,
    context: undefined,
    label: "Status",
  };
  assert.match(
    await render(quick.component, { fields: [supplied], filters: [] }),
    />Issued</
  );
  assert.equal(supplied.label, "Status");
  const check = {
    fieldname: "enabled",
    value: "enabled",
    label: "Enabled",
    fieldtype: "Check",
  };
  assert.deepEqual(
    producer.serializeFilters([
      { fieldname: "enabled", operator: "equals", value: "Yes", field: check },
    ]),
    [["enabled", "=", true]]
  );
  delete globalThis.__;
});
