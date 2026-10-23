import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const jquery = require("jquery");

function setup() {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://erp.example.com",
  });
  const $ = jquery(dom.window);
  const routes = [];
  const handlers = {};
  const host = {
    $,
    jQuery: $,
    document: dom.window.document,
    Element: dom.window.Element,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    addEventListener: dom.window.addEventListener.bind(dom.window),
    removeEventListener: dom.window.removeEventListener.bind(dom.window),
    innerWidth: 1024,
    innerHeight: 768,
    setTimeout,
    clearTimeout,
    console,
    frappe: {
      ui: {
        form: { on: (name, events) => (handlers[name] = events) },
        make_app_page: () => ({}),
      },
      pages: { "component-explorer": {} },
      utils: {},
      boot: { lang: "it" },
      session: { user: "translator@example.com" },
      _messages: { Open: "Aperto", "Open:Access": "Apri" },
      set_route: (...args) => routes.push(args),
      get_meta: () => ({}),
      meta: { get_docfield: () => undefined },
      scrub: (value) => value.toLowerCase().replaceAll(" ", "_"),
      call: () => assert.fail("Open-action fixtures must not issue requests"),
    },
  };
  host.window = host;
  host.frappe.provide = (path) => {
    let value = host;
    for (const part of path.split(".")) value = value[part] ??= {};
  };
  const context = vm.createContext(host);
  const jsRoot = new URL("../../", import.meta.url);
  const load = (path, isolate = false) => {
    const code = readFileSync(new URL(path, jsRoot), "utf8")
      .replace(/^import .*;\n/gm, "")
      .replace(/^export default .*;\n/gm, "")
      .replace(/^export /gm, "");
    vm.runInContext(isolate ? `(function(){${code}\n})();` : code, context);
  };
  load("format.js");
  load("translate.js");
  load("ui/components/utils.js");
  load("utils/utils.js", true);
  load("ui/components/button.js", true);
  load("ui/components/position.js");
  load("ui/components/bottom_sheet.js", true);
  load("ui/components/popover.js", true);
  load("ui/components/stepper.js", true);
  load("ui/tree.js", true);
  return { host, $, dom, routes, handlers, context };
}

for (const [kind, generated] of [
  ["BottomSheet", { button: {} }],
  ["Popover", {}],
]) {
  test(`actual ${kind} default trigger opens with action context and preserves supplied labels/triggers`, () => {
    const { host, $, dom } = setup();
    let opened = 0;
    const widget = new host.frappe.ui[kind]({
      ...generated,
      content: "Contenuto <privato>",
      title: "Titolo demo",
      on_open: () => opened++,
    });
    $(dom.window.document.body).append(widget.$trigger);
    assert.equal(widget.trigger_el.textContent, "Apri");
    assert.equal(widget.trigger_el.getAttribute("aria-haspopup"), "dialog");
    widget.trigger_el.click();
    assert.equal(widget.is_open, true);
    assert.equal(opened, 1);
    const panel = widget.panel;
    assert.ok(panel.textContent.includes("Contenuto <privato>"));
    assert.equal(panel.querySelector("privato"), null);
    widget.close();
    widget.destroy();
    let suppliedClick = 0;
    const options = { label: "Set <azienda>", onclick: () => suppliedClick++ };
    const supplied = new host.frappe.ui[kind]({
      button: options,
      content: "Dati",
    });
    assert.equal(supplied.trigger_el.textContent, "Set <azienda>");
    supplied.trigger_el.click();
    assert.equal(supplied.is_open, true);
    assert.equal(suppliedClick, 0);
    assert.equal(options.label, "Set <azienda>");
    assert.equal(typeof options.onclick, "function");
    supplied.destroy();
    const trigger = dom.window.document.createElement("button");
    trigger.textContent = "Pulsante del chiamante";
    const custom = new host.frappe.ui[kind]({
      trigger,
      button: { label: "Ignored" },
      content: "Dati",
    });
    assert.equal(custom.trigger_el, trigger);
    assert.equal(trigger.textContent, "Pulsante del chiamante");
    trigger.click();
    assert.equal(custom.is_open, true);
    custom.destroy();
    assert.equal(host.__("Open"), "Aperto");
    assert.equal(host.frappe.session.user, "translator@example.com");
    dom.window.close();
  });
}

test("actual restored-document action preserves visibility, routes and restore branch", () => {
  const { host, context, handlers, routes, dom } = setup();
  vm.runInContext(
    readFileSync(
      new URL(
        "../../../../../core/doctype/deleted_document/deleted_document.js",
        import.meta.url
      ),
      "utf8"
    ),
    context
  );
  const buttons = [];
  const frm = {
    doc: {
      restored: 1,
      deleted_doctype: "Item Group",
      new_name: "Set / <privato>",
      name: "DELETED-DEMO",
    },
    add_custom_button: (label, onclick) => buttons.push({ label, onclick }),
  };
  handlers["Deleted Document"].refresh(frm);
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].label, "Apri");
  buttons[0].onclick();
  assert.deepEqual(routes, [["Form", "Item Group", "Set / <privato>"]]);
  buttons.length = 0;
  frm.doc.restored = 0;
  handlers["Deleted Document"].refresh(frm);
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].label, "Restore");
  assert.equal(routes.length, 1);
  dom.window.close();
});

test("actual tree preview action preserves record title, route and canonical name", () => {
  const { host, routes, dom } = setup();
  const tree = Object.create(host.frappe.ui.Tree.prototype);
  tree.args = { doctype: "Item Group" };
  const data = { name: "Set / <privato>", preview_title: "Titolo <privato>" };
  const before = structuredClone(data);
  const content = tree.render_node_hover_card({ expandable: false }, data);
  const button = content[0].querySelector("button");
  assert.equal(button.title, "Apri");
  assert.ok(content.text().includes("Titolo <privato>"));
  assert.equal(content[0].querySelector("privato"), null);
  button.click();
  assert.deepEqual(routes, [["Form", "Item Group", "Set / <privato>"]]);
  assert.deepEqual(data, before);
  dom.window.close();
});

test("actual ComponentExplorer vertical Stepper preserves demo content and absent action callback", () => {
  const { host, context, routes, dom, $ } = setup();
  const source = readFileSync(
    new URL(
      "../../../../../core/page/component_explorer/component_explorer.js",
      import.meta.url
    ),
    "utf8"
  );
  assert.equal(source.split("\n\tconst $body = $(").length, 2);
  vm.runInContext(
    source.replace(
      "\n\tconst $body = $(",
      "\n\treturn COMPONENTS;\n\tconst $body = $("
    ),
    context
  );
  const components = host.frappe.pages["component-explorer"].on_page_load({});
  const options = components.Stepper.groups.find((group) =>
    group.items.some((item) => item.orientation === "vertical")
  ).items[0];
  const stepper = new host.frappe.ui.Stepper(options);
  const button = [...stepper.nav.querySelectorAll("button")].find((el) =>
    el.classList.contains("es-button")
  );
  assert.equal(button.textContent, "Apri");
  assert.equal(button.onclick, null);
  assert.equal($._data(button, "events")?.click, undefined);
  button.click();
  assert.equal(routes.length, 0);
  assert.equal(options.current, 1);
  assert.equal(options.steps[1].label, "Opening balances");
  assert.ok(
    stepper.nav.textContent.includes(
      "Bring the closing balances from your old books."
    )
  );
  dom.window.close();
});
