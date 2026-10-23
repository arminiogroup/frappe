import { readFileSync } from "node:fs";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, createApp, h, nextTick, ref, type App } from "vue";
import ImportStep from "../steps/ImportStep.vue";
import { t } from "../translate";
import type { UseDataImport } from "../useDataImport";

const { callMock } = vi.hoisted(() => ({ callMock: vi.fn(async () => []) }));
vi.mock("frappe-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("frappe-ui")>()),
  call: callMock,
}));

let app: App | undefined;
let host: HTMLElement;
const saved = new Map<string, unknown>();
const globals = globalThis as Record<string, any>;

beforeEach(() => {
  for (const key of ["__", "frappe", "$", "jQuery", "csrf_token"])
    saved.set(key, globals[key]);
  const dictionary = {
    Failed: "Fallito",
    "Failed:Data Import": "Con errori",
    "{0} failed": "{0} fallito",
    "{0} failed:Data Import": "Con errori: {0}",
    "{0} failed:Background Task": "Operazione non riuscita: {0}",
  };
  const sandbox: Record<string, any> = {
    frappe: { _messages: dictionary },
    $: {},
    jQuery: {},
  };
  sandbox.jQuery = sandbox.$;
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const file of ["format.js", "translate.js"]) {
    vm.runInContext(
      readFileSync(`frappe/public/js/frappe/${file}`, "utf8"),
      context
    );
  }
  globals.__ = sandbox.__;
  globals.frappe = { session: { user: "translator@example.com" } };
  globals.csrf_token = "csrf-demo";
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  host?.remove();
  for (const [key, value] of saved) {
    if (value === undefined) delete globals[key];
    else globals[key] = value;
  }
  saved.clear();
  vi.restoreAllMocks();
});

function mount({ failed = 1, running = false, summary = true } = {}) {
  const doc = ref({
    doctype: "Data Import",
    name: "DI-DEMO",
    reference_doctype: "ToDo",
    import_type: "Insert New Records",
    status: running ? "In Progress" : "Partial Success",
    skipped_rows: [{ row_number: 9, row_data: "[]" }],
  });
  const state = {
    doc,
    running: ref(running),
    importStarted: computed(() => true),
    progress: ref({
      current: 4,
      total: 10,
      eta: 0,
      inserted: 3,
      updated: 0,
      failed,
      skipping: false,
      recentActivity: [
        { kind: "error", text: "Errore <privato>", isHtml: false, row: 2 },
      ],
    }),
    importStatus: ref(
      summary
        ? {
            status: doc.value.status,
            total_records: failed,
            success: 0,
            failed,
          }
        : {}
    ),
    logFilter: ref("all"),
    logs: ref(
      failed
        ? [
            {
              success: 0,
              row_indexes: "[2,3]",
              messages: JSON.stringify([{ title: "Titolo <privato>" }]),
            },
          ]
        : []
    ),
  };
  const onOpenList = vi.fn();
  app = createApp({
    render: () =>
      h(ImportStep, {
        dataImport: state as unknown as UseDataImport,
        onOpenList,
      }),
  });
  app.mount(host);
  return { state, onOpenList };
}

function stat(label: string) {
  return [...host.querySelectorAll('[role="listitem"]')].find((el) =>
    el.textContent?.includes(label)
  );
}

describe("Data Import contextual transport", () => {
  it("forwards trailing context at call time and preserves old host arguments", () => {
    expect(t("Failed", [], "Data Import")).toBe("Con errori");
    expect(t("{0} failed", [2], "Data Import")).toBe("Con errori: 2");
    expect(t("{0} failed", ["Attività"], "Background Task")).toBe(
      "Operazione non riuscita: Attività"
    );
    expect(t("Failed")).toBe("Fallito");
    expect(t("Failed", [], "Unknown")).toBe("Fallito");
    const capture = vi.fn(() => "host");
    globals.__ = capture;
    const values = [0, false, null, undefined, ""];
    expect(t("Values {0}", values, "Data Import")).toBe("host");
    expect(capture).toHaveBeenCalledWith("Values {0}", values, "Data Import");
    t("No replacements");
    expect(capture).toHaveBeenLastCalledWith(
      "No replacements",
      undefined,
      undefined
    );
    t("Null", null as unknown as unknown[], "Data Import");
    expect(capture).toHaveBeenLastCalledWith("Null", null, "Data Import");
  });

  it("preserves standalone interpolation for falsey and missing values", () => {
    delete globals.__;
    expect(
      t("{0}/{1}/{2}/{3}/{4}", [0, false, null, undefined, ""], "Data Import")
    ).toBe("0/false/null/{3}/");
    expect(t("{0}", undefined, "Data Import")).toBe("{0}");
    expect(t("{0}", null as unknown as unknown[], "Data Import")).toBe("{0}");
  });
});

for (const failed of [0, 1, 2]) {
  it(`actual result SFC preserves ${failed} count and canonical download/callback payloads`, async () => {
    const { state, onOpenList } = mount({ failed });
    const before = JSON.stringify(state.doc.value);
    const item = stat("Con errori");
    expect(item).toBeDefined();
    expect(item!.querySelector(".text-xl-semibold")?.textContent?.trim()).toBe(
      String(failed)
    );
    expect(host.innerHTML.includes("<privato>")).toBe(false);
    if (failed) expect(host.textContent).toContain("Titolo <privato>");
    const downloads: unknown[] = [];
    vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(function (
      this: HTMLFormElement
    ) {
      downloads.push({
        action: new URL(this.action).pathname,
        method: this.method,
        values: Object.fromEntries(new FormData(this)),
      });
    });
    const download = item!.querySelector("button");
    if (failed) {
      expect(download?.getAttribute("aria-label")).toBe("Download Failed Rows");
      download!.click();
      expect(downloads).toEqual([
        {
          action:
            "/api/method/frappe.core.doctype.data_import.data_import.download_errored_template",
          method: "post",
          values: { data_import_name: "DI-DEMO", csrf_token: "csrf-demo" },
        },
      ]);
    } else expect(download).toBeNull();
    const openList = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Go to list")
    );
    openList!.click();
    expect(onOpenList).toHaveBeenCalledWith("ToDo");
    expect(JSON.stringify(state.doc.value)).toBe(before);
    expect(globals.frappe.session.user).toBe("translator@example.com");
    await nextTick();
  });
  it(`actual running SFC renders whole contextual ${failed} failure count`, () => {
    const { state } = mount({ failed, running: true });
    expect(host.textContent).toContain("Importing row 4 of 10");
    if (failed) expect(host.textContent).toContain(`Con errori: ${failed}`);
    else expect(host.textContent?.includes("Con errori:")).toBe(false);
    expect(host.textContent).toContain("Errore <privato>");
    expect(host.innerHTML.includes("<privato>")).toBe(false);
    expect(state.progress.value.failed).toBe(failed);
  });
}

it("actual result SFC keeps physical-row fallback and canonical failed-tab selection", async () => {
  const { state } = mount({ summary: false });
  expect(
    stat("Con errori")!.querySelector(".text-xl-semibold")?.textContent?.trim()
  ).toBe("2");
  const failedTab = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Failed (2)")
  );
  failedTab!.click();
  await nextTick();
  expect(state.logFilter.value).toBe("failed");
  expect(state.logs.value[0].row_indexes).toBe("[2,3]");
});
