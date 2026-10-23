import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const plain = (value) => JSON.parse(JSON.stringify(value));
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

function setup() {
  const dialogs = [];
  const groups = [];
  const rendered = [];
  const requests = [];
  const $ = (value) => value;
  const sandbox = {
    $,
    jQuery: $,
    frappe: {
      provide() {},
      views: { ListView: class {} },
      pages: { "dashboard-view": {} },
      widget: { utils: {} },
      dashboards: { chart_sources: {} },
      utils: {
        unescape_html: (value) => String(value).replaceAll("&amp;", "&"),
      },
      ellipsis: (value, length) =>
        value.length > length ? `${value.slice(0, length)}...` : value,
      dashboard_utils: {
        get_dashboard_settings: () =>
          Promise.resolve({
            chart_config: '{"Login":{"filters":{"user":"demo@example.test"}}}',
          }),
      },
      ui: {},
      _messages: {
        Login: "Accedi",
        "Login:Dashboard Chart": "Accessi",
        Sales: "Vendite",
        "Set Filters for {0}": "Imposta filtri per {0}",
      },
      xcall: (method, args) => {
        requests.push({ method, args: plain(args) });
        return Promise.resolve({ chart_name: args.args.chart_name });
      },
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  function load(path, transform = (value) => value) {
    vm.runInContext(
      transform(readFileSync(new URL(path, import.meta.url), "utf8")),
      context
    );
  }
  load("../format.js");
  load("../translate.js");
  load("./widget_dialog.js", (source) =>
    source.replace("export default function", "function")
  );
  load("./base_widget.js", (source) =>
    source
      .replace(/^import .*;\n/m, "")
      .replace("export default class Widget", "class Widget")
  );
  load("./chart_widget.js", (source) =>
    source
      .replace(/^import .*;\n/m, "")
      .replace("export default class ChartWidget", "class ChartWidget")
  );
  load("../views/workspace/blocks/block.js", (source) =>
    source
      .replace(/^import .*;\n/m, "")
      .replace("export default class Block", "class Block")
  );
  load("../views/dashboard/dashboard_view.js");
  load("../../../../core/page/dashboard_view/dashboard_view.js");
  const classes = vm.runInContext(
    "({ Widget, ChartWidget, Block, ChartDialog, Dashboard })",
    context
  );
  function frame(prototype, options) {
    const widget = Object.assign(Object.create(prototype), options);
    const element = {
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
    };
    Object.assign(widget, {
      title_field: [element],
      subtitle_field: { html() {} },
      widget: { width: () => 900, addClass() {} },
    });
    return widget;
  }
  function renderChart(options) {
    const chart = frame(classes.ChartWidget.prototype, options);
    chart.set_chart_title();
    rendered.push(chart);
    return chart;
  }
  class Group {
    constructor(options) {
      Object.assign(this, options);
      this.container = { find: () => ({ hide() {} }) };
      groups.push(this);
      if (this.type === "chart") {
        this.widgets_list = (
          Array.isArray(options.widgets) ? options.widgets : [options.widgets]
        ).map(renderChart);
      }
    }
  }
  sandbox.frappe.widget.WidgetGroup = Group;
  sandbox.frappe.widget.SingleWidgetGroup = Group;
  sandbox.frappe.ui.Dialog = class {
    constructor(options) {
      Object.assign(this, options);
      dialogs.push(this);
    }
    show() {}
    hide() {
      this.hidden = true;
    }
    set_values(values) {
      this.values = values;
    }
  };
  return {
    sandbox,
    classes,
    frame,
    renderChart,
    dialogs,
    groups,
    rendered,
    requests,
  };
}

test("chart frame uses chart context while default widget and custom captions retain their behavior", () => {
  const { sandbox, classes, frame, renderChart } = setup();
  const chart = renderChart({
    name: "Login",
    chart_name: "Login",
    label: "Login",
    hidden: 0,
    width: "Half",
  });
  assert.match(chart.title_field[0].innerHTML, />Accessi<\/span>/);
  assert.equal(chart.title_field[0].attributes.title, "Accessi");
  assert.deepEqual(plain(chart.get_config()), {
    name: "Login",
    chart_name: "Login",
    label: "Login",
    hidden: 0,
    width: "Half",
  });
  const generic = frame(classes.Widget.prototype, { label: "Login" });
  generic.set_title(60);
  assert.match(generic.title_field[0].innerHTML, />Accedi<\/span>/);
  assert.equal(generic.title_field[0].attributes.title, "Login");
  const custom = renderChart({ label: "Caffè aziendale", chart_name: "Login" });
  assert.match(custom.title_field[0].innerHTML, />Caffè aziendale<\/span>/);
  assert.equal(custom.title_field[0].attributes.title, "Caffè aziendale");
  assert.equal(sandbox.__("Login"), "Accedi");
});

test("chart tooltip translates the full source caption while default truncation and canonical names stay unchanged", () => {
  const { classes, frame } = setup();
  const chart = frame(classes.ChartWidget.prototype, {
    name: "Login",
    chart_name: "Login",
    label: "Login",
  });
  chart.set_title(3, "Dashboard Chart");
  assert.equal(chart.title_field[0].attributes.title, "Accessi");
  assert.match(chart.title_field[0].innerHTML, />Log\.\.\.<\/span>/);
  assert.deepEqual(plain(chart.get_config()), {
    name: "Login",
    chart_name: "Login",
    label: "Login",
  });
  const ordinary = frame(classes.Widget.prototype, { label: "Login" });
  ordinary.set_title(3);
  assert.equal(ordinary.title_field[0].attributes.title, "Login");
  assert.match(ordinary.title_field[0].innerHTML, />Log\.\.\.<\/span>/);
});

test("DashboardView render and existing-chart producer keep contextual labels with canonical settings and names", async () => {
  const { sandbox, dialogs, rendered, requests } = setup();
  const view = Object.create(sandbox.frappe.views.DashboardView.prototype);
  const chart = { name: "Login", chart_name: "Login", label: "Login" };
  Object.assign(view, {
    charts: [chart],
    number_cards: [],
    $dashboard_wrapper: { empty() {} },
    render_number_cards() {},
    doctype: "Activity Log",
  });
  view.render_dashboard();
  await flush();
  assert.equal(chart.label, "Accessi");
  assert.equal(chart.name, "Login");
  assert.equal(chart.chart_name, "Login");
  assert.deepEqual(plain(chart.chart_settings), {
    filters: { user: "demo@example.test" },
  });
  assert.match(rendered[0].title_field[0].innerHTML, />Accessi<\/span>/);
  let created;
  view.chart_group.new_widget = {
    on_create: (value) => {
      created = value;
    },
  };
  view.get_field_options = () => ({
    value_fields: [],
    date_fields: [],
    aggregate_function_fields: [],
    group_by_fields: [],
  });
  view.show_add_chart_dialog();
  dialogs[0].primary_action({
    new_or_existing: "Existing Chart",
    chart: "Login",
  });
  assert.deepEqual(plain(created), {
    chart_name: "Login",
    label: "Accessi",
    name: "Login",
  });
  await dialogs[0].primary_action({
    new_or_existing: "New Chart",
    label: "Caffè aziendale",
    chart_type: "Time Series",
    chart_function: "Count",
  });
  assert.equal(created.label, "Caffè aziendale");
  assert.equal(created.chart_name, "Caffè aziendale");
  assert.equal(requests[0].args.args.document_type, "Activity Log");
  assert.equal(requests[0].args.args.chart_type, "Count");
  assert.equal(requests[0].args.args.filters_json, "[]");
});

test("ChartDialog fallback is contextual and preserves supplied labels and canonical data", () => {
  const { classes } = setup();
  const dialog = new classes.ChartDialog({ type: "chart" });
  const fallback = { chart_name: "Login", name: "CHART-ROW", width: "Half" };
  assert.equal(dialog.process_data(fallback), fallback);
  assert.deepEqual(fallback, {
    chart_name: "Login",
    name: "CHART-ROW",
    width: "Half",
    label: "Accessi",
  });
  const supplied = {
    chart_name: "Login",
    label: "Caffè aziendale",
    name: "CHART-ROW",
  };
  assert.equal(dialog.process_data(supplied), supplied);
  assert.deepEqual(supplied, {
    chart_name: "Login",
    label: "Caffè aziendale",
    name: "CHART-ROW",
  });
  assert.equal(dialog.process_data({ chart_name: "Sales" }).label, "Vendite");
});

test("chart filter dialog uses the same title context and keeps filter callbacks canonical", () => {
  const { classes, dialogs } = setup();
  const chart = Object.create(classes.ChartWidget.prototype);
  chart.chart_doc = {
    chart_name: "Login",
    chart_type: "Count",
    filters_json: "[]",
  };
  chart.filters = { user: "demo@example.test" };
  const original = JSON.stringify(chart.chart_doc);
  let saved;
  let refreshed = 0;
  chart.save_chart_config_for_user = (value) => {
    saved = value;
  };
  chart.fetch_and_update_chart = () => refreshed++;
  const fields = [{ fieldname: "user", fieldtype: "Data" }];
  chart.setup_filter_dialog(fields);
  assert.equal(dialogs[0].title, "Imposta filtri per Accessi");
  assert.equal(dialogs[0].fields, fields);
  assert.equal(dialogs[0].values, chart.filters);
  const values = { user: "other@example.test" };
  dialogs[0].primary_action.call(dialogs[0], values);
  assert.equal(saved.filters, values);
  assert.equal(chart.filters, values);
  assert.equal(refreshed, 1);
  assert.equal(dialogs[0].hidden, true);
  assert.equal(JSON.stringify(chart.chart_doc), original);
});

test("workspace block lookup matches contextual server labels and keeps legacy and custom label identities", () => {
  const { classes, rendered } = setup();
  function block(items, type = "chart") {
    const value = Object.create(classes.Block.prototype);
    value.wrapper = {
      attributes: {},
      innerHTML: "old",
      setAttribute(name, text) {
        this.attributes[name] = text;
      },
    };
    value.config = { page_data: { [`${type}s`]: { items } } };
    value.readOnly = true;
    return value;
  }
  const row = {
    name: "ROW-1",
    chart_name: "Login",
    label: "Accessi",
    width: "Half",
  };
  const canonical = block([row]);
  assert.equal(canonical.make("chart", "Login"), true);
  assert.equal(canonical.wrapper.attributes.chart_name, "Login");
  assert.equal(canonical.block_widget.widgets, row);
  assert.match(rendered[0].title_field[0].innerHTML, />Accessi<\/span>/);
  assert.equal(rendered[0].get_config().chart_name, "Login");
  const legacy = block([{ ...row }]);
  assert.equal(legacy.make("chart", "Accessi"), true);
  assert.equal(legacy.wrapper.attributes.chart_name, "Accessi");
  const supplied = block([
    { chart_name: "CANONICAL-CHART", label: "Caffè &amp; tè" },
  ]);
  assert.equal(supplied.make("chart", "Caffè & tè"), true);
  assert.equal(supplied.block_widget.widgets.chart_name, "CANONICAL-CHART");
  const ordinary = block([{ label: "Accedi", link_to: "Login" }], "shortcut");
  assert.equal(ordinary.make("shortcut", "Login"), true);
  assert.equal(ordinary.wrapper.attributes.shortcut_name, "Login");
  assert.equal(block([row]).make("chart", "Missing"), false);
});

test("classic Dashboard raw chart rows reach the same contextual ChartWidget frame", async () => {
  const { classes, rendered, groups } = setup();
  const dashboard = Object.create(classes.Dashboard.prototype);
  const row = { chart: "Login", width: "Full", name: "DASHBOARD-ROW" };
  Object.assign(dashboard, {
    get_permitted_items: () => Promise.resolve([row]),
    container: {},
    destroyed: false,
  });
  await dashboard.render_charts();
  await flush();
  assert.match(rendered[0].title_field[0].innerHTML, />Accessi<\/span>/);
  assert.equal(groups[0].widgets[0].chart_name, "Login");
  assert.equal(groups[0].widgets[0].name, "DASHBOARD-ROW");
  assert.deepEqual(row, {
    chart: "Login",
    width: "Full",
    name: "DASHBOARD-ROW",
  });
  assert.deepEqual(plain(groups[0].widgets[0].chart_settings), {
    filters: { user: "demo@example.test" },
  });
});
