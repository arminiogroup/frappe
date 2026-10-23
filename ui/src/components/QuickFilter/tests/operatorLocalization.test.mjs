import { readFileSync } from "node:fs";
import vm from "node:vm";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { TooltipProvider } from "frappe-ui";
import QuickFilterInputs from "../QuickFilterInputs.vue";
import { serializeFilters } from "../../Filter/filters";

const host = {
  frappe: {
    _messages: {
      Like: "Mi piace",
      Equals: "Uguali",
      "Like:Filter Operator": "Contiene",
      "Equals:Filter Operator": "Uguale a",
    },
  },
  jQuery: {},
};
host.window = host;
host.$ = host.jQuery;
const context = vm.createContext(host);
for (const name of ["format", "translate"]) {
  vm.runInContext(
    readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        `../../../../../frappe/public/js/frappe/${name}.js`
      ),
      "utf8"
    ),
    context
  );
}

const title = Object.freeze({
  fieldname: "title",
  fieldtype: "Data",
  label: "Customer field label",
  parent: "ToDo",
});
const name = Object.freeze({
  fieldname: "name",
  fieldtype: "Data",
  options: "ToDo",
  label: "Customer record label",
  parent: "ToDo",
});
let app;
let container;
let requests;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("__", host.__);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal("PointerEvent", MouseEvent);
  requests = [];
  vi.stubGlobal("fetch", async (url, options) => {
    expect(url).toBe("/api/method/frappe.desk.search.search_link");
    expect(options.method).toBe("POST");
    const params = JSON.parse(options.body);
    expect(params.doctype).toBe("ToDo");
    requests.push({ url, params });
    return new Response(JSON.stringify({ message: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  container?.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function mount(fields, conditions = []) {
  const filters = ref(conditions);
  container = document.createElement("div");
  document.body.append(container);
  app = createApp({
    setup: () => () =>
      h(
        TooltipProvider,
        { hoverDelay: 0 },
        {
          default: () =>
            h(QuickFilterInputs, {
              fields,
              filters: filters.value,
              "onUpdate:filters": (value) => {
                filters.value = value;
              },
            }),
        }
      ),
  });
  app.mount(container);
  await nextTick();
  return filters;
}

const toggle = () => container.querySelector("button[data-slot='trigger']");

async function showTooltip(button) {
  button.focus();
  await nextTick();
  await vi.advanceTimersByTimeAsync(50);
  await nextTick();
  return document.querySelector("[data-slot='bubble']");
}

async function click(button) {
  button.click();
  await nextTick();
}

describe("Quick Filter operator localization", () => {
  it.each([
    ["like", "Contiene", "≈", "LIKE", "%caffè%"],
    ["equals", "Uguale a", "=", "=", "caffè"],
  ])(
    "renders contextual %s in the real Tooltip and accessible button",
    async (operator, label, symbol, wireOperator, wireValue) => {
      const filters = await mount(
        [title],
        [{ field: title, fieldname: "title", operator, value: "caffè" }]
      );
      const button = toggle();
      expect(button.getAttribute("aria-label")).toBe(label);
      expect(button.textContent).toBe(symbol);
      expect((await showTooltip(button)).textContent).toBe(label);
      expect(container.querySelector("input").getAttribute("placeholder")).toBe(
        title.label
      );
      expect(serializeFilters(filters.value)).toEqual([
        ["title", wireOperator, wireValue],
      ]);
      expect(requests).toEqual([]);
    }
  );

  it("toggles the raw operator without translating values or unrelated conditions", async () => {
    const other = {
      field: title,
      fieldname: "title",
      operator: "in",
      value: ["Like", "Customer value"],
    };
    const filters = await mount(
      [title],
      [
        other,
        { field: title, fieldname: "title", operator: "like", value: "Like" },
      ]
    );
    const button = toggle();
    await click(button);
    expect(button.getAttribute("aria-label")).toBe("Uguale a");
    expect(serializeFilters(filters.value)).toEqual([
      ["title", "in", ["Like", "Customer value"]],
      ["title", "=", "Like"],
    ]);
    expect(filters.value[0]).toEqual(other);
    expect(filters.value[1].operator).toBe("equals");
    await click(button);
    expect(button.getAttribute("aria-label")).toBe("Contiene");
    expect(serializeFilters(filters.value)[1]).toEqual([
      "title",
      "LIKE",
      "%Like%",
    ]);
    expect(filters.value[1].value).toBe("Like");
  });

  it("holds an empty override and keeps the real typing debounce and wire value", async () => {
    const filters = await mount([title]);
    await click(toggle());
    expect(toggle().getAttribute("aria-label")).toBe("Uguale a");
    expect(filters.value).toEqual([]);
    const input = container.querySelector("input");
    input.value = "caffè";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();
    await vi.advanceTimersByTimeAsync(499);
    expect(filters.value).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await nextTick();
    expect(serializeFilters(filters.value)).toEqual([["title", "=", "caffè"]]);
  });

  it("swaps the real name text input and Link picker while retaining canonical request identity", async () => {
    const filters = await mount(
      [name],
      [
        {
          field: name,
          fieldname: "name",
          operator: "like",
          value: "TODO-EXAMPLE",
        },
      ]
    );
    expect(container.querySelector("[role='combobox']")).toBeNull();
    await click(toggle());
    await vi.advanceTimersByTimeAsync(1);
    expect(container.querySelector("[role='combobox']")).not.toBeNull();
    expect(toggle().getAttribute("aria-label")).toBe("Uguale a");
    expect(serializeFilters(filters.value)).toEqual([
      ["name", "=", "TODO-EXAMPLE"],
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0].params).toMatchObject({
      doctype: "ToDo",
      txt: "",
      filters: {},
    });
    await click(toggle());
    expect(container.querySelector("[role='combobox']")).toBeNull();
    expect(toggle().getAttribute("aria-label")).toBe("Contiene");
    expect(serializeFilters(filters.value)).toEqual([
      ["name", "LIKE", "%TODO-EXAMPLE%"],
    ]);
  });

  it("reflects external condition changes and clears without reusing a stale override", async () => {
    const filters = await mount([title]);
    await click(toggle());
    filters.value = [
      { field: title, fieldname: "title", operator: "equals", value: "record" },
    ];
    await nextTick();
    expect(toggle().getAttribute("aria-label")).toBe("Uguale a");
    filters.value = [];
    await nextTick();
    expect(toggle().getAttribute("aria-label")).toBe("Contiene");
    expect(serializeFilters(filters.value)).toEqual([]);
  });

  it("keeps readable English captions without a translation host", async () => {
    vi.stubGlobal("__", undefined);
    const filters = await mount(
      [title],
      [{ field: title, fieldname: "title", operator: "like", value: "caffè" }]
    );
    expect(toggle().getAttribute("aria-label")).toBe("Like");
    expect((await showTooltip(toggle())).textContent).toBe("Like");
    await click(toggle());
    expect(toggle().getAttribute("aria-label")).toBe("Equals");
    expect(serializeFilters(filters.value)).toEqual([["title", "=", "caffè"]]);
  });
});
