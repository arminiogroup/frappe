import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const searchPath = fileURLToPath(new URL("./search.js", import.meta.url));
const formatPath = fileURLToPath(new URL("../../format.js", import.meta.url));
const translatePath = fileURLToPath(
  new URL("../../translate.js", import.meta.url)
);
for (const count of [0, 1, 2, 19]) {
  test(`search result count ${count} uses a complete Italian sentence`, () => {
    let summary;
    const sandbox = {
      frappe: {
        search: {},
        provide() {},
        _messages: {
          "{0} result found": "{0} risultato trovato",
          "{0} results found": "{0} risultati trovati",
          result: "risultato",
          results: "risultati",
          found: "trovati",
        },
      },
      $(html) {
        return {
          html,
          append() {},
          text(value) {
            this.value = value;
            return this;
          },
        };
      },
    };
    sandbox.window = sandbox;
    sandbox.jQuery = sandbox.$;
    const context = vm.createContext(sandbox);
    vm.runInContext(readFileSync(formatPath, "utf8"), context);
    vm.runInContext(readFileSync(translatePath, "utf8"), context);
    vm.runInContext(readFileSync(searchPath, "utf8"), context);
    const dialog = Object.create(sandbox.frappe.search.SearchDialog.prototype);
    dialog.more_count = 20;
    dialog.$body = {
      find(selector) {
        if (selector === ".result") return { length: count };
        return {
          before() {},
          hide() {},
          slideDown() {},
          append(value) {
            summary = value.value;
          },
        };
      },
    };
    dialog.render_result = () => {};
    dialog.add_more_results([
      { results: Array.from({ length: count }), title: "Item" },
    ]);
    assert.equal(
      summary,
      count === 1 ? "1 risultato trovato" : `${count} risultati trovati`
    );
  });
}

function paginationContext() {
  const nodes = [];
  const handlers = {};
  const requests = [];
  const $ = (value) => {
    if (typeof value !== "string") return value;
    const node = {
      markup: value,
      label: "",
      length: 0,
      append() {
        return this;
      },
      appendTo() {
        return this;
      },
      prepend() {
        return this;
      },
      find() {
        return this;
      },
      empty() {
        return this;
      },
      addClass() {
        return this;
      },
      toggleClass() {
        return this;
      },
      attr() {
        return this;
      },
      html(value) {
        this.markup = value;
        return this;
      },
      text(value) {
        this.label = value;
        return this;
      },
    };
    nodes.push(node);
    return node;
  };
  const sandbox = {
    $,
    jQuery: $,
    frappe: {
      provide() {},
      search: {
        utils: {
          get_global_results: (...args) => {
            requests.push(args);
            return Promise.resolve([]);
          },
        },
      },
      utils: {
        escape_html: (value) => String(value).replaceAll('"', "&quot;"),
        icon: () => "",
      },
      _messages: { More: "Altro", "More:Pagination": "Altri risultati" },
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const path of [formatPath, translatePath, searchPath])
    vm.runInContext(readFileSync(path, "utf8"), context);
  const dialog = Object.create(sandbox.frappe.search.SearchDialog.prototype);
  const host = $("<div>");
  dialog.full_lists = { "All Results": host };
  dialog.nav_lists = {};
  dialog.current_keyword = "caffè";
  dialog.more_count = 20;
  dialog.render_result = () => "<div>original record</div>";
  dialog.build_global_search_table_panel = () => $("<div>");
  dialog.$body = {
    on: (_event, selector, callback) => {
      handlers[selector] = callback;
    },
  };
  dialog.$wrapper = { on() {} };
  return { dialog, nodes, handlers, requests, sandbox, host };
}

for (const kind of ["Global", "Nav", "Summary"]) {
  test(`search ${kind} pagination uses a result caption with canonical routing attributes`, () => {
    const { dialog, nodes } = paginationContext();
    const rows = Array.from({ length: 21 }, (_, i) => ({
      name: `CONTACT-${i}`,
    }));
    if (kind === "Summary")
      dialog.add_section_to_summary("Contact", rows, "Nav");
    else dialog.render_full_list("Contact", rows, kind);
    const markup = nodes.map((n) => n.markup).join("\n");
    assert.match(markup, /Altri risultati/);
    assert.match(markup, /data-category="Contact"/);
    assert.match(
      markup,
      kind === "Summary"
        ? /data-fetch-type="Nav"/
        : new RegExp(`data-search="${kind}"`)
    );
    if (kind === "Nav") assert.match(markup, /data-count="20"/);
    assert.deepEqual(
      rows.map((r) => r.name),
      Array.from({ length: 21 }, (_, i) => `CONTACT-${i}`)
    );
  });
}

test("toolbar overflow caption keeps the global More meaning", () => {
  const { dialog, nodes, host, sandbox } = paginationContext();
  dialog._cached_global_search_allowed = ["Contact"];
  dialog.current_effective_pins_list = () => ["Contact"];
  dialog.build_global_search_more_menu_dom = () => "<div>Contact</div>";
  dialog.render_doctype_filter_bar_into(host);
  assert.equal(
    nodes.find((n) => n.markup.includes("global-search-more-label")).label,
    " Altro"
  );
  assert.equal(sandbox.__("More"), "Altro");
});

test("pagination click callbacks preserve global queries and cached Nav record IDs", async () => {
  const { dialog, handlers, requests } = paginationContext();
  dialog.bind_events();
  const list = {
    length: 1,
    children: () => ({ length: 8 }),
    first() {
      return this;
    },
  };
  const trigger = {
    attributes: { "data-category": "Contact", "data-search": "Global" },
    attr(name) {
      return this.attributes[name];
    },
    closest: () => ({ find: () => list }),
    hide() {},
  };
  dialog.global_doctype_filter = "Customer";
  handlers[".list-more"]({ preventDefault() {}, currentTarget: trigger });
  await Promise.resolve();
  assert.deepEqual(requests, [["caffè", 7, 20, "Customer"]]);
  trigger.attributes["data-search"] = "Nav";
  const rows = Array.from({ length: 25 }, (_, i) => ({ name: `CONTACT-${i}` }));
  dialog.nav_lists.Contact = [...rows];
  let added;
  dialog.add_more_results = (values) => {
    added = values;
  };
  handlers[".list-more"]({ preventDefault() {}, currentTarget: trigger });
  assert.equal(added[0].title, "Contact");
  assert.deepEqual(
    Array.from(added[0].results, (r) => r.name),
    rows.slice(0, 20).map((r) => r.name)
  );
  assert.deepEqual(
    dialog.nav_lists.Contact.map((r) => r.name),
    rows.slice(20).map((r) => r.name)
  );
});
