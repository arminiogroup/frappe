import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

async function schedulerFlow(response, succeeds = false) {
  const buttons = new Map();
  const alerts = [];
  const requests = [];
  const jquery = Object.assign(() => ({ ajaxSend() {}, ajaxComplete() {} }), {
    extend: Object.assign,
  });
  const sandbox = {
    $: jquery,
    jQuery: jquery,
    document: {},
    setInterval() {},
    has_common: () => true,
    deep_equal() {},
    number_systems: {},
    CHART_PALETTE: [],
    frappe: {
      listview_settings: {},
      user_roles: ["System Manager"],
      _messages: {
        "Enable Scheduler": "Abilita lo scheduler",
        "Failed to enable scheduler: {0}":
          "Impossibile abilitare lo scheduler: {0}",
        "Failed to enable scheduler.": "Impossibile abilitare lo scheduler.",
        "Enabled Scheduler": "Scheduler abilitato",
      },
      provide(path) {
        let target = this;
        for (const part of path.split(".").slice(1))
          target = target[part] ??= {};
      },
      confirm: (_message, yes) => yes(),
      show_alert: (message) => alerts.push(message),
      get_route: () => ["List", "RQ Job"],
    },
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const path of [
    "../../../public/js/frappe/format.js",
    "../../../public/js/frappe/translate.js",
    "../../../public/js/frappe/utils/utils.js",
    "../../../public/js/frappe/request.js",
    "./rq_job_list.js",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8").replace(
      /^import .+;\n/gm,
      ""
    );
    vm.runInContext(source, context);
  }
  sandbox.frappe.call = (options) => {
    requests.push(options.method);
    if (options.method.endsWith("get_custom_queues"))
      options.callback({ message: [] });
    else if (options.method.endsWith("get_scheduler_status"))
      options.callback({ message: { status: "inactive" } });
    else if (succeeds) options.callback({ message: "enabled" });
    else options.error(response);
  };
  sandbox.frappe.listview_settings["RQ Job"].onload({
    page: {
      add_inner_button: (label, action) => buttons.set(label, action),
      set_indicator() {},
    },
    filter_area: {
      standard_filters_wrapper: { find: () => ({ append() {} }) },
    },
    list_view_settings: {},
    refresh() {},
  });
  await new Promise(setImmediate);
  buttons.get("Abilita lo scheduler")();
  await new Promise(setImmediate);
  assert.deepEqual(requests, [
    "frappe.core.doctype.rq_job.rq_job.get_custom_queues",
    "frappe.utils.scheduler.get_scheduler_status",
    "frappe.utils.scheduler.activate_scheduler",
  ]);
  return alerts.at(-1);
}

test("real xcall string rejection formats and escapes the scheduler failure detail", async () => {
  const alert = await schedulerFlow({
    message: '<b title="failure">Unavailable & retry</b>',
  });
  assert.equal(
    alert.message,
    "Impossibile abilitare lo scheduler: &lt;b title&#x3D;&quot;failure&quot;&gt;Unavailable &amp; retry&lt;/b&gt;"
  );
  assert.equal(alert.indicator, "error");
});

test("real xcall message-object rejection uses its readable message", async () => {
  const alert = await schedulerFlow({
    message: new Error("scheduler unavailable"),
  });
  assert.equal(
    alert.message,
    "Impossibile abilitare lo scheduler: scheduler unavailable"
  );
});

test("real xcall missing rejection detail uses a complete translated sentence", async () => {
  for (const response of [undefined, {}, { message: "" }]) {
    const alert = await schedulerFlow(response);
    assert.equal(alert.message, "Impossibile abilitare lo scheduler.");
    assert.equal(alert.indicator, "error");
  }
});

test("successful activation keeps the original method and translated success alert", async () => {
  assert.equal(await schedulerFlow(undefined, true), "Scheduler abilitato");
});
