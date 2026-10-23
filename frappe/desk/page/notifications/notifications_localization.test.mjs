import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

test("notification read-state tabs retain canonical values and separate permission labels", () => {
  const sandbox = {
    jQuery: null,
    frappe: {
      _messages: {
        Read: "Lettura",
        Unread: "Non letto",
        "Read:Notification list": "Lette",
        "Unread:Notification list": "Non lette",
      },
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const file of [
    "../../../public/js/frappe/format.js",
    "../../../public/js/frappe/translate.js",
  ]) {
    vm.runInContext(
      readFileSync(new URL(file, import.meta.url), "utf8"),
      context
    );
  }
  const source = readFileSync(
    new URL("./notifications.vue", import.meta.url),
    "utf8"
  );
  const statement = source.match(/const tab_options = (\[[\s\S]*?\n\]);/)[0];
  vm.runInContext(statement, context);
  const options = vm.runInContext("tab_options", context);
  assert.deepEqual(JSON.parse(JSON.stringify(options)), [
    { value: "Unread", label: "Non lette" },
    { value: "Read", label: "Lette" },
  ]);
  assert.equal(sandbox.__("Read"), "Lettura");
});
