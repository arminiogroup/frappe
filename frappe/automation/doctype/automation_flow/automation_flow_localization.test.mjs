import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const labels = [
  ["SetFieldValue", "Set Field Value", "Imposta il valore di un campo"],
  ["CreateDocument", "Create Document", "Crea documento"],
  [
    "IncrementFieldValue",
    "Increment Field Value",
    "Incrementa il valore di un campo",
  ],
  ["SendNotification", "Send Notification", "Invia notifica"],
  ["AssignToUser", "Assign to User", "Assegna a un utente"],
  ["CallWebhook", "Call Webhook", "Chiama webhook"],
  ["RunScript", "Run Script", "Esegui script"],
];

test("Automation Flow translates capability labels while preserving action ids and empty options", () => {
  const selectors = [];
  const sandbox = {
    jQuery: null,
    frappe: {
      ui: { form: { on() {} } },
      _messages: Object.fromEntries(
        labels.map(([_id, source, translation]) => [source, translation])
      ),
      provide(path) {
        let target = this;
        for (const part of path.split(".").slice(1))
          target = target[part] ??= {};
      },
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const path of [
    "../../../public/js/frappe/format.js",
    "../../../public/js/frappe/translate.js",
    "./automation_flow.js",
  ])
    vm.runInContext(
      readFileSync(new URL(path, import.meta.url), "utf8"),
      context
    );
  const form = {
    set_df_property() {},
    fields_dict: {
      actions: {
        grid: {
          update_docfield_property: (field, property, options) =>
            selectors.push({ field, property, options }),
        },
      },
    },
  };
  const capabilities = {
    fields: [],
    actions: labels.map(([action_type, label]) => ({ action_type, label })),
  };
  const before = JSON.stringify(capabilities);
  sandbox.frappe.automation_flow.set_select_options(form, capabilities);
  assert.equal(selectors[0].field, "action_type");
  assert.equal(selectors[0].property, "options");
  assert.equal(selectors[0].options[0], "");
  assert.deepEqual(
    Array.from(selectors[0].options.slice(1), (option) => option.label),
    labels.map((label) => label[2])
  );
  assert.deepEqual(
    Array.from(selectors[0].options.slice(1), (option) => option.value),
    labels.map((label) => label[0])
  );
  assert.equal(JSON.stringify(capabilities), before);
});
