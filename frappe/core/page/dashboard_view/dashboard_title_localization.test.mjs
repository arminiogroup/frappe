import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const jquery = require("jquery");
const source =
  process.env.FRAPPE_SOURCE_ROOT ||
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const messages = {
  Selling: "Vendite",
  Buying: "Acquisti",
  Project: "Progetto",
  "Project:Dashboard": "Progetti",
  Asset: "Cespite",
  "Asset:Dashboard": "Cespiti",
  CRM: "CRM",
  Manufacturing: "Produzione",
  Payments: "Pagamenti",
  Accounts: "Contabilità",
  Stock: "Magazzino",
  Dashboard: "Cruscotto",
  dashboard: "cruscotto",
  "{0} Dashboard": "Cruscotto {0}",
  "Cruscotto Selling": "Composed-key collision",
};
const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = () => new Promise((done) => setTimeout(done, 0));
const pending = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};
const dashboard = (name, is_standard = 1, island = false) => ({
  doctype: "Dashboard",
  name,
  dashboard_name: name,
  is_standard,
  charts: [],
  cards: [],
  __onload: island
    ? { island: { name: "example.dashboard", props: { canonical: name } } }
    : {},
});

function harness({
  doc = dashboard("Selling"),
  menus = [],
  dictionary = messages,
  mobile = false,
  fetch,
  items,
} = {}) {
  const dom = new JSDOM(
    '<body><div id="wrapper"><div class="page-head"><div class="title-area"><nav class="navbar-breadcrumbs"></nav></div></div><div class="page-content"></div></div></body>',
    { url: "https://example.com" }
  );
  const $ = jquery(dom.window);
  let route = ["dashboard-view", (doc?.name || "Missing").toLowerCase()];
  const calls = [];
  const mounts = [];
  const groups = [];
  const host = {
    $,
    jQuery: $,
    console,
    document: dom.window.document,
    Element: dom.window.Element,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    setTimeout,
    clearTimeout,
    matchMedia: () => ({ matches: !mobile }),
    frappe: {
      ui: {},
      utils: {},
      pages: { "dashboard-view": {} },
      session: { user: "translator@example.com" },
      boot: { lang: "it" },
      _messages: { ...dictionary },
      route_titles: {},
      router: { get_sub_path: () => route.join("/") },
      get_route: () => route,
      get_route_str: () => route.join("/"),
      is_mobile: () => mobile,
      model: {
        with_doc: async (dt, name) => {
          calls.push({ kind: "with_doc", dt, name });
          return fetch ? fetch(name) : doc;
        },
      },
      xcall: async (method, args) => {
        calls.push({ kind: "xcall", method, args: plain(args) });
        return items ? items(method) : [];
      },
      db: {
        get_list: async (dt, args) => {
          calls.push({ kind: "get_list", dt, args: args && plain(args) });
          return args?.fields?.includes("is_standard")
            ? menus
            : menus.map(({ name }) => ({ name }));
        },
      },
      dashboard_utils: { get_dashboard_settings: async () => ({}) },
      set_route: (...args) => calls.push({ kind: "set_route", args }),
      new_doc: () => assert.fail("Document creation must not run"),
      widget: {
        WidgetGroup: class {
          constructor(options) {
            this.options = options;
            this.widgets_list = [];
            groups.push(this);
          }
          destroy() {
            this.destroyed = true;
          }
        },
      },
    },
  };
  host.window = host;
  host.frappe.provide = (path) => {
    let current = host;
    for (const key of path.split(".")) current = current[key] ??= {};
  };
  const context = vm.createContext(host);
  function load(path, isolated = false) {
    let code = readFileSync(resolve(source, path), "utf8")
      .replace(/^import .*;\n/gm, "")
      .replace(/^export default .*;\n/gm, "")
      .replace(/^export /gm, "");
    if (isolated) code = `(function(){${code}\n})();`;
    vm.runInContext(code, context, { filename: path });
  }
  for (const path of [
    "frappe/public/js/frappe/format.js",
    "frappe/public/js/frappe/translate.js",
    "frappe/public/js/frappe/ui/components/utils.js",
  ])
    load(path);
  load("frappe/public/js/frappe/utils/utils.js", true);
  load("frappe/public/js/frappe/dom.js");
  load("frappe/public/js/frappe/ui/components/breadcrumbs.js");
  load("frappe/public/js/frappe/ui/components/button.js", true);
  load("frappe/public/js/frappe/ui/components/empty_state.js", true);
  load("frappe/public/js/frappe/ui/page.js");
  const page = Object.create(host.frappe.ui.Page.prototype);
  page.$title_area = $(".title-area");
  page.menu = $("<ul>").appendTo($("<div>"));
  page.actions = $("<ul>");
  page.menu_btn_group = page.menu.parent();
  host.frappe.ui.make_app_page = () => page;
  host.frappe.ui.mount_island = (name, element, props) => {
    const mount = {
      name,
      element,
      props,
      ready: Promise.resolve(),
      unmount() {
        this.unmounted = true;
      },
    };
    mounts.push(mount);
    return mount;
  };
  load("frappe/core/page/dashboard_view/dashboard_view.js");
  const wrapper = $("#wrapper")[0];
  host.frappe.pages["dashboard-view"].on_page_load(wrapper);
  return {
    $,
    page,
    calls,
    mounts,
    groups,
    doc,
    host,
    route: (value) => (value ? (route = value) : route),
    show: async () => {
      await $(wrapper).triggerHandler("show");
      await settle();
    },
    hide: () => $(wrapper).triggerHandler("hide"),
    crumb: () => $(".navbar-breadcrumbs .es-breadcrumbs__label").last().text(),
    title: () => dom.window.document.title,
    rows: () =>
      page.menu
        .find(".menu-item-label")
        .map((_, el) => ({
          label: $(el).text(),
          canonical: decodeURIComponent($(el).attr("data-label")),
        }))
        .get(),
    snapshot: () =>
      page
        .build_dropdown_options(page.menu)
        .flatMap((row) => row.options || row),
    close: () => dom.window.close(),
  };
}

function checkCanonical(h, initial) {
  assert.deepEqual(h.doc, initial);
  assert.equal(h.host.frappe.dashboard.dashboard_name, initial.name);
  assert.deepEqual(h.route(), ["dashboard-view", initial.name.toLowerCase()]);
  assert.deepEqual(
    h.calls.filter((call) => call.kind === "xcall"),
    [
      {
        kind: "xcall",
        method: "frappe.desk.doctype.dashboard.dashboard.get_permitted_cards",
        args: { dashboard_name: initial.name },
      },
      {
        kind: "xcall",
        method: "frappe.desk.doctype.dashboard.dashboard.get_permitted_charts",
        args: { dashboard_name: initial.name },
      },
    ]
  );
  assert.equal(
    h.calls.some((call) => call.kind === "set_route"),
    false
  );
}

test("all standard category captions use Dashboard context, while canonical document and query state stays exact", async () => {
  for (const [name, label] of Object.entries({
    Buying: "Acquisti",
    Selling: "Vendite",
    Project: "Progetti",
    CRM: "CRM",
    Manufacturing: "Produzione",
    Payments: "Pagamenti",
    Accounts: "Contabilità",
    Stock: "Magazzino",
    Asset: "Cespiti",
  })) {
    const h = harness({ doc: dashboard(name) });
    try {
      const initial = plain(h.doc);
      await h.show();
      checkCanonical(h, initial);
      assert.equal(h.crumb(), label, name);
      assert.equal(h.title(), `Cruscotto ${label}`, name);
      assert.equal(
        h.host.frappe.route_titles[`dashboard-view/${name.toLowerCase()}`],
        h.title()
      );
    } finally {
      h.close();
    }
  }
});

test("custom names remain authored even when global, contextual or composed-title translations collide", async () => {
  for (const name of [
    "Selling",
    "Buying",
    "Project",
    "Asset",
    "Custom cruscotto",
    "Custom dashboard",
    "<b>Research & sales</b>",
  ]) {
    const h = harness({ doc: dashboard(name, 0) });
    try {
      const initial = plain(h.doc);
      await h.show();
      checkCanonical(h, initial);
      assert.equal(h.crumb(), name);
      assert.equal(
        h.title(),
        name.toLowerCase().includes("cruscotto") ? name : `Cruscotto ${name}`
      );
      assert.equal(h.$(".navbar-breadcrumbs b").length, 0);
    } finally {
      h.close();
    }
  }
});

test("English and unknown standard names preserve fallback and the existing suffix condition", async () => {
  for (const [name, standard] of [
    ["Selling", 1],
    ["Unknown Category", 1],
    ["Custom dashboard", 0],
    ["Selling", 0],
  ]) {
    const h = harness({ doc: dashboard(name, standard), dictionary: {} });
    try {
      await h.show();
      assert.equal(h.crumb(), name);
      assert.equal(
        h.title(),
        name.toLowerCase().includes("dashboard") ? name : `${name} Dashboard`
      );
    } finally {
      h.close();
    }
  }
});

test("switch-menu captions translate only standards without collapsing raw keys or callback identities on desktop and mobile", async () => {
  for (const mobile of [false, true]) {
    const menus = [
      { name: "Selling", is_standard: 1 },
      { name: "Buying", is_standard: 1 },
      { name: "Project", is_standard: 1 },
      { name: "Asset", is_standard: 1 },
      { name: "Vendite", is_standard: 0 },
      { name: "Manufacturing", is_standard: 0 },
      { name: "CRM", is_standard: 1 },
    ];
    const h = harness({
      doc: dashboard("CRM"),
      menus,
      mobile,
      dictionary: { ...messages, Buying: "Vendite" },
    });
    try {
      const initialMenus = plain(menus);
      await h.show();
      assert.deepEqual(
        h.calls.find((call) => call.kind === "get_list"),
        {
          kind: "get_list",
          dt: "Dashboard",
          args: { fields: ["name", "is_standard"] },
        }
      );
      const rows = h
        .rows()
        .filter((row) => menus.some((menu) => menu.name === row.canonical));
      assert.deepEqual(rows, [
        { label: "Vendite", canonical: "Selling" },
        { label: "Vendite", canonical: "Buying" },
        { label: "Progetti", canonical: "Project" },
        { label: "Cespiti", canonical: "Asset" },
        { label: "Vendite", canonical: "Vendite" },
        { label: "Manufacturing", canonical: "Manufacturing" },
      ]);
      assert.equal(
        h.snapshot().filter((row) => row.label === "Vendite").length,
        3
      );
      for (const row of rows) {
        const li = h.page.menu
          .find(`span[data-label="${encodeURIComponent(row.canonical)}"]`)
          .closest("li");
        assert.equal(li.hasClass("user-action"), false);
        assert.equal(typeof li.data("menu_click"), "function");
        assert.match(
          li.data("menu_click").toString(),
          /frappe\.set_route\("dashboard-view", name\)/
        );
      }
      assert.deepEqual(menus, initialMenus);
      assert.equal(
        h.calls.some((call) => call.kind === "set_route"),
        false
      );
    } finally {
      h.close();
    }
  }
});

test("island fallback names use standard context while app-owned titles, props and action callbacks remain untouched", async () => {
  for (const standard of [0, 1]) {
    const h = harness({ doc: dashboard("Asset", standard, true) });
    try {
      const initial = plain(h.doc);
      await h.show();
      assert.equal(h.crumb(), standard ? "Cespiti" : "Asset");
      assert.equal(h.title(), standard ? "Cespiti" : "Asset");
      const mount = h.mounts[0];
      assert.equal(mount.name, "example.dashboard");
      assert.equal(mount.props.canonical, "Asset");
      for (const title of ["Selling", "<b>Authored & title</b>", ""]) {
        mount.props.onTitle(title);
        assert.equal(h.crumb(), title || "Cruscotto");
        assert.equal(h.title(), title || "Cruscotto");
        assert.equal(h.$(".navbar-breadcrumbs b").length, 0);
      }
      const onClick = () => assert.fail("Island action must not run");
      mount.props.onActions([{ label: "Selling", onClick }]);
      assert.deepEqual(h.rows(), [{ label: "Selling", canonical: "Selling" }]);
      assert.equal(
        h.page.menu.children("li").first().data("menu_click"),
        onClick
      );
      assert.deepEqual(h.doc, initial);
      h.hide();
      assert.equal(mount.unmounted, true);
      assert.equal(
        h.host.document.body.classList.contains("island-page"),
        false
      );
      assert.equal(h.page.menu.children().length, 0);
      assert.equal(h.$(".page-content").children().length, 0);
    } finally {
      h.close();
    }
  }
});

test("missing and bare routes retain their raw identity and existing empty-state behavior", async () => {
  const h = harness({ doc: null });
  try {
    h.route(["dashboard-view", "Selling"]);
    await h.show();
    assert.equal(h.crumb(), "Selling");
    assert.equal(h.title(), "Cruscotto");
    assert.match(h.$(".page-content").text(), /No dashboard named Selling/);
    assert.equal(
      h.calls.some((call) => call.kind === "get_list" || call.kind === "xcall"),
      false
    );
    h.route(["dashboard-view"]);
    await h.show();
    assert.deepEqual(
      h.calls.filter((call) => call.kind === "set_route"),
      [{ kind: "set_route", args: ["List", "Dashboard"] }]
    );
  } finally {
    h.close();
  }
});

test("out-of-order document fetches cannot repaint the current canonical dashboard", async () => {
  const old = pending();
  const current = pending();
  const h = harness({
    fetch: (name) => (name === "selling" ? old.promise : current.promise),
  });
  try {
    const first = h.show();
    h.route(["dashboard-view", "asset"]);
    const second = h.show();
    current.resolve(dashboard("Asset"));
    await second;
    const title = h.title();
    old.resolve(dashboard("Selling"));
    await first;
    assert.equal(h.crumb(), "Cespiti");
    assert.equal(h.title(), title);
    assert.equal(h.host.frappe.dashboard.dashboard_name, "Asset");
    assert.equal(h.calls.filter((call) => call.kind === "get_list").length, 1);
  } finally {
    h.close();
  }
});

test("hide destroys widget groups and leaves delayed widget responses unable to draw", async () => {
  const response = pending();
  const h = harness({ items: () => response.promise });
  try {
    await h.show();
    const legacy = h.host.frappe.dashboard;
    h.hide();
    assert.equal(legacy.destroyed, true);
    assert.equal(h.host.frappe.dashboard, null);
    response.resolve([{ card: "Canonical Card" }]);
    await settle();
    await settle();
    assert.equal(h.groups.length, 0);
    assert.equal(h.$(".page-content").children().length, 0);
  } finally {
    h.close();
  }

  const ready = harness({
    items: (method) =>
      method.endsWith("get_permitted_cards")
        ? [{ card: "Canonical Card" }]
        : [],
  });
  try {
    await ready.show();
    assert.equal(ready.groups.length, 1);
    assert.equal(ready.groups[0].options.widgets[0].name, "Canonical Card");
    ready.hide();
    assert.equal(ready.groups[0].destroyed, true);
  } finally {
    ready.close();
  }
});
