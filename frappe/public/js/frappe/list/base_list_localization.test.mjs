import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const listPath = fileURLToPath(new URL("./base_list.js", import.meta.url));
const selectPath = fileURLToPath(
  new URL("../form/controls/select.js", import.meta.url)
);
const formatPath = fileURLToPath(new URL("../format.js", import.meta.url));
const translatePath = fileURLToPath(
  new URL("../translate.js", import.meta.url)
);

for (const fixture of [
  {
    parent: "Material Request",
    value: "Issued",
    expected: "Materiale scaricato",
  },
  { parent: "Asset", value: "Issue", expected: "Assegnato" },
  {
    parent: "Asset",
    context: "Custom Display",
    value: "Issue",
    expected: "Scelta personalizzata",
  },
  { value: "Issued", expected: "Materiale scaricato" },
]) {
  test(`standard Select filter retains context ${
    fixture.context || fixture.parent || "doctype fallback"
  }`, async () => {
    const $ = () => {};
    $.fn = { val() {} };
    const sandbox = {
      frappe: {
        views: {},
        provide() {},
        get_user_settings: () => ({}),
        model: { is_value_type: () => true },
        perm: { has_perm: () => true },
        boot: { treeviews: [] },
        ui: { form: { ControlData: class {} } },
        _messages: {
          Issued: "Emesso",
          "Issued:Material Request": "Materiale scaricato",
          Issue: "Segnalazione",
          "Issue:Asset": "Assegnato",
          "Issue:Custom Display": "Scelta personalizzata",
        },
      },
      $,
      jQuery: $,
      is_null: (value) => value === null || value === undefined,
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
    for (const sourcePath of [formatPath, translatePath, selectPath]) {
      vm.runInContext(
        readFileSync(sourcePath, "utf8").replace(
          'import { selectOptionContext } from "../../utils/select_option_context";',
          ""
        ),
        context
      );
    }
    const listSource = readFileSync(listPath, "utf8").replace(
      'import { safe_href } from "../ui/components/utils.js";',
      ""
    );
    vm.runInContext(listSource, context);
    const field = {
      fieldname: "status",
      fieldtype: "Select",
      label: "Status",
      options: fixture.value,
      in_standard_filter: true,
      parent: fixture.parent,
      context: fixture.context,
    };
    const original = JSON.stringify(field);
    let filter;
    const list = vm.runInContext(
      "Object.create(FilterArea.prototype)",
      context
    );
    list.list_view = {
      doctype: "Material Request",
      settings: { hide_name_filter: true },
      meta: { fields: [field] },
      page: {
        page_form: { find: () => ({}) },
        add_field: (df) => {
          filter = df;
        },
      },
    };
    list.place_id_filter = () => {};
    await list.make_standard_filters();
    assert.equal(filter.parent, fixture.parent || "Material Request");
    assert.equal(filter.context, fixture.context);
    const option = sandbox.parse_option(
      fixture.value,
      filter.context || filter.parent
    );
    assert.equal(option.label, fixture.expected);
    assert.equal(option.value, fixture.value);
    assert.equal(filter.fieldname, "status");
    assert.equal(filter.condition, "=");
    assert.equal(JSON.stringify(field), original);
  });
}
