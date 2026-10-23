import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const require = createRequire(resolve(root, "package.json"));
const { build } = require("esbuild");
const { parse, compileScript } = require("@vue/compiler-sfc");
const { createRenderer, h, ref, nextTick } = require("vue");
const inspector = dirname(fileURLToPath(import.meta.url));
function make(type, text = "") {
  const node = {
    type,
    text,
    props: {},
    children: [],
    parent: null,
    style: {},
    dataValues: {},
    setAttribute(key, value) {
      this.props[key] = value;
    },
    removeAttribute(key) {
      delete this.props[key];
    },
    addEventListener(key, value) {
      this.props["on" + key] = value;
    },
    removeEventListener(key) {
      delete this.props["on" + key];
    },
    appendChild(child) {
      detach(child);
      child.parent = this;
      this.children.push(child);
    },
    replaceChildren() {
      this.children.forEach((child) => (child.parent = null));
      this.children = [];
    },
    focus() {},
  };
  return node;
}
function detach(node) {
  if (node.parent)
    node.parent.children.splice(node.parent.children.indexOf(node), 1);
  node.parent = null;
}
const $ = Object.assign(
  (node) => ({
    0: node,
    appendTo(target) {
      target.appendChild(node);
      return this;
    },
    data(key, value) {
      if (value !== undefined) {
        node.dataValues[key] = value;
        return this;
      }
      return node.dataValues[key];
    },
  }),
  { extend: Object.assign }
);
const host = {
  console,
  jQuery: $,
  $,
  document: {
    createElement: (type) => make(type),
    createTextNode: (text) => make("#text", text),
  },
  frappe: {
    ui: {},
    utils: { icon: () => "", is_rtl: () => false },
    provide() {},
    get_meta: () => ({ fields: [] }),
    _messages: {
      Both: "Entrambi",
      "Both:Print Grid Lines": "Righe e colonne",
      None: "Nessuna",
      "None:Print Table Header": "Nessuna intestazione",
      "None:Print Table Style": "Essenziale",
    },
  },
};
host.window = host;
vm.createContext(host);
for (const file of [
  "format.js",
  "translate.js",
  "ui/components/utils.js",
  "ui/components/tab_buttons.js",
])
  vm.runInContext(
    readFileSync(resolve(root, "frappe/public/js/frappe", file), "utf8")
      .replace(/^import .+;\n/gm, "")
      .replace(/^export default .+;\n/gm, "")
      .replace(/^export /gm, ""),
    host,
    { filename: file }
  );
globalThis.frappe = host.frappe;
globalThis.__ = host.__;
async function load(entry) {
  const bundled = await build({
    entryPoints: [resolve(inspector, entry)],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    external: ["vue"],
    nodePaths: [resolve(root, "node_modules")],
    plugins: [
      {
        name: "actual-inspector-controls",
        setup(builder) {
          builder.onResolve(
            {
              filter:
                /\/(LabelField|StepperRow|SpacingRow|StyleSection|ColorField|VisibilitySection|TextRow|Stepper|Autocomplete)\.vue$/,
            },
            () => ({ path: "leaf", namespace: "leaf" })
          );
          builder.onLoad({ filter: /.*/, namespace: "leaf" }, () => ({
            contents: `import {h} from 'vue';export default {props:['label'],setup(p,{slots}){return()=>h('div',[p.label,slots.default?.()])}}`,
          }));
          builder.onResolve({ filter: /^vuedraggable$/ }, () => ({
            path: "drag",
            namespace: "drag",
          }));
          builder.onLoad({ filter: /.*/, namespace: "drag" }, () => ({
            contents: `import {h} from 'vue';export default {props:['list'],setup(p,{slots}){return()=>h('div',(p.list??[]).map((element,index)=>slots.item?.({element,index})))}}`,
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
  return output.exports.default;
}
function mount(component, store) {
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
    setText: (node, text) => (node.text = text),
    setElementText(node, text) {
      node.text = text;
      node.children = [];
    },
    patchProp: (node, key, _previous, next) => (node.props[key] = next),
    parentNode: (node) => node.parent,
    nextSibling: (node) =>
      node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
    setScopeId() {},
  });
  const container = make("root");
  const app = renderer.createApp({ setup: () => () => h(component) });
  app.provide("$store", store);
  app.config.globalProperties.__ = host.__;
  app.config.globalProperties.frappe = host.frappe;
  app.mount(container);
  const all = () => {
    const nodes = [];
    const walk = (node) => {
      nodes.push(node);
      node.children.forEach(walk);
    };
    walk(container);
    return nodes;
  };
  const text = (node) =>
    (node.type === "#comment" ? "" : node.text) +
    node.children.map(text).join("");
  const find = (predicate) => {
    const node = all().find(predicate);
    assert(node, "expected actual rendered control");
    return node;
  };
  const dispatch = async (node, key, event = {}) => {
    const handler = node.props[key];
    assert(handler, "expected actual control event");
    handler({ preventDefault() {}, stopPropagation() {}, ...event });
    await nextTick();
  };
  return { all, text, find, dispatch, unmount: () => app.unmount() };
}
function storeFor(field = {}, section = {}) {
  return {
    selected_field: ref(field),
    selected_fields: ref([]),
    preview_doc: ref({}),
    selected_section: ref(section),
    layout: ref({ sections: [section] }),
  };
}

test("section grid labels localize while all/rows/columns and fallback deletion stay canonical", async () => {
  const component = await load("SectionPropertiesPanel.vue");
  const store = storeFor(
    {},
    {
      label: "Business section",
      columns: [{ fields: [] }],
      field_borders: true,
      background: "#123456",
    }
  );
  const view = mount(component, store);
  const select = view.find(
    (n) =>
      n.type === "select" && n.children.some((o) => o.props.value === "all")
  );
  assert(select.children.some((o) => view.text(o) === "Righe e colonne"));
  await view.dispatch(select, "onChange", { target: { value: "rows" } });
  assert.equal(store.selected_section.value.grid_borders, "rows");
  await view.dispatch(select, "onChange", { target: { value: "columns" } });
  assert.equal(store.selected_section.value.grid_borders, "columns");
  await view.dispatch(select, "onChange", { target: { value: "all" } });
  assert(!("grid_borders" in store.selected_section.value));
  const toggle = view.find(
    (n) => n.type === "input" && n.props["aria-label"] === "Field borders"
  );
  await view.dispatch(toggle, "onChange", { target: { checked: false } });
  assert(!("field_borders" in store.selected_section.value));
  assert(!("grid_borders" in store.selected_section.value));
  assert.equal(store.selected_section.value.label, "Business section");
  assert.equal(store.selected_section.value.background, "#123456");
  view.unmount();
});

test("table header and clean style have distinct contexts and emit existing canonical settings", async () => {
  const component = await load("TableFieldInspector.vue");
  const field = {
    fieldtype: "Table",
    fieldname: "items",
    label: "Business table",
    table_columns: [
      {
        fieldname: "business",
        fieldtype: "Data",
        label: "Business column",
        width: 100,
      },
    ],
    table_header_bg: "#123456",
  };
  const store = storeFor(field);
  const view = mount(component, store);
  const header = view.find(
    (n) => n.type === "button" && view.text(n) === "Nessuna intestazione"
  );
  await view.dispatch(header, "onclick");
  assert.equal(store.selected_field.value.table_header, "none");
  const select = view.find(
    (n) =>
      n.type === "select" && n.children.some((o) => o.props.value === "clean")
  );
  assert(select.children.some((o) => view.text(o) === "Essenziale"));
  await view.dispatch(select, "onChange", { target: { value: "clean" } });
  assert.equal(store.selected_field.value.table_style, "plain");
  assert.equal(store.selected_field.value.table_bordered, false);
  assert.equal(store.selected_field.value.table_header, "none");
  assert.equal(store.selected_field.value.table_header_bg, "#123456");
  assert.equal(
    store.selected_field.value.table_columns[0].label,
    "Business column"
  );
  await view.dispatch(select, "onChange", { target: { value: "grid" } });
  assert(!("table_style" in store.selected_field.value));
  assert(!("table_bordered" in store.selected_field.value));
  view.unmount();
});

test("unknown custom style and header remain untouched until a known selection is chosen", async () => {
  const component = await load("TableFieldInspector.vue");
  const store = storeFor({
    fieldtype: "Table",
    fieldname: "items",
    table_style: "legacy_style",
    table_bordered: false,
    table_header: "legacy_header",
  });
  const view = mount(component, store);
  assert.equal(store.selected_field.value.table_style, "legacy_style");
  assert.equal(store.selected_field.value.table_header, "legacy_header");
  const select = view.find(
    (n) =>
      n.type === "select" && n.children.some((o) => o.props.value === "clean")
  );
  assert(select.children.some((o) => view.text(o) === "Custom"));
  await view.dispatch(select, "onChange", { target: { value: "rows" } });
  assert(!("table_style" in store.selected_field.value));
  assert.equal(store.selected_field.value.table_bordered, false);
  assert.equal(store.selected_field.value.table_header, "legacy_header");
  assert.equal(host.__("None"), "Nessuna");
  view.unmount();
});
