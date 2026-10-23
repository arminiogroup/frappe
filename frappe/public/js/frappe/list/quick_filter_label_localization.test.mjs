import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const { transformSync } = require("esbuild");
const appRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const readSource = (path) => readFileSync(appRoot + path, "utf8");
const settle = () => new Promise((resolve) => setTimeout(resolve, 400));
const plain = (value) => JSON.parse(JSON.stringify(value));
const messages = {
  Date: "Data",
  Data: "Dati",
  "Date:Custom Parent": "Data contestuale",
  Status: "Stato",
  Issue: "Segnalazione",
  "Issue:Asset": "Assegnato",
  "Issue:Custom Display": "Scelta personalizzata",
};

function environment({
  english = false,
  fields = [],
  doctype = "Communication",
} = {}) {
  const dom = new JSDOM(
    '<!doctype html><body><div class="page-form"><div class="standard-filter-section"></div></div></body>',
    { url: "http://localhost/", runScripts: "outside-only" }
  );
  const context = dom.getInternalVMContext();
  const window = dom.window;
  window.moment = require("moment-timezone");
  window.cint = (value) => Number.parseInt(value || 0, 10);
  window.cstr = (value) => String(value ?? "");
  window.flt = (value) => Number(value || 0);
  window.is_null = (value) => value === undefined || value === null;
  window.strip_html = (value) => String(value ?? "").replace(/<[^>]*>/g, "");
  window.locals = {};
  vm.runInContext(readFileSync(require.resolve("jquery"), "utf8"), context);
  const $ = window.jQuery;
  $.fn.tooltip = function () {
    return this;
  };
  vm.runInContext(
    readFileSync(
      require.resolve("air-datepicker/dist/js/datepicker.js"),
      "utf8"
    ),
    context
  );
  vm.runInContext(
    readFileSync(
      require.resolve("air-datepicker/dist/js/i18n/datepicker.en.js"),
      "utf8"
    ),
    context
  );
  const events = [];
  const metadata = { fields, autoname: "hash" };
  window.frappe = {
    provide(path) {
      let target = window;
      for (const part of path.split(".")) target = target[part] ??= {};
    },
    _messages: english ? {} : { ...messages },
    ui: { form: {} },
    views: {},
    form: { formatters: {} },
    model: {
      is_value_type: () => true,
      can_write: () => false,
      is_numeric_field: () => false,
      no_value_type: [],
      table_fields: [],
      get_value: () => undefined,
    },
    perm: { has_perm: (_doctype, level) => !level },
    boot: {
      treeviews: [],
      user: { language: "en" },
      sysdefaults: { date_format: "yyyy-mm-dd" },
      time_zone: { system: "UTC", user: "UTC" },
    },
    sys_defaults: {
      date_format: "yyyy-mm-dd",
      first_day_of_the_week: "Monday",
      time_zone: "UTC",
    },
    get_user_settings: () => ({ filter_conditions: {} }),
    get_meta: () => metadata,
    is_mobile: () => false,
    utils: { icon: () => "<svg></svg>" },
    meta: { docfield_map: {}, docfield_copy: {} },
    defaults: { is_enabled: () => false },
    session: { user: "translator@example.com" },
    call() {
      throw new Error("Unexpected network request");
    },
    db: new Proxy(
      {},
      {
        get() {
          throw new Error("Unexpected database access");
        },
      }
    ),
  };
  const helper = transformSync(
    readSource("frappe/public/js/frappe/utils/select_option_context.ts"),
    { loader: "ts", format: "iife", globalName: "SelectContexts" }
  ).code;
  vm.runInContext(helper, context);
  window.selectOptionContext = window.SelectContexts.selectOptionContext;
  for (const path of [
    "frappe/public/js/frappe/utils/utils.js",
    "frappe/public/js/frappe/dom.js",
    "frappe/public/js/frappe/format.js",
    "frappe/public/js/frappe/translate.js",
    "frappe/public/js/frappe/utils/datetime.js",
    "frappe/public/js/frappe/form/formatters.js",
    "frappe/public/js/frappe/form/controls/base_control.js",
    "frappe/public/js/frappe/form/controls/base_input.js",
    "frappe/public/js/frappe/form/controls/data.js",
    "frappe/public/js/frappe/form/controls/date.js",
    "frappe/public/js/frappe/form/controls/select.js",
    "frappe/public/js/frappe/form/controls/control.js",
    "frappe/public/js/frappe/ui/page.js",
    "frappe/public/js/frappe/list/base_list.js",
    "frappe/public/js/frappe/views/kanban_v2/kanban_page.js",
  ]) {
    vm.runInContext(readSource(path).replace(/^import .*;\n/gm, ""), context, {
      filename: path,
    });
  }
  const page = Object.create(window.frappe.ui.Page.prototype);
  page.page_form = $(".page-form");
  page.fields_dict = {};
  const list = vm.runInContext("Object.create(FilterArea.prototype)", context);
  list.list_view = {
    doctype,
    view_name: "List",
    meta: metadata,
    settings: { hide_name_filter: true },
    page,
  };
  list.debounced_refresh_list_view = () => events.push("list refresh");
  const board = Object.create(window.frappe.views.KanbanV2Page.prototype);
  board.doctype = doctype;
  board.page = page;
  board.$filter_section = $("<div></div>").appendTo(page.page_form);
  board.filters = [];
  board.provider = {
    setFilters: (filters) => events.push(["board filters", plain(filters)]),
  };
  board.board = { refresh: () => events.push("board refresh") };
  return {
    window,
    page,
    list,
    board,
    metadata,
    events,
    close: () => window.close(),
  };
}

const fixtures = [
  {
    label: "Date",
    fieldtype: "Date",
    expected: "Data",
    parent: "Communication",
  },
  {
    label: "Date",
    fieldtype: "Date",
    expected: "Data contestuale",
    parent: "Custom Parent",
  },
  {
    label: "Data",
    fieldtype: "Data",
    expected: "Dati",
    parent: "Communication",
  },
  {
    label: "Custom label",
    fieldtype: "Date",
    expected: "Custom label",
    parent: "Communication",
  },
  {
    label: "Date",
    fieldtype: "Date",
    expected: "Date",
    parent: "Communication",
    english: true,
  },
  {
    label: "Date",
    fieldtype: "Date",
    expected: "Data",
    parent: "Communication",
    custom: true,
  },
];

for (const kind of ["list", "board"]) {
  for (const fixture of fixtures) {
    if (kind === "board" && fixture.custom) continue;
    test(
      kind +
        " translates raw " +
        fixture.label +
        " exactly once " +
        fixture.parent +
        (fixture.english ? " English" : ""),
      async () => {
        const field = {
          label: fixture.label,
          fieldtype: fixture.fieldtype,
          fieldname: "date_field",
          in_standard_filter: true,
          parent: fixture.parent,
          context: "Select-specific context",
        };
        const original = JSON.stringify(field);
        const state = environment({
          fields: fixture.custom ? [] : [field],
          english: fixture.english,
        });
        try {
          if (fixture.custom)
            state.list.list_view.settings.custom_filter_configs = [
              { ...field },
            ];
          if (kind === "board") state.board.setup_quick_filters();
          else await state.list.make_standard_filters();
          const control = state.page.fields_dict.date_field;
          const value =
            fixture.fieldtype === "Date" ? "2026-01-31" : "Customer";
          control.set_input(value);
          assert.equal(control.df.label, field.label);
          assert.equal(control.df.parent, field.parent);
          assert.equal(control.df.context, field.context);
          assert.equal(control.$input.attr("placeholder"), fixture.expected);
          assert.equal(control.$wrapper.attr("title"), fixture.expected);
          assert.equal(control.get_value(), value);
          assert.equal(JSON.stringify(field), original);
          const filters =
            kind === "board"
              ? state.board.get_effective_filters()
              : state.list.get_standard_filters();
          const expected = [
            [
              "Communication",
              "date_field",
              fixture.fieldtype === "Date" ? "=" : "like",
              fixture.fieldtype === "Date" ? value : "%Customer%",
            ],
          ];
          assert.deepEqual(plain(filters), expected);
          assert.equal(
            Boolean(control.datepicker),
            fixture.fieldtype === "Date"
          );
          control.df.onchange();
          await settle();
          if (kind === "board") {
            assert.deepEqual(state.events, [
              ["board filters", expected],
              "board refresh",
            ]);
          } else {
            assert.deepEqual(state.events, ["list refresh"]);
          }
        } finally {
          state.close();
        }
      }
    );
  }
}

for (const kind of ["list", "board"]) {
  for (const fixture of [
    { parent: "Asset", expected: "Assegnato" },
    { expected: "Assegnato" },
    {
      parent: "Asset",
      context: "Custom Display",
      expected: "Scelta personalizzata",
    },
    { parent: "Unknown DocType", expected: "Segnalazione" },
  ]) {
    test(
      kind +
        " keeps Select context and canonical option " +
        (fixture.context || fixture.parent || "fallback"),
      async () => {
        const field = {
          label: "Status",
          fieldtype: "Select",
          fieldname: "status",
          in_standard_filter: true,
          options: "Issue",
          parent: fixture.parent,
          context: fixture.context,
        };
        const original = JSON.stringify(field);
        const state = environment({ fields: [field], doctype: "Asset" });
        try {
          if (kind === "board") state.board.setup_quick_filters();
          else await state.list.make_standard_filters();
          const control = state.page.fields_dict.status;
          assert.equal(control.df.label, "Status");
          assert.equal(control.df.parent, fixture.parent || "Asset");
          assert.equal(control.df.context, fixture.context);
          assert.equal(control.df.options, "\nIssue");
          assert.deepEqual(
            plain(
              control.$input
                .find("option")
                .map((_index, option) => ({
                  value: option.value,
                  label: option.textContent,
                }))
                .get()
            ),
            [
              { value: "", label: "" },
              { value: "Issue", label: fixture.expected },
            ]
          );
          await control.set_value("Issue");
          await settle();
          assert.equal(control.get_value(), "Issue");
          const filters =
            kind === "board"
              ? state.board.get_effective_filters()
              : state.list.get_standard_filters();
          assert.deepEqual(plain(filters), [["Asset", "status", "=", "Issue"]]);
          assert.equal(JSON.stringify(field), original);
        } finally {
          state.close();
        }
      }
    );
  }
}

test("Kanban actual seed and rerender preserve values, field limits and effective filters", async () => {
  const makeField = (fieldname, extra = {}) => ({
    fieldname,
    label: "Data",
    fieldtype: "Data",
    parent: "Communication",
    in_standard_filter: true,
    ...extra,
  });
  const fields = [
    makeField("board_status"),
    makeField("swimlane"),
    makeField("denied", { permlevel: 1 }),
    makeField("first"),
    makeField("second"),
    makeField("third"),
    makeField("fourth"),
    makeField("fifth"),
  ];
  const original = JSON.stringify(fields);
  const state = environment({ fields });
  try {
    state.board.field_name = "board_status";
    state.board.group_by_field = "swimlane";
    state.board.mount_board = () => {
      state.events.push("board mount boundary");
    };
    state.board.filters = [
      ["Communication", "first", "like", "%Customer%"],
      ["Communication", "untouched", "=", "Date"],
    ];
    state.board.setup_quick_filters();
    await settle();
    assert.deepEqual(plain(state.board._quick_filter_fields), [
      "first",
      "second",
      "third",
      "fourth",
    ]);
    const first = state.page.fields_dict.first;
    assert.equal(first.get_value(), "Customer");
    await state.page.fields_dict.second.set_value("Data");
    const previous = state.page.fields_dict.second;
    state.board.setup_quick_filters();
    await settle();
    assert.notEqual(state.page.fields_dict.second, previous);
    assert.equal(state.page.fields_dict.first.get_value(), "Customer");
    assert.equal(state.page.fields_dict.second.get_value(), "Data");
    assert.equal(state.page.fields_dict.fifth, undefined);
    assert.deepEqual(
      plain(
        state.board.get_effective_filters([
          ["Communication", "extra", "=", "Issue"],
        ])
      ),
      [
        ["Communication", "untouched", "=", "Date"],
        ["Communication", "first", "like", "%Customer%"],
        ["Communication", "second", "like", "%Data%"],
        ["Communication", "extra", "=", "Issue"],
      ]
    );
    assert.equal(JSON.stringify(fields), original);
  } finally {
    state.close();
  }
});
