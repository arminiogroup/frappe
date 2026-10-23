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
      Group: "Gruppo",
      "Group:Grouping": "Raggruppa",
      "Grouped by {0}": "Raggruppato per {0}",
      "Group By": "Raggruppa per",
      "Select field": "Seleziona campo",
      Apply: "Applica",
      "Clear grouping": "Rimuovi raggruppamento",
      "Clear Grouping": "Rimuovi raggruppamento",
      Count: "Conteggio",
      "Status:Item": "Stato articolo",
      Status: "Stato generico",
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
        export {aggregateFunctionLabel,serializeGroupBy,parseGroupBy} from ${JSON.stringify(
          resolve(ui, "GroupBy/groupBy.ts")
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
        export const Button={inheritAttrs:false,props:['label','icon','iconLeft','iconRight','variant','theme','tooltip'],setup(p,{attrs,slots}){return()=>h('button',attrs,[p.label,slots.default?.()])}};
        export const Popover={props:['open'],emits:['update:open'],setup(p,{slots,emit}){globalThis.groupPopover={open:()=>emit('update:open',true)};return()=>h('section',[slots.trigger?.(),slots.default?.({close(){globalThis.closedPopovers++}})])}};
        export const Combobox={inheritAttrs:false,props:['options','modelValue','placeholder'],emits:['update:modelValue'],setup(p,{emit}){return()=>h('select',{value:p.modelValue,placeholder:p.placeholder,onChange:e=>emit('update:modelValue',e.target.value)},(p.options??[]).map(o=>h('option',{value:o.value},o.label)))}};
        export const Select=Combobox;
        export const Switch={props:['modelValue','label'],emits:['update:modelValue'],setup(p,{emit}){return()=>h('input',{type:'checkbox',checked:p.modelValue,onChange:e=>emit('update:modelValue',e.target.checked)})}};
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
    focus() {},
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

test("Group action and hidden-label accessibility use grouping context", async () => {
  const api = await load("GroupBy/GroupBy.vue");
  const view = mount(api.component, null);
  assert.equal(view.button("Raggruppa").props["aria-label"], "Raggruppa");
  view.state.hideLabel = true;
  await nextTick();
  assert.equal(view.ariaButton("Raggruppa").props["aria-label"], "Raggruppa");
  assert(!view.text().includes("Gruppo"));
  view.unmount();
});

test("Actual Apply and Clear preserve canonical fields, aggregates and model presentation", async () => {
  const api = await load("GroupBy/GroupBy.vue");
  const view = mount(api.component, null);
  await view.select("status");
  await view.dispatch(view.button("Applica"), "onClick");
  assert.deepEqual(JSON.parse(JSON.stringify(view.state.value)), {
    fields: ["status"],
    aggregates: [{ function: "count" }],
  });
  assert(view.text().includes("Raggruppato per Stato articolo"));
  view.state.value = {
    fields: ["status"],
    aggregates: [{ function: "count" }],
    widths: { status: 180 },
    sort: [{ fieldname: "status", direction: "desc" }],
    showTotals: true,
  };
  globalThis.groupPopover.open();
  await nextTick();
  await nextTick();
  await view.dispatch(view.button("Applica"), "onClick");
  assert.deepEqual(JSON.parse(JSON.stringify(view.state.value)), {
    fields: ["status"],
    aggregates: [{ function: "count" }],
    widths: { status: 180 },
    sort: [{ fieldname: "status", direction: "desc" }],
    showTotals: true,
  });
  const clear = view.ariaButton("Rimuovi raggruppamento");
  await view.dispatch(clear, "onClick");
  assert.equal(view.state.value, null);
  view.unmount();
});

test("Supplied metadata labels, unknown fieldnames and unknown aggregate fallback remain intact", async () => {
  const api = await load("GroupBy/GroupBy.vue");
  assert.equal(api.aggregateFunctionLabel("custom_aggregate"), "");
  const view = mount(api.component, {
    fields: ["unknown_business_field"],
    aggregates: [{ function: "count" }],
  });
  assert(view.text().includes("Raggruppato per unknown_business_field"));
  globalThis.groupPopover.open();
  await nextTick();
  await nextTick();
  const clearButtons = view
    .all()
    .filter(
      (n) =>
        n.type === "button" && view.nodeText(n) === "Rimuovi raggruppamento"
    );
  assert(clearButtons.length);
  await view.dispatch(clearButtons.at(-1), "onClick");
  assert.equal(view.state.value, null);
  assert.equal(host.__("Group"), "Gruppo");
  view.unmount();
});
