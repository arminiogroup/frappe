const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "../../../../../..");
const TARGETS = {
  "Stock Balance": "Giacenze di magazzino",
  Sales: "Vendite",
  "Report {0} is ready.": "Il report {0} è pronto.",
  "Report {0} failed to generate.": "Impossibile generare il report {0}.",
  "Report {0} has finished processing.":
    "L’elaborazione del report {0} è terminata.",
  View: "Visualizza",
};
const plain = (value) => JSON.parse(JSON.stringify(value));

function fixture({
  messages = TARGETS,
  open = "Stock Balance",
  standard = "Yes",
} = {}) {
  const callbacks = {};
  const alerts = [];
  const deliveries = [];
  const bindings = [];
  const forbidden = [];
  const blocked = (name) => () => {
    forbidden.push(name);
    throw new Error(`Unexpected ${name}`);
  };
  const context = {
    console,
    URL,
    URLSearchParams,
    location: new URL("https://example.com/desk/query-report/Sales"),
    localStorage: { getItem: () => null, setItem: blocked("storage write") },
    sessionStorage: { getItem: () => null },
    history: {
      pushState: blocked("navigation"),
      replaceState: blocked("navigation"),
    },
    DataTable: class {
      constructor() {
        throw new Error("Unexpected table construction");
      }
    },
    deep_equal: blocked("deep equality dependency"),
    number_systems: {},
    CHART_PALETTE: {},
  };
  context.window = context;
  context.addEventListener = () => {};
  context.$ = (value) => ({
    on: () => {},
    data: (key) => value.dataset[key],
  });
  context.$.map = (values, callback) =>
    Array.from(values).flatMap((value, index) => callback(value, index) ?? []);
  context.$.isPlainObject = (value) =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  context.$.isArray = Array.isArray;
  context.jQuery = context.$;
  context.frappe = {
    views: { BaseList: class {} },
    standard_pages: {},
    workspaces: {},
    boot: {
      page_info: {},
      module_sidebars: {},
      module_app: {},
      allowed_workspaces: [],
    },
    session: { user: "translator@example.com" },
    utils: { make_event_emitter: () => {} },
    model: { with_doctype: blocked("metadata lookup") },
    _messages: { ...messages },
    realtime: {
      on: (event, callback) => {
        assert.equal(event, "report_processed");
        assert.equal(callbacks[event], undefined);
        callbacks[event] = callback;
      },
    },
    show_alert: (spec) => alerts.push(plain(spec)),
    call: blocked("RPC"),
    xcall: blocked("RPC"),
    set_route: blocked("route action"),
  };
  context.frappe.provide = (name) =>
    name.split(".").reduce((object, key) => (object[key] ||= {}), context);
  context.fetch = blocked("fetch");
  context.XMLHttpRequest = class {
    constructor() {
      throw new Error("Unexpected XHR");
    }
  };
  vm.createContext(context);
  function load(relative, imports = []) {
    const file = path.join(ROOT, relative);
    let source = fs.readFileSync(file, "utf8");
    for (const statement of imports) {
      assert.equal(source.split(statement).length, 2);
      source = source.replace(statement, "");
    }
    vm.runInContext(source, context, { filename: file });
  }
  load("public/js/frappe/format.js");
  load("public/js/frappe/translate.js");
  load("public/js/frappe/utils/utils.js", [
    'import deep_equal from "fast-deep-equal";',
    'import number_systems from "./number_systems";',
    'import { CHART_PALETTE } from "../ui/components/utils.js";',
  ]);
  load("public/js/frappe/router.js");
  context.frappe.router.setup_shell_routes();
  load("public/js/frappe/views/reports/query_report.js", [
    'import DataTable from "frappe-datatable";',
  ]);
  const instance = Object.create(context.frappe.views.QueryReport.prototype);
  Object.assign(instance, {
    report_name: open,
    report_doc: { name: open, is_standard: standard },
    prepared_report_doc_name: "PR-ACTIVE",
    page: { wrapper: { on: (...args) => bindings.push(args) } },
    primary_button: { prop: (...args) => deliveries.push(["button", ...args]) },
    refresh: () => deliveries.push(["refresh"]),
  });
  instance.setup_events();
  const state = () =>
    plain({
      report_name: instance.report_name,
      report_doc: instance.report_doc,
      prepared_report_doc_name: instance.prepared_report_doc_name,
    });
  return {
    context,
    instance,
    alerts,
    deliveries,
    bindings,
    state,
    emit(data) {
      const before = state();
      const event = plain(data);
      callbacks.report_processed(data);
      assert.deepEqual(data, event);
      assert.deepEqual(state(), before);
      assert.deepEqual(forbidden, []);
    },
    async link(report, name) {
      assert.equal(alerts.length, 1);
      assert.equal(alerts[0].indicator, "orange");
      const match = alerts[0].message.match(/ <a href="([^"]*)">([^<]*)<\/a>$/);
      assert.ok(match, alerts[0].message);
      context.location = new URL(match[1], "https://example.com");
      assert.equal(context.location.hash, "");
      assert.equal(
        context.frappe.router.is_app_route(context.location.pathname),
        true
      );
      context.frappe.route_options = null;
      assert.deepEqual(plain(await context.frappe.router.parse()), [
        "query-report",
        report,
      ]);
      assert.deepEqual(plain(context.frappe.route_options), {
        prepared_report_name: name,
      });
      assert.deepEqual(forbidden, []);
      return match[2];
    },
  };
}

function event(values = {}) {
  return {
    report_name: "Stock Balance",
    name: "PR-FINISHED",
    status: "Completed",
    is_standard: true,
    ...values,
  };
}

test("completed standard report uses a complete Italian frame and canonical modern route", async () => {
  const f = fixture();
  f.emit(event());
  assert.ok(
    f.alerts[0].message.startsWith("Il report Giacenze di magazzino è pronto. ")
  );
  assert.equal(await f.link("Stock Balance", "PR-FINISHED"), "Visualizza");
  assert.deepEqual(f.deliveries, [["button", "disabled", false]]);
});

test("failed standard report is described as failed rather than successfully generated", async () => {
  const f = fixture();
  f.emit(event({ status: "Error" }));
  assert.ok(
    f.alerts[0].message.startsWith(
      "Impossibile generare il report Giacenze di magazzino. "
    )
  );
  assert.doesNotMatch(f.alerts[0].message, /generated|è pronto/);
  assert.equal(await f.link("Stock Balance", "PR-FINISHED"), "Visualizza");
});

test("another completed report retains the event identity while the singleton remains unchanged", async () => {
  const f = fixture({ open: "Sales" });
  f.emit(event());
  assert.ok(
    f.alerts[0].message.startsWith("Il report Giacenze di magazzino è pronto. ")
  );
  await f.link("Stock Balance", "PR-FINISHED");
  assert.equal(f.instance.report_name, "Sales");
});

test("explicit custom provenance overrides a stale standard descriptor and global name collision", async () => {
  const f = fixture({ open: "Sales", standard: "Yes" });
  f.emit(event({ report_name: "Sales", is_standard: false }));
  assert.ok(f.alerts[0].message.startsWith("Il report Sales è pronto. "));
  assert.doesNotMatch(f.alerts[0].message, /Vendite/);
  await f.link("Sales", "PR-FINISHED");
});

test("legacy payload uses only matching cached standard provenance and a neutral outcome", async () => {
  const f = fixture();
  f.emit({ report_name: "Stock Balance", name: "PR-LEGACY" });
  assert.ok(
    f.alerts[0].message.startsWith(
      "L’elaborazione del report Giacenze di magazzino è terminata. "
    )
  );
  await f.link("Stock Balance", "PR-LEGACY");
});

test("legacy other, unknown and custom names are kept raw without metadata or RPC reads", async () => {
  for (const values of [
    { open: "Stock Balance", standard: "Yes" },
    { open: "Sales", standard: "No" },
    { open: "Sales", standard: null },
  ]) {
    const f = fixture(values);
    f.emit({ report_name: "Sales", name: "PR-LEGACY", status: "Unknown" });
    assert.ok(
      f.alerts[0].message.startsWith(
        "L’elaborazione del report Sales è terminata. "
      )
    );
    assert.doesNotMatch(f.alerts[0].message, /Vendite/);
    await f.link("Sales", "PR-LEGACY");
  }
});

test("matching prepared IDs preserve refresh and global unlock even for errors or another report", () => {
  for (const status of ["Completed", "Error"]) {
    const f = fixture({ open: "Sales" });
    f.emit(event({ name: "PR-ACTIVE", status }));
    assert.deepEqual(f.alerts, []);
    assert.deepEqual(f.deliveries, [
      ["button", "disabled", false],
      ["refresh"],
    ]);
  }
});

test("missing event report names preserve no-alert and global unlock behavior", () => {
  for (const report_name of [undefined, null, ""]) {
    const f = fixture();
    const data = event({ report_name });
    if (report_name === undefined) delete data.report_name;
    f.emit(data);
    assert.deepEqual(f.alerts, []);
    assert.deepEqual(f.deliveries, [["button", "disabled", false]]);
  }
});

test("hostile names and prepared IDs are escaped while actual router parsing preserves canonical values", async () => {
  for (const [report_name, name] of [
    ['Report "quoted" <img src=x> & = `', 'PR"<&>'],
    ["Report/with/slash", "PR/SLASH"],
    ["Report 50%", "PR 50%"],
    ["Report?&=#", "PR?&=#"],
    ["Caffè Ω", "PR-caffè Ω"],
    ["Report + plus", "PR + plus"],
  ]) {
    const f = fixture();
    f.emit(event({ report_name, name, is_standard: false }));
    assert.ok(
      f.alerts[0].message.startsWith(
        `Il report ${f.context.frappe.utils.escape_html(
          report_name
        )} è pronto. `
      )
    );
    assert.doesNotMatch(
      f.alerts[0].message,
      /<img|<script|href="[^"]*"[^>]*on/
    );
    assert.equal(await f.link(report_name, name), "Visualizza");
  }
  const f = fixture();
  f.context.location = new URL(
    "#query-report/Stock%20Balance/?prepared_report_name=PR-LEGACY",
    "https://example.com/desk/query-report/Sales"
  );
  assert.deepEqual(plain(await f.context.frappe.router.parse()), [
    "query-report",
    "Sales",
  ]);
  assert.deepEqual(plain(f.context.frappe.route_options), {});
});

test("empty dictionaries retain whole English fallbacks and the delegated action binding", async () => {
  for (const [status, expected] of [
    ["Completed", "Report Stock Balance is ready."],
    ["Error", "Report Stock Balance failed to generate."],
    [undefined, "Report Stock Balance has finished processing."],
  ]) {
    const f = fixture({ messages: {} });
    const data = event({ status });
    if (status === undefined) delete data.status;
    f.emit(data);
    assert.ok(f.alerts[0].message.startsWith(`${expected} `));
    assert.equal(await f.link("Stock Balance", "PR-FINISHED"), "View");
    assert.equal(f.bindings.length, 1);
    assert.deepEqual(f.bindings[0].slice(0, 2), ["click", "[data-action]"]);
    let received;
    f.instance.memory_action = function (e) {
      received = [this, e];
    };
    const e = { currentTarget: { dataset: { action: "memory_action" } } };
    f.bindings[0][2](e);
    assert.deepEqual(received, [f.instance, e]);
  }
});
