import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const read = (relative) =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

function context(messages, additions = {}) {
  const jquery = () => ({
    attr() {
      return this;
    },
    text(value) {
      texts.push(value);
      return this;
    },
    appendTo() {
      return this;
    },
    find() {
      return this;
    },
    prop() {
      return this;
    },
    on() {
      return this;
    },
  });
  const texts = [];
  const sandbox = {
    frappe: { _messages: messages, provide() {}, ...additions },
    $: jquery,
    jQuery: jquery,
  };
  sandbox.window = sandbox;
  const result = vm.createContext(sandbox);
  vm.runInContext(read("../../format.js"), result);
  vm.runInContext(read("../../translate.js"), result);
  return { result, sandbox, texts };
}

test("search result templates translate list, tree and report labels while preserving routes", () => {
  const messages = {
    "Sales Order": "Ordine di vendita",
    Warehouse: "Magazzino",
    "Price List": "Listino prezzi",
    Settings: "Impostazioni",
    "{0} List": "Elenco di {0}",
    "{0} Tree": "Albero di {0}",
    "{0} Report": "Report di {0}",
  };
  const types = ["Sales Order", "Warehouse", "Price List", "Settings"];
  const { result, sandbox } = context(messages, {
    search: {},
    boot: {
      lang: "it",
      user: { can_read: types, can_search: types, can_create: [] },
      single_types: ["Settings"],
      tree_view_doctypes: ["Warehouse"],
    },
    model: { can_get_report: () => true },
  });
  vm.runInContext(
    read("./fuzzy_match.js").replace(
      "export function fuzzy_match",
      "function fuzzy_match"
    ),
    result
  );
  vm.runInContext(
    read("./search_utils.js").replace(
      'import { fuzzy_match } from "./fuzzy_match.js";',
      ""
    ),
    result
  );
  const rows = sandbox.frappe.search.utils.get_doctypes("o");
  const row = (name, type) =>
    rows.find((entry) => entry.match === name && entry.type === type);
  assert.equal(row("Sales Order", "List").value, "Elenco di Ordine di vendita");
  for (const [name, type, expected, route] of [
    [
      "Sales Order",
      "List",
      "Elenco di Ordine di vendita",
      ["List", "Sales Order"],
    ],
    ["Warehouse", "Tree", "Albero di Magazzino", ["Tree", "Warehouse"]],
    [
      "Sales Order",
      "Report",
      "Report di Ordine di vendita",
      ["List", "Sales Order", "Report"],
    ],
    ["Price List", "List", "Listino prezzi", ["List", "Price List"]],
    ["Settings", "", "Impostazioni", ["Form", "Settings", "Settings"]],
  ]) {
    assert.equal(row(name, type).label.replace(/<\/?mark>/g, ""), expected);
    assert.deepEqual(Array.from(row(name, type).route), route);
  }
  assert.equal(row("Warehouse", "Tree").value, "Albero di Magazzino");
  assert.deepEqual(types, [
    "Sales Order",
    "Warehouse",
    "Price List",
    "Settings",
  ]);
});

test("global-search settings translate document names without storing translated identifiers", async () => {
  let open;
  let view;
  let saved;
  const settings = { allowed_in_global_search: [] };
  const { result, sandbox, texts } = context(
    { "Sales Order": "Ordine di vendita" },
    {
      doctype_settings: {
        register(_name, handler) {
          open = handler;
        },
        render_loading() {},
        render_error(_panel, _retry, error) {
          throw error;
        },
      },
      db: { get_doc: async () => settings },
      call: async ({ args }) => {
        saved = args.doc;
      },
      ui: { keys: { get_shortcut_label: () => "Ctrl+G" }, toast() {} },
      dom: { get_unique_id: () => "test-global-search" },
    }
  );
  vm.runInContext(
    read("../../form/doctype_settings/tabs/global_search.js"),
    result
  );
  const body = {
    empty() {
      return this;
    },
    append() {},
  };
  const panel = {
    body,
    set_view(value) {
      view = value;
      value.render(panel);
    },
  };
  open(panel, "Sales Order");
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(view.description.includes("Ordine di vendita"));
  assert.ok(
    texts.some((text) => text === "Include Ordine di vendita in global search")
  );
  assert.ok(
    texts.some(
      (text) =>
        text ===
        "Ordine di vendita documents become searchable for everyone in this site"
    )
  );
  await vm.runInContext('set_included("Sales Order", true)', result);
  assert.equal(saved.allowed_in_global_search[0].document_type, "Sales Order");
  assert.equal(sandbox.frappe._messages["Sales Order"], "Ordine di vendita");
});

test("database optimization dialog and queued message translate display text only", async () => {
  let launch;
  let dialog;
  let request;
  let alert;
  const messages = {
    Optimize: "Ottimizza",
    "Optimize Doctype": "Ottimizza tipo di documento",
    "Select a DocType": "Scegli un tipo di documento",
    "Sales Order": "Ordine di vendita",
    "{0} has been added to queue for optimization":
      "{0}: ottimizzazione in coda",
  };
  const { result, sandbox } = context(messages, {
    query_reports: {},
    ui: {
      Dialog: class {
        constructor(options) {
          dialog = options;
        }
        show() {}
        hide() {}
      },
    },
    call: async (options) => {
      request = options;
      options.callback({});
    },
    show_alert(value) {
      alert = value;
    },
  });
  vm.runInContext(
    read(
      "../../../../../core/report/database_storage_usage_by_tables/database_storage_usage_by_tables.js"
    ),
    result
  );
  sandbox.frappe.query_reports["Database Storage Usage By Tables"].onload({
    page: {
      add_inner_button(_label, callback) {
        launch = callback;
      },
    },
  });
  launch();
  await dialog.primary_action({ doctype_name: "Sales Order" });
  assert.deepEqual(
    [dialog.title, dialog.fields[0].label, dialog.primary_action_label, alert],
    [
      "Ottimizza tipo di documento",
      "Scegli un tipo di documento",
      "Ottimizza",
      "Ordine di vendita: ottimizzazione in coda",
    ]
  );
  assert.equal(request.args.doctype_name, "Sales Order");
  assert.equal(dialog.fields[0].options, "DocType");
});

for (const [keyword, typed] of [
  ["nuovo", "nuovo"],
  ["Nuovo", "NUOVO"],
  ["crea", "crea"],
  ["new", "new"],
]) {
  test(`create-search consumes the complete ${keyword} keyword and preserves document creation`, () => {
    const created = [];
    const { result, sandbox } = context(
      {
        new: keyword,
        Item: "Articolo",
        "New {0}": "Crea {0}",
      },
      {
        search: {},
        boot: { lang: "it", user: { can_create: ["Item"] } },
        new_doc: (...args) => created.push(args),
      }
    );
    vm.runInContext(
      read("./fuzzy_match.js").replace(
        "export function fuzzy_match",
        "function fuzzy_match"
      ),
      result
    );
    vm.runInContext(
      read("./search_utils.js").replace(
        'import { fuzzy_match } from "./fuzzy_match.js";',
        ""
      ),
      result
    );
    const rows = sandbox.frappe.search.utils.get_creatables(
      `${typed} Articolo`
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, "New");
    assert.equal(rows[0].match, "Item");
    assert.equal(rows[0].value, "Crea Articolo");
    assert.ok(rows[0].index > 1);
    rows[0].onclick();
    assert.deepEqual(JSON.parse(JSON.stringify(created)), [["Item", true]]);
    assert.deepEqual(
      Array.from(sandbox.frappe.search.utils.get_creatables("cerca Articolo")),
      []
    );
    assert.deepEqual(Array.from(sandbox.frappe.boot.user.can_create), ["Item"]);
  });
}

for (const [
  routeType,
  sourceName,
  translatedName,
  suffix,
  translatedSuffix,
] of [
  ["List", "Sales Order", "Ordine di vendita", "List", "Elenco"],
  ["Tree", "Warehouse", "Magazzino", "Tree", "Albero"],
  ["Workspaces", "Accounting", "Contabilità", "Workspace", "Area di lavoro"],
  [
    "query-report",
    "Stock Balance",
    "Giacenze di magazzino",
    "Report",
    "Report",
  ],
]) {
  test(`recent ${routeType} labels translate the name before adding bold markup`, () => {
    for (const italian of [true, false]) {
      const messages = italian
        ? { [sourceName]: translatedName, [suffix]: translatedSuffix }
        : {};
      const route = [routeType, sourceName];
      const { result, sandbox } = context(messages, {
        search: {},
        boot: { lang: italian ? "it" : "en", user: { recent: "[]" } },
        route_history: [route],
      });
      sandbox.$.isArray = Array.isArray;
      sandbox.$.isPlainObject = (value) =>
        Object.prototype.toString.call(value) === "[object Object]";
      vm.runInContext(
        read("./fuzzy_match.js").replace(
          "export function fuzzy_match",
          "function fuzzy_match"
        ),
        result
      );
      vm.runInContext(
        read("./search_utils.js").replace(
          'import { fuzzy_match } from "./fuzzy_match.js";',
          ""
        ),
        result
      );
      sandbox.frappe.search.utils.setup_recent();
      const [entry] = sandbox.frappe.search.utils.get_recent_pages("");
      const displayName = italian ? translatedName : sourceName;
      const displaySuffix = italian ? translatedSuffix : suffix;
      assert.equal(entry.label, `<b>${displayName}</b> ${displaySuffix}`);
      assert.equal(entry.value, `${displayName} ${displaySuffix}`);
      assert.deepEqual(Array.from(entry.route), route);
      assert.deepEqual(Array.from(entry.match[1]), route);
      assert.equal(entry.recent, true);
      assert.equal(entry.index, 80);
      assert.deepEqual(sandbox.frappe.route_history, [route]);
    }
  });
}
