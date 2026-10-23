import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function setup() {
  const alerts = [];
  const realtime = {};
  const handlers = [];
  const $ = (markup) => ({ markup });
  $.extend = Object.assign;
  const host = {
    $,
    jQuery: $,
    cstr: String,
    console,
    frappe: {
      ui: {},
      utils: {},
      session: { user: "translator@example.com" },
      _messages: {
        Failed: "Fallito",
        Running: "In esecuzione",
        Completed: "Completato",
        Queued: "In coda",
        Cancelled: "Annullato",
        "Background Task": "Attività in secondo piano",
        "{0} failed": "{0} fallito",
        "{0} failed:Background Task": "Operazione non riuscita: {0}",
        "{0} failed:Data Import": "Con errori: {0}",
      },
      realtime: { on: (name, callback) => (realtime[name] = callback) },
      call: () => assert.fail("Task actions must not run"),
      db: { get_list: () => assert.fail("Known realtime tasks need no read") },
      show_alert: (alert) => alerts.push(alert),
    },
  };
  host.window = host;
  host.frappe.provide = (path) => {
    let current = host;
    for (const part of path.split(".")) current = current[part] ??= {};
  };
  const context = vm.createContext(host);
  const load = (path, module = false) => {
    const code = readFileSync(new URL(path, import.meta.url), "utf8")
      .replace(/^import .*;\n/gm, "")
      .replace(/^export default .*;\n/gm, "")
      .replace(/^export /gm, "");
    vm.runInContext(module ? `(function(){${code}\n})();` : code, context);
  };
  load("../../format.js");
  load("../../translate.js");
  load("../components/utils.js");
  load("../../utils/utils.js", true);
  load("../components/badge.js", true);
  load("./background_tasks.js");
  const view = Object.create(host.frappe.ui.BackgroundTasks.prototype);
  const task = {
    name: "BG-DEMO",
    task_id: "JOB-DEMO",
    task_name: "Ricalcolo <caffè & prezzi>",
    status: "Running",
    progress: 37,
    allow_user_retry: 1,
    allow_user_cancellation: 0,
  };
  Object.assign(view, {
    panel: {
      is_open: false,
      $panel: { on: (...args) => handlers.push(args) },
    },
    db_tasks: [task],
    has_fetched: false,
  });
  view.setup_events();
  return { host, view, task, alerts, realtime, handlers };
}

test("actual task badge translates canonical failure without changing retry rules", () => {
  const { host, view, task } = setup();
  task.status = "Failed";
  const before = structuredClone(task);
  const html = view.get_task_html(task).markup;
  assert.ok(html.includes('<span class="es-badge__label">Fallito</span>'));
  assert.ok(html.includes('data-theme="red"'));
  assert.ok(html.includes('data-name="BG-DEMO" data-task-id="JOB-DEMO"'));
  assert.ok(html.includes("Ricalcolo &lt;caffè &amp; prezzi&gt;"));
  assert.ok(html.includes('class="btn btn-xs btn-retry-task"'));
  assert.ok(!html.includes('class="btn btn-xs btn-cancel-task"'));
  assert.deepEqual(task, before);
  assert.equal(host.frappe.session.user, "translator@example.com");
  task.allow_user_retry = 0;
  assert.ok(!view.get_task_html(task).markup.includes("btn-retry-task"));
});

test("actual realtime failure alert translates the whole frame around escaped title", () => {
  const { host, task, alerts, realtime } = setup();
  realtime.task_update({
    task_id: task.task_id,
    task_name: task.task_name,
    status: "Failed",
  });
  assert.equal(alerts.length, 1);
  assert.equal(
    alerts[0].message,
    "Operazione non riuscita: Ricalcolo &lt;caffè &amp; prezzi&gt;"
  );
  assert.equal(alerts[0].indicator, "red");
  assert.equal(task.status, "Failed");
  assert.equal(task.task_id, "JOB-DEMO");
  assert.equal(task.task_name, "Ricalcolo <caffè & prezzi>");
  assert.equal(host.__("{0} failed", [2], "Data Import"), "Con errori: 2");
  assert.equal(host.__("{0} failed", [2]), "2 fallito");
});

test("silent updates, progress and existing cancellation controls stay unchanged", () => {
  const { view, task, alerts, realtime } = setup();
  realtime.task_update({
    task_id: task.task_id,
    status: "Failed",
    silent: true,
  });
  assert.equal(alerts.length, 0);
  assert.equal(task.status, "Failed");
  Object.assign(task, {
    status: "Running",
    progress: 37,
    stage: "Fase <privata>",
    show_progress_bar: 0,
  });
  const html = view.get_task_html(task).markup;
  assert.ok(html.includes("Fase &lt;privata&gt;"));
  assert.ok(!html.includes('class="progress-bar'));
  assert.ok(!html.includes("btn-cancel-task"));
  assert.ok(!html.includes("btn-retry-task"));
  task.status = "Queued";
  assert.ok(view.get_task_html(task).markup.includes("btn-cancel-task"));
});
