import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const { transformSync } = require("esbuild");
const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const messages = {
  Open: "Aperto",
  "Open:Communication.email_status": "Normale",
  Spam: "Indesiderata",
  Trash: "Cestino",
  Failed: "Non riuscito",
  "Failed:Select Option: agreement_status": "Non rispettato",
  "Open:Override": "Esplicito",
  "Caption:Communication": "Didascalia",
};

function environment() {
  const dom = new JSDOM("<select></select>");
  const $ = require("jquery")(dom.window);
  const sandbox = {
    $,
    jQuery: $,
    is_null: (value) => value == null,
    frappe: {
      form: {},
      views: {},
      provide() {},
      meta: { docfield_map: {} },
      ui: { form: { ControlData: class {} } },
      _messages: { ...messages },
      model: { is_value_type: () => true },
      get_user_settings: () => ({}),
      perm: { has_perm: () => true },
      boot: { treeviews: [] },
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  const helper = `${root}/frappe/public/js/frappe/utils/select_option_context.ts`;
  if (existsSync(helper)) {
    const source = transformSync(readFileSync(helper, "utf8"), {
      loader: "ts",
      format: "esm",
    }).code;
    vm.runInContext(
      source.replace("export {\n  selectOptionContext\n};\n", ""),
      context
    );
  }
  for (const [path, imported] of [
    ["utils/datatype.js", ""],
    ["format.js", ""],
    ["translate.js", ""],
    [
      "form/controls/select.js",
      'import { selectOptionContext } from "../../utils/select_option_context";',
    ],
    [
      "form/formatters.js",
      'import { selectOptionContext } from "../utils/select_option_context";',
    ],
    [
      "list/base_list.js",
      'import { safe_href } from "../ui/components/utils.js";',
    ],
  ])
    vm.runInContext(
      readFileSync(`${root}/frappe/public/js/frappe/${path}`, "utf8").replace(
        imported,
        ""
      ),
      context
    );
  const field = (name) => {
    const data = JSON.parse(
      readFileSync(
        `${root}/frappe/core/doctype/communication/communication.json`,
        "utf8"
      )
    );
    return {
      ...data.fields.find((f) => f.fieldname === name),
      parent: data.name,
    };
  };
  const control = (df) => {
    const result = Object.create(
      sandbox.frappe.ui.form.ControlSelect.prototype
    );
    Object.assign(result, { df, doctype: df.parent, $input: $("<select>") });
    result.set_options();
    return result;
  };
  return { sandbox, context, $, field, control };
}

test("actual ControlSelect separates same-parent email bucket without changing values or selected data", () => {
  const { control, field } = environment();
  const email = field("email_status");
  const before = structuredClone(email);
  const input = control(email);
  assert.equal(input.$input.find('option[value="Open"]').text(), "Normale");
  assert.equal(
    control(field("status")).$input.find('option[value="Open"]').text(),
    "Aperto"
  );
  input.$input.val("Trash");
  assert.equal(input.$input.val(), "Trash");
  assert.equal(input.$input.find(":selected").text(), "Cestino");
  assert.deepEqual(email, before);
  assert.deepEqual(
    control({ ...email, sort_options: true })
      .$input.find("option")
      .map((_, option) => option.value)
      .get(),
    ["Trash", "Spam", "Open"]
  );
  input.df = { ...email, options: `${email.options}\nOther` };
  input.set_options();
  assert.equal(input.$input.val(), "Trash");
  assert.equal(
    control({ ...email, context: "Override" })
      .$input.find('option[value="Open"]')
      .text(),
    "Esplicito"
  );
  assert.equal(
    control({ ...email, options: [{ value: "Open", label: "Caption" }] })
      .$input.find("option")
      .text(),
    "Didascalia"
  );
});

test("public add_options retains four arguments, legacy parsing, sorting, selection and events", () => {
  const { sandbox, $ } = environment();
  const add = sandbox.frappe.ui.form.add_options;
  assert.equal(add.length, 4);
  const input = $("<select>");
  let changes = 0;
  input.on("select-change", () => changes++);
  assert.equal(
    add(input, "not an array", true, "Communication").get(0),
    input.get(0)
  );
  assert.equal(changes, 0);
  add(
    input,
    [
      "Open",
      { value: "X", label: "Caption", disabled: true, selected: true },
      0,
      null,
    ],
    true,
    "Communication"
  );
  assert.deepEqual(
    input
      .find("option")
      .map((_, el) => el.textContent)
      .get(),
    ["", "0", "Aperto", "Didascalia"]
  );
  assert.equal(input.find('option[value="X"]').prop("disabled"), true);
  assert.equal(input.get(0).selectedIndex, 0);
  assert.equal(changes, 1);
  const plugin = $("<select>");
  plugin.add_options(["Open"]);
  assert.equal(plugin.find("option").text(), "Aperto");
  assert.equal(
    sandbox.parse_option({ value: "Open", label: "Caption" }, "Communication")
      .label,
    "Didascalia"
  );
});

test("client Select formatter preserves Data/custom result and applies metadata to canonical values only", () => {
  const { sandbox, field } = environment();
  const format = sandbox.frappe.form.formatters.Select;
  const df = field("email_status");
  assert.equal(format("Open", df), "Normale");
  let calls = 0;
  sandbox.frappe.meta.docfield_map.Communication = {
    email_status: {
      formatter(value, supplied) {
        calls++;
        assert.equal(value, "Open");
        assert.equal(supplied.fieldname, df.fieldname);
        return "Caption";
      },
    },
  };
  assert.equal(format("Open", df), "Didascalia");
  assert.equal(calls, 1);
  assert.equal(format("Open", { ...df, context: "Override" }), "Caption");
  delete sandbox.frappe.meta.docfield_map.Communication.email_status;
  assert.equal(format(null, { fieldtype: "Select" }), "");
  assert.equal(format(0, df), 0);
});

test("actual BaseList producer retains metadata identity through actual ControlSelect and canonical callbacks", async () => {
  const { sandbox, context, field, control } = environment();
  const raw = field("email_status");
  raw.in_standard_filter = 1;
  const before = structuredClone(raw);
  let produced,
    refreshed = 0;
  const area = vm.runInContext("Object.create(FilterArea.prototype)", context);
  area.list_view = {
    doctype: "Communication",
    settings: { hide_name_filter: true },
    meta: { fields: [raw] },
    page: {
      page_form: { find: () => ({}) },
      add_field(df) {
        produced = df;
      },
    },
  };
  area.place_id_filter = () => {};
  area.debounced_refresh_list_view = () => refreshed++;
  await area.make_standard_filters();
  assert.equal(produced.parent, "Communication");
  assert.equal(produced.context, undefined);
  assert.equal(
    control(produced).$input.find('option[value="Open"]').text(),
    "Normale"
  );
  produced.onchange();
  assert.equal(refreshed, 1);
  assert.equal(produced.fieldname, "email_status");
  assert.equal(produced.condition, "=");
  assert.equal(produced.options, "\nOpen\nSpam\nTrash");
  assert.deepEqual(raw, before);
  assert.equal(sandbox.frappe._messages.Open, "Aperto");
});
