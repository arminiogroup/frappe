import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

test("legacy email badge uses communication context for text and title", () => {
  const sandbox = {
    jQuery: null,
    frappe: { _messages: { Read: "Lettura", "Read:Communication": "Letto" } },
    doc: { _doc_status: "Read" },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const file of ["../../format.js", "../../translate.js"]) {
    vm.runInContext(
      readFileSync(new URL(file, import.meta.url), "utf8"),
      context
    );
  }
  const source = readFileSync(
    new URL("./timeline_message_box.html", import.meta.url),
    "utf8"
  );
  for (const key of ["label", "title"]) {
    const expression = source.match(
      new RegExp(key + ": (__(\\(doc\\._doc_status[^)]*\\)))")
    )[1];
    assert.equal(vm.runInContext(expression, context), "Letto");
  }
  assert.equal(sandbox.doc._doc_status, "Read");
  assert.equal(sandbox.__("Read"), "Lettura");
});
