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
const { parse } = require("@babel/parser");
const bundle = (path) =>
  buildSync({
    entryPoints: [resolve(root, path)],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    logLevel: "silent",
  }).outputFiles[0].text;
const modules = [
  "frappe/public/js/frappe/utils/utils.js",
  "frappe/public/js/frappe/ui/components/tooltip.js",
  "frappe/public/js/frappe/form/controls/text_editor.js",
].map(bundle);
const dictionary = {
  Bold: "Grassetto",
  Italic: "Corsivo",
  Underline: "Sottolineato",
  Strikethrough: "Barrato",
  "Remove formatting": "Rimuovi formattazione",
  Blockquote: "Citazione",
  "Code block": "Blocco di codice",
  "Text direction": "Direzione del testo",
  "Insert link": "Inserisci link",
  "Insert image": "Inserisci immagine",
  "Insert video": "Inserisci video",
  "Numbered list": "Elenco numerato",
  "Bullet list": "Elenco puntato",
  "Task list": "Elenco di attività",
  "Increase indent": "Aumenta il rientro",
  "Decrease indent": "Riduci rientro",
  Subscript: "Pedice",
  Superscript: "Apice",
  "Text style": "Stile del testo",
  "Font size": "Dimensione del carattere",
  "Text color": "Colore del testo",
  "Background color": "Colore di sfondo",
  Alignment: "Allineamento",
  Table: "Tabella",
  Paragraph: "Paragrafo",
  "Heading {0}": "Titolo {0}",
};
const buttons = [
  [".ql-bold", "Bold"],
  [".ql-italic", "Italic"],
  [".ql-underline", "Underline"],
  [".ql-strike", "Strikethrough"],
  [".ql-clean", "Remove formatting"],
  [".ql-blockquote", "Blockquote"],
  [".ql-code-block", "Code block"],
  [".ql-direction", "Text direction"],
  [".ql-link", "Insert link"],
  [".ql-image", "Insert image"],
  ['.ql-list[value="ordered"]', "Numbered list"],
  ['.ql-list[value="bullet"]', "Bullet list"],
  ['.ql-list[value="check"]', "Task list"],
  ['.ql-indent[value="-1"]', "Decrease indent"],
  ['.ql-indent[value="+1"]', "Increase indent"],
];

function setup(t, messages = dictionary) {
  const dom = new JSDOM("<!doctype html><body></body>", {
    url: "https://example.com",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const window = dom.window;
  const context = dom.getInternalVMContext();
  const $ = jquery(window);
  const controls = [];
  const deliveries = [];
  window.$ = window.jQuery = $;
  window.document.execCommand = () => false;
  window.Range.prototype.getBoundingClientRect = () => ({
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    width: 0,
    height: 0,
  });
  window.Range.prototype.getClientRects = () => [];
  window.frappe = {
    ui: { form: { ControlCode: class {} } },
    utils: {},
    _messages: messages,
    boot: { lang: "it" },
    session: { user: "translator@example.com" },
    provide(path) {
      let value = window;
      for (const key of path.split(".")) value = value[key] ??= {};
    },
  };
  for (const name of ["format", "translate"]) {
    vm.runInContext(
      readFileSync(resolve(root, `frappe/public/js/frappe/${name}.js`), "utf8"),
      context
    );
  }
  for (const source of modules) vm.runInContext(source, context);
  t.after(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    for (const control of controls) control.quill.scroll.observer.disconnect();
    dom.window.close();
  });
  return {
    window,
    $,
    context,
    deliveries,
    create(df = {}, state = {}) {
      const wrapper = $("<div>").appendTo(window.document.body);
      const control = Object.create(
        window.frappe.ui.form.ControlTextEditor.prototype
      );
      Object.assign(control, {
        df,
        input_area: wrapper,
        $wrapper: wrapper,
        value: "",
        parse_validate_and_set_in_model(value) {
          deliveries.push(value);
        },
        ...state,
      });
      control.make_quill_editor();
      controls.push(control);
      return control;
    },
    customOptions(html) {
      const options = vm.runInContext(
        "({container:null,handlers:{}})",
        context
      );
      options.container = $("<div>")
        .html(html)
        .appendTo(window.document.body)[0];
      return options;
    },
  };
}

test("Italian accessible names reuse actual translated tooltip labels", (t) => {
  const { create, $ } = setup(t);
  const control = create();
  const toolbar = control.quill.getModule("toolbar");
  assert.equal(control.quill.constructor.version, "2.0.3");
  assert.equal(toolbar.container.getAttribute("role"), "toolbar");
  assert.equal(
    toolbar.container.querySelectorAll("button").length,
    buttons.length
  );
  for (const [selector, source] of buttons) {
    const button = toolbar.container.querySelector(selector);
    assert.equal(
      button.getAttribute("aria-label"),
      dictionary[source],
      selector
    );
    assert.equal(button.getAttribute("aria-pressed"), "false");
    const tooltip = $(button).data("es-tooltip");
    assert.equal(tooltip.text, dictionary[source]);
    tooltip.show();
    assert.equal(tooltip.bubble.getAttribute("role"), "tooltip");
    assert.equal(tooltip.bubble.childNodes[0].nodeValue, dictionary[source]);
    assert.equal(button.getAttribute("aria-describedby"), tooltip.bubble.id);
    tooltip.hide();
  }
});

test("English fallback uses human display labels and leaves raw controls intact", (t) => {
  const { create } = setup(t, {});
  const toolbar = create().quill.getModule("toolbar");
  for (const [selector, source] of buttons) {
    assert.equal(
      toolbar.container.querySelector(selector).getAttribute("aria-label"),
      source
    );
  }
  assert.deepEqual(
    Array.from(toolbar.controls, ([format, input]) => [
      format,
      input.tagName,
      input.value,
    ]).filter(([format]) => format === "list"),
    [
      ["list", "BUTTON", "ordered"],
      ["list", "BUTTON", "bullet"],
      ["list", "BUTTON", "check"],
    ]
  );
});

test("existing picker names and canonical option values remain unchanged", (t) => {
  const { create } = setup(t);
  const toolbar = create().quill.getModule("toolbar").container;
  for (const [format, source] of [
    ["header", "Text style"],
    ["size", "Font size"],
    ["color", "Text color"],
    ["background", "Background color"],
    ["align", "Alignment"],
    ["table", "Table"],
  ]) {
    const label = toolbar.querySelector(`.ql-${format} .ql-picker-label`);
    assert.equal(label.getAttribute("aria-label"), dictionary[source]);
    assert.equal(label.getAttribute("aria-expanded"), "false");
  }
  assert.deepEqual(
    Array.from(
      toolbar.querySelector("select.ql-header").options,
      (o) => o.value
    ),
    ["1", "2", "3", "4", "5", "6", ""]
  );
  assert.deepEqual(
    Array.from(
      toolbar.querySelector("select.ql-align").options,
      (o) => o.value
    ),
    ["", "center", "right", "justify"]
  );
});

test("custom names, missing labels, class order and unrelated actions stay compatible", (t) => {
  const env = setup(t);
  const options = env.customOptions(`
		<button class="application ql-bold" aria-label="Application supplied name"></button>
		<button class="application ql-italic ql-active" aria-label="italic"></button>
		<button class="ql-underline"></button>
		<button class="ql-strike" aria-label=""></button>
		<button class="ql-video" aria-label="video"></button>
		<button class="ql-script" value="sub" aria-label="script: sub"></button>
		<button class="ql-script" value="super" aria-label="script: super"></button>
		<button class="ql-custom" value="raw-token" aria-label="Application action"></button>
	`);
  const calls = [];
  options.handlers.custom = (value) => calls.push(value);
  const control = env.create({ get_toolbar_options: () => options });
  const toolbar = control.quill.getModule("toolbar").container;
  assert.equal(
    toolbar.querySelector(".ql-bold").getAttribute("aria-label"),
    "Application supplied name"
  );
  for (const [selector, source] of [
    [".ql-italic", "Italic"],
    [".ql-underline", "Underline"],
    [".ql-strike", "Strikethrough"],
    [".ql-video", "Insert video"],
    ['.ql-script[value="sub"]', "Subscript"],
    ['.ql-script[value="super"]', "Superscript"],
  ])
    assert.equal(
      toolbar.querySelector(selector).getAttribute("aria-label"),
      dictionary[source]
    );
  const custom = toolbar.querySelector(".ql-custom");
  assert.equal(custom.getAttribute("aria-label"), "Application action");
  assert.equal(env.$(custom).data("es-tooltip"), undefined);
  custom.click();
  assert.deepEqual(calls, ["raw-token"]);
});

test("Quill empty and zero button values retain exact generated-label matching", (t) => {
  const env = setup(t);
  const options = vm.runInContext(
    '[[{direction:""},{direction:0}]]',
    env.context
  );
  const toolbar = env
    .create({ get_toolbar_options: () => options })
    .quill.getModule("toolbar").container;
  assert.deepEqual(
    Array.from(toolbar.querySelectorAll("button"), (el) => [
      el.value,
      el.getAttribute("aria-label"),
    ]),
    [
      ["", dictionary["Text direction"]],
      ["0", dictionary["Text direction"]],
    ]
  );
});

test("format actions keep canonical Delta values, toggle state and user text", async (t) => {
  const env = setup(t);
  const control = env.create();
  const quill = control.quill;
  const toolbar = quill.getModule("toolbar").container;
  const click = (selector) => toolbar.querySelector(selector).click();
  quill.setText("Bold <and> Sample", "silent");
  quill.setSelection(0, 17, "silent");
  const before = JSON.stringify(quill.getContents());
  click(".ql-bold");
  assert.equal(quill.getFormat().bold, true);
  assert.equal(
    toolbar.querySelector(".ql-bold").getAttribute("aria-pressed"),
    "true"
  );
  click(".ql-bold");
  assert.equal(JSON.stringify(quill.getContents()), before);
  click('.ql-list[value="ordered"]');
  assert.equal(quill.getFormat().list, "ordered");
  click('.ql-list[value="ordered"]');
  click('.ql-list[value="check"]');
  assert.equal(quill.getFormat().list, "unchecked");
  click('.ql-list[value="check"]');
  click('.ql-indent[value="+1"]');
  assert.equal(quill.getFormat().indent, 1);
  click('.ql-indent[value="-1"]');
  assert.equal(quill.getFormat().indent, undefined);
  click(".ql-direction");
  assert.equal(quill.getFormat().direction, "rtl");
  assert.equal(quill.getFormat().align, "right");
  click(".ql-direction");
  assert.equal(JSON.stringify(quill.getContents()), before);
  assert.equal(quill.getText(), "Bold <and> Sample\n");
  await new Promise((resolve) => env.window.setTimeout(resolve, 350));
  assert.equal(
    env.deliveries.at(-1),
    '<div class="ql-editor read-mode"><p>Bold &lt;and&gt; Sample</p></div>'
  );
});

test("title fallback retains actual shortcut hints while names stay plain", (t) => {
  const env = setup(t);
  delete env.window.frappe.ui.tooltip;
  const keyboard = readFileSync(
    resolve(root, "frappe/public/js/frappe/ui/keyboard.js"),
    "utf8"
  );
  const getter = parse(keyboard, { sourceType: "module" }).program.body.find(
    (node) =>
      node.type === "ExpressionStatement" &&
      node.expression.type === "AssignmentExpression" &&
      node.expression.left.type === "MemberExpression" &&
      node.expression.left.property.name === "get_shortcut_label"
  );
  assert.ok(getter);
  env.window.frappe.provide("frappe.ui.keys");
  vm.runInContext(keyboard.slice(getter.start, getter.end), env.context);
  const toolbar = env.create().quill.getModule("toolbar").container;
  const bold = toolbar.querySelector(".ql-bold");
  assert.equal(
    bold.title,
    `${dictionary.Bold} (${env.window.frappe.ui.keys.get_shortcut_label(
      "ctrl+b"
    )})`
  );
  assert.equal(bold.getAttribute("aria-label"), dictionary.Bold);
  assert.equal(
    toolbar.querySelector(".ql-clean").title,
    dictionary["Remove formatting"]
  );
});

test("empty toolbars, read-only controls and explicit picker names keep existing behavior", (t) => {
  const env = setup(t);
  const grid = env.create({}, { grid_row: {} });
  assert.equal(
    grid.quill.getModule("toolbar").container.querySelectorAll("button").length,
    0
  );
  assert.equal(grid.get_quill_options().theme, null);
  assert.doesNotThrow(() => grid.add_toolbar_tooltips(null));
  assert.doesNotThrow(() => grid.add_toolbar_tooltips({}));
  const readOnly = env.create({ read_only: 1 });
  assert.equal(readOnly.quill.root.getAttribute("contenteditable"), "false");
  const toolbar = readOnly.quill.getModule("toolbar");
  const picker = toolbar.container.querySelector(".ql-align .ql-picker-label");
  picker.setAttribute("aria-label", "Application alignment");
  readOnly.add_toolbar_tooltips(toolbar);
  assert.equal(picker.getAttribute("aria-label"), "Application alignment");
  assert.equal(readOnly.quill.getText(), "\n");
  assert.deepEqual(env.deliveries, []);
});
