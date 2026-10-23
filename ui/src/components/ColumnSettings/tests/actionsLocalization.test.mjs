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
const { createRenderer, h, reactive, nextTick } = require("vue");
const ui = resolve(root, "ui/src/components");
globalThis.HTMLInputElement = class {};
const host = {
  frappe: {
    _messages: {
      Columns: "Colonne",
      "Remove column": "Rimuovi colonna",
      "Add Column": "Aggiungi colonna",
      "Confirm Reset": "Conferma ripristino",
      Reset: "Ripristina",
      Sort: "Ordina",
      Ascending: "Crescente",
      Descending: "Decrescente",
      "Select field": "Seleziona campo",
      "Remove sort": "Rimuovi criterio",
      "Add Sort": "Aggiungi criterio",
      "Clear Sort": "Cancella ordinamento",
      "Amount:Item": "Importo",
      "Status:Item": "Stato",
      "User column": "MUST STAY SUPPLIED",
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

const fields = [
  {
    parent: "Item",
    fieldname: "amount",
    fieldtype: "Currency",
    label: "Amount",
    in_list_view: 1,
  },
  {
    parent: "Item",
    fieldname: "status",
    fieldtype: "Data",
    label: "Status",
    in_list_view: 1,
  },
];

async function load(entry) {
  const bundled = await build({
    stdin: {
      contents: `export {default as component} from ${JSON.stringify(
        resolve(ui, entry)
      )};
        export {serializeColumns,parseColumns} from ${JSON.stringify(
          resolve(ui, "ColumnSettings/columns.ts")
        )};
        export {serializeOrderBy} from ${JSON.stringify(
          resolve(ui, "SortBy/orderBy.ts")
        )};`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    external: ["vue"],
    define: { "import.meta.env.DEV": "false" },
    nodePaths: [resolve(root, "node_modules")],
    plugins: [
      {
        name: "actual-action-components",
        setup(builder) {
          builder.onResolve({ filter: /^frappe-ui$/ }, () => ({
            path: "ui",
            namespace: "leaf",
          }));
          builder.onLoad({ filter: /.*/, namespace: "leaf" }, () => ({
            contents: `
        import {h,reactive} from 'vue';
        export const Button={inheritAttrs:false,props:['label','icon','iconLeft','iconRight','variant','theme'],setup(p,{attrs,slots}){return()=>h('button',attrs,[p.label,slots.default?.(),slots.suffix?.()])}};
        export const Popover={inheritAttrs:false,setup(p,{slots,expose}){expose({open(){}});return()=>h('section',[slots.trigger?.({open:false}),slots.default?.({close(){globalThis.closedPopovers++}})])}};
        export const Combobox={inheritAttrs:false,props:['options','modelValue','placeholder'],emits:['update:selectedOption','update:modelValue'],setup(p,{slots,emit}){return()=>h('div',[slots.trigger?.(),h('select',{value:p.modelValue,placeholder:p.placeholder,onChange(e){const option=p.options.find(o=>o.value===e.target.value);emit('update:selectedOption',option);emit('update:modelValue',option?.value)}},(p.options??[]).map(o=>h('option',{value:o.value},o.label)))])}};
        export const TextInput={inheritAttrs:false,props:['modelValue','readonly'],emits:['update:modelValue'],setup(p,{attrs,emit}){return()=>h('input',{...attrs,value:p.modelValue,readonly:p.readonly,onInput:e=>emit('update:modelValue',e.target.value)})}};
        export const frappeRequest=async()=>({});
        export function createResource(){return reactive({data:{docs:[{name:'Item',fields:globalThis.actionFields}]},fetched:true,loading:false,fetch(){},reload(){}})}
      `,
          }));
          builder.onResolve({ filter: /^vuedraggable$/ }, () => ({
            path: "drag",
            namespace: "leaf-drag",
          }));
          builder.onLoad({ filter: /.*/, namespace: "leaf-drag" }, () => ({
            contents: `
        import {h} from 'vue';export default {props:['modelValue'],emits:['update:modelValue'],setup(p,{slots,emit}){globalThis.actionDrag={get value(){return p.modelValue},reorder:value=>emit('update:modelValue',value)};return()=>h('div',(p.modelValue??[]).map((element,index)=>slots.item?.({element,index})))}}
      `,
          }));
          builder.onLoad({ filter: /\.vue$/ }, ({ path }) => {
            const { descriptor, errors } = parse(readFileSync(path, "utf8"), {
              filename: path,
            });
            assert.deepEqual(errors, []);
            return {
              contents: compileScript(descriptor, {
                id: path,
                inlineTemplate: true,
                fs: {
                  fileExists: existsSync,
                  readFile: (f) => readFileSync(f, "utf8"),
                },
              }).content,
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

function mount(component, model, options = {}) {
  globalThis.__ = host.__;
  globalThis.actionFields = fields;
  globalThis.closedPopovers = 0;
  const make = (type, text = "") => ({
    type,
    text,
    props: {},
    children: [],
    parent: null,
  });
  const detach = (node) => {
    if (node.parent)
      node.parent.children.splice(node.parent.children.indexOf(node), 1);
  };
  const renderer = createRenderer({
    createElement: (type) => make(type),
    createText: (text) => make("#text", text),
    createComment: (text) => make("#comment", text),
    insert(node, parent, anchor = null) {
      detach(node);
      node.parent = parent;
      const i = anchor ? parent.children.indexOf(anchor) : -1;
      parent.children.splice(i < 0 ? parent.children.length : i, 0, node);
    },
    remove: detach,
    setText: (node, text) => {
      node.text = text;
    },
    setElementText(node, text) {
      node.text = text;
      node.children = [];
    },
    patchProp(node, key, previous, next) {
      node.props[key] = next;
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) =>
      node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
    setScopeId() {},
  });
  const state = reactive({ value: model, hideLabel: false, resets: 0 });
  const container = make("root");
  const app = renderer.createApp({
    setup: () => () =>
      h(component, {
        doctype: "Item",
        ...options,
        hideLabel: state.hideLabel,
        modelValue: state.value,
        "onUpdate:modelValue": (value) => {
          state.value = value;
        },
        onReset: () => {
          state.resets++;
        },
      }),
  });
  app.mount(container);
  const all = () => {
    const nodes = [];
    const visit = (n) => {
      nodes.push(n);
      n.children.forEach(visit);
    };
    visit(container);
    return nodes;
  };
  const text = (node) =>
    (node.type === "#comment" ? "" : node.text) +
    node.children.map(text).join("");
  const find = (predicate) => {
    const node = all().find(predicate);
    assert.ok(node, "Expected rendered control");
    return node;
  };
  const button = (label) =>
    find((node) => node.type === "button" && text(node) === label);
  const ariaButton = (label) =>
    find(
      (node) => node.type === "button" && node.props["aria-label"] === label
    );
  const dispatch = async (node, key, event = {}) => {
    const handlers = [node.props[key]].flat();
    assert.ok(handlers[0], `Expected ${key} handler`);
    for (const handler of handlers)
      handler({ preventDefault() {}, stopPropagation() {}, ...event });
    await nextTick();
  };
  const select = async (value, trigger) => {
    const node = find(
      (n) =>
        n.type === "select" &&
        n.children.some((o) => o.props.value === value) &&
        (!trigger || text(n.parent).includes(trigger))
    );
    await dispatch(node, "onChange", { target: { value } });
  };
  return {
    state,
    all,
    nodeText: text,
    text: () => text(container),
    find,
    button,
    ariaButton,
    dispatch,
    select,
    unmount: () => app.unmount(),
  };
}

test("Columns controls localize actions while adding, renaming, reordering and serializing canonical columns", async () => {
  const api = await load("ColumnSettings/ColumnSettings.vue");
  const view = mount(api.component, [], { canReset: true });
  assert.equal(view.button("Colonne").props["aria-label"], "Colonne");
  await view.select("amount");
  assert.deepEqual(JSON.parse(JSON.stringify(view.state.value)), [
    { fieldname: "amount", label: "Importo" },
  ]);
  view.button("Aggiungi colonna");
  await view.select("status");
  globalThis.actionDrag.reorder([...view.state.value].reverse());
  await nextTick();
  assert.deepEqual(
    view.state.value.map((c) => c.fieldname),
    ["status", "amount"]
  );
  const input = view.find(
    (n) => n.type === "input" && n.props.value === "Stato"
  );
  await view.dispatch(input, "onClick");
  await view.dispatch(input, "onInput", { target: { value: "User column" } });
  assert.equal(view.state.value[0].label, "Stato");
  await view.dispatch(input, "onKeydown", { key: "Enter" });
  assert.equal(view.state.value[0].label, "User column");
  const wire = api.serializeColumns(view.state.value, fields);
  assert.equal(wire[0].key, "status");
  assert.equal(wire[0].label, "User column");
  assert.equal(api.parseColumns(wire)[0].fieldname, "status");
  await view.dispatch(view.ariaButton("Rimuovi colonna"), "onClick");
  assert.deepEqual(
    view.state.value.map((c) => c.fieldname),
    ["amount"]
  );
  view.unmount();
});

test("Column reset confirmation and hidden-label accessibility preserve supplied layouts", async () => {
  const api = await load("ColumnSettings/ColumnSettings.vue");
  const layout = [
    { fieldname: "amount", label: "User column", width: "173px" },
  ];
  const view = mount(api.component, structuredClone(layout), {
    canReset: true,
  });
  const original = JSON.stringify(view.state.value);
  await view.dispatch(view.button("Ripristina"), "onClick");
  assert.equal(view.state.resets, 0);
  view.button("Conferma ripristino");
  await view.dispatch(view.button("Conferma ripristino"), "onClick");
  assert.equal(view.state.resets, 1);
  assert.equal(JSON.stringify(view.state.value), original);
  assert.equal(view.find((n) => n.type === "input").props.value, "User column");
  view.state.hideLabel = true;
  await nextTick();
  assert.equal(view.nodeText(view.ariaButton("Colonne")), "");
  assert.equal(
    api.serializeColumns(view.state.value, fields)[0].width,
    "173px"
  );
  view.unmount();
});

test("Sort actions and accessible directions translate without changing canonical order_by", async () => {
  const api = await load("SortBy/SortBy.vue");
  const view = mount(api.component, []);
  assert.equal(view.button("Ordina").props["aria-label"], "Ordina");
  assert.doesNotMatch(view.text(), /Empty - Choose/);
  await view.select("amount");
  assert.equal(api.serializeOrderBy(view.state.value), "amount asc");
  await view.dispatch(view.ariaButton("Crescente"), "onClick");
  assert.equal(api.serializeOrderBy(view.state.value), "amount desc");
  view.ariaButton("Decrescente");
  assert.ok(
    view
      .all()
      .some(
        (n) => n.type === "select" && n.props.placeholder === "Seleziona campo"
      )
  );
  view.button("Aggiungi criterio");
  await view.select("status", "Aggiungi criterio");
  assert.equal(
    api.serializeOrderBy(view.state.value),
    "amount desc, status asc"
  );
  assert.match(
    view.nodeText(
      view.find(
        (n) => n.type === "button" && view.nodeText(n).startsWith("Ordina")
      )
    ),
    /2/
  );
  globalThis.actionDrag.reorder([...view.state.value].reverse());
  await nextTick();
  assert.equal(
    api.serializeOrderBy(view.state.value),
    "status asc, amount desc"
  );
  await view.dispatch(view.ariaButton("Rimuovi criterio"), "onClick");
  assert.equal(api.serializeOrderBy(view.state.value), "amount desc");
  await view.dispatch(view.button("Cancella ordinamento"), "onClick");
  assert.equal(api.serializeOrderBy(view.state.value), "");
  assert.equal(globalThis.closedPopovers, 1);
  view.state.hideLabel = true;
  await nextTick();
  assert.equal(view.nodeText(view.ariaButton("Ordina")), "");
  view.unmount();
});

test("actions retain standalone English fallback and supplied label/width values", async () => {
  const api = await load("ColumnSettings/ColumnSettings.vue");
  const view = mount(
    api.component,
    [{ fieldname: "amount", label: "User column", width: "11rem" }],
    { canReset: true }
  );
  globalThis.__ = undefined;
  view.state.hideLabel = true;
  await nextTick();
  view.ariaButton("Columns");
  view.button("Reset");
  assert.equal(view.find((n) => n.type === "input").props.value, "User column");
  assert.equal(view.state.value[0].width, "11rem");
  view.unmount();
});
