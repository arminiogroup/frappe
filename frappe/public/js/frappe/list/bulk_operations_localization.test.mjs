import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

class Element {
  constructor() {
    this.children = [];
    this.attributes = {};
    this.handlers = {};
    this.slots = {};
  }
  get() {
    return this;
  }
  find(selector) {
    if (selector === ":selected") return { val: () => this.value };
    return (this.slots[selector] ||= new Element());
  }
  append(value) {
    this.children.push(value);
    return this;
  }
  hide() {
    return this;
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  appendChild(value) {
    this.children.push(value);
  }
  addEventListener(name, callback) {
    this.handlers[name] = callback;
  }
  empty() {
    this.children = [];
  }
  html(value) {
    this.label = value;
    return this;
  }
  attr(name, value) {
    this.attributes[name] = value;
    return this;
  }
  prop(name, value) {
    this[name] = value;
    return this;
  }
  appendTo(parent) {
    parent.children.push(this);
  }
  trigger() {}
  val(value) {
    if (value !== undefined) this.value = value;
    return this.value;
  }
}

function setup() {
  const dialogs = [];
  const requests = [];
  const opened = [];
  const messages = [];
  const events = [];
  const buttons = [];
  const $ = (value) => (value instanceof Element ? value : new Element());
  $.fn = { val() {} };
  $.extend = Object.assign;
  const sandbox = {
    $,
    jQuery: $,
    cint: (value) => Number(value) || 0,
    cstr: String,
    is_null: (value) => value === null || value === undefined,
    document: {
      createElement: () => new Element(),
      createTextNode: (value) => ({ textContent: value }),
    },
    locals: {
      DocType: { "Sales Invoice": { default_print_format: "Demo Format" } },
    },
    frappe: {
      provide() {},
      meta: {},
      views: {},
      utils: { is_rtl: () => false },
      model: {
        get_doc: () => ({
          pdf_page_size: "Ledger",
          pdf_page_height: 279,
          pdf_page_width: 432,
        }),
        is_submittable: () => true,
      },
      user: { has_role: () => false },
      ui: {
        form: { ControlData: class {} },
        button: (options) => {
          const element = new Element();
          element.options = options;
          buttons.push(element);
          return element;
        },
      },
      _messages: {
        Ledger: "Libro mastro",
        "Ledger:Print Settings": "Ledger",
        "Page Size": "Righe per pagina",
        "Page Size:Print Settings": "Formato pagina",
      },
      msgprint: (message) => messages.push(message),
      throw: (message) => {
        throw new Error(message);
      },
      call(method, args) {
        if (typeof method === "object") method.callback({ message: [] });
        else requests.push({ method, args: JSON.parse(JSON.stringify(args)) });
        return Promise.resolve({ message: { task_id: "DEMO-TASK" } });
      },
      realtime: {
        task_subscribe: (id) => events.push(["subscribe", id]),
        on: (name) => events.push(["on", name]),
      },
    },
    open: (url) => {
      opened.push(new URL(url, "https://example.test"));
      return {};
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  const helperPath = new URL(
    "../utils/select_option_context.ts",
    import.meta.url
  );
  if (existsSync(helperPath)) {
    const { transformSync } = createRequire(import.meta.url)("esbuild");
    const helperSource = transformSync(readFileSync(helperPath, "utf8"), {
      loader: "ts",
      format: "esm",
    }).code;
    vm.runInContext(
      helperSource.replace("export {\n  selectOptionContext\n};\n", ""),
      context
    );
  }
  for (const path of [
    "../format.js",
    "../translate.js",
    "../model/meta.js",
    "../form/controls/select.js",
  ]) {
    vm.runInContext(
      readFileSync(new URL(path, import.meta.url), "utf8").replace(
        'import { selectOptionContext } from "../../utils/select_option_context";',
        ""
      ),
      context
    );
  }
  for (const path of [
    "../ui/components/utils.js",
    "../ui/components/tab_buttons.js",
    "./base_list.js",
  ]) {
    vm.runInContext(
      readFileSync(new URL(path, import.meta.url), "utf8")
        .replace(/^import .*;\n/gm, "")
        .replace(/^export default .*;\n/gm, "")
        .replace(/^export /gm, ""),
      context
    );
  }
  sandbox.frappe.meta.get_print_formats = () => ["Demo Format"];
  function select(df) {
    const control = Object.create(
      sandbox.frappe.ui.form.ControlSelect.prototype
    );
    Object.assign(control, { df, $input: new Element() });
    control.set_options();
    return control;
  }
  sandbox.frappe.ui.Dialog = class {
    constructor(options) {
      Object.assign(this, options);
      this.fields_dict = Object.fromEntries(
        options.fields.map((df) => [df.fieldname, select(df)])
      );
      dialogs.push(this);
    }
    set_primary_action(label, callback) {
      this.action = callback;
    }
    show() {}
    hide() {
      this.hidden = true;
    }
  };
  vm.runInContext(
    readFileSync(
      new URL("./bulk_operations.js", import.meta.url),
      "utf8"
    ).replace("export default class BulkOperations", "class BulkOperations"),
    context
  );
  const bulk = new sandbox.frappe.ui.BulkOperations({
    doctype: "Sales Invoice",
  });
  return {
    sandbox,
    bulk,
    dialogs,
    requests,
    opened,
    messages,
    events,
    select,
    buttons,
  };
}

const docs = [{ name: "DEMO-INV-001", docstatus: 1 }];
const args = {
  page_size: "Ledger",
  letter_sel: "No Letterhead",
  print_sel: "",
  background_print: false,
};

test("bulk page-size control keeps the paper name and canonical PDF option", () => {
  const { sandbox, bulk, dialogs, select } = setup();
  const before = JSON.stringify(sandbox.frappe.meta.get_print_sizes());
  bulk.print(docs);
  const page = dialogs[0].fields_dict.page_size;
  const ledger = page.$input.children.find(
    (option) => option.attributes.value === "Ledger"
  );
  assert.equal(ledger.label, "Ledger");
  assert.equal(page.df.default, "Ledger");
  assert.equal(JSON.stringify(sandbox.frappe.meta.get_print_sizes()), before);
  const ordinary = select({ options: ["Ledger"] });
  assert.equal(ordinary.$input.children[0].label, "Libro mastro");
  assert.equal(ordinary.$input.children[0].attributes.value, "Ledger");
  assert.equal(sandbox.__("Ledger"), "Libro mastro");
});

test("synchronous bulk print sends raw paper, document and format values", () => {
  const { bulk, dialogs, opened } = setup();
  bulk.print(docs);
  dialogs[0].action(args);
  const query = opened[0].searchParams;
  assert.equal(
    opened[0].pathname,
    "/api/method/frappe.utils.print_format.download_multi_pdf"
  );
  assert.deepEqual(JSON.parse(query.get("options")), { "page-size": "Ledger" });
  assert.deepEqual(JSON.parse(query.get("name")), ["DEMO-INV-001"]);
  assert.equal(query.get("doctype"), "Sales Invoice");
  assert.equal(query.get("format"), "Demo Format");
  assert.equal(query.get("no_letterhead"), "1");
  assert.equal(query.get("letterhead"), "No Letterhead");
  assert.equal(dialogs[0].hidden, true);
});

test("background bulk print keeps the same canonical request and subscription", async () => {
  const { bulk, dialogs, requests, opened, events } = setup();
  bulk.print(docs);
  dialogs[0].action({
    ...args,
    background_print: true,
    print_sel: "Custom Format",
    letter_sel: "Demo Letterhead",
  });
  await Promise.resolve();
  assert.equal(opened.length, 0);
  assert.deepEqual(requests, [
    {
      method: "frappe.utils.print_format.download_multi_pdf_async",
      args: {
        doctype: "Sales Invoice",
        name: '["DEMO-INV-001"]',
        format: "Custom Format",
        no_letterhead: "0",
        letterhead: "Demo Letterhead",
        options: '{"page-size":"Ledger"}',
      },
    },
  ]);
  assert.deepEqual(events, [
    ["subscribe", "DEMO-TASK"],
    ["on", "task_complete:DEMO-TASK"],
  ]);
});

test("custom page dimensions and print eligibility controls remain unchanged", () => {
  const { bulk, dialogs, opened, messages } = setup();
  bulk.print(docs);
  dialogs[0].action({
    ...args,
    page_size: "Custom",
    page_height: 279,
    page_width: 432,
  });
  assert.deepEqual(JSON.parse(opened[0].searchParams.get("options")), {
    "page-height": 279,
    "page-width": 432,
  });
  assert.throws(
    () =>
      dialogs[0].action({
        ...args,
        page_size: "Custom",
        page_height: 0,
        page_width: 432,
      }),
    /Page height and width cannot be zero/
  );
  bulk.print([{ name: "DEMO-DRAFT", docstatus: 0 }]);
  bulk.print([]);
  bulk.print(
    Array.from({ length: 501 }, (_, i) => ({ name: `DEMO-${i}`, docstatus: 1 }))
  );
  assert.equal(dialogs.length, 1);
  assert.deepEqual(messages, [
    "You selected Draft or Cancelled documents",
    "Select atleast 1 record for printing",
    "You can only print upto 500 documents at a time",
  ]);
  bulk.print(
    Array.from({ length: 26 }, (_, i) => ({ name: `DEMO-${i}`, docstatus: 1 }))
  );
  assert.equal(dialogs[1].fields_dict.background_print.df.default, true);
  assert.equal(dialogs[1].fields_dict.background_print.df.read_only, true);
});

test("paper format and list row-count labels remain distinct with canonical radio and paging callbacks", () => {
  const { sandbox, bulk, dialogs, buttons } = setup();
  bulk.print(docs);
  assert.equal(dialogs[0].fields_dict.page_size.df.label, "Formato pagina");
  const list = Object.create(sandbox.frappe.views.BaseList.prototype);
  let refreshed = 0;
  Object.assign(list, {
    selected_page_count: 20,
    page_length: 20,
    start: 0,
    data: Array.from({ length: 20 }, (_, i) => ({ name: `DEMO-${i}` })),
    $frappe_list: new Element(),
    refresh: () => refreshed++,
  });
  list.setup_paging_area();
  const group = list.paging_button_group;
  assert.equal(group.el.attributes.role, "radiogroup");
  assert.equal(group.el.attributes["aria-label"], "Righe per pagina");
  assert.deepEqual(
    Array.from(group.options, (option) => option.value),
    [20, 100, 500, 2500]
  );
  assert.deepEqual(
    Array.from(group.pills, (pill) => pill.el.children[0].textContent),
    ["20", "100", "500", "2500"]
  );
  assert.equal(group.get_value(), 20);
  assert.equal(refreshed, 0);
  group.pills[1].el.handlers.click({});
  assert.equal(group.get_value(), 100);
  assert.equal(list.selected_page_count, 100);
  assert.equal(list.start, 20);
  assert.equal(list.page_length, 80);
  assert.equal(refreshed, 1);
  buttons[0].options.onclick();
  assert.equal(list.start, 20);
  assert.equal(list.page_length, 100);
  assert.equal(group.get_value(), 100);
  assert.equal(refreshed, 2);
  group.pills[0].el.handlers.click({});
  assert.equal(list.selected_page_count, 20);
  assert.equal(list.start, 0);
  assert.equal(list.page_length, 20);
  assert.equal(refreshed, 3);
  assert.equal(sandbox.__("Page Size"), "Righe per pagina");
});
