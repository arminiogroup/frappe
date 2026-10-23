import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

function setup() {
  const dropdowns = [];
  function $(value) {
    if (typeof value !== "string") return value;
    const dropdown = {
      html: value,
      label: null,
      appendTo() {},
      prependTo() {},
      find() {
        return {
          on: (_event, _selector, callback) => (dropdown.click = callback),
        };
      },
    };
    dropdowns.push(dropdown);
    return dropdown;
  }
  const sandbox = {
    $,
    jQuery: $,
    Widget: class {},
    frappe: {
      widget: { utils: {} },
      dashboards: { chart_sources: {} },
      provide() {},
      utils: { icon: () => "" },
      _messages: {
        More: "Altro",
        "More:Heatmap legend": "Più",
        Less: "Meno",
        "Last Month": "Mese scorso",
        "Last Month:Dashboard Chart": "Ultimo mese",
        "Last Week": "Settimana scorsa",
        "Last Week:Dashboard Chart": "Ultima settimana",
        "Last Quarter:Dashboard Chart": "Ultimi tre mesi",
        "Last Year:Dashboard Chart": "Ultimo anno",
      },
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const path of [
    "../format.js",
    "../translate.js",
    "../utils/dashboard_utils.js",
  ]) {
    vm.runInContext(
      readFileSync(new URL(path, import.meta.url), "utf8"),
      context
    );
  }
  const chartSource = readFileSync(
    new URL("./chart_widget.js", import.meta.url),
    "utf8"
  )
    .replace('import Widget from "./base_widget.js";', "")
    .replace("export default class ChartWidget", "class ChartWidget");
  vm.runInContext(chartSource, context);
  const widget = vm.runInContext(
    "Object.create(ChartWidget.prototype)",
    context
  );
  return { sandbox, widget, dropdowns };
}

test("chart recent-span menu and selected caption retain context with canonical actions", () => {
  const { sandbox, widget, dropdowns } = setup();
  widget.chart_doc = {
    type: "Line",
    timespan: "Last Year",
    time_interval: "Daily",
  };
  widget.chart_settings = { timespan: "Last Month", time_interval: "Daily" };
  let saved;
  let refreshed = 0;
  widget.save_chart_config_for_user = (settings) => (saved = settings);
  widget.fetch_and_update_chart = () => refreshed++;
  const filters = widget.get_time_series_filters();
  sandbox.frappe.dashboard_utils.render_chart_filters(
    filters,
    "chart-actions",
    {},
    0
  );
  const dropdown = dropdowns[1];
  assert.match(dropdown.html, /Ultimo mese/);
  assert.match(dropdown.html, /Ultima settimana/);
  assert.match(dropdown.html, /Ultimi tre mesi/);
  assert.match(dropdown.html, /Ultimo anno/);
  assert.doesNotMatch(dropdown.html, /Mese scorso|Settimana scorsa/);
  assert.match(dropdown.html, /data-option="Last%20Week"/);
  dropdown.click({
    currentTarget: {
      attr: () => undefined,
      data: () => "Last%20Week",
      parents: () => ({
        find: () => ({ html: (label) => (dropdown.label = label) }),
      }),
    },
  });
  assert.equal(dropdown.label, "Ultima settimana");
  assert.equal(saved.timespan, "Last Week");
  assert.equal(saved.from_date, null);
  assert.equal(saved.to_date, null);
  assert.equal(refreshed, 1);
  assert.equal(sandbox.__("Last Week"), "Settimana scorsa");
});

test("generic chart filter callers retain default labels, values and fieldnames", () => {
  const { sandbox, dropdowns } = setup();
  let action;
  sandbox.frappe.dashboard_utils.render_chart_filters(
    [
      {
        label: "Last Month",
        options: ["Last Week"],
        fieldnames: ["posting_date"],
        action: (...args) => (action = args),
      },
    ],
    "custom-actions",
    {},
    1
  );
  const dropdown = dropdowns[0];
  assert.match(dropdown.html, /Mese scorso/);
  assert.match(dropdown.html, /Settimana scorsa/);
  assert.match(dropdown.html, /data-fieldname="posting_date"/);
  dropdown.click({
    currentTarget: {
      attr: () => "posting_date",
      data: () => "Last%20Week",
      parents: () => ({
        find: () => ({ html: (label) => (dropdown.label = label) }),
      }),
    },
  });
  assert.deepEqual(Array.from(action), ["Last Week", "posting_date"]);
  assert.equal(dropdown.label, "Settimana scorsa");
});

test("classic heatmap legend expresses increasing intensity without changing colors or guards", () => {
  const { widget, sandbox } = setup();
  widget.custom_options = JSON.stringify({
    colors: ["#111111", "#222222", "#333333", "#444444", "#555555"],
  });
  widget.chart_doc = {
    custom_options: JSON.stringify({
      colors: ["#123456", "#234567", "#345678", "#456789", "#567890"],
    }),
  };
  const original = JSON.stringify(widget.chart_doc);
  let appended = [];
  widget.body = { append: (value) => appended.push(value) };
  widget.widget = { width: () => 991 };
  widget.render_heatmap_legend();
  assert.equal(appended.length, 0);
  widget.widget.width = () => 1200;
  widget.render_heatmap_legend();
  assert.equal(appended.length, 1);
  const html = appended[0].html;
  assert.deepEqual(
    [...html.matchAll(/background-color: (#[a-f0-9]+)/g)].map((m) => m[1]),
    ["#123456", "#234567", "#345678", "#456789", "#567890"]
  );
  widget.render_heatmap_legend();
  assert.equal(appended.length, 1);
  assert.equal(JSON.stringify(widget.chart_doc), original);
  assert.match(html, />Meno<\/div>/);
  assert.match(html, />Più<\/div>/);
  assert.doesNotMatch(html, /Altro|Altri risultati/);
  assert.equal(sandbox.__("More"), "Altro");
});
