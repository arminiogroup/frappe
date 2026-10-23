import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const jquery = require("jquery");
const plain = (value) => JSON.parse(JSON.stringify(value));
const oldMessage =
  "This report contains {0} rows and is too big to display in browser, you can {1} this report instead.";
const wholeMessage =
  "This report contains {0} rows and is too big to display in browser, you can <b>export</b> this report instead.";

function load(t, limit = 1000) {
  const dom = new JSDOM("<!doctype html><body></body>");
  t.after(() => dom.window.close());
  const $ = jquery(dom.window);
  const tables = [];
  const callbacks = [];
  const posts = [];
  const requests = [];
  const accessLogs = [];
  let exportCallback;
  let canExport = false;
  const frappe = {
    session: { user: "translator@example.com" },
    boot: {
      lang: "it",
      sysdefaults: { max_report_rows: limit, number_format: "#.###,##" },
    },
    _messages: {
      export: "esporta",
      Export: "Esporta",
      [oldMessage]:
        "Questo report contiene {0} righe ed è troppo grande per il browser; puoi {1} questo report.",
      [wholeMessage]:
        "Questo report contiene {0} righe ed è troppo grande per essere visualizzato nel browser. Puoi <b>esportarlo</b>.",
    },
    provide() {},
    widget: { utils: {} },
    standard_pages: {},
    views: { BaseList: class {} },
    query_reports: {},
    ui: {},
    defaults: { is_enabled: () => false },
    model: { can_export: () => canExport },
    user: { is_report_manager: () => false },
    request: { url: "/api/method" },
    call: (request) => requests.push(request),
    utils: {
      icon: (name) => `<svg data-icon="${name}"></svg>`,
      datatable: { get_translations: () => ({}) },
      is_rtl: () => false,
      report_column_total() {},
    },
    get_meta: () => ({ masked_fields: [] }),
    report_utils: {
      get_export_dialog(title, fields, callback) {
        exportCallback = callback;
        return {
          show() {
            callbacks.push("export-show");
          },
          hide() {
            callbacks.push("export-hide");
          },
        };
      },
    },
  };
  class DataTable {
    constructor(element, options) {
      this.options = options;
      this.element = element;
      this.rowmanager = {
        setTreeDepth: (depth) => callbacks.push(["depth", depth]),
      };
      tables.push(this);
    }
  }
  const sandbox = {
    frappe,
    $,
    jQuery: $,
    document: dom.window.document,
    DataTable,
    open_url_post: (url, args) => posts.push({ url, args: plain(args) }),
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const path of [
    "../../format.js",
    "../../translate.js",
    "../../utils/common.js",
    "../../utils/datatype.js",
    "../../utils/number_format.js",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8").replace(
      /^import .+;\n/gm,
      ""
    );
    vm.runInContext(source, context, { filename: path });
  }
  vm.runInContext(
    readFileSync(new URL("./query_report.js", import.meta.url), "utf8").replace(
      'import DataTable from "frappe-datatable";',
      ""
    ),
    context,
    { filename: "query_report.js" }
  );
  const report = Object.create(frappe.views.QueryReport.prototype);
  Object.assign(report, {
    report_name: "Rapporto dimostrativo",
    report_doc: { ref_doctype: "Example Document" },
    report_settings: {},
    columns: [
      { fieldname: "name", label: "Name" },
      { fieldname: "hidden", hidden: true },
    ],
    raw_data: { add_total_row: false },
    tree_report: false,
    data: [],
    $report: $("<div></div>"),
    $message: $("<section><div></div></section>"),
    get_filter_values: () => ({ company: "Example Company" }),
    get_applied_filters: (filters) => ({ Company: filters.company }),
    make_access_log: (...args) => accessLogs.push(args),
  });
  return {
    frappe,
    report,
    sandbox,
    tables,
    callbacks,
    posts,
    requests,
    accessLogs,
    setCanExport: (value) => (canExport = value),
    exportValues: (values) => exportCallback(values),
  };
}

test("oversized refresh renders a complete localized warning and removes the stale table", (t) => {
  const env = load(t);
  assert.equal(env.frappe.session.user, "translator@example.com");
  const row = { name: "Start", amount: 1 };
  const data = Array(1001).fill(row);
  env.report.data = data;
  let destroyed = 0;
  env.report.datatable = { destroy: () => destroyed++ };
  env.report.render_datatable();
  assert.equal(destroyed, 1);
  assert.equal(env.report.datatable, null);
  assert.equal(env.tables.length, 0);
  assert.equal(env.report.data, data);
  assert.equal(row.name, "Start");
  assert.equal(env.callbacks.length, 0);
  assert.equal(env.requests.length, 0);
  const message = env.report.$message;
  assert.notEqual(message.css("display"), "none");
  assert.equal(message.find("svg").attr("data-icon"), "triangle-alert");
  assert.equal(message.find("b").eq(0).text(), "1.001");
  assert.match(message.text(), /Puoi esportarlo\./);
  assert.equal(message.find("b").eq(1).text(), "esportarlo");
});

test("default and invalid row limits retain the existing hundred-thousand fallback", (t) => {
  for (const limit of [undefined, 0, "invalid"]) {
    const env = load(t, limit);
    env.frappe.boot.sysdefaults.max_report_rows = limit;
    env.report.data = Array(100001).fill({ name: "EXAMPLE" });
    env.report.render_datatable();
    assert.equal(env.tables.length, 0);
    assert.equal(env.report.$message.find("b").eq(0).text(), "100.001");
    assert.equal(env.posts.length, 0);
  }
});

test("at the strict limit table creation keeps totals, tree depth, columns and callbacks", (t) => {
  const env = load(t, 2);
  env.report.data = [{ name: "EXAMPLE" }, { name: "Total" }];
  const original = JSON.stringify(env.report.data);
  env.report.raw_data.add_total_row = true;
  env.report.report_settings.initial_depth = 3;
  env.report.report_settings.after_datatable_render = (table) =>
    env.callbacks.push(table);
  env.report.render_datatable();
  assert.equal(env.tables.length, 1);
  const table = env.tables[0];
  assert.equal(table.options.showTotalRow, true);
  assert.equal(table.options.language, "it");
  assert.equal(table.options.treeView, false);
  assert.deepEqual(plain(table.options.data), [{ name: "EXAMPLE" }]);
  assert.deepEqual(plain(table.options.columns), [
    { fieldname: "name", label: "Name" },
  ]);
  assert.deepEqual(plain(env.callbacks[0]), ["depth", 3]);
  assert.equal(env.callbacks[1], table);
  assert.equal(JSON.stringify(env.report.data), original);
  assert.notEqual(env.report.$report.css("display"), "none");
});

test("below the limit an existing compatible table refreshes without replacement", (t) => {
  const env = load(t, 3);
  env.report.data = [{ name: "EXAMPLE" }];
  let refreshed;
  const table = {
    options: { showTotalRow: false },
    refresh: (data, columns) => (refreshed = { data, columns }),
  };
  env.report.datatable = table;
  env.report.tree_report = true;
  env.report.render_datatable();
  assert.equal(env.report.datatable, table);
  assert.equal(env.tables.length, 0);
  assert.equal(table.options.treeView, true);
  assert.equal(refreshed.data, env.report.data);
  assert.equal(refreshed.columns.length, 1);
});

test("export permission gate and no-table export payload remain canonical", (t) => {
  const env = load(t, 2);
  env.report.data = [{ name: "A" }, { name: "B" }, { name: "C" }];
  env.report.render_datatable();
  const item = env.report
    .get_menu_items()
    .find((entry) => entry.label === "Esporta");
  assert.equal(item.condition(), false);
  env.setCanExport(true);
  assert.equal(item.condition(), true);
  item.action();
  env.exportValues({
    file_format: "CSV",
    export_in_background: 0,
    csv_delimiter: ";",
  });
  assert.equal(env.requests.length, 0);
  assert.equal(env.posts.length, 1);
  assert.equal(env.posts[0].url, "/api/method");
  const args = env.posts[0].args;
  assert.equal(args.cmd, "frappe.desk.query_report.export_query");
  assert.equal(args.report_name, "Rapporto dimostrativo");
  assert.deepEqual(args.filters, { company: "Example Company" });
  assert.deepEqual(args.applied_filters, { Company: "Example Company" });
  assert.equal(args.ignore_visible_idx, true);
  assert.deepEqual(args.visible_idx, []);
  assert.deepEqual(args.custom_columns, []);
  assert.equal(args.file_format_type, "CSV");
  assert.equal(args.csv_delimiter, ";");
  assert.deepEqual(env.accessLogs, [["Export", "CSV"]]);
  assert.deepEqual(env.callbacks, ["export-show", "export-hide"]);
});
