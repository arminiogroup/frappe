import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const jquery = require("jquery");
const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const read = (path) => readFileSync(resolve(root, path), "utf8");
const metadataFiles = {
  "Website Settings": "website/doctype/website_settings/website_settings.json",
  "Scheduled Job Type":
    "core/doctype/scheduled_job_type/scheduled_job_type.json",
  "System Console": "desk/doctype/system_console/system_console.json",
};
const targets = {
  "Clear Cache": "Svuota la cache",
  "Skip Next Execution": "Salta la prossima esecuzione",
  Execute: "Esegui",
  Actions: "Azioni",
  Logs: "Registri",
  "{} Complete": "Operazione completata: {}",
};
const plain = (value) => JSON.parse(JSON.stringify(value));

function environment(t, messages = targets) {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://example.com",
  });
  const $ = jquery(dom.window);
  const registrations = [];
  const pages = [];
  let width = 375;
  const forbidden = () =>
    assert.fail("Action callbacks and routes must never run");
  const host = {
    $,
    jQuery: $,
    document: dom.window.document,
    Element: dom.window.Element,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    console,
    setTimeout,
    clearTimeout,
    matchMedia: (query) => ({
      matches: width >= Number(query.match(/min-width: (\d+)px/)[1]),
    }),
    frappe: {
      ui: {
        form: {
          on: (doctype, event, callback) => {
            assert.equal(event, "refresh");
            registrations.push({ doctype, callback });
          },
        },
      },
      model: { sync: forbidden },
      utils: {},
      boot: { lang: "it" },
      session: { user: "translator@example.com" },
      _messages: { ...messages },
      xcall: forbidden,
      call: forbidden,
      set_route: forbidden,
      msgprint: forbidden,
      throw: forbidden,
    },
  };
  host.window = host;
  host.frappe.provide = (path) => {
    let value = host;
    for (const part of path.split(".")) value = value[part] ??= {};
  };
  const context = vm.createContext(host);
  const load = (path, isolated = false, exported = []) => {
    let code = read(`frappe/public/js/frappe/${path}`)
      .replace(/^import .*;\n/gm, "")
      .replace(/^export default .*;\n/gm, "")
      .replace(/^export /gm, "");
    if (isolated) {
      code = `(function(){${code}\n${exported
        .map((name) => `globalThis.${name}=${name};`)
        .join("\n")}\n})();`;
    }
    vm.runInContext(code, context, { filename: path });
  };
  load("format.js");
  load("translate.js");
  load("ui/components/utils.js");
  load("utils/utils.js", true);
  host.frappe.utils.icon = () => "";
  load("ui/components/button.js", true);
  load("ui/components/position.js");
  load("ui/components/menu.js", true, ["MenuTree", "build_item"]);
  load("ui/components/dropdown.js", true);
  load("ui/page.js");
  load("form/form.js");
  t.after(() => {
    for (const page of pages) page.destroy_group_dropdowns(page.inner_toolbar);
    dom.window.close();
  });

  const makeForm = (doctype, isNew = false) => {
    const meta = JSON.parse(read(`frappe/${metadataFiles[doctype]}`));
    const page = Object.create(host.frappe.ui.Page.prototype);
    Object.assign(page, {
      inner_toolbar: $("<div>"),
      menu: $("<ul>"),
      menu_btn_group: $('<div class="hide">'),
    });
    page.menu_btn_group.append(page.menu);
    pages.push(page);
    const frm = Object.create(host.frappe.ui.form.Form.prototype);
    Object.assign(frm, {
      meta,
      doctype,
      doc: { doctype, name: "CANONICAL-RECORD", __islocal: Number(isNew) },
      custom_buttons: {},
      page,
    });
    const start = registrations.length;
    frm.setup_doctype_actions();
    const refresh = () => {
      for (const { callback } of registrations.slice(
        start,
        start + meta.actions.length
      )) {
        callback();
      }
    };
    refresh();
    return { frm, page, meta, refresh };
  };
  const accessible = (item) => {
    const { el } = host.build_item(item, {
      reserve_icon_space: false,
      component: "DocType action test",
      taken: new Set(),
    });
    assert.equal(el.getAttribute("role"), "menuitem");
    return el.textContent;
  };
  return {
    host,
    context,
    $,
    makeForm,
    accessible,
    setWidth: (value) => (width = value),
  };
}

test("ungrouped desktop actions already translate and retain canonical keys", (t) => {
  const { makeForm } = environment(t);
  for (const [doctype, label, target] of [
    ["Website Settings", "Clear Cache", "Svuota la cache"],
    ["System Console", "Logs", "Registri"],
  ]) {
    const { frm } = makeForm(doctype);
    const button = frm.custom_buttons[label];
    assert.equal(button.text(), target);
    assert.equal(decodeURIComponent(button.attr("data-label")), label);
    assert.equal(frm.doc.name, "CANONICAL-RECORD");
  }
});

test("grouped desktop action names are Italian while group identifiers remain raw", (t) => {
  const { makeForm, accessible } = environment(t);
  const { page } = makeForm("Scheduled Job Type");
  const group = page.get_inner_group_button("Actions");
  assert.equal(group.find("button").text(), "Azioni");
  assert.equal(decodeURIComponent(group.attr("data-label")), "Actions");
  const rows = page.build_inner_group_options(group.children(".dropdown-menu"));
  assert.deepEqual(Array.from(rows, accessible), [
    "Esegui",
    "Salta la prossima esecuzione",
  ]);
});

test("ungrouped mobile menu uses Italian without changing its stored identity", (t) => {
  const { makeForm, accessible } = environment(t);
  const { page } = makeForm("Website Settings");
  const rows = page.build_dropdown_options(page.menu);
  assert.equal(accessible(rows[0]), "Svuota la cache");
  assert.equal(
    decodeURIComponent(page.menu.find(".menu-item-label").attr("data-label")),
    "Clear Cache"
  );
});

test("mobile grouped menu translates group and action names at the display boundary", (t) => {
  const { makeForm, accessible } = environment(t);
  const { page } = makeForm("Scheduled Job Type");
  const rows = page.build_dropdown_options(page.menu);
  assert.equal(accessible(rows[0]), "Azioni");
  assert.deepEqual(Array.from(rows[0].submenu, accessible), [
    "Esegui",
    "Salta la prossima esecuzione",
  ]);
  const store = page.menu.find(".menu-item-label").first();
  assert.equal(
    decodeURIComponent(store.attr("data-label")),
    "Actions > Execute"
  );
  assert.deepEqual(plain(store.closest("li").data("menu_submenu")), {
    group: "Actions",
    label: "Execute",
  });
});

test("new documents and hidden actions remain gated with raw metadata unchanged", (t) => {
  const { host, makeForm } = environment(t);
  for (const doctype of Object.keys(metadataFiles)) {
    const expected = JSON.parse(
      read(`frappe/${metadataFiles[doctype]}`)
    ).actions;
    const { frm, meta } = makeForm(doctype);
    assert.deepEqual(meta.actions, expected);
    assert.deepEqual(
      Object.keys(frm.custom_buttons),
      expected.filter((a) => !a.hidden).map((a) => a.label)
    );
    const fresh = makeForm(doctype, true);
    assert.deepEqual(Object.keys(fresh.frm.custom_buttons), []);
    assert.equal(fresh.page.inner_toolbar.children().length, 0);
  }
  assert.equal(host.frappe.session.user, "translator@example.com");
});

test("repeated refresh preserves held elements and canonical deduplication", (t) => {
  const { makeForm, $ } = environment(t);
  for (const doctype of Object.keys(metadataFiles)) {
    const { frm, page, meta, refresh } = makeForm(doctype);
    const held = Object.fromEntries(
      Object.entries(frm.custom_buttons).map(([label, button]) => [
        label,
        button[0],
      ])
    );
    const handlers = page.menu
      .children("li")
      .filter((_, li) => $(li).data("menu_click"))
      .map((_, li) => $(li).data("menu_click"))
      .get();
    refresh();
    for (const [label, element] of Object.entries(held)) {
      assert.equal(frm.custom_buttons[label][0], element);
      assert.equal(decodeURIComponent($(element).attr("data-label")), label);
    }
    const next = page.menu
      .children("li")
      .filter((_, li) => $(li).data("menu_click"))
      .map((_, li) => $(li).data("menu_click"))
      .get();
    assert.deepEqual(next, handlers);
    assert.equal(next.length, meta.actions.filter((a) => !a.hidden).length);
  }
});

test("different raw groups keep separate menus when their Italian names match", (t) => {
  const { host, makeForm } = environment(t, {
    ...targets,
    "Review actions": "Azioni",
  });
  const { page } = makeForm("Scheduled Job Type");
  page.add_inner_button(
    "Custom review",
    () => assert.fail("Never activate a test action"),
    "Review actions"
  );
  const groups = page.build_dropdown_options(page.menu);
  assert.equal(groups.length, 2);
  assert.deepEqual(
    Array.from(groups, (item) => item.label),
    ["Azioni", "Azioni"]
  );
  assert.equal(page.get_inner_group_button("Actions").length, 1);
  assert.equal(page.get_inner_group_button("Review actions").length, 1);
  assert.equal(host.frappe._messages["Review actions"], "Azioni");
});

test("supplied translated, unknown, quoted and markup labels retain caller semantics", (t) => {
  const { makeForm, accessible } = environment(t);
  const { page } = makeForm("Website Settings");
  const forbidden = () => assert.fail("Never activate a custom action");
  for (const label of [
    "Svuota la cache",
    'Caffè "demo"',
    "Custom <b>record</b>",
  ]) {
    const button = page.add_inner_button(label, forbidden);
    assert.equal(button.text(), label);
    assert.equal(decodeURIComponent(button.attr("data-label")), label);
  }
  const menu = page.build_dropdown_options(page.menu);
  assert.deepEqual(Array.from(menu, accessible).slice(1), [
    "Svuota la cache",
    'Caffè "demo"',
    "Custom record",
  ]);
  const row = page.add_inner_button(
    'Voce "privata"',
    forbidden,
    "Gruppo del cliente"
  );
  assert.equal(row.text(), 'Voce "privata"');
  assert.equal(decodeURIComponent(row.attr("data-label")), 'Voce "privata"');
  assert.equal(
    page.get_inner_group_button("Gruppo del cliente").find("button").text(),
    "Gruppo del cliente"
  );
});

test("held grouped rows preserve later text, visibility, disabled and theme mutations", (t) => {
  const { makeForm } = environment(t);
  const { frm, page } = makeForm("Scheduled Job Type");
  const row = frm.custom_buttons.Execute;
  const store = page
    .get_inner_group_button("Actions")
    .children(".dropdown-menu");
  row
    .text("Etichetta del cliente")
    .addClass("disabled text-danger audit-marker");
  let options = page.build_inner_group_options(store);
  assert.equal(options[0].label, "Etichetta del cliente");
  assert.equal(options[0].disabled, true);
  assert.equal(options[0].theme, "red");
  assert.equal(options[0].css_class, "audit-marker");
  row.hide();
  assert.equal(page.build_inner_group_options(store).length, 1);
  row.show();
  assert.equal(page.build_inner_group_options(store).length, 2);
  assert.equal(decodeURIComponent(row.attr("data-label")), "Execute");
});

test("mobile filtering and stored callback identities retain their original contract", (t) => {
  const { makeForm, setWidth, $ } = environment(t);
  const { page } = makeForm("Scheduled Job Type");
  const link = page.menu.find(".menu-item-label").first().closest("a");
  const callback = link.closest("li").data("menu_click");
  link.addClass("disabled");
  assert.equal(
    page.build_dropdown_options(page.menu)[0].submenu[0].disabled,
    true
  );
  assert.equal(link.closest("li").data("menu_click"), callback);
  for (const width of [375, 800, 991]) {
    setWidth(width);
    assert.equal(page.build_dropdown_options(page.menu).length, 1);
  }
  for (const width of [992, 1280]) {
    setWidth(width);
    assert.equal(page.build_dropdown_options(page.menu).length, 0);
  }
  assert.equal(
    page.menu
      .find(".menu-item-label")
      .filter(
        (_, el) =>
          $(el).attr("data-label") === encodeURIComponent("Actions > Execute")
      ).length,
    1
  );
});

test("existing completion gettext expression translates labels without executing an action", (t) => {
  const { host, context, makeForm } = environment(t);
  const expression = read("frappe/public/js/frappe/form/form.js").match(
    /message: (__\("\{\} Complete", \[__\(action.label\)\]\)),/
  )[1];
  for (const [doctype, source, target] of [
    ["Website Settings", "Clear Cache", "Svuota la cache"],
    [
      "Scheduled Job Type",
      "Skip Next Execution",
      "Salta la prossima esecuzione",
    ],
    ["System Console", "Execute", "Esegui"],
  ]) {
    const { meta } = makeForm(doctype);
    host.action = meta.actions.find((action) => action.label === source);
    const before = JSON.stringify(host.action);
    assert.equal(
      vm.runInContext(expression, context),
      `Operazione completata: ${target}`
    );
    assert.equal(JSON.stringify(host.action), before);
  }
});

test("English fallback preserves canonical labels in every display path", (t) => {
  const { makeForm, accessible } = environment(t, {});
  const { page } = makeForm("Scheduled Job Type");
  const group = page.get_inner_group_button("Actions");
  assert.equal(group.find("button").text(), "Actions");
  assert.deepEqual(
    Array.from(
      page.build_inner_group_options(group.children(".dropdown-menu")),
      accessible
    ),
    ["Execute", "Skip Next Execution"]
  );
  const mobile = page.build_dropdown_options(page.menu);
  assert.equal(accessible(mobile[0]), "Actions");
  assert.deepEqual(Array.from(mobile[0].submenu, accessible), [
    "Execute",
    "Skip Next Execution",
  ]);
});
