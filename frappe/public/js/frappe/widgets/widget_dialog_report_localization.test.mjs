import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

function setup() {
  const queries = [];
  const $ = Object.assign(() => ({ on() {} }), { extend: Object.assign });
  const sandbox = {
    $,
    jQuery: $,
    addEventListener() {},
    deep_equal() {},
    number_systems: {},
    CHART_PALETTE: [],
    frappe: {
      provide(path) {
        let target = this;
        for (const part of path.split(".").slice(1))
          target = target[part] ??= {};
      },
      _messages: {
        "Is Query Report": "Report basato su query",
        "Query, Script, or Custom Report":
          "Report basato su query o script, oppure personalizzato",
        Login: "Accedi",
        "Login:Dashboard Chart": "Accessi",
      },
      db: {
        get_value: (doctype, name, field) => {
          queries.push({ doctype, name, field });
          return Promise.resolve({
            message: { report_type: sandbox.report_type },
          });
        },
      },
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const path of [
    "../format.js",
    "../translate.js",
    "../utils/utils.js",
    "../event_emitter.js",
    "../router.js",
    "./widget_dialog.js",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8")
      .replace(/^import .+;\n/gm, "")
      .replace("export default function", "function")
      .replace(/^export default EventEmitterMixin;\n/m, "");
    vm.runInContext(source, context);
  }
  const card = vm.runInContext(
    'new (get_dialog_constructor("links"))({})',
    context
  );
  const fields = card
    .get_fields()
    .find((field) => field.fieldname === "links").fields;
  return { sandbox, context, queries, fields };
}

test("report flag caption describes query, script and custom report families", () => {
  const { fields } = setup();
  const field = fields.find((field) => field.fieldname === "is_query_report");
  assert.equal(
    field.label,
    "Report basato su query o script, oppure personalizzato"
  );
  assert.equal(field.fieldname, "is_query_report");
  assert.equal(field.fieldtype, "Check");
  assert.equal(field.default, "0");
});

test("actual CardDialog onchange and route generator preserve all four standard report types", async () => {
  const { sandbox, fields, queries } = setup();
  const onchange = fields.find(
    (field) => field.fieldname === "link_to"
  ).onchange;
  for (const report_type of [
    "Report Builder",
    "Query Report",
    "Script Report",
    "Custom Report",
  ]) {
    sandbox.report_type = report_type;
    const row = { doc: { link_type: "Report", link_to: "REPORT-UNCHANGED" } };
    onchange.call(row);
    await new Promise(setImmediate);
    assert.equal(row.doc.is_query_report, report_type !== "Report Builder");
    assert.equal(row.doc.link_to, "REPORT-UNCHANGED");
    const route = sandbox.frappe.utils.generate_route({
      type: row.doc.link_type,
      name: row.doc.link_to,
      is_query_report: row.doc.is_query_report,
      report_ref_doctype: "ToDo",
    });
    assert.equal(
      route,
      report_type === "Report Builder"
        ? "/desk/todo/view/report/REPORT-UNCHANGED"
        : "/desk/query-report/REPORT-UNCHANGED"
    );
  }
  assert.deepEqual(
    queries,
    Array.from({ length: 4 }, () => ({
      doctype: "Report",
      name: "REPORT-UNCHANGED",
      field: "report_type",
    }))
  );
});

test("non-report links retain their original onchange behavior", () => {
  const { fields, queries } = setup();
  const row = {
    doc: { link_type: "DocType", link_to: "ToDo", is_query_report: false },
  };
  fields.find((field) => field.fieldname === "link_to").onchange.call(row);
  assert.deepEqual(queries, []);
  assert.deepEqual(row.doc, {
    link_type: "DocType",
    link_to: "ToDo",
    is_query_report: false,
  });
});

test("existing chart title context and user-supplied labels remain intact", () => {
  const { context } = setup();
  const chart = vm.runInContext(
    'new (get_dialog_constructor("chart"))({})',
    context
  );
  const generated = chart.process_data({ chart_name: "Login" });
  assert.equal(generated.label, "Accessi");
  assert.equal(generated.chart_name, "Login");
  const custom = chart.process_data({
    chart_name: "Login",
    label: "My unchanged label",
  });
  assert.equal(custom.label, "My unchanged label");
  assert.equal(custom.chart_name, "Login");
});
