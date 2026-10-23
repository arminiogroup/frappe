import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const jquery = require("jquery");
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path) => readFileSync(resolve(root, path), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));

function host(t) {
  const dom = new JSDOM("<!doctype html><body></body>");
  t.after(() => dom.window.close());
  const $ = jquery(dom.window);
  const storage = new Map([
    ["tracker_url:url", "https://example.com/page"],
    ["tracker_url:medium", "Medium"],
  ]);
  const requests = [];
  const copied = [];
  const notices = [];
  let prompt;
  const frappe = {
    _messages: {
      Medium: "Media",
      "Medium:UTM Medium": "Canale",
      Canale: "SECOND PASS",
      Comment: "Commento",
    },
    provide() {},
    query_reports: {},
    standard_pages: {},
    widget: { utils: {} },
    views: { BaseList: class {} },
    ui: { form: {} },
    defaults: { is_enabled: () => false },
    utils: {},
    model: {},
    datetime: { now_date: () => "2026-10-21", add_days: () => "2026-07-13" },
    db: {
      async get_value(doctype, name, field) {
        requests.push([doctype, name, field]);
        return {
          message: { slug: doctype === "UTM Medium" ? "Banner / IT" : "" },
        };
      },
    },
    prompt(fields, callback, title) {
      prompt = { fields, callback, title };
    },
    msgprint: (...args) => notices.push(args),
  };
  const sandbox = {
    frappe,
    $,
    jQuery: $,
    DataTable: class {},
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const path of [
    "frappe/public/js/frappe/format.js",
    "frappe/public/js/frappe/translate.js",
  ]) {
    vm.runInContext(read(path), context);
  }
  vm.runInContext(
    read("frappe/public/js/frappe/utils/utils.js")
      .replace('import deep_equal from "fast-deep-equal";', "")
      .replace('import number_systems from "./number_systems";', "")
      .replace(
        'import { CHART_PALETTE } from "../ui/components/utils.js";',
        ""
      ),
    context
  );
  frappe.utils.copy_to_clipboard = (value) => copied.push(value);
  vm.runInContext(
    read("frappe/website/report/website_analytics/website_analytics.js"),
    context
  );
  vm.runInContext(
    read("frappe/public/js/frappe/views/reports/report_utils.js"),
    context
  );
  vm.runInContext(
    read("frappe/public/js/frappe/views/reports/query_report.js").replace(
      'import DataTable from "frappe-datatable";',
      ""
    ),
    context
  );
  vm.runInContext(
    read("frappe/public/js/frappe/form/sidebar/assign_to.js"),
    context
  );
  return { frappe, requests, copied, notices, storage, prompt: () => prompt };
}

test("analytics group selector localizes channel but keeps canonical grouping values", (t) => {
  const { frappe } = host(t);
  const settings = frappe.query_reports["Website Analytics"];
  const grouping = settings.filters.find(
    (field) => field.fieldname === "group_by"
  );
  assert.equal(
    grouping.options.find((option) => option.value === "medium").label,
    "Canale"
  );
  assert.deepEqual(plain(grouping.options.map((option) => option.value)), [
    "path",
    "browser",
    "referrer",
    "source",
    "campaign",
    "medium",
    "content",
  ]);
  assert.equal(grouping.default, "path");
  frappe.query_report = { get_filter_value: () => "medium" };
  const calls = [];
  const businessValue = "Medium & <banner>";
  const result = settings.formatter(
    businessValue,
    0,
    { id: "medium" },
    {},
    (value) => {
      calls.push(value);
      return value;
    }
  );
  assert.equal(result, "Medium &amp; &lt;banner&gt;");
  assert.deepEqual(calls, [result]);
});

test("tracking prompt keeps raw data, Link targets, slug fallback and optional URL parts", async (t) => {
  const { frappe, requests, copied, notices, storage, prompt } = host(t);
  frappe.utils.generate_tracking_url();
  const form = prompt();
  const medium = form.fields.find((field) => field.fieldname === "medium");
  assert.equal(medium.label, "Canale");
  assert.equal(medium.default, "Medium");
  assert.equal(medium.options, "UTM Medium");
  assert.equal(medium.fieldtype, "Link");
  assert.equal(
    medium.description,
    "Marketing medium (e.g. cpc, banner, email)"
  );
  assert.deepEqual(plain(form.fields.map((field) => field.fieldname)), [
    "url",
    "source",
    "campaign",
    "medium",
    "content",
  ]);
  const data = {
    url: "https://example.com/page",
    source: "Referral & email",
    campaign: "Autunno / caffè",
    medium: "Medium",
    content: "Variante A & B",
  };
  const before = { ...data };
  await form.callback(data);
  assert.deepEqual(data, before);
  assert.deepEqual(requests, [
    ["UTM Source", data.source, "slug"],
    ["UTM Campaign", data.campaign, "slug"],
    ["UTM Medium", "Medium", "slug"],
  ]);
  assert.equal(
    copied[0],
    data.url +
      "?utm_source=" +
      encodeURIComponent(data.source) +
      "&utm_campaign=" +
      encodeURIComponent(data.campaign) +
      "&utm_medium=" +
      encodeURIComponent("Banner / IT") +
      "&utm_content=" +
      encodeURIComponent(data.content)
  );
  assert.equal(storage.get("tracker_url:medium"), "Medium");
  assert.equal(storage.get("tracker_url:campaign"), data.campaign);
  assert.ok(notices[0][0].includes(copied[0]));
  requests.length = 0;
  await form.callback({
    url: "https://example.com/minimal",
    source: "Reference",
  });
  assert.deepEqual(requests, [["UTM Source", "Reference", "slug"]]);
  assert.equal(copied[1], "https://example.com/minimal?utm_source=Reference");
});

test("actual report receiver retains translated server and supplied labels", (t) => {
  const { frappe } = host(t);
  const report = Object.create(frappe.views.QueryReport.prototype);
  Object.assign(report, { report_doc: {}, report_settings: {} });
  const server = {
    fieldname: "medium",
    label: "Canale",
    fieldtype: "Data",
    width: 500,
    align: "left",
  };
  const columns = report.prepare_columns([server]);
  assert.equal(columns[0].name, "Canale");
  assert.equal(columns[0].id, "medium");
  assert.equal(columns[0].width, 500);
  assert.equal(columns[0].align, "left");
  assert.equal(
    report.prepare_columns([
      { fieldname: "custom", label: "Medium", fieldtype: "Data" },
    ])[0].name,
    "Medium"
  );
  report.report_doc.query = "select medium from example";
  assert.equal(
    report.prepare_columns([
      { fieldname: "medium", label: "Medium", fieldtype: "Data" },
    ])[0].name,
    "Media"
  );
});

test("assignment priority and comment remain their canonical values and noun labels", (t) => {
  const { frappe } = host(t);
  const assign = Object.create(frappe.ui.form.AssignToDialog.prototype);
  assign.frm = { doc: { priority: "Medium" } };
  const fields = assign.get_fields();
  const priority = fields.find((field) => field.fieldname === "priority");
  assert.deepEqual(plain(priority.options), [
    { value: "Low", label: "Low" },
    { value: "Medium", label: "Media" },
    { value: "High", label: "High" },
  ]);
  assert.equal(
    fields.find((field) => field.fieldname === "description").label,
    "Commento"
  );
  assert.equal(assign.frm.doc.priority, "Medium");
});
