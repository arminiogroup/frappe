import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const sourcePath = (relative) =>
  fileURLToPath(new URL(relative, import.meta.url));
const escape = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function load() {
  const anchors = [];
  const titles = new Map();
  const validated = [];
  const $ = () => {};
  $.fn = { val() {} };
  const sandbox = {
    $,
    jQuery: $,
    cur_frm: {},
    cur_dialog: null,
    document: {
      createElement(tag) {
        assert.equal(tag, "a");
        const anchor = {
          dataset: {},
          get outerHTML() {
            return `<a href="${escape(this.href)}">${escape(
              this.innerText
            )}</a>`;
          },
        };
        anchors.push(anchor);
        return anchor;
      },
    },
    frappe: {
      provide() {},
      boot: { translated_doctypes: ["UOM", "Role"], link_title_doctypes: [] },
      _messages: {
        Set: "Imposta",
        "Set:UOM": "Insieme",
        "Set:Role": "Ruolo Set",
        Minute: "Verbale",
        "Minute:UOM": "Minuto",
        Reference: "Riferimento",
        Uncontextualized: "Traduzione globale",
        Unsafe: "<Insieme & unità>",
        "Unsafe:UOM": "<Unità & insieme>",
      },
      ui: {
        form: {
          ControlData: class {
            validate_and_set_in_model(...args) {
              validated.push(args);
              return args[0];
            }
          },
        },
      },
      form: { formatters: {} },
      views: { BaseList: class {} },
      utils: {
        get_link_title: (doctype, name) => titles.get(`${doctype}::${name}`),
        fetch_link_title: async (doctype, name) =>
          titles.get(`${doctype}::${name}`),
        add_link_title: (doctype, name, title) =>
          titles.set(`${doctype}::${name}`, title),
        escape_html: escape,
        debounce: (callback) => callback,
      },
      model: {
        can_read: () => true,
        is_single: () => false,
        html_fieldtypes: [],
        is_numeric_field: () => false,
      },
      router: { slug: (value) => value.toLowerCase().replaceAll(" ", "-") },
      dom: { remove_script_and_style: (value) => value },
      get_meta: () => ({}),
      is_mobile: () => false,
    },
    Awesomplete: class {
      constructor(input, options) {
        this.input = input;
        this.options = options;
      }
    },
    cstr: (value) => String(value ?? ""),
    cint: (value) => Number.parseInt(value || 0, 10),
    flt: (value) => Number(value),
    strip_html: (value) => String(value).replace(/<[^>]*>/g, ""),
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  const helperPath = new URL(
    "../utils/select_option_context.ts",
    import.meta.url
  );
  if (existsSync(helperPath)) {
    const { transformSync } = createRequire(import.meta.url)("esbuild");
    const helperSource = transformSync(readFileSync(helperPath, "utf8"), {
      loader: "ts",
      format: "esm",
    }).code;
    vm.runInContext(
      helperSource.replace("export {\n  selectOptionContext\n};\n", ""),
      context
    );
  }
  for (const relative of [
    "../format.js",
    "../translate.js",
    "./formatters.js",
  ]) {
    vm.runInContext(
      readFileSync(sourcePath(relative), "utf8").replace(
        'import { selectOptionContext } from "../utils/select_option_context";',
        ""
      ),
      context
    );
  }
  vm.runInContext(
    readFileSync(sourcePath("./controls/link.js"), "utf8").replace(
      'import Awesomplete from "../../ui/awesomplete";',
      ""
    ),
    context
  );
  vm.runInContext(
    readFileSync(sourcePath("./controls/dynamic_link.js"), "utf8"),
    context
  );
  vm.runInContext(
    readFileSync(sourcePath("../list/list_view.js"), "utf8")
      .replace('import BulkOperations from "./bulk_operations";', "")
      .replace('import ListSettings from "./list_settings";', ""),
    context
  );
  function control(doctype) {
    const field = Object.create(sandbox.frappe.ui.form.ControlLink.prototype);
    field.df = { fieldname: "unit", options: doctype };
    field.title_value_map = {};
    field.input = { value: "" };
    field.$input = {
      events: {},
      val(value) {
        if (arguments.length) field.input.value = value;
        return field.input.value;
      },
      on(event, callback) {
        this.events[event] = callback;
        return this;
      },
    };
    return field;
  }
  function list() {
    return Object.assign(
      Object.create(sandbox.frappe.views.ListView.prototype),
      {
        doctype: "Item",
        link_field_title_fields: {},
        settings: {},
        column_max_widths: {},
        get_subject_element: (_doc, title) => ({ innerHTML: escape(title) }),
      }
    );
  }
  return { ...sandbox, anchors, titles, validated, control, list };
}

test("Link input contextual display maps back to the canonical record and title", async () => {
  const env = load();
  const field = env.control("UOM");
  await field.set_link_title("Set");
  assert.equal(field.input.value, "Insieme");
  assert.equal(field.get_input_value(), "Set");
  assert.equal(field.df.options, "UOM");
  env.frappe.boot.link_title_doctypes.push("UOM");
  env.titles.set("UOM::UOM-RAW", "Minute");
  await field.set_link_title("UOM-RAW");
  assert.equal(field.input.value, "Minuto");
  assert.equal(field.get_input_value(), "UOM-RAW");
  assert.equal(env.titles.get("UOM::UOM-RAW"), "Minute");
  assert.equal(env.control("Role").get_translated("Set"), "Ruolo Set");
});

test("Link autocomplete translates its label while selection keeps canonical model values", () => {
  const env = load();
  const field = env.control("UOM");
  field.setup_awesomeplete();
  const item = {
    value: "Set",
    label: "Minute",
    description: "Supplier description",
  };
  const original = JSON.stringify(item);
  field.awesomplete.get_item = () => item;
  const displayed = field.awesomplete.options.data(item);
  assert.deepEqual({ ...displayed }, { label: "Minuto", value: "Set" });
  field.awesomplete.options.replace.call(field.awesomplete, item);
  assert.equal(field.input.value, "Minuto");
  assert.equal(field.input_matches_item("minuto", item), true);
  assert.equal(field.input_matches_item("set", item), true);
  field.$input.events["awesomplete-select"]({
    originalEvent: { text: { value: "Set" } },
  });
  assert.equal(env.validated[0][0], "Set");
  assert.equal(field.label, "Minuto");
  assert.equal(env.titles.get("UOM::Set"), "Minute");
  assert.equal(JSON.stringify(item), original);
});

test("Link translation keeps the existing flag gate and context/global/source fallbacks", () => {
  const env = load();
  assert.equal(env.control("UTM Source").get_translated("Set"), "Set");
  assert.equal(
    env.control("UTM Source").get_translated("Reference"),
    "Reference"
  );
  assert.equal(
    env.control("UOM").get_translated("Uncontextualized"),
    "Traduzione globale"
  );
  assert.equal(
    env.control("UOM").get_translated("Custom record"),
    "Custom record"
  );
  env.frappe.boot.translated_doctypes = [];
  assert.equal(env.control("UOM").get_translated("Minute"), "Minute");
});

test("Dynamic Link control translates using its resolved target, not the target fieldname", () => {
  const env = load();
  const field = Object.create(env.frappe.ui.form.ControlDynamicLink.prototype);
  field.df = {
    parent: "Custom Record",
    fieldname: "record",
    options: "record_type",
  };
  field.docname = "RECORD-RAW";
  env.frappe.model.get_value = (doctype, name, fieldname) => {
    assert.equal(doctype, "Custom Record");
    assert.equal(name, "RECORD-RAW");
    assert.equal(fieldname, "record_type");
    return "Role";
  };
  assert.equal(field.get_translated("Set"), "Ruolo Set");
  assert.equal(field.df.options, "record_type");
  assert.equal(field.docname, "RECORD-RAW");
});

test("Link formatter uses target context in readable, print, plain and unreadable paths", () => {
  const env = load();
  const df = { fieldtype: "Link", fieldname: "unit", options: "UOM" };
  const doc = { doctype: "Item", unit: "Set" };
  const original = JSON.stringify({ df, doc });
  for (const options of [{}, { only_value: true }, { for_print: true }]) {
    const html = env.frappe.format("Set", df, options, doc);
    if (options.only_value || options.for_print) assert.equal(html, "Insieme");
    else {
      assert.equal(html, '<a href="/desk/uom/Set">Insieme</a>');
      assert.deepEqual(env.anchors.at(-1).dataset, {
        doctype: "UOM",
        name: "Set",
        value: "Set",
      });
    }
  }
  env.frappe.model.can_read = () => false;
  assert.equal(env.frappe.format("Set", df, {}, doc), "Insieme");
  env.titles.set("UOM::Set", "Minute");
  assert.equal(
    env.frappe.format("Set", df, { for_print: true }, doc),
    "Minuto"
  );
  assert.equal(JSON.stringify({ df, doc }), original);
});

test("default record anchors keep unflagged business names and titles raw", () => {
  const env = load();
  const df = { fieldtype: "Link", options: "UTM Source" };
  for (const value of ["Set", "Reference"]) {
    assert.equal(
      env.frappe.format(value, df, {}),
      `<a href="/desk/utm-source/${value}">${value}</a>`
    );
    assert.equal(env.frappe.format(value, df, { only_value: true }), value);
    assert.equal(env.frappe.format(value, df, { for_print: true }), value);
  }
  env.titles.set("UTM Source::SOURCE-RAW", "Set");
  assert.equal(
    env.frappe.format("SOURCE-RAW", df, {}),
    '<a href="/desk/utm-source/SOURCE-RAW">Set</a>'
  );
  env.frappe.model.can_read = () => false;
  assert.equal(env.frappe.format("SOURCE-RAW", df, {}), "Set");
});

test("explicit Link labels and actually applied custom formatters retain legacy handling", () => {
  const env = load();
  const df = { fieldtype: "Link", options: "UOM" };
  const doc = { doctype: "Item", unit: "Set" };
  assert.equal(
    env.frappe.format("Set", df, { label: "Minute" }, doc),
    '<a href="/desk/uom/Set">Verbale</a>'
  );
  env.frappe.form.link_formatters.UOM = (value, receivedDoc, receivedDf) => {
    assert.equal(value, "Set");
    assert.equal(receivedDoc, doc);
    assert.equal(receivedDf, df);
    return "Minute";
  };
  assert.equal(
    env.frappe.format("Set", df, {}, doc),
    '<a href="/desk/uom/Set">Verbale</a>'
  );
  assert.equal(
    env.frappe.format("Set", df, { label: "Supplier wording" }, doc),
    '<a href="/desk/uom/Set">Supplier wording</a>'
  );
  assert.equal(
    env.frappe.format("Set", df, { only_value: true }, doc),
    "Insieme"
  );
  assert.equal(
    env.frappe.format("Set", df, {}, { doctype: "UOM" }),
    '<a href="/desk/uom/Set">Insieme</a>'
  );
});

test("Dynamic Link target override selects context without changing target or canonical route", () => {
  const env = load();
  const df = {
    fieldtype: "Dynamic Link",
    fieldname: "record",
    options: "record_type",
  };
  const doc = { doctype: "Custom Record", record_type: "Role", record: "Set" };
  assert.equal(
    env.frappe.format("Set", df, {}, doc),
    '<a href="/desk/role/Set">Ruolo Set</a>'
  );
  assert.equal(df.options, "record_type");
  assert.equal(df._options, "Role");
  assert.equal(doc.record_type, "Role");
  assert.equal(doc.record, "Set");
  assert.equal(
    env.frappe.format("Set", df, { for_print: true }, doc),
    "Ruolo Set"
  );
});

test("Link supplied presentation precedence is unchanged", () => {
  const env = load();
  const df = { fieldtype: "Link", options: "UOM" };
  const doc = { doctype: "Item" };
  assert.equal(
    env.frappe.format("Set", df, { label: "Minute" }, doc),
    '<a href="/desk/uom/Set">Verbale</a>'
  );
  env.frappe.form.link_formatters.UOM = () => "Minute";
  assert.equal(
    env.frappe.format("Set", df, {}, doc),
    '<a href="/desk/uom/Set">Verbale</a>'
  );
  env.titles.set("UOM::Set", "Set");
  assert.equal(
    env.frappe.format("Set", df, { label: "Supplier wording" }, doc),
    '<a href="/desk/uom/Set">Supplier wording</a>'
  );
  env.titles.set("UOM::Set", "Reference");
  assert.equal(
    env.frappe.format("Set", df, {}, doc),
    '<a href="/desk/uom/Set">Riferimento</a>'
  );
  assert.equal(env.anchors.at(-1).dataset.name, "Set");
});

test("Link fallback labels and encoded record identity remain compatible", () => {
  const env = load();
  const df = { fieldtype: "Link", options: "UOM" };
  for (const [value, expected] of [
    ["Uncontextualized", "Traduzione globale"],
    ["Custom record", "Custom record"],
  ]) {
    for (const options of [{}, { for_print: true }, { only_value: true }]) {
      const result = env.frappe.format(value, df, options);
      if (options.for_print || options.only_value)
        assert.equal(result, expected);
      else assert.equal(env.anchors.at(-1).innerText, expected);
    }
  }
  const canonical = "Set / A&B";
  env.titles.set(`UOM::${canonical}`, "Custom record");
  const html = env.frappe.format(canonical, df, {});
  assert.equal(html, '<a href="/desk/uom/Set%20%2F%20A%26B">Custom record</a>');
  assert.deepEqual(env.anchors.at(-1).dataset, {
    doctype: "UOM",
    name: canonical,
    value: canonical,
  });
  env.frappe.model.can_read = () => false;
  assert.equal(env.frappe.format(canonical, df, {}), "Custom record");
});

test("list Link display retains context, canonical filters, titles and supplied formatter data", () => {
  const env = load();
  const list = env.list();
  const df = {
    fieldtype: "Link",
    fieldname: "unit",
    options: "UOM",
    label: "Unit",
  };
  const col = { type: "Field", df };
  const doc = { name: "ITEM-RAW", unit: "Set", unit_title: "Minute" };
  const original = JSON.stringify({ df, doc });
  let html = list.get_column_html(col, doc, false);
  assert.match(html, />\s*Insieme\s*<\/a>/);
  assert.match(html, /data-filter="unit,=,Set"/);
  list.link_field_title_fields.unit = "title";
  html = list.get_column_html(col, doc, false);
  assert.match(html, />\s*Minuto\s*<\/a>/);
  assert.match(html, /data-filter="unit,=,Set"/);
  assert.equal(JSON.stringify({ df, doc }), original);
  list.settings.formatters = {
    unit(value, field, row) {
      assert.equal(value, "Set");
      assert.equal(field, df);
      assert.equal(row, doc);
      return "Supplier Set";
    },
  };
  assert.match(list.get_column_html(col, doc, false), /Supplier Set/);
  assert.equal(JSON.stringify({ df, doc }), original);
});

test("list unflagged names stay raw and contextual display remains HTML escaped", () => {
  const env = load();
  const list = env.list();
  const df = {
    fieldtype: "Link",
    fieldname: "source",
    options: "UTM Source",
    label: "Source",
  };
  assert.match(
    list.get_column_html({ type: "Field", df }, { source: "Reference" }, false),
    />\s*Reference\s*<\/a>/
  );
  df.options = "UOM";
  const html = list.get_column_html(
    { type: "Field", df },
    { source: "Unsafe" },
    false
  );
  assert.match(html, /&lt;Unità &amp; insieme&gt;/);
  assert.match(html, /data-filter="source,=,Unsafe"/);
  assert.doesNotMatch(html, /<Unità/);
});
