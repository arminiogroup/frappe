import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const require = createRequire(`${root}/package.json`);
const { JSDOM } = require("jsdom");
const message =
  "If you confirm your deletion request and it remains pending, automatic processing can start {0} hours after the request was created.";
const target =
  "Se confermi la richiesta di eliminazione e questa rimane in sospeso, l'elaborazione automatica può iniziare al termine del periodo di attesa, calcolato dalla creazione della richiesta (ore: {0}).";
const metadata = JSON.parse(
  readFileSync(
    `${root}/frappe/website/web_form/request_to_delete_data/request_to_delete_data.json`,
    "utf8"
  )
);

function environment(messages = { [message]: target }) {
  const dom = new JSDOM(
    `<div id="introduction">${metadata.introduction_text}</div>`,
    { url: `https://example.test/${metadata.route}` }
  );
  const $ = require("jquery")(dom.window);
  const calls = [];
  const errors = [];
  const sandbox = {
    window: dom.window,
    document: dom.window.document,
    $,
    jQuery: $,
    frappe: {
      _messages: messages,
      web_form: {},
      call: (args) => calls.push(args),
    },
    console: { error: (...args) => errors.push(args) },
  };
  const context = vm.createContext(sandbox);
  const bootstrap = readFileSync(`${root}/frappe/templates/base.html`, "utf8");
  const ready = bootstrap.match(
    /frappe\.ready_events = \[\];\s*frappe\.ready = function\(fn\) \{\s*frappe\.ready_events\.push\(fn\);\s*\}/
  );
  assert.ok(ready);
  vm.runInContext(ready[0], context);
  const website = readFileSync(`${root}/frappe/website/js/website.js`, "utf8");
  const trigger = website.match(
    /\ttrigger_ready: function \(\) \{([\s\S]*?)\n\t\},/
  );
  assert.ok(trigger);
  vm.runInContext(
    `frappe.trigger_ready = function () {${trigger[1]}\n};`,
    context
  );
  for (const relative of ["format.js", "translate.js"]) {
    vm.runInContext(
      readFileSync(`${root}/frappe/public/js/frappe/${relative}`, "utf8"),
      context
    );
  }
  sandbox.__ = sandbox.window.__;
  vm.runInContext(
    readFileSync(
      `${root}/frappe/website/web_form/request_to_delete_data/request_to_delete_data.js`,
      "utf8"
    ),
    context
  );
  const introduction = $("#introduction .ql-editor.read-mode");
  const original = introduction.html();
  const load = () => {
    sandbox.frappe.trigger_ready();
    assert.deepEqual(errors, []);
    sandbox.frappe.web_form.after_load();
    return calls.at(-1);
  };
  return { sandbox, dom, $, calls, errors, introduction, original, load };
}

test("real website ready registration retains the read-only singleton RPC", () => {
  const env = environment();
  assert.equal(env.sandbox.frappe.ready_events.length, 1);
  assert.equal(env.sandbox.frappe.web_form.after_load, undefined);
  assert.deepEqual(env.calls, []);
  const request = env.load();
  assert.deepEqual(Object.keys(request), ["method", "callback"]);
  assert.equal(
    request.method,
    "frappe.website.doctype.website_settings.website_settings.get_auto_account_deletion"
  );
  assert.equal(typeof request.callback, "function");
  assert.equal(env.introduction.html(), env.original);
  assert.equal(
    env.dom.window.location.pathname,
    "/request-for-account-deletion"
  );
});

for (const hours of [1, 72]) {
  test(`the ${hours}-hour introduction describes earliest processing after confirmation`, () => {
    const env = environment();
    const response = { message: hours, marker: "RESPONSE-RAW" };
    const before = structuredClone(response);
    env.load().callback(response);
    assert.equal(
      env.introduction.html(),
      env.original + `<br><b>${target.replace("{0}", hours)}</b>`
    );
    assert.deepEqual(response, before);
    assert.equal(env.introduction.find("a").attr("href"), "/request-data");
    assert.equal(env.introduction.children().last().prop("tagName"), "B");
    assert.equal(env.calls.length, 1);
    assert.deepEqual(env.errors, []);
  });
}

for (const hours of [0, -1, -72, null, undefined, false, "", 0.5]) {
  test(`a disabled or absent waiting period ${String(
    hours
  )} adds no completion promise`, () => {
    const env = environment();
    const response = { message: hours };
    env.load().callback(response);
    assert.equal(env.introduction.html(), env.original);
    assert.equal(response.message, hours);
    assert.equal(env.calls.length, 1);
    assert.deepEqual(env.errors, []);
  });
}

test("English fallback keeps the complete waiting-period meaning and raw hours", () => {
  const env = environment({});
  env.load().callback({ message: 72 });
  assert.equal(
    env.introduction.children().last().text(),
    message.replace("{0}", "72")
  );
  assert.equal(env.introduction.find("a").attr("href"), "/request-data");
});

test("repeated after-load callbacks retain the existing append and RPC behavior", () => {
  const env = environment();
  env.load().callback({ message: 1 });
  env.sandbox.frappe.web_form.after_load();
  env.calls[1].callback({ message: 1 });
  assert.equal(env.calls.length, 2);
  assert.equal(
    env.introduction.html(),
    env.original + `<br><b>${target.replace("{0}", "1")}</b>`.repeat(2)
  );
});
