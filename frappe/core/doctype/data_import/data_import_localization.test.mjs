import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
const { JSDOM } = createRequire(import.meta.url)("jsdom");
import vm from "node:vm";

function setup({ failed = 1, summary = true } = {}) {
  const handlers = {};
  const requests = [];
  const downloads = [];
  const routes = [];
  const tabs = [];
  let html = "";
  let actions;
  const wrapper = {
    html: (value) => (html = value),
    find: () => ({
      empty() {
        return this;
      },
      append() {
        return this;
      },
    }),
  };
  const $ = (node) => Object.assign([node], wrapper);
  $.extend = Object.assign;
  const logs = failed
    ? [
        {
          success: 0,
          row_indexes: "[2,3]",
          messages: JSON.stringify([{ title: "Titolo <privato>" }]),
        },
      ]
    : [];
  const host = {
    $,
    jQuery: $,
    document: new JSDOM("").window.document,
    cstr: String,
    cint: (value) => Number.parseInt(value, 10) || 0,
    open_url_post: (...args) => downloads.push(args),
    frappe: {
      ui: {
        form: { on: (doctype, events) => (handlers[doctype] = events) },
        TabButtons: class {
          constructor(options) {
            tabs.push(options);
            this.el = {};
          }
        },
      },
      utils: {},
      dom: { get_unique_id: () => "error-demo" },
      user: { full_name: (user) => user },
      datetime: { str_to_user: (value) => value },
      session: { user: "translator@example.com" },
      _messages: { Failed: "Fallito", "Failed:Data Import": "Con errori" },
      set_route: (...args) => routes.push(args),
      call: (options) => {
        requests.push({ method: options.method, args: options.args });
        if (options.method.endsWith(".get_import_status"))
          options.callback({
            message: summary ? { total_records: failed, failed } : {},
          });
        else if (options.method.endsWith(".get_import_logs"))
          options.callback({ message: logs });
        else assert.fail(`Unexpected transport ${options.method}`);
      },
    },
  };
  host.window = host;
  host.frappe.provide = (path) => {
    let cursor = host;
    for (const part of path.split(".")) cursor = cursor[part] ??= {};
  };
  const context = vm.createContext(host);
  const jsRoot = new URL("../../../public/js/frappe/", import.meta.url);
  const load = (path, module = false) => {
    const code = readFileSync(new URL(path, jsRoot), "utf8")
      .replace(/^import .*;\n/gm, "")
      .replace(/^export default .*;\n/gm, "")
      .replace(/^export /gm, "");
    vm.runInContext(module ? `(function(){${code}\n})();` : code, context);
  };
  load("format.js");
  load("translate.js");
  load("ui/components/utils.js");
  load("utils/utils.js", true);
  for (const name of ["button", "badge", "empty_state", "progress"])
    load(`ui/components/${name}.js`, true);
  host.frappe.utils.bind_actions_with_object = (_wrapper, object) =>
    (actions = object);
  vm.runInContext(
    readFileSync(new URL("./data_import.js", import.meta.url), "utf8"),
    context
  );
  const doc = {
    name: "DI-DEMO",
    import_type: "Insert New Records",
    status: "Partial Success",
    reference_doctype: "ToDo",
    skipped_rows: [{ row_number: 9 }],
    owner: "owner@example.test",
    modified_by: "editor@example.test",
    creation: "2026-10-20 10:00:00",
    modified: "2026-10-20 11:00:00",
  };
  const events = {
    ...handlers["Data Import"],
    toggle_import_log_ui() {},
    set_import_log_heading() {},
  };
  const frm = {
    doc,
    events,
    get_field(name) {
      assert.equal(name, "import_log_preview");
      return { $wrapper: wrapper };
    },
    trigger(name) {
      return events[name](frm);
    },
  };
  return {
    host,
    frm,
    events,
    logs,
    requests,
    downloads,
    routes,
    tabs,
    get html() {
      return html;
    },
    get actions() {
      return actions;
    },
  };
}

for (const failed of [0, 1, 2]) {
  test(`actual import-log callbacks render contextual ${failed} count and preserve download routes`, () => {
    const state = setup({ failed });
    const before = structuredClone(state.frm.doc);
    state.events.render_import_log(state.frm);
    assert.match(
      state.html,
      new RegExp(
        `<span>Con errori</span>[\\s\\S]*?text-ink-red-6[^>]*>${failed}</span>`
      )
    );
    assert.deepEqual(JSON.parse(JSON.stringify(state.requests)), [
      {
        method: "frappe.core.doctype.data_import.data_import.get_import_status",
        args: { data_import_name: "DI-DEMO" },
      },
      {
        method: "frappe.core.doctype.data_import.data_import.get_import_logs",
        args: { data_import: "DI-DEMO", status: "all" },
      },
    ]);
    assert.deepEqual(
      Array.from(state.tabs[0].options, (option) => option.value),
      ["all", "success", "failed"]
    );
    state.actions.go_to_list();
    state.actions.download_skipped_rows();
    state.actions.export_errored_rows();
    assert.deepEqual(state.routes, [["List", "ToDo"]]);
    assert.deepEqual(JSON.parse(JSON.stringify(state.downloads)), [
      [
        "/api/method/frappe.core.doctype.data_import.data_import.download_skipped_rows",
        { data_import_name: "DI-DEMO" },
      ],
      [
        "/api/method/frappe.core.doctype.data_import.data_import.download_errored_template",
        { data_import_name: "DI-DEMO" },
      ],
    ]);
    assert.deepEqual(state.frm.doc, before);
    if (failed) assert.ok(state.html.includes("Titolo &lt;privato&gt;"));
    assert.equal(state.host.__("Failed"), "Fallito");
  });
}

test("actual import-log fallback counts physical rows and preserves canonical tab request", () => {
  const state = setup({ summary: false });
  state.events.render_import_log(state.frm);
  assert.match(
    state.html,
    /<span>Con errori<\/span>[\s\S]*?text-ink-red-6[^>]*>2<\/span>/
  );
  state.tabs[0].on_change("failed");
  assert.equal(state.frm._import_log_filter, "failed");
  assert.equal(state.requests.at(-1).args.status, "failed");
  assert.equal(state.logs[0].row_indexes, "[2,3]");
});

for (const failed of [0, 1, 2]) {
  test(`actual progress renderer contextualizes ${failed} while preserving progress and activity`, () => {
    const state = setup({ failed });
    state.frm._wizard_import_progress = {
      failed,
      inserted: 3,
      skipped: 1,
      current: 4,
      total: 10,
      percent: 40,
      title: "Titolo <privato>",
      recent_activity: [{ kind: "error", text: "Errore <privato>", row: 2 }],
    };
    const before = structuredClone(state.frm._wizard_import_progress);
    state.events.render_import_progress_state(state.frm);
    assert.match(
      state.html,
      new RegExp(`text-ink-red-8">${failed}</div>[\\s\\S]*?>Con errori</div>`)
    );
    assert.ok(state.html.includes('aria-valuenow="40"'));
    assert.ok(state.html.includes("Titolo &lt;privato&gt;"));
    assert.ok(state.html.includes("Errore &lt;privato&gt;"));
    assert.deepEqual(state.frm._wizard_import_progress, before);
    assert.equal(state.requests.length, 0);
  });
}
