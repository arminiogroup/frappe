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
const ts = require("typescript");
const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const read = (path) => readFileSync(resolve(root, path), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));

function host(t) {
  const dom = new JSDOM("<!doctype html><body></body>");
  t.after(() => dom.window.close());
  const $ = jquery(dom.window);
  const timers = [];
  $.fn.dropdown = function () {
    return this;
  };
  const frappe = {
    _messages: {
      Like: "Mi piace",
      "Like:Filter Operator": "Contiene",
      Contiene: "SECOND PASS",
      "Custom condition": "Etichetta personalizzata",
      "Etichetta personalizzata": "SECOND PASS",
      "Greater Than": "Maggiore di",
      "Maggiore di": "SECOND PASS",
      Before: "Prima",
      Item: "Articolo",
      legacy: "Condizione precedente",
    },
    boot: { additional_filters_config: {}, nested_set_doctypes: [] },
    provide() {},
    views: {},
    ui: {},
    form: {},
    meta: { docfield_map: {} },
    get_meta: () => ({}),
    utils: { icon: (name) => `<svg data-icon="${name}"></svg>` },
    dom: { remove_script_and_style: (value) => value },
  };
  const sandbox = {
    frappe,
    $,
    jQuery: $,
    setTimeout: (callback, ms) => timers.push({ callback, ms }),
    strip: (value) => value.trim(),
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const path of [
    "frappe/public/js/frappe/format.js",
    "frappe/public/js/frappe/translate.js",
  ])
    vm.runInContext(read(path), context);
  const helper = ts.transpileModule(
    read("frappe/public/js/frappe/utils/select_option_context.ts"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }
  ).outputText;
  sandbox.exports = {};
  vm.runInContext(helper, context);
  sandbox.selectOptionContext = sandbox.exports.selectOptionContext;
  vm.runInContext(
    read("frappe/public/js/frappe/form/formatters.js").replace(
      'import { selectOptionContext } from "../utils/select_option_context";',
      ""
    ),
    context
  );
  vm.runInContext(
    read("frappe/public/js/frappe/ui/filters/filter.js"),
    context
  );
  vm.runInContext(
    read("frappe/public/js/frappe/list/base_list.js").replace(
      'import { safe_href } from "../ui/components/utils.js";',
      ""
    ) + "\nglobalThis.FilterArea = FilterArea;",
    context
  );
  return { $, frappe, sandbox, timers };
}

function filter(host) {
  const { $, frappe } = host;
  const instance = Object.create(frappe.ui.Filter.prototype);
  instance.utils = frappe.ui.filter_utils;
  instance.set_conditions();
  instance.set_conditions_from_config();
  instance.filter_edit_area = $(
    '<div><select class="condition"></select></div>'
  );
  for (const [value, label] of instance.conditions) {
    $("<option>")
      .val(value)
      .text(label)
      .appendTo(instance.filter_edit_area.find("select"));
  }
  instance.field = {
    df: { fieldname: "item", label: "Item", fieldtype: "Data" },
    get_value: () => " caffè ",
  };
  instance.fieldselect = { selected_doctype: "Task" };
  return instance;
}

test("filter predicate dropdown and active tag share the contextual label", (t) => {
  const state = host(t);
  const instance = filter(state);
  instance.set_condition("like");
  assert.equal(
    instance.filter_edit_area.find('option[value="like"]').text(),
    "Contiene"
  );
  instance.set_special_condition_labels("Data");
  assert.equal(
    instance.filter_edit_area.find('option[value="like"]').text(),
    "Contiene"
  );
  assert.equal(instance.get_filter_button_text(), "Articolo Contiene %caffè%");
  assert.deepEqual(plain(instance.get_value()), [
    "Task",
    "item",
    "like",
    "%caffè%",
  ]);
  assert.equal(state.sandbox.__("Like"), "Mi piace");
  assert.equal(
    state.frappe.ui.filter_utils.get_default_condition({
      fieldname: "_liked_by",
      fieldtype: "Data",
      parent: "Task",
    }),
    "like"
  );
});

test("configured and date labels survive without a second dictionary pass", (t) => {
  const state = host(t);
  state.frappe.boot.additional_filters_config = {
    custom: { label: "Custom condition", valid_for_fieldtypes: ["Data"] },
  };
  const instance = filter(state);
  instance.set_condition("custom");
  instance.set_special_condition_labels("Data");
  assert.equal(
    instance.filter_edit_area.find('option[value="custom"]').text(),
    "Etichetta personalizzata"
  );
  assert.equal(
    instance.get_filter_button_text(),
    "Articolo Etichetta personalizzata caffè"
  );
  instance.set_condition("<");
  for (const type of ["Date", "Datetime"]) {
    instance.set_special_condition_labels(type);
    assert.equal(
      instance.filter_edit_area.find('option[value="<"]').text(),
      "Prima"
    );
    assert.equal(instance.get_condition(), "<");
  }
  instance.set_special_condition_labels("Data");
  assert.equal(
    instance.filter_edit_area.find('option[value=">"]').text(),
    "Maggiore di"
  );
});

test("active tag consumes the actual selected display text without translating it again", (t) => {
  const state = host(t);
  const instance = filter(state);
  instance.filter_edit_area.find('option[value="like"]').text("Contiene");
  instance.set_condition("like");
  assert.equal(instance.get_filter_button_text(), "Articolo Contiene %caffè%");
  assert.equal(instance.get_condition(), "like");
});

test("empty or unavailable option display preserves the old raw-condition fallback", (t) => {
  const state = host(t);
  const instance = filter(state);
  state
    .$("<option>")
    .val("legacy")
    .text("")
    .appendTo(instance.filter_edit_area.find("select"));
  instance.set_condition("legacy");
  assert.equal(
    instance.get_filter_button_text(),
    "Articolo Condizione precedente caffè"
  );
  instance.filter_edit_area.find("select").empty();
  assert.equal(instance.get_condition(), null);
  assert.equal(instance.get_filter_button_text(), "Articolo null caffè");
});

test("list match dropdown preserves callbacks, saved operators and wildcard serialization", (t) => {
  const { $, frappe, sandbox, timers } = host(t);
  const settings = [];
  let refreshes = 0;
  let value = "%caffè%";
  const field = {
    df: { fieldname: "item", match_type: "like" },
    $wrapper: $("<div><input></div>"),
    get_value: () => value,
    set_value: (next) => (value = next),
  };
  const area = Object.create(sandbox.FilterArea.prototype);
  area.list_view = {
    doctype: "Task",
    view_name: "List",
    page: { fields_dict: { item: field } },
    save_view_user_settings: (next) => settings.push(plain(next)),
  };
  area.debounced_refresh_list_view = () => refreshes++;
  frappe.get_user_settings = () => ({ filter_conditions: { warehouse: "=" } });
  area.filter_field_with_match_type(field.df);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 100);
  timers.shift().callback();
  assert.equal(
    field.$wrapper.find('[data-match-type="like"]').text(),
    "Contiene"
  );
  field.$wrapper.find('[data-match-type="="]').trigger("click");
  assert.equal(value, "caffè");
  assert.equal(field.df.match_type, "=");
  assert.deepEqual(settings, [
    { filter_conditions: { warehouse: "=", item: "=" } },
  ]);
  assert.equal(refreshes, 1);
  assert.deepEqual(plain(area.get_standard_filters()), [
    ["Task", "item", "=", "caffè"],
  ]);
  field.$wrapper.find('[data-match-type="="]').trigger("click");
  assert.equal(refreshes, 1);
  field.$wrapper.find('[data-match-type="like"]').trigger("click");
  assert.equal(field.df.match_type, "like");
  assert.deepEqual(plain(area.get_standard_filters()), [
    ["Task", "item", "like", "%caffè%"],
  ]);
  value = "%caffè";
  assert.deepEqual(plain(area.get_standard_filters()), [
    ["Task", "item", "like", "%caffè"],
  ]);
  value = "";
  field.$wrapper.find('[data-match-type="="]').trigger("click");
  assert.equal(refreshes, 2);
  assert.deepEqual(plain(area.get_standard_filters()), []);
});

test("missing inputs and existing input groups retain the established timer guards", (t) => {
  const { $, sandbox, timers } = host(t);
  for (const field of [
    undefined,
    { $wrapper: $("<div>") },
    { $wrapper: $('<div class="input-group"><input></div>') },
  ]) {
    const area = Object.create(sandbox.FilterArea.prototype);
    area.list_view = { page: { fields_dict: { item: field } } };
    area.filter_field_with_match_type({ fieldname: "item" });
    timers.shift().callback();
    assert.equal(
      field?.$wrapper.find(".match-type-dropdown-menu").length || 0,
      0
    );
  }
});
