import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

function queueForm(status = "Queued", roles = ["System Manager"]) {
  const handlers = {};
  const buttons = [];
  const confirmations = [];
  const calls = [];
  const sandbox = {
    jQuery: null,
    frappe: {
      boot: { user: { roles } },
      ui: { form: { on: (name, events) => (handlers[name] = events) } },
      _messages: {
        "Unlock Reference Document": "Sblocca documento di riferimento",
        "Are you sure you want to unlock this document? Other queued submissions of the same document may also be unlocked, which can lead to unexpected behavior.":
          "Vuoi sbloccare questo documento? Potrebbero essere sbloccate anche altre operazioni in coda sullo stesso documento, con risultati imprevisti.",
      },
      confirm: (message, yes) => confirmations.push({ message, yes }),
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const path of [
    "../../../public/js/frappe/format.js",
    "../../../public/js/frappe/translate.js",
    "./submission_queue.js",
  ])
    vm.runInContext(
      readFileSync(new URL(path, import.meta.url), "utf8"),
      context
    );
  handlers["Submission Queue"].refresh({
    doc: { status },
    add_custom_button: (label, action) => buttons.push({ label, action }),
    call: (method) => calls.push(method),
  });
  return { buttons, confirmations, calls };
}

test("queue unlock confirmation is translated and retains explicit confirmation before the call", () => {
  const form = queueForm();
  assert.equal(form.buttons[0].label, "Sblocca documento di riferimento");
  form.buttons[0].action();
  assert.equal(
    form.confirmations[0].message,
    "Vuoi sbloccare questo documento? Potrebbero essere sbloccate anche altre operazioni in coda sullo stesso documento, con risultati imprevisti."
  );
  assert.deepEqual(form.calls, []);
  form.confirmations[0].yes();
  assert.deepEqual(form.calls, ["unlock_doc"]);
});

test("queue unlock controls retain their existing status and role conditions", () => {
  assert.deepEqual(queueForm("Finished").buttons, []);
  assert.deepEqual(queueForm("Queued", ["Employee"]).buttons, []);
});
