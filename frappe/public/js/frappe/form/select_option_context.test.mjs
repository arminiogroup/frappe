import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const { buildSync } = require("esbuild");
const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const bundle = buildSync({
  entryPoints: [`${root}/ui/src/utils/translateDocField.ts`],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
});
const module = { exports: {} };
new Function("module", "exports", bundle.outputFiles[0].text)(
  module,
  module.exports
);
const { translateSelectOption } = module.exports;
const field = {
  parent: "Communication",
  fieldname: "email_status",
  fieldtype: "Select",
};

function host(messages) {
  const sandbox = { frappe: { _messages: messages }, $: {}, window: null };
  sandbox.jQuery = sandbox.$;
  sandbox.window = sandbox;
  vm.runInNewContext(
    readFileSync(`${root}/frappe/public/js/frappe/format.js`, "utf8"),
    sandbox
  );
  vm.runInNewContext(
    readFileSync(`${root}/frappe/public/js/frappe/translate.js`, "utf8"),
    sandbox
  );
  globalThis.frappe = sandbox.frappe;
  globalThis.__ = sandbox.__;
  return messages;
}

test.afterEach(() => {
  delete globalThis.frappe;
  delete globalThis.__;
});

test("metadata option lookup distinguishes exact fields before parent and shared conventions", () => {
  const messages = host({
    Open: "Aperto",
    "Open:Communication.email_status": "Normale",
    Failed: "Non riuscito",
    "Failed:Select Option: agreement_status": "Non rispettato",
  });
  assert.equal(translateSelectOption(field, "Open"), "Normale");
  assert.equal(
    translateSelectOption({ ...field, fieldname: "status" }, "Open"),
    "Aperto"
  );
  const sla = {
    parent: "Task",
    fieldname: "agreement_status",
    fieldtype: "Select",
  };
  assert.equal(translateSelectOption(sla, "Failed"), "Non rispettato");
  messages["Failed:Task"] = "Scelta del progetto";
  assert.equal(translateSelectOption(sla, "Failed"), "Scelta del progetto");
  messages["Failed:Task.agreement_status"] = "Esito specifico";
  assert.equal(translateSelectOption(sla, "Failed"), "Esito specifico");
});

test("identity translations count as entries and empty translations retain existing fallback", () => {
  const messages = host({
    Open: "Aperto",
    "Open:Communication": "Open",
    "Open:Communication.email_status": "",
  });
  assert.equal(translateSelectOption(field, "Open"), "Open");
  messages["Open:Communication.email_status"] = "Open";
  messages["Open:Communication"] = "Altro";
  assert.equal(translateSelectOption(field, "Open"), "Open");
  messages["Open:Communication.email_status"] = "";
  messages["Open:Communication"] = "";
  assert.equal(translateSelectOption(field, "Open"), "Aperto");
});

test("explicit client contexts, missing provenance and non-Select values preserve legacy contracts", () => {
  host({
    Open: "Aperto",
    "Open:Communication.email_status": "Normale",
    "Open:Override": "Esplicito",
  });
  assert.equal(
    translateSelectOption({ ...field, context: "Override" }, "Open"),
    "Esplicito"
  );
  assert.equal(
    translateSelectOption({ ...field, context: "Unknown" }, "Open"),
    "Aperto"
  );
  assert.equal(
    translateSelectOption({ ...field, fieldname: undefined }, "Open"),
    "Aperto"
  );
  assert.equal(
    translateSelectOption({ ...field, parent: undefined }, "Open"),
    "Open"
  );
  assert.equal(
    translateSelectOption({ ...field, fieldtype: "Data" }, "Open"),
    "Open"
  );
  assert.equal(translateSelectOption(field, 0), 0);
  assert.equal(translateSelectOption(field, null), null);
  assert.equal(translateSelectOption(field, "Unknown"), "Unknown");
});

test("standalone and custom translator hosts need no new dictionary contract", () => {
  assert.equal(translateSelectOption(field, "Open"), "Open");
  const calls = [];
  globalThis.__ = (message, args, context) => {
    calls.push([message, args, context]);
    return "Custom";
  };
  assert.equal(translateSelectOption(field, "Open"), "Custom");
  assert.deepEqual(calls, [["Open", [], "Communication"]]);
});
