import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

class Element {
  constructor(html = "") {
    this.markup = html;
    this.attributes = Object.fromEntries(
      [...html.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]])
    );
    this.handlers = {};
  }
  html(value) {
    if (value !== undefined) this.markup = value;
    return this;
  }
  attr(name, value) {
    if (typeof name === "object") Object.assign(this.attributes, name);
    else if (value === undefined) return this.attributes[name];
    else this.attributes[name] = value;
    return this;
  }
  on(event, callback) {
    this.handlers[event] = callback;
    return this;
  }
  off() {
    return this;
  }
  get() {
    return this;
  }
  addClass() {
    return this;
  }
  removeClass() {
    return this;
  }
  removeAttr(name) {
    delete this.attributes[name];
    return this;
  }
  prependTo() {
    return this;
  }
  appendTo() {
    return this;
  }
  append() {
    return this;
  }
  empty() {
    return this;
  }
  find() {
    return new Element();
  }
  click(callback) {
    this.handlers.click = callback;
    return this;
  }
  show() {
    return this;
  }
  hide() {
    return this;
  }
}

function setup() {
  const requests = [];
  const $ = (value) =>
    value instanceof Element ? value : new Element(value || "");
  $.extend = Object.assign;
  $.isArray = Array.isArray;
  const sandbox = {
    $,
    jQuery: $,
    console,
    frappe: {
      provide() {},
      _messages: {
        More: "Altro",
        "More:Pagination": "Altri risultati",
        "Get Items": "Recupera articoli",
        "Get Items:MultiSelectDialog": "Recupera elementi",
      },
      utils: {
        escape_html: (value) =>
          String(value)
            .replaceAll("&", "&amp;")
            .replaceAll('"', "&quot;")
            .replaceAll("<", "&lt;"),
      },
      model: { can_create: () => false },
      ui: {
        FieldGroup: class {},
        form: {
          ControlData: class {
            set_input_attributes() {}
            toggle_label() {}
          },
        },
      },
      call(options) {
        requests.push(JSON.parse(JSON.stringify(options)));
        options.callback?.({ message: [] });
        return Promise.resolve({ message: [{ name: "CONTACT-1" }] });
      },
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  function load(path, transform = (source) => source) {
    vm.runInContext(
      transform(readFileSync(new URL(path, import.meta.url), "utf8")),
      context
    );
  }
  load("../format.js");
  load("../translate.js");
  load("../ui/components/utils.js", (s) => s.replace(/^export /gm, ""));
  load("../ui/components/button.js", (s) =>
    s
      .replace(/^import .*;\n/m, "")
      .replace("export default frappe.ui.button;", "")
  );
  load("../ui/dialog.js", (s) => s.replace(/^import .*;\n/gm, ""));
  const setPrimary = sandbox.frappe.ui.Dialog.prototype.set_primary_action;
  sandbox.frappe.ui.Dialog = class {
    constructor(options) {
      Object.assign(this, options);
      this.footer = new Element();
      this.primary = new Element();
      this.fields_dict = Object.fromEntries(
        options.fields.map((f) => [
          f.fieldname,
          {
            df: f,
            $wrapper: new Element(),
            get_value: () => "Caffè",
            set_input() {},
          },
        ])
      );
      this.values = { merge_taxes: 1 };
      if (options.primary_action)
        setPrimary.call(
          this,
          options.primary_action_label,
          options.primary_action
        );
    }
    get_primary_btn() {
      return this.primary;
    }
    get_values() {
      return this.values;
    }
    get_input() {
      return new Element();
    }
    show() {}
  };
  load("./controls/button.js");
  load("./link_selector.js");
  load("./multi_select_dialog.js");
  function button(field) {
    const control = Object.create(
      sandbox.frappe.ui.form.ControlButton.prototype
    );
    Object.assign(control, {
      df: field,
      input_area: new Element(),
      label_span: new Element(),
    });
    control.make_input();
    control.set_label();
    return control;
  }
  return { sandbox, requests, button };
}

for (const [doctype, label, expected] of [
  ["Contact", undefined, "Recupera elementi"],
  ["[Select]", undefined, "Recupera elementi"],
  ["Contact", "Acquisisci contatti", "Acquisisci contatti"],
]) {
  test(`generic selection caption preserves supplied labels and canonical payloads: ${doctype}/${
    label || "default"
  }`, () => {
    const { sandbox } = setup();
    const dialog = Object.create(
      sandbox.frappe.ui.form.MultiSelectDialog.prototype
    );
    let payload;
    Object.assign(dialog, {
      doctype,
      for_select: doctype === "[Select]",
      fields: [],
      primary_action_label: label,
      setup_results() {},
      bind_events() {},
      get_results() {},
      action: (...args) => {
        payload = JSON.parse(JSON.stringify(args));
      },
    });
    dialog.make();
    dialog.args = { company: "Impresa originale" };
    dialog.add_filters_group = true;
    dialog.filter_group = {
      get_filters: () => [["Contact", "status", "=", "Passive"]],
    };
    dialog.$results = {
      find: () => ({ map: () => ({ get: () => ["CONTACT-0"] }) }),
    };
    dialog.child_datatable = {
      datamanager: { rows: [1, 2] },
      rowmanager: { checkMap: [1, 0] },
    };
    dialog.child_results = [
      { name: "EMAIL-1", parent: "CONTACT-1" },
      { name: "EMAIL-2", parent: "CONTACT-2" },
    ];
    dialog.dialog.primary.handlers.click();
    assert.deepEqual(payload, [
      ["CONTACT-0", "CONTACT-1"],
      {
        company: "Impresa originale",
        merge_taxes: 1,
        status: ["=", "Passive"],
        filtered_children: ["EMAIL-1"],
      },
    ]);
    assert.match(
      dialog.dialog.primary.markup,
      new RegExp(`<span class="es-button__label">${expected}</span>`)
    );
    assert.equal(dialog.dialog.primary.attr("type"), "button");
    assert.equal(sandbox.__("Get Items"), "Recupera articoli");
  });
}

test("LinkSelector More exposes the pagination caption and keeps the actual search request", () => {
  const { sandbox, requests, button } = setup();
  const selector = Object.create(sandbox.frappe.ui.form.LinkSelector.prototype);
  Object.assign(selector, {
    doctype: "User",
    target: {
      set_custom_query: (args) => {
        args.filters = { enabled: 1 };
      },
    },
  });
  selector.make();
  const more = button(
    selector.dialog.fields.find((f) => f.fieldname === "more")
  );
  more.onclick();
  assert.equal(requests.at(-1).method, "frappe.desk.search.search_widget");
  assert.deepEqual(requests.at(-1).args, {
    txt: "Caffè",
    searchfield: "name",
    start: 10,
    page_length: 10,
    filters: { enabled: 1 },
    doctype: "User",
  });
  assert.equal(more.$input.attr("title"), "Altri risultati");
  assert.equal(more.$input.markup, "Altri risultati");
  assert.equal(more.df.fieldname, "more");
});

test("MultiSelectDialog parent and child pagination keep canonical query arguments", async () => {
  const { sandbox, requests, button } = setup();
  const dialog = Object.create(
    sandbox.frappe.ui.form.MultiSelectDialog.prototype
  );
  Object.assign(dialog, {
    doctype: "Contact",
    page_length: 20,
    child_page_length: 20,
    setters: {},
    args: {},
    allow_child_item_selection: true,
    child_fieldname: "email_ids",
    child_doctype: "Contact Email",
    child_columns: ["email_id"],
    dialog: { fields_dict: { search_term: { get_value: () => "Caffè" } } },
    render_result_list() {},
    show_child_results() {
      return this.get_child_result();
    },
  });
  const parent = button(
    dialog.get_result_fields().find((f) => f.fieldname === "more_btn")
  );
  parent.onclick();
  await Promise.resolve();
  assert.equal(requests.at(-1).args.page_length, 45);
  assert.equal(requests.at(-1).args.doctype, "Contact");
  const child = button(
    dialog
      .get_child_selection_fields()
      .find((f) => f.fieldname === "more_child_btn")
  );
  child.onclick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.at(-1).method, "frappe.client.get_list");
  assert.deepEqual(requests.at(-1).args, {
    doctype: "Contact Email",
    filters: [
      ["parentfield", "=", "email_ids"],
      ["parent", "in", ["CONTACT-1"]],
    ],
    fields: ["name", "parent", "email_id"],
    parent: "Contact",
    limit_page_length: 45,
    order_by: "parent",
  });
  assert.equal(parent.$input.markup, "Altri risultati");
  assert.equal(child.$input.markup, "Altri risultati");
});
