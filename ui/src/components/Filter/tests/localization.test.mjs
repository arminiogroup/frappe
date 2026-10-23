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
const { createSSRApp, createRenderer, nextTick } = require("vue");
const { renderToString } = require("vue/server-renderer");
const ui = resolve(root, "ui/src/components");
const messages = {
  Like: "Mi piace",
  "Like:Filter Operator": "Contiene",
  "Not like:Filter Operator": "Non contiene",
  "Equals:Filter Operator": "È uguale a",
  "Is not:Filter Operator": "Non è",
  Set: "Imposta",
  "Set:Filter Value": "Valorizzato",
  "Not Set:Filter Value": "Non valorizzato",
  "Last Week": "Settimana scorsa",
  Today: "Oggi",
  Name: "Nome",
  "Created By": "Creato da",
  Filter: "Filtra",
  Where: "Dove",
  And: "E",
  "Remove filter": "Rimuovi filtro",
  "Select a date": "Seleziona una data",
  "Select a date range": "Seleziona un intervallo di date",
  "Select a date and time": "Seleziona data e ora",
  "Enter comma-separated values": "Inserisci valori separati da virgole",
  "Enter a value": "Inserisci un valore",
  Yes: "Sì",
  No: "No",
  "Select options": "Seleziona opzioni",
  "Select field": "Seleziona campo",
  "Select a Value": "Seleziona un valore",
  "Select an Option": "Seleziona un'opzione",
  "Search {0}": "Cerca {0}",
  Customer: "Cliente",
  "No results found": "Nessun risultato",
  Notifications: "Notifiche",
  "No notifications to show": "Nessuna notifica da mostrare",
  "Couldn't load notifications": "Impossibile caricare le notifiche",
  "Unread:Notification Log": "Da leggere",
  Unread: "Non letto",
  "Load more": "Carica altro",
  Close: "Chiudi",
  "Mark all as read": "Segna tutto come letto",
};

const host = {
  frappe: { _messages: messages },
  jQuery: {},
};
host.window = host;
host.$ = host.jQuery;
const context = vm.createContext(host);
vm.runInContext(
  readFileSync(resolve(root, "frappe/public/js/frappe/format.js"), "utf8"),
  context
);
vm.runInContext(
  readFileSync(resolve(root, "frappe/public/js/frappe/translate.js"), "utf8"),
  context
);

globalThis.document = { documentElement: { getAttribute: () => "light" } };
globalThis.MutationObserver = class {
  observe() {}
};
globalThis.DOMParser = class {
  parseFromString(html) {
    assert.equal(html, "");
    return {
      querySelector: () => null,
      querySelectorAll: () => [],
      body: { innerHTML: "" },
    };
  }
};

async function load(entry, extra = "") {
  const bundled = await build({
    stdin: {
      contents: `export { default as component } from ${JSON.stringify(
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
    nodePaths: [
      resolve(root, "node_modules"),
      resolve(root, "island-toolchain/node_modules"),
    ],
    plugins: [
      {
        name: "vue-localization-test",
        setup(builder) {
          builder.onResolve({ filter: /^~icons\// }, ({ path }) => ({
            path,
            namespace: "icon",
          }));
          builder.onLoad({ filter: /.*/, namespace: "icon" }, ({ path }) => ({
            contents: `import {h} from 'vue';export default {render(){return h('svg',{'data-icon':${JSON.stringify(
              path
            )}})}}`,
          }));
          builder.onResolve(
            { filter: /^frappe-ui(?:\/editor)?$/ },
            ({ path }) => ({ path, namespace: "stub" })
          );
          builder.onLoad({ filter: /.*/, namespace: "stub" }, ({ path }) => {
            return {
              contents: `import {h,reactive} from 'vue';
              export {dayjsLocal} from ${JSON.stringify(
                resolve(
                  root,
                  "island-toolchain/node_modules/frappe-ui/src/utils/dayjs.ts"
                )
              )};
              const simple=(tag)=>({props:['label','theme','text','open','options','modelValue','placeholder'],setup(props,{slots,expose}){expose({open(){}});return ()=>h(tag,{'data-options':props.options,'data-model':props.modelValue,placeholder:props.placeholder,title:props.text},[props.label,slots.trigger?.({close(){}}),slots.default?.({close(){}}),slots.header?.()])}});
              const choice={props:['options','modelValue','placeholder'],setup(props){return ()=>h('select',{'data-options':props.options,'data-model':props.modelValue,placeholder:props.placeholder},(props.options??[]).map(o=>h('option',{value:o.value},o.label)))}};
              export const Button=simple('button'), Avatar=simple('span'), Combobox=simple('div'), Popover=simple('div'), TabButtons=choice, Select=choice, MultiSelect=choice, TextInput=simple('input');
              export const frappeRequest=async()=>({}),debounce=fn=>fn;
              export function createResource(options){(globalThis.resourceOptions??=[]).push(options);return reactive({data:options.url.includes('getdoctype')?{docs:[{name:options.params.doctype,fields:[{fieldname:'title',fieldtype:'Data',label:'Customer field'}]}]}:[],fetched:true,loading:false,update(){},reload(){},fetch(){}});}`,
              resolveDir: root,
            };
          });
          builder.onResolve({ filter: /valueControlComponents$/ }, () => ({
            path: "controls",
            namespace: "leaf",
          }));
          builder.onLoad({ filter: /.*/, namespace: "leaf" }, () => ({
            contents: `import {h} from 'vue';const Control={props:['field','options','placeholder','modelValue'],setup(props){return ()=>h('input',{placeholder:props.placeholder??props.field?.placeholder,'data-model':props.modelValue,'data-options':props.options})}};export const VALUE_CONTROLS=Object.fromEntries(['set','timespan','multiSelect','multiLink','text','select','link','number','dateRange','date','datetime','duration','rating'].map(key=>[key,Control]));`,
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
                readFile: (file) => readFileSync(file, "utf8"),
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

const render = (component, props) =>
  renderToString(createSSRApp(component, props));

function mount(component, props = {}) {
  const node = (tag, text = "") => ({
    tag,
    text,
    props: {},
    children: [],
    style: { display: "" },
  });
  const renderer = createRenderer({
    createElement: node,
    createText: (text) => node("#text", text),
    createComment: (text) => node("#comment", text),
    insert(child, parent, anchor) {
      if (child.parent) {
        const index = child.parent.children.indexOf(child);
        if (index >= 0) child.parent.children.splice(index, 1);
      }
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(child);
      else parent.children.splice(index, 0, child);
      child.parent = parent;
    },
    remove(child) {
      const index = child.parent?.children.indexOf(child);
      if (index >= 0) child.parent.children.splice(index, 1);
    },
    setElementText(el, text) {
      el.text = text;
      el.children = [];
    },
    setText(el, text) {
      el.text = text;
    },
    patchProp(el, key, oldValue, value) {
      el.props[key] = value;
    },
    parentNode: (el) => el.parent,
    nextSibling(el) {
      return el.parent?.children[el.parent.children.indexOf(el) + 1];
    },
  });
  const container = node("root"),
    app = renderer.createApp(component, props);
  app.mount(container);
  const nodes = () => {
    const out = [];
    function visit(n) {
      out.push(n);
      n.children.forEach(visit);
    }
    visit(container);
    return out;
  };
  const text = () =>
    nodes()
      .filter((n) => n.tag !== "#comment")
      .map((n) => n.text)
      .join("");
  return { app, nodes, text };
}

test("filter helper labels translate at use time with contextual operators and unchanged wire serialization", async () => {
  const loaded = await load(
    "Filter/MultiSelectInput.vue",
    `export {getOperators} from ${JSON.stringify(
      resolve(ui, "Filter/operators.ts")
    )};export {conditionOperators} from ${JSON.stringify(
      resolve(ui, "ConditionBuilder/internal/operators.ts")
    )};export {getFilterableFields,pickFilterFields} from ${JSON.stringify(
      resolve(ui, "Filter/getFilterableFields.ts")
    )};export {valueControl,placeholder} from ${JSON.stringify(
      resolve(ui, "Filter/valueControl.ts")
    )};export {serializeFilters} from ${JSON.stringify(
      resolve(ui, "Filter/filters.ts")
    )};`
  );
  delete globalThis.__;
  assert.equal(
    loaded.getOperators("Data").find((o) => o.value === "like").label,
    "Like"
  );
  globalThis.__ = host.__;
  assert.equal(
    loaded.getOperators("Data").find((o) => o.value === "like").label,
    "Contiene"
  );
  assert.equal(
    loaded.conditionOperators("Data").find((o) => o.value === "is not").label,
    "Non è"
  );
  const fields = loaded.getFilterableFields(
    [{ fieldname: "title", fieldtype: "Data", label: "Customer label" }],
    "ToDo"
  );
  assert.equal(fields.find((f) => f.fieldname === "name").label, "Nome");
  assert.equal(fields.find((f) => f.fieldname === "name").options, "ToDo");
  assert.equal(
    fields.find((f) => f.fieldname === "_liked_by").label,
    "Mi piace"
  );
  assert.equal(
    fields.find((f) => f.fieldname === "title").label,
    "Customer label"
  );
  const custom = loaded.pickFilterFields(fields, [
    { fieldname: "custom", fieldtype: "Data", label: "Name" },
  ]);
  assert.equal(custom[0].label, "Name");
  const presence = loaded.valueControl({
    field: { fieldname: "title", fieldtype: "Data" },
    operator: "is",
    value: "set",
  });
  assert.deepEqual(presence.props.options, [
    { label: "Valorizzato", value: "set" },
    { label: "Non valorizzato", value: "not set" },
  ]);
  const periods = loaded.valueControl({
    field: { fieldtype: "Date" },
    operator: "timespan",
    value: "last week",
  }).props.options;
  assert.equal(periods[0].label, "Settimana scorsa");
  assert.equal(periods[0].value, "last week");
  assert.equal(periods.length, 17);
  const conditions = [
    {
      fieldname: "title",
      field: { fieldtype: "Data" },
      operator: "like",
      value: "caffè",
    },
    {
      fieldname: "enabled",
      field: { fieldtype: "Check" },
      operator: "equals",
      value: "Yes",
    },
    {
      fieldname: "due",
      field: { fieldtype: "Date" },
      operator: "between",
      value: ["2026-01-01", "2026-01-31"],
    },
    {
      fieldname: "created",
      field: { fieldtype: "Date" },
      operator: "timespan",
      value: "last week",
    },
  ];
  assert.deepEqual(loaded.serializeFilters(conditions), [
    ["title", "LIKE", "%caffè%"],
    ["enabled", "=", true],
    ["due", "between", ["2026-01-01", "2026-01-31"]],
    ["created", "timespan", "last week"],
  ]);
  assert.equal(
    loaded.placeholder(conditions[2]),
    "Seleziona un intervallo di date"
  );
  assert.equal(
    loaded.valueControl(conditions[2]).props.placeholder,
    "Seleziona un intervallo di date"
  );
  delete globalThis.__;
});

test("actual filter and Check option renders preserve canonical values with Italian display labels", async () => {
  globalThis.__ = host.__;
  const filter = (await load("Filter/Filter.vue")).component;
  const model = [
    {
      fieldname: "title",
      field: { fieldname: "title", fieldtype: "Data", label: "Customer label" },
      operator: "like",
      value: "caffè",
    },
    {
      fieldname: "due",
      field: { fieldname: "due", fieldtype: "Date" },
      operator: "between",
      value: ["2026-01-01", "2026-01-31"],
    },
  ];
  assert.match(
    await render(filter, { doctype: "ToDo", modelValue: [] }),
    /Filtra/
  );
  const html = await render(filter, { doctype: "ToDo", modelValue: model });
  assert.match(html, /Filtra/);
  assert.match(html, /Contiene/);
  assert.match(html, /Dove/);
  assert.match(html, /Seleziona un intervallo di date/);
  assert.equal(model[0].operator, "like");
  assert.equal(model[1].value[0], "2026-01-01");
  const select = (await load("Fields/SelectField.vue")).component;
  const check = await render(select, {
    field: { fieldname: "enabled", fieldtype: "Check", options: "Yes\nNo" },
    modelValue: "Yes",
  });
  assert.match(check, />Sì<\/option>/);
  assert.match(check, /value="Yes"/);
  assert.match(check, /data-model="Yes"/);
  const custom = await render(select, {
    field: {
      fieldname: "customer",
      fieldtype: "Select",
      options: "Yes\nCustomer label",
    },
    modelValue: "Yes",
  });
  assert.match(custom, />Yes<\/option>/);
  assert.match(custom, /Customer label/);
  delete globalThis.__;
});

test("multi-value inputs translate only defaults and DocType display while keeping supplied labels and search identities", async () => {
  globalThis.__ = host.__;
  const multi = (await load("Filter/MultiSelectInput.vue")).component;
  const props = {
    field: {
      fieldname: "status",
      fieldtype: "Select",
      options: "Open\nClosed",
    },
    modelValue: ["Open"],
  };
  const html = await render(multi, props);
  assert.match(html, /Seleziona opzioni/);
  assert.match(html, /value="Open"/);
  assert.match(html, />Open<\/option>/);
  assert.match(
    await render(multi, { ...props, placeholder: "Select options" }),
    /placeholder="Select options"/
  );
  const link = (await load("Filter/MultiLinkInput.vue")).component;
  const linkHtml = await render(link, {
    field: { fieldname: "customer", fieldtype: "Link", options: "Customer" },
    modelValue: ["CUSTOMER-1"],
  });
  assert.match(linkHtml, /Cerca Cliente/);
  assert.match(linkHtml, /Nessun risultato/);
  assert.match(linkHtml, /CUSTOMER-1/);
  assert.equal(globalThis.resourceOptions.at(-1).params.doctype, "Customer");
  delete globalThis.__;
});

test("notification defaults translate while caller titles, tabs, content and event identities stay exact", async () => {
  globalThis.__ = host.__;
  const panel = (await load("Notifications/NotificationPanel.vue")).component;
  const base = { notifications: [], hasNextPage: false, loading: false };
  assert.match(await render(panel, base), /Notifiche/);
  assert.match(await render(panel, base), /Nessuna notifica da mostrare/);
  assert.match(
    await render(panel, { ...base, error: new Error("opaque") }),
    /Impossibile caricare le notifiche/
  );
  const html = await render(panel, {
    ...base,
    title: "Notifications",
    tabs: [
      { label: "Read", value: "read" },
      { label: "Customer tab", value: "custom" },
    ],
  });
  assert.match(html, />Notifications</);
  assert.match(html, />Read<\/option>/);
  assert.match(html, /value="read"/);
  assert.match(html, /Customer tab/);
  const item = (await load("Notifications/NotificationItem.vue")).component;
  const notification = {
    name: "NOTIFICATION-1",
    read: 0,
    creation: "",
    subject: "<b>Customer message</b>",
    description: "Customer content",
    from_user: "mario@example.com",
  };
  let clicked;
  const mounted = mount(item, {
    notification,
    onClick: (value) => {
      clicked = value;
    },
  });
  assert.match(mounted.text(), /Da leggere/);
  assert.equal(
    mounted.nodes().find((n) => n.props.role === "button").props["data-state"],
    "unread"
  );
  mounted
    .nodes()
    .find((n) => n.props.role === "button")
    .props.onClick();
  assert.equal(clicked, notification);
  assert.equal(notification.read, 0);
  mounted.app.unmount();
  const itemHtml = await render(item, { notification });
  assert.match(itemHtml, /<b>Customer message<\/b>/);
  assert.match(itemHtml, /Customer content/);
  delete globalThis.__;
});

test("notification relative time uses the actual host Italian date helper", async () => {
  const fixed = Date.parse("2026-10-21T12:00:00Z"),
    moment = require("moment-timezone"),
    prior = moment.now;
  moment.now = () => fixed;
  host.moment = moment;
  host.Date = class extends Date {
    constructor(...args) {
      super(...(args.length ? args : [fixed]));
    }
  };
  host.setInterval = () => {};
  host.frappe.datetime = {};
  host.frappe.provide = () => {};
  host.frappe.boot = { time_zone: { system: "UTC", user: "Europe/Rome" } };
  host.frappe.sys_defaults = {
    date_format: "dd/mm/yyyy",
    time_format: "HH:mm",
  };
  host.$.extend = Object.assign;
  messages.yesterday = "ieri";
  for (const name of ["datetime", "pretty_date"])
    vm.runInContext(
      readFileSync(
        resolve(root, `frappe/public/js/frappe/utils/${name}.js`),
        "utf8"
      ),
      context
    );
  globalThis.__ = host.__;
  globalThis.frappe = host.frappe;
  try {
    const item = (await load("Notifications/NotificationItem.vue")).component;
    assert.match(
      await render(item, {
        notification: {
          name: "N-1",
          read: 1,
          creation: "2026-10-20 12:00:00",
          subject: "Customer content",
        },
      }),
      />ieri</
    );
  } finally {
    moment.now = prior;
    delete globalThis.frappe;
    delete globalThis.__;
  }
});
