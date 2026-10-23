import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../../"
);
const require = createRequire(resolve(root, "package.json"));
const { JSDOM } = require("jsdom");
const jquery = require("jquery");
const { buildSync } = require("esbuild");
const utils = buildSync({
  entryPoints: [resolve(root, "frappe/public/js/frappe/utils/utils.js")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  logLevel: "silent",
}).outputFiles[0].text;
const singularViewing = "{0} is currently viewing this document";
const pluralViewing = "{0} are currently viewing this document";
const singularComposing = "{0} is currently composing an email";
const pluralComposing = "{0} are currently composing an email";
const singularFallback = "{0} is currently {1}";
const pluralFallback = "{0} are currently {1}";
const dictionary = {
  and: "e",
  [singularViewing]: "{0} sta visualizzando questo documento",
  [pluralViewing]: "{0} stanno visualizzando questo documento",
  [singularComposing]: "{0} sta scrivendo un’email",
  [pluralComposing]: "{0} stanno scrivendo un’email",
  [singularFallback]: "Stato attuale di {0}: {1}",
  [pluralFallback]: "Stato attuale di {0}: {1}",
  Open: "Aperto",
  "custom state": "stato tradotto",
};
const userInfo = {
  "ana@example.com": { fullname: "Open", image: "", abbr: "O", color: "blue" },
  "bruno@example.com": {
    fullname: "Bruno",
    image: "/example.png",
    abbr: "B",
    color: "gray",
  },
  "clara@example.com": {
    fullname: "Clara",
    image: "",
    abbr: "C",
    color: "orange",
  },
};

function setup(t, messages = dictionary) {
  const dom = new JSDOM(
    '<!doctype html><body><div id="wrapper"><ul class="hidden"><li class="form-viewers"></li></ul><ul class="hidden"><li class="form-typers"></li></ul></div></body>',
    { runScripts: "outside-only", url: "https://example.com" }
  );
  t.after(() => dom.window.close());
  const window = dom.window;
  const context = dom.getInternalVMContext();
  const $ = jquery(window);
  const alerts = [],
    reads = [],
    infoCalls = [],
    translationCalls = [];
  let docinfo;
  window.$ = window.jQuery = $;
  window.frappe = {
    ui: { form: {} },
    utils: {},
    session: { user: "translator@example.com" },
    _messages: messages,
    user_info(username) {
      infoCalls.push(username);
      assert.ok(userInfo[username]);
      return userInfo[username];
    },
    show_alert(message) {
      alerts.push(message);
    },
    templates: {
      users_in_sidebar: readFileSync(
        resolve(
          root,
          "frappe/public/js/frappe/form/templates/users_in_sidebar.html"
        ),
        "utf8"
      ),
    },
    provide(path) {
      let value = window;
      for (const key of path.split(".")) value = value[key] ??= {};
    },
  };
  for (const name of ["format", "translate", "microtemplate"]) {
    vm.runInContext(
      readFileSync(resolve(root, `frappe/public/js/frappe/${name}.js`), "utf8"),
      context
    );
  }
  vm.runInContext(utils, context);
  const translate = window.__;
  window.__ = (...args) => {
    translationCalls.push(args);
    return translate(...args);
  };
  vm.runInContext(
    readFileSync(
      resolve(
        root,
        "frappe/public/js/frappe/form/sidebar/form_sidebar_users.js"
      ),
      "utf8"
    ),
    context
  );
  const frm = {
    get_docinfo() {
      reads.push("get_docinfo");
      return docinfo;
    },
  };
  const wrapper = $("#wrapper");
  const sidebar = new window.frappe.ui.form.SidebarUsers({
    frm,
    $wrapper: wrapper,
  });
  const array = (values) => vm.runInContext("Array", context).from(values);
  return {
    sidebar,
    wrapper,
    alerts,
    reads,
    infoCalls,
    translationCalls,
    array,
    setDocinfo(value) {
      docinfo = value;
    },
    titles(type) {
      return [
        ...wrapper.find(
          type === "viewers" ? ".form-viewers .avatar" : ".form-typers .avatar"
        ),
      ].map((node) => node.getAttribute("title"));
    },
  };
}

for (const [names, message, source, expected] of [
  [
    ["Open"],
    "viewing this document",
    singularViewing,
    "Open sta visualizzando questo documento",
  ],
  [
    ["Open", "Bruno", "Clara"],
    "viewing this document",
    pluralViewing,
    "Open, Bruno e Clara stanno visualizzando questo documento",
  ],
  [
    ["Open"],
    "composing an email",
    singularComposing,
    "Open sta scrivendo un’email",
  ],
  [
    ["Open", "Bruno", "Clara"],
    "composing an email",
    pluralComposing,
    "Open, Bruno e Clara stanno scrivendo un’email",
  ],
]) {
  test(`public show_alert translates complete ${
    names.length === 1 ? "singular" : "plural"
  } ${message}`, (t) => {
    const state = setup(t);
    const users = state.array(names);
    state.sidebar.show_alert(users, message);
    assert.deepEqual(state.alerts, [expected]);
    assert.deepEqual(Array.from(users), names);
    assert.equal(state.sidebar.show_alert.length, 2);
    assert.equal(state.translationCalls.at(-1)[0], source);
    assert.equal(state.translationCalls.at(-1)[1].length, 1);
  });
}

for (const type of ["viewers", "typers"]) {
  test(`actual refresh renders complete ${type} titles and preserves ordered reads and selection`, (t) => {
    const state = setup(t);
    const users = {
      current: [
        "translator@example.com",
        "ana@example.com",
        "bruno@example.com",
        "clara@example.com",
      ],
      new: ["bruno@example.com"],
    };
    const original = JSON.stringify(users);
    state.setDocinfo({ [type]: users });
    state.sidebar.refresh(true, type);
    assert.deepEqual(
      state.titles(type),
      type === "viewers"
        ? [
            "Open sta visualizzando questo documento",
            "Bruno sta visualizzando questo documento",
            "Clara sta visualizzando questo documento",
          ]
        : [
            "Open sta scrivendo un’email",
            "Bruno sta scrivendo un’email",
            "Clara sta scrivendo un’email",
          ]
    );
    assert.deepEqual(state.alerts, [
      type === "viewers"
        ? "Bruno sta visualizzando questo documento"
        : "Open, Bruno e Clara stanno scrivendo un’email",
    ]);
    assert.deepEqual(state.reads, ["get_docinfo"]);
    assert.deepEqual(state.infoCalls, [
      "ana@example.com",
      "bruno@example.com",
      "clara@example.com",
    ]);
    assert.equal(JSON.stringify(users), original);
    const parent = state.wrapper.find(
      type === "viewers" ? ".form-viewers" : ".form-typers"
    );
    assert.equal(parent.parent().hasClass("hidden"), false);
    assert.equal(parent.find("img").attr("src"), "/example.png");
    assert.equal(parent.find("img").attr("alt"), "Bruno");
    assert.equal(parent.find(".standard-image").first().text(), "O");
  });
}

test("public arbitrary messages keep their exact generic fallback and raw argument identity", (t) => {
  const state = setup(t);
  const messages = [
    "custom state",
    "viewing this document ",
    "VIEWING THIS DOCUMENT",
    "Composing an email",
    "",
    undefined,
    null,
    0,
    { state: "busy" },
  ];
  for (const message of messages) {
    for (const names of [["Open"], ["Open", "Bruno", "Clara"]]) {
      state.alerts.length = 0;
      const users = state.array(names);
      state.sidebar.show_alert(users, message);
      const label = names.length === 1 ? "Open" : "Open, Bruno e Clara";
      assert.deepEqual(state.alerts, [
        `Stato attuale di ${label}: ${
          message === undefined ? "{1}" : String(message)
        }`,
      ]);
      const [source, args] = state.translationCalls.at(-1);
      assert.equal(
        source,
        names.length === 1 ? singularFallback : pluralFallback
      );
      assert.equal(args[0], label);
      assert.equal(args[1], message);
      assert.deepEqual(Array.from(users), names);
    }
  }
});

test("zero users never deliver or translate an alert", (t) => {
  const state = setup(t);
  for (const message of [
    "viewing this document",
    "composing an email",
    "custom state",
    undefined,
  ])
    state.sidebar.show_alert(state.array([]), message);
  assert.deepEqual(state.alerts, []);
  assert.deepEqual(state.translationCalls, []);
});

test("refresh keeps empty, missing, disabled-alert, self-only and non-viewer type behavior", (t) => {
  const state = setup(t, {});
  const viewers = state.wrapper.find(".form-viewers");
  const typers = state.wrapper.find(".form-typers");
  for (const docinfo of [undefined, {}, { viewers: null }]) {
    viewers.append('<span class="old">old</span>');
    state.setDocinfo(docinfo);
    state.sidebar.refresh(true, "viewers");
    assert.equal(viewers.html(), "");
    assert.deepEqual(state.alerts, []);
  }
  state.setDocinfo({
    viewers: { current: ["ana@example.com"], new: ["ana@example.com"] },
  });
  state.sidebar.refresh(false, "viewers");
  assert.deepEqual(state.titles("viewers"), [
    "Open is currently viewing this document",
  ]);
  assert.deepEqual(state.alerts, []);
  state.setDocinfo({
    viewers: {
      current: ["translator@example.com"],
      new: ["translator@example.com"],
    },
  });
  state.sidebar.refresh(true, "viewers");
  assert.equal(viewers.html(), "");
  assert.equal(viewers.parent().hasClass("hidden"), true);
  assert.deepEqual(state.alerts, []);
  const custom = { current: ["ana@example.com"], new: [] };
  state.setDocinfo({ custom });
  state.sidebar.refresh(true, "custom");
  assert.deepEqual(state.titles("typers"), [
    "Open is currently composing an email",
  ]);
  assert.equal(typers.parent().hasClass("hidden"), false);
  assert.deepEqual(state.alerts, ["Open is currently composing an email"]);
  assert.deepEqual(custom, { current: ["ana@example.com"], new: [] });
  state.setDocinfo({ custom: { current: [], new: [] } });
  state.sidebar.refresh(true, "custom");
  assert.equal(typers.html(), "");
  assert.equal(typers.parent().hasClass("hidden"), true);
});

test("unknown English messages and known activities retain readable original output with an empty dictionary", (t) => {
  const state = setup(t, {});
  for (const message of [
    "viewing this document",
    "composing an email",
    "custom state",
  ]) {
    for (const names of [["Open"], ["Open", "Bruno", "Clara"]]) {
      state.alerts.length = 0;
      state.sidebar.show_alert(state.array(names), message);
      assert.deepEqual(state.alerts, [
        names.length === 1
          ? `Open is currently ${message}`
          : `Open, Bruno and Clara are currently ${message}`,
      ]);
    }
  }
});
