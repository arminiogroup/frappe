import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const sourceRoot = new URL("../../", import.meta.url);
function load() {
  const elements = [];
  class Element {
    constructor(html = "") {
      this.htmlText = html;
      this.handlers = {};
      this.length = 1;
      this.dataValues = {};
      elements.push(this);
    }
    appendTo() {
      return this;
    }
    append() {
      return this;
    }
    on(name, callback) {
      this.handlers[name] = callback;
      return this;
    }
    find(selector) {
      return (this.dataValues[selector] ??= new Element(selector));
    }
    closest() {
      return { length: 1 };
    }
    remove() {
      this.length = 0;
      return this;
    }
  }
  const $ = Object.assign(
    (value) => (value instanceof Element ? value : new Element(value)),
    { extend: Object.assign }
  );
  const host = {
    jQuery: $,
    $,
    console,
    frappe: {
      views: {},
      utils: {
        escape_html: (s) =>
          String(s)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll('"', "&quot;"),
        icon: () => "",
        is_mac: () => false,
      },
      ui: { keys: { add_shortcut() {} } },
      _messages: {
        Clear: "Cancella",
        "Clear:Selection": "Deseleziona",
        Group: "Gruppo",
        "Group:Grouping": "Raggruppa",
        None: "Nessuna",
        "None:Grouping": "Nessun raggruppamento",
      },
      provide() {},
    },
  };
  host.number_systems = {};
  host.deep_equal = () => {};
  host.window = host;
  vm.createContext(host);
  for (const path of [
    "format.js",
    "translate.js",
    "ui/components/utils.js",
    "utils/utils.js",
    "ui/components/button.js",
    "views/kanban_v2/kanban_page.js",
  ]) {
    const code = readFileSync(new URL(path, sourceRoot), "utf8")
      .replace(/^import .+;\n/gm, "")
      .replace(/^export default .+;\n/gm, "")
      .replace(/^export /gm, "");
    vm.runInContext(code, host, { filename: path });
  }
  host.frappe.ui.Dropdown = class {
    constructor(options) {
      this.options = options;
      this.$trigger = new Element(options.button.label);
      this.button = options.button;
    }
    destroy() {
      this.destroyed = true;
    }
  };
  host.frappe.ui.button.dress = (target, options) => {
    target.htmlText = options.label;
  };
  const page = Object.create(host.frappe.views.KanbanV2Page.prototype);
  page.wrapper = new Element();
  page.page = {};
  page.$filter_section = new Element();
  page.quickFilters = 0;
  page.mounts = 0;
  page.heights = 0;
  page.setup_quick_filters = () => page.quickFilters++;
  page.mount_board = () => page.mounts++;
  page.sync_board_height = () => page.heights++;
  return { host, page, elements };
}

test("selection action translates separately and only deselects", () => {
  const { page, host } = load();
  const selected = [];
  page.board = {
    engine: { select: (ids) => selected.push(Array.from(ids)) },
    refresh: () => assert.fail("deselect must not refresh"),
  };
  page.make_selection_bar();
  assert.match(page.$selection_bar.htmlText, />Deseleziona</);
  page.update_selection_bar = (ids) => {
    page.selected_ids = ids;
  };
  page.selected_ids = ["DOC-UNCHANGED"];
  page.$selection_bar.find(".kn-sel-clear").handlers.click();
  assert.deepEqual(selected, [[]]);
  assert.deepEqual(Array.from(page.selected_ids), []);
  assert.equal(host.__("Clear"), "Cancella");
});

test("group action and None option retain null and canonical fieldnames", () => {
  const { page, host } = load();
  page.group_by_options = [{ fieldname: "status", label: "Business <label>" }];
  page.setup_group_button();
  assert.equal(page.$group_dropdown.button.label, "Raggruppa");
  const choices = page.get_group_dropdown_options();
  assert.equal(choices[0].label, "Nessun raggruppamento");
  choices[1].onclick();
  assert.equal(page.group_by_field, "status");
  assert.equal(page.$group_dropdown.$trigger.htmlText, "Business <label>");
  assert.equal(page.mounts, 1);
  page.get_group_dropdown_options()[0].onclick();
  assert.equal(page.group_by_field, null);
  assert.equal(page.mounts, 2);
  page.get_group_dropdown_options()[0].onclick();
  assert.equal(page.mounts, 2);
  assert.equal(host.__("Group"), "Gruppo");
  assert.equal(host.__("None"), "Nessuna");
});

test("no group choices hides the control and supplied labels stay unchanged", () => {
  const { page } = load();
  page.group_by_options = [{ fieldname: "business_key", label: "None" }];
  page.group_by_field = "business_key";
  page.setup_group_button();
  assert.equal(page.$group_dropdown.button.label, "None");
  page.group_by_options = [];
  const dropdown = page.$group_dropdown;
  page.setup_group_button();
  assert.equal(dropdown.destroyed, true);
  assert.equal(page.$group_dropdown, null);
  assert.equal(page.$group_wrapper, null);
});
