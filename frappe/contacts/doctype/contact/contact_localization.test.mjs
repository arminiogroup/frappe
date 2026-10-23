import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

test("Contact phone action uses its action context and preserves phone selection", () => {
  const handlers = {};
  let called;
  const sandbox = {
    jQuery: null,
    frappe: {
      ui: { form: { on: (name, events) => (handlers[name] = events) } },
      phone_call: { handler: (numbers) => (called = numbers) },
      _messages: { Call: "Chiamata", "Call:Phone action": "Chiama" },
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const path of [
    "../../../public/js/frappe/format.js",
    "../../../public/js/frappe/translate.js",
    "./contact.js",
  ]) {
    vm.runInContext(
      readFileSync(new URL(path, import.meta.url), "utf8"),
      context
    );
  }
  const buttons = [];
  const form = {
    doc: {
      user: "existing@example.com",
      phone_nos: [
        { phone: "+390000000001", is_primary_mobile_no: 0 },
        { phone: "+390000000002", is_primary_mobile_no: 1 },
      ],
      links: [],
    },
    set_query() {},
    refresh_field() {},
    is_dirty: () => true,
    add_custom_button: (label, action) => buttons.push({ label, action }),
  };
  handlers.Contact.refresh(form);
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].label, "Chiama");
  buttons[0].action();
  assert.deepEqual(Array.from(called), ["+390000000002", "+390000000001"]);
  assert.equal(sandbox.__("Call"), "Chiamata");
  form.doc.phone_nos = [];
  handlers.Contact.refresh(form);
  assert.equal(buttons.length, 1);
});
