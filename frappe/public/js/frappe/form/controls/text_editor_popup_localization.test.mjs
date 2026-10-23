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
const postcss = require("postcss");
const { sass, sass_options } = require(resolve(root, "esbuild/sass_compiler"));
const compiled = await sass.compileAsync(
  resolve(root, "frappe/public/scss/desk.bundle.scss"),
  sass_options
);
const rules = [];
postcss.parse(compiled.css).walkRules((rule) => {
  rule.walkDecls("content", (decl) => {
    for (const selector of rule.selectors) {
      const match = selector.match(/^(.*?)::?(before|after)$/);
      if (match && selector.includes(".ql-tooltip")) {
        rules.push({
          selector: match[1],
          pseudo: match[2],
          value: decl.value,
          important: !!decl.important,
          order: rules.length,
        });
      }
    }
  });
});
const modules = [
  "frappe/public/js/frappe/utils/utils.js",
  "frappe/public/js/frappe/ui/components/tooltip.js",
  "frappe/public/js/frappe/form/controls/text_editor.js",
].map(
  (path) =>
    buildSync({
      entryPoints: [resolve(root, path)],
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      logLevel: "silent",
    }).outputFiles[0].text
);
const messages = {
  Link: "Collegamento",
  URL: "URL",
  "Video URL": "URL del video",
  Formula: "Formula",
  Edit: "Modifica",
  Save: "Salva",
  Remove: "Rimuovi",
};

function caption(element, pseudo) {
  const score = (rule) => [
    rule.important ? 1 : 0,
    (rule.selector.match(/#[\w-]+/g) || []).length,
    (rule.selector.match(/\.[\w-]+|\[[^\]]+\]/g) || []).length,
    (rule.selector.match(/(?:^|\s|>)(?:[a-z][\w-]*)/gi) || []).length,
    rule.order,
  ];
  const candidates = rules.filter(
    (rule) => rule.pseudo === pseudo && element.matches(rule.selector)
  );
  candidates.sort((left, right) => {
    const a = score(left);
    const b = score(right);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  });
  const value = candidates.at(-1)?.value;
  if (value?.startsWith("attr(")) {
    return element.getAttribute(value.slice(5, -1)) ?? "";
  }
  return value?.replace(/^(['"])(.*)\1$/, "$2");
}

function setup(t, dictionary = messages) {
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
  const network = [];
  window.$ = window.jQuery = $;
  window.fetch = (...args) => {
    network.push(args);
    throw new Error("Unexpected network request");
  };
  window.XMLHttpRequest = class {
    constructor() {
      network.push("XHR");
      throw new Error("Unexpected XHR");
    }
  };
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
    _messages: dictionary,
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
    assert.deepEqual(network, []);
    dom.window.close();
  });
  return {
    window,
    context,
    deliveries,
    create(theme = "snow", optional = false, extraModules = null) {
      const area = $("<div>").appendTo(window.document.body);
      const df = { theme };
      if (optional) {
        const options = vm.runInContext(
          '[["link", "video", "formula"]]',
          context
        );
        df.get_toolbar_options = () => options;
      }
      const control = Object.create(
        window.frappe.ui.form.ControlTextEditor.prototype
      );
      Object.assign(control, {
        df,
        input_area: area,
        $wrapper: area,
        value: "",
        parse_validate_and_set_in_model(value) {
          deliveries.push(value);
        },
      });
      if (extraModules) {
        control.get_quill_options = function () {
          const options =
            window.frappe.ui.form.ControlTextEditor.prototype.get_quill_options.call(
              this
            );
          Object.assign(options.modules, extraModules);
          return options;
        };
      }
      control.make_quill_editor();
      controls.push(control);
      assert.equal(control.quill.constructor.version, "2.0.3");
      return control;
    },
    direct(Quill) {
      window.PopupTestQuill = Quill;
      window.popupTestContainer = $("<div>").appendTo(window.document.body)[0];
      const quill = vm.runInContext(
        'new PopupTestQuill(popupTestContainer, {theme:"snow",modules:{toolbar:[["link","video","formula"]]}})',
        context
      );
      controls.push({ quill });
      return quill;
    },
  };
}

function prepare(control) {
  control.quill.setText("Preserve raw text", "silent");
  control.quill.setSelection(0, 8, "silent");
}

function enter(control, value, window) {
  const tooltip = control.quill.theme.tooltip;
  tooltip.textbox.value = value;
  tooltip.textbox.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    })
  );
}

function open(control, format) {
  control.quill
    .getModule("toolbar")
    .container.querySelector(`.ql-${format}`)
    .click();
}

function snapshot(control) {
  const tooltip = control.quill.theme.tooltip;
  return {
    caption: caption(tooltip.root, "before"),
    action: caption(tooltip.root.querySelector(".ql-action"), "after"),
    remove: caption(tooltip.root.querySelector(".ql-remove"), "before"),
    placeholder: tooltip.textbox.getAttribute("placeholder"),
  };
}

function setTemplate(tooltip, mutate) {
  const template = tooltip.root.ownerDocument.createElement("template");
  template.innerHTML = tooltip.constructor.TEMPLATE;
  mutate(template.content);
  tooltip.constructor.TEMPLATE = template.innerHTML;
}

test("Snow link captions follow actual edit, preview, save, and remove actions", async (t) => {
  const { create, window, deliveries } = setup(t);
  const control = create();
  prepare(control);
  const quill = control.quill;
  const tooltip = quill.theme.tooltip;
  const states = [];
  open(control, "link");
  states.push(snapshot(control));
  assert.equal(tooltip.textbox.value, "Preserve");
  assert.equal(tooltip.textbox.placeholder, "https://quilljs.com");
  tooltip.textbox.value = "/private/files/raw?lang=en#keep";
  tooltip.root.querySelector(".ql-action").click();
  assert.equal(quill.getFormat(0, 8).link, "/private/files/raw?lang=en#keep");
  quill.setSelection(1, 0, "user");
  states.push(snapshot(control));
  assert.equal(
    tooltip.preview.getAttribute("href"),
    "/private/files/raw?lang=en#keep"
  );
  assert.equal(tooltip.preview.textContent, "/private/files/raw?lang=en#keep");
  tooltip.root.querySelector(".ql-action").click();
  states.push(snapshot(control));
  assert.equal(tooltip.textbox.value, "/private/files/raw?lang=en#keep");
  enter(control, "https://example.com/raw?x=1&y=2", window);
  quill.setSelection(2, 0, "user");
  states.push(snapshot(control));
  assert.equal(quill.getFormat(0, 8).link, "https://example.com/raw?x=1&y=2");
  assert.equal(
    tooltip.preview.getAttribute("href"),
    "https://example.com/raw?x=1&y=2"
  );
  tooltip.root.querySelector(".ql-remove").click();
  assert.equal(quill.getFormat(0, 8).link, undefined);
  assert.equal(quill.getText(), "Preserve raw text\n");
  assert.equal(tooltip.root.classList.contains("ql-hidden"), true);
  await new Promise((resolve) => window.setTimeout(resolve, 350));
  assert.ok(deliveries.length > 0);
  assert.equal(quill.root.contains(tooltip.root), false);
  assert.equal(quill.root.innerHTML.includes("data-label"), false);
  assert.deepEqual(
    states.map((state) => [state.caption, state.action]),
    [
      ["URL", "Salva"],
      ["Collegamento", "Modifica"],
      ["URL", "Salva"],
      ["Collegamento", "Modifica"],
    ]
  );
  assert.equal(states[1].remove, "Rimuovi");
});

test("Snow Escape and unsafe-link sanitization retain original behavior", (t) => {
  const { create, window } = setup(t);
  const control = create();
  prepare(control);
  open(control, "link");
  const tooltip = control.quill.theme.tooltip;
  const before = JSON.stringify(control.quill.getContents());
  tooltip.textbox.value = "https://example.com/not-saved";
  tooltip.textbox.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    })
  );
  assert.equal(JSON.stringify(control.quill.getContents()), before);
  assert.equal(tooltip.root.classList.contains("ql-hidden"), true);
  control.quill.setSelection(0, 8, "silent");
  open(control, "link");
  enter(control, "javascript:alert(1)", window);
  assert.equal(control.quill.getFormat(0, 8).link, "about:blank");
  assert.equal(control.quill.getText(), "Preserve raw text\n");
});

test("Snow video uses localized caption and placeholder with canonical embed output", (t) => {
  const { create, window } = setup(t);
  const control = create("snow", true);
  prepare(control);
  open(control, "video");
  const state = snapshot(control);
  enter(control, "https://youtu.be/abc123", window);
  assert.ok(
    control.quill
      .getContents()
      .ops.some(
        (op) =>
          op.insert?.video === "https://www.youtube.com/embed/abc123?showinfo=0"
      )
  );
  assert.equal(
    control.quill.theme.tooltip.root.classList.contains("ql-hidden"),
    true
  );
  assert.equal(state.caption, "URL del video");
  assert.equal(state.placeholder, "URL del video");
});

test("Snow formula preserves example, missing-renderer guard, and raw expression", (t) => {
  const { create, window } = setup(t);
  const control = create("snow", true);
  prepare(control);
  open(control, "formula");
  const tooltip = control.quill.theme.tooltip;
  const state = snapshot(control);
  tooltip.textbox.value = "x^2 + y < 3";
  const before = JSON.stringify(control.quill.getContents());
  assert.throws(() => tooltip.save(), {
    message: "Formula module requires KaTeX.",
  });
  assert.equal(JSON.stringify(control.quill.getContents()), before);
  const renders = [];
  window.katex = {
    render(value, node, options) {
      renders.push({ value, options: JSON.parse(JSON.stringify(options)) });
      node.textContent = value;
    },
  };
  tooltip.save();
  assert.deepEqual(renders, [
    {
      value: "x^2 + y < 3",
      options: { throwOnError: false, errorColor: "#f00" },
    },
  ]);
  assert.ok(
    control.quill
      .getContents()
      .ops.some((op) => op.insert?.formula === "x^2 + y < 3")
  );
  assert.equal(
    control.quill.root.querySelector(".ql-formula").getAttribute("data-value"),
    "x^2 + y < 3"
  );
  assert.equal(state.caption, "Formula");
  assert.equal(state.placeholder, "e=mc^2");
});

test("Bubble retains its link, close, formula, and translated video-placeholder flows", (t) => {
  const { create, window } = setup(t);
  const control = create("bubble", true);
  prepare(control);
  open(control, "link");
  enter(control, "/raw/bubble?keep=1", window);
  assert.equal(control.quill.getFormat(0, 8).link, "/raw/bubble?keep=1");
  open(control, "video");
  const tooltip = control.quill.theme.tooltip;
  const placeholder = tooltip.textbox.placeholder;
  tooltip.root.querySelector(".ql-close").click();
  assert.equal(tooltip.root.classList.contains("ql-editing"), false);
  assert.equal(caption(tooltip.root.querySelector(".ql-close"), "before"), "×");
  open(control, "formula");
  assert.equal(tooltip.textbox.placeholder, "e=mc^2");
  assert.equal(tooltip.root.hasAttribute("data-label"), false);
  assert.equal(placeholder, "URL del video");
});

test("missing translations fall back to human labels, preserving technical examples", (t) => {
  const { create } = setup(t, {});
  const control = create("snow", true);
  prepare(control);
  open(control, "link");
  assert.equal(snapshot(control).caption, "URL");
  assert.equal(snapshot(control).action, "Save");
  assert.equal(snapshot(control).placeholder, "https://quilljs.com");
  open(control, "video");
  assert.equal(snapshot(control).caption, "Video URL");
  assert.equal(snapshot(control).placeholder, "Video URL");
  open(control, "formula");
  assert.equal(snapshot(control).caption, "Formula");
  assert.equal(snapshot(control).placeholder, "e=mc^2");
});

test("known Snow custom label attributes and current template input remain exact", (t) => {
  const { create } = setup(t);
  const seed = create();
  const customLabels = {
    "data-label": "Collegamento dell'app",
    "data-label-link": "",
    "data-label-video": "Video dell'app",
    "data-label-formula": "0",
  };
  seed.quill.constructor.register(
    "modules/popupLabels",
    class {
      constructor(quill) {
        for (const [name, value] of Object.entries(customLabels)) {
          quill.theme.tooltip.root.setAttribute(name, value);
        }
      }
    }
  );
  setTemplate(seed.quill.theme.tooltip, (template) => {
    template
      .querySelector(".ql-action")
      .setAttribute("data-label-edit", "Modifica dell'app");
    template.querySelector(".ql-action").setAttribute("data-label-save", "");
    template
      .querySelector(".ql-remove")
      .setAttribute("data-label", "Rimozione dell'app");
    const input = template.querySelector("input");
    input.setAttribute("data-video", "URL personalizzato");
    input.setAttribute("data-link", "https://custom.example.com/raw");
    input.setAttribute("data-formula", "raw^2");
    input.setAttribute("value", "Existing input value");
  });
  const control = create("snow", true, { popupLabels: true });
  const tooltip = control.quill.theme.tooltip;
  for (const [name, value] of Object.entries(customLabels)) {
    assert.equal(tooltip.root.getAttribute(name), value);
  }
  assert.equal(
    tooltip.root.querySelector(".ql-action").getAttribute("data-label-edit"),
    "Modifica dell'app"
  );
  assert.equal(
    tooltip.root.querySelector(".ql-action").getAttribute("data-label-save"),
    ""
  );
  assert.equal(
    tooltip.root.querySelector(".ql-remove").getAttribute("data-label"),
    "Rimozione dell'app"
  );
  assert.equal(
    tooltip.textbox.getAttribute("data-video"),
    "URL personalizzato"
  );
  assert.equal(
    tooltip.textbox.getAttribute("data-link"),
    "https://custom.example.com/raw"
  );
  assert.equal(tooltip.textbox.getAttribute("data-formula"), "raw^2");
  assert.equal(tooltip.textbox.value, "Existing input value");
});

test("stock video marker changes only for known themes and exact stock value", (t) => {
  const { create } = setup(t);
  for (const theme of ["snow", "bubble"]) {
    const seed = create(theme);
    const Tooltip = seed.quill.theme.tooltip.constructor;
    const original = Tooltip.TEMPLATE;
    for (const value of ["", null, "Embed URL ", "Custom video URL"]) {
      Tooltip.TEMPLATE = original;
      setTemplate(seed.quill.theme.tooltip, (template) => {
        const input = template.querySelector("input");
        if (value === null) input.removeAttribute("data-video");
        else input.setAttribute("data-video", value);
      });
      const control = create(theme);
      assert.equal(
        control.quill.theme.tooltip.textbox.getAttribute("data-video"),
        value
      );
    }
    Tooltip.TEMPLATE = original;
    assert.equal(
      create(theme).quill.theme.tooltip.textbox.getAttribute("data-video"),
      "URL del video"
    );
    assert.equal(Tooltip.TEMPLATE, original);
  }
});

test("unknown theme subclasses and direct Quill retain original unlabelled popup fallback", (t) => {
  const { create, direct } = setup(t);
  const seed = create();
  class CustomSnow extends seed.quill.theme.constructor {}
  seed.quill.constructor.register("themes/application", CustomSnow);
  const custom = create("application", true);
  prepare(custom);
  open(custom, "link");
  assert.equal(
    custom.quill.theme.tooltip.root.hasAttribute("data-label"),
    false
  );
  assert.equal(snapshot(custom).caption, "Enter link:");
  assert.equal(snapshot(custom).action, "Save");
  assert.equal(
    custom.quill.theme.tooltip.textbox.getAttribute("data-video"),
    "Embed URL"
  );
  const raw = direct(seed.quill.constructor);
  raw.setText("raw direct", "silent");
  raw.setSelection(0, 3, "silent");
  raw.getModule("toolbar").container.querySelector(".ql-link").click();
  assert.equal(raw.theme.tooltip.root.hasAttribute("data-label"), false);
  assert.equal(caption(raw.theme.tooltip.root, "before"), "Enter link:");
  assert.equal(
    caption(raw.theme.tooltip.root.querySelector(".ql-action"), "after"),
    "Save"
  );
  assert.equal(
    raw.theme.tooltip.textbox.getAttribute("data-video"),
    "Embed URL"
  );
});
