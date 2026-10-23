import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const require = createRequire(resolve(root, "package.json"));
const Vue = require("vue");
const { parse } = require("@vue/compiler-sfc");
const { compile } = require("@vue/compiler-dom");
const { renderToString } = require("vue/server-renderer");
const source = readFileSync(new URL("./profile.vue", import.meta.url), "utf8");
const { descriptor } = parse(source);
const render = new Function(
  "Vue",
  compile(descriptor.template.content, {
    mode: "function",
    prefixIdentifiers: true,
  }).code
)(Vue);

function translator() {
  const host = {
    jQuery: null,
    frappe: {
      _messages: {
        Set: "Imposta",
        "Not set": "Non impostato",
        "Set:Email Signature": "Impostata",
        "Not set:Email Signature": "Non impostata",
      },
    },
  };
  host.window = host;
  const context = vm.createContext(host);
  for (const file of ["format.js", "translate.js"])
    vm.runInContext(
      readFileSync(resolve(root, "frappe/public/js/frappe", file), "utf8"),
      context
    );
  return host.__;
}

for (const [signature, expected] of [
  ["<p>Firma aziendale</p>", "Impostata"],
  ["", "Non impostata"],
]) {
  test(`email signature state uses its own context for ${
    signature ? "populated" : "empty"
  } content`, async () => {
    const __ = translator();
    const values = { email_signature: signature };
    const actions = [];
    const rows = [];
    const app = Vue.createSSRApp({
      data: () => ({
        __,
        screen: "email",
        SCREENS: { email: "Email" },
        settings: {},
        user_data: values,
        switches: () => [],
        change: (fieldname) => actions.push(fieldname),
        go() {},
      }),
      render,
    });
    app.component("Group", {
      props: ["label"],
      render() {
        return this.$slots.default?.();
      },
    });
    for (const name of ["Button", "Photo", "Switch", "TextInput"])
      app.component(name, {
        render() {
          return null;
        },
      });
    app.component("Row", {
      props: ["label", "value"],
      setup(props, { attrs }) {
        rows.push({ props, attrs });
        return () => Vue.h("span", props.value);
      },
    });
    await renderToString(app);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].props.value, expected);
    rows[0].attrs.onClick();
    assert.deepEqual(actions, ["email_signature"]);
    assert.deepEqual(values, { email_signature: signature });
    assert.equal(__("Set"), "Imposta");
    assert.equal(__("Not set"), "Non impostato");
  });
}
