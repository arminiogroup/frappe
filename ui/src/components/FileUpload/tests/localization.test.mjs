import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const require = createRequire(resolve(root, "package.json"));
const { build } = require("esbuild");
const { parse, compileScript } = require("@vue/compiler-sfc");
const { createSSRApp, createRenderer, nextTick } = require("vue");
const { renderToString } = require("vue/server-renderer");
const ui = resolve(root, "ui/src/components/FileUpload");
const messages = {
  "{0} file": "{0} file",
  "{0} files": "{0} file",
  Upload: "Carica",
  "Upload {0} files": "Carica {0} file",
  "Upload from device": "Carica dal dispositivo",
  "Embed a link": "Incorpora un collegamento",
  "Take a photo": "Scatta una foto",
  "No attachments yet.": "Nessun allegato.",
  Attach: "Allega",
  Remove: "Rimuovi",
  Cancel: "Annulla",
  Retry: "Riprova",
  "All private": "Tutti privati",
  "All public": "Tutti pubblici",
  Mixed: "Misti",
  "Make all private": "Rendi tutti privati",
  "Make all public": "Rendi tutti pubblici",
  "Uploaded {0} file": "Caricato {0} file",
  "Uploaded {0} files": "Caricati {0} file",
  "{0} uploaded, {1} failed": "Caricati: {0}; non riusciti: {1}",
  "Uploading {0}/{1}": "Caricamento: {0}/{1}",
  Failed: "Non riuscito",
  "Only {0} file allowed.": "È consentito solo {0} file.",
  "Only {0} files allowed.": "Sono consentiti solo {0} file.",
  '"{0}" is already in the list.': '"{0}" è già nell’elenco.',
  '"{0}" was skipped — file type not allowed.':
    'File "{0}" ignorato: tipo non consentito.',
  '"{0}" was skipped — exceeds {1}.': 'File "{0}" ignorato: supera {1}.',
  "Only http(s) links are allowed.":
    "Sono consentiti solo collegamenti http(s).",
  Cancelled: "Annullato",
  "Upload cancelled": "Caricamento annullato",
  "Upload failed": "Caricamento non riuscito",
  "Network error": "Errore di rete",
  "Upload failed ({0})": "Caricamento non riuscito ({0})",
  "This file is {0}; the limit is {1}.":
    "Il file è di {0}; il limite è di {1}.",
  "File size exceeded the maximum allowed size of {0}.":
    "La dimensione del file supera il limite consentito di {0}.",
  "File size exceeds the maximum allowed limit.":
    "La dimensione del file supera il limite consentito.",
  "Free aspect ratio": "Proporzioni libere",
  Apply: "Applica",
  "Rotate left": "Ruota a sinistra",
  "Rotate right": "Ruota a destra",
  "Switch camera": "Cambia fotocamera",
  Capture: "Scatta",
  Retake: "Scatta di nuovo",
  "Use photo": "Usa la foto",
  "No camera is available on this device.":
    "Nessuna fotocamera disponibile sul dispositivo.",
  "Could not access the camera. Check permissions and try again.":
    "Impossibile accedere alla fotocamera. Controlla le autorizzazioni e riprova.",
};

const host = {
  frappe: { _messages: messages },
  jQuery: {},
};
host.window = host;
host.$ = host.jQuery;
const context = vm.createContext(host);
vm.runInContext(
  readFileSync(resolve(root, "frappe/public/js/frappe/format.js"), "utf8"),
  context
);
vm.runInContext(
  readFileSync(resolve(root, "frappe/public/js/frappe/translate.js"), "utf8"),
  context
);

globalThis.document = { documentElement: { getAttribute: () => "light" } };
globalThis.MutationObserver = class {
  observe() {}
};
globalThis.DOMParser = class {
  parseFromString(html) {
    assert.equal(html, "");
    return {
      querySelector: () => null,
      querySelectorAll: () => [],
      body: { innerHTML: "" },
    };
  }
};

async function load(entry, extra = "") {
  const bundled = await build({
    stdin: {
      contents: `export { default as component } from ${JSON.stringify(
        resolve(ui, entry)
      )};${extra}`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    external: ["vue", "vue/server-renderer"],
    define: { "import.meta.env.DEV": "false" },
    nodePaths: [
      resolve(root, "node_modules"),
      resolve(root, "island-toolchain/node_modules"),
    ],
    plugins: [
      {
        name: "vue-localization-test",
        setup(builder) {
          builder.onResolve(
            { filter: /^frappe-ui(?:\/editor)?$/ },
            ({ path }) => ({ path, namespace: "stub" })
          );
          builder.onLoad({ filter: /.*/, namespace: "stub" }, ({ path }) => {
            return {
              contents: `import {h} from 'vue';
              export {getConfig,setConfig} from ${JSON.stringify(
                resolve(
                  root,
                  "island-toolchain/node_modules/frappe-ui/src/utils/config.ts"
                )
              )};
              import {useFileUpload as realUpload} from ${JSON.stringify(
                resolve(
                  root,
                  "island-toolchain/node_modules/frappe-ui/src/utils/useFileUpload.ts"
                )
              )};
              export function useFileUpload(){const upload=realUpload();globalThis.uploadState=upload.state;return upload;}
              const simple=(tag)=>({props:['label','theme','text','open','options'],setup(props,{slots}){return ()=>h(tag,{'data-options':props.options,title:props.text},[props.label,slots.default?.(),slots.header?.()])}});
              export const Button=simple('button'), Dropdown=simple('div'), ErrorMessage=simple('span'), TextInput=simple('input'), Dialog=simple('div');`,
              resolveDir: root,
            };
          });
          builder.onLoad({ filter: /\.vue$/ }, ({ path }) => {
            const { descriptor, errors } = parse(readFileSync(path, "utf8"), {
              filename: path,
            });
            assert.deepEqual(errors, []);
            const script = compileScript(descriptor, {
              id: path,
              inlineTemplate: true,
              fs: {
                fileExists: existsSync,
                readFile: (file) => readFileSync(file, "utf8"),
              },
            });
            return {
              contents: script.content,
              loader: "ts",
              resolveDir: dirname(path),
            };
          });
        },
      },
    ],
  });
  const output = { exports: {} };
  new Function("require", "module", "exports", bundled.outputFiles[0].text)(
    require,
    output,
    output.exports
  );
  return output.exports;
}

const render = (component, props) =>
  renderToString(createSSRApp(component, props));

const makeFile = (name, bytes = 4, type = "text/plain") =>
  new File([new Uint8Array(bytes)], name, { type });
const transport = async (file) => ({ file_url: `/private/files/${file.name}` });

function mount(component, props = {}) {
  const node = (tag, text = "") => ({
    tag,
    text,
    props: {},
    children: [],
    style: { display: "" },
  });
  const renderer = createRenderer({
    createElement: node,
    createText: (text) => node("#text", text),
    createComment: (text) => node("#comment", text),
    insert(child, parent, anchor) {
      if (child.parent) {
        const index = child.parent.children.indexOf(child);
        if (index >= 0) child.parent.children.splice(index, 1);
      }
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(child);
      else parent.children.splice(index, 0, child);
      child.parent = parent;
    },
    remove(child) {
      const index = child.parent?.children.indexOf(child);
      if (index >= 0) child.parent.children.splice(index, 1);
    },
    setElementText(el, text) {
      el.text = text;
      el.children = [];
    },
    setText(el, text) {
      el.text = text;
    },
    patchProp(el, key, oldValue, value) {
      el.props[key] = value;
    },
    parentNode: (el) => el.parent,
    nextSibling(el) {
      return el.parent?.children[el.parent.children.indexOf(el) + 1];
    },
  });
  const container = node("root"),
    app = renderer.createApp(component, props);
  app.mount(container);
  const nodes = () => {
    const out = [];
    function visit(n) {
      out.push(n);
      n.children.forEach(visit);
    }
    visit(container);
    return out;
  };
  const text = () =>
    nodes()
      .filter((n) => n.tag !== "#comment")
      .map((n) => n.text)
      .join("");
  return { app, nodes, text };
}

test("upload queue validation translates whole messages while preserving files, URLs and booleans", async () => {
  const loaded = await load(
    "AttachmentsList.vue",
    `export {useUploader} from ${JSON.stringify(
      resolve(ui, "useUploader.ts")
    )};`
  );
  globalThis.__ = host.__;
  const single = loaded.useUploader({ transport });
  single.add([makeFile("a.txt"), makeFile("b.txt")]);
  assert.equal(single.errors.value[0], "È consentito solo 1 file.");
  const multiple = loaded.useUploader({ transport, multiple: true });
  multiple.add([makeFile("nome <1>.txt")]);
  multiple.add([makeFile("nome <1>.txt")]);
  assert.equal(multiple.errors.value[0], '"nome <1>.txt" è già nell’elenco.');
  assert.equal(multiple.items[0].name, "nome <1>.txt");
  multiple.addLink("javascript:alert(1)");
  assert.equal(
    multiple.errors.value[0],
    "Sono consentiti solo collegamenti http(s)."
  );
  multiple.addLink("https://example.com/file.pdf");
  multiple.setAllPrivate(false);
  const result = await multiple.commit();
  assert.equal(result[1].file_url, "https://example.com/file.pdf");
  assert.equal(result[1].is_private, false);
  const limited = loaded.useUploader({
    transport,
    restrictions: { max_file_size: 2 },
  });
  limited.add([makeFile("grande.txt", 3)]);
  assert.equal(
    limited.errors.value[0],
    'File "grande.txt" ignorato: supera 2 B.'
  );
  delete globalThis.__;
  const english = loaded.useUploader({ transport });
  english.add([makeFile("a"), makeFile("b")]);
  assert.equal(english.errors.value[0], "Only 1 file allowed.");
});

test("actual upload dialog renders count grammar, source actions and privacy with unchanged queued files", async () => {
  globalThis.__ = host.__;
  const { component } = await load("FileUploadDialog.vue");
  const mounted = mount(component, { open: true, multiple: true, transport });
  assert.match(mounted.text(), /Carica dal dispositivo/);
  const input = mounted
    .nodes()
    .find((n) => n.tag === "input" && n.props.type === "file");
  input.files = [makeFile("documento.txt")];
  input.props.onChange();
  await nextTick();
  assert.match(mounted.text(), /1 file/);
  assert.match(mounted.text(), /Tutti privati/);
  input.files = [makeFile("secondo.txt")];
  input.props.onChange();
  await nextTick();
  assert.match(mounted.text(), /2 file/);
  assert.doesNotMatch(mounted.text(), /2 files/);
  assert.match(mounted.text(), /Carica 2 file/);
  const dropdown = mounted
    .nodes()
    .find((n) => Array.isArray(n.props["data-options"]));
  const options = dropdown.props["data-options"];
  assert.equal(options[1].label, "Rendi tutti pubblici");
  options[1].onClick();
  await nextTick();
  assert.match(mounted.text(), /Tutti pubblici/);
  assert.match(mounted.text(), /documento.txt/);
  assert.match(mounted.text(), /secondo.txt/);
  mounted.app.unmount();
  delete globalThis.__;
});

test("actual tray renders singular, plural and partial failures without changing caller labels or status keys", async () => {
  globalThis.__ = host.__;
  const loaded = await load(
    "UploadTray.vue",
    `export {pushTrayBatch,clearAllBatches} from ${JSON.stringify(
      resolve(ui, "uploadTray.ts")
    )};`
  );
  for (const count of [1, 2]) {
    loaded.clearAllBatches();
    const items = Array.from({ length: count }, (_, i) => ({
      id: String(i),
      name: `file-${i}.txt`,
      status: "done",
      progress: 1,
      isPrivate: true,
    }));
    loaded.pushTrayBatch("Customer tray label", items);
    const html = await render(loaded.component);
    assert.match(
      html,
      new RegExp(`${count === 1 ? "Caricato" : "Caricati"} ${count} file`)
    );
    assert.match(html, /Customer tray label/);
    assert.equal(items[0].status, "done");
  }
  loaded.clearAllBatches();
  loaded.pushTrayBatch("Customer label", [
    { id: "1", name: "a.txt", status: "done", progress: 1 },
    { id: "2", name: "b.txt", status: "error", progress: 0 },
  ]);
  assert.match(await render(loaded.component), /Caricati: 1; non riusciti: 1/);
  loaded.clearAllBatches();
  delete globalThis.__;
});

test("camera and crop actions translate through actual rendered controls and error lifecycle", async () => {
  globalThis.__ = host.__;
  const camera = (await load("sources/CameraSource.vue")).component;
  const mounted = mount(camera);
  await nextTick();
  assert.match(mounted.text(), /Nessuna fotocamera disponibile/);
  mounted.app.unmount();
  const crop = (await load("ImageCropper.vue")).component;
  const html = await render(crop, {
    file: makeFile("photo.png", 1, "image/png"),
  });
  assert.match(html, /Proporzioni libere/);
  assert.match(html, /Applica/);
  assert.match(html, /aria-label="Ruota a sinistra"/);
  delete globalThis.__;
});

class XMLHttpRequestFixture {
  static DONE = 4;
  static sent = [];
  static outcome = "success";
  constructor() {
    this.handlers = {};
    this.upload = {
      addEventListener: (key, fn) => {
        this.upload[key] = fn;
      },
    };
  }
  addEventListener(key, fn) {
    this.handlers[key] = fn;
  }
  open(...args) {
    this.openArgs = args;
  }
  setRequestHeader() {}
  send(form) {
    XMLHttpRequestFixture.sent.push({ form, open: this.openArgs });
    this.upload.loadstart?.();
    if (XMLHttpRequestFixture.outcome === "network") {
      this.handlers.error();
      return;
    }
    this.readyState = 4;
    this.status = XMLHttpRequestFixture.outcome === "server" ? 400 : 200;
    this.responseText = JSON.stringify(
      this.status === 400
        ? {
            _server_messages: JSON.stringify([
              JSON.stringify({ message: "Dettaglio server invariato" }),
            ]),
          }
        : { message: { file_url: "/private/files/upload.txt" } }
    );
    this.onreadystatechange();
  }
  abort() {
    this.handlers.abort?.();
  }
}

test("actual small-file size rejection keeps Error identity and reads the current exact configured limit on each attempt", async () => {
  globalThis.__ = host.__;
  globalThis.window = globalThis;
  globalThis.XMLHttpRequest = XMLHttpRequestFixture;
  const loaded = await load(
    "AttachmentsList.vue",
    `export {createFrappeTransport} from ${JSON.stringify(
      resolve(ui, "useFileUpload.ts")
    )};export {setConfig} from 'frappe-ui';`
  );
  const upload = loaded.createFrappeTransport();
  const file = makeFile("large.txt", 100);
  XMLHttpRequestFixture.sent = [];
  for (const limit of [50, 75]) {
    loaded.setConfig("maxFileSize", limit);
    const error = await upload(
      file,
      { isPrivate: true },
      { signal: new AbortController().signal, onProgress() {} }
    ).then(
      () => assert.fail("must reject"),
      (e) => e
    );
    assert.equal(error, globalThis.uploadState.error);
    assert.equal(error.name, "UploadError");
    assert.equal(error.kind, "file-size");
    assert.deepEqual(error.messages, []);
    assert.equal(
      error.message,
      `Il file è di 100 B; il limite è di ${limit} B.`
    );
  }
  assert.equal(XMLHttpRequestFixture.sent.length, 0);
  loaded.setConfig("maxFileSize", 1000);
  await upload(
    makeFile("ok.txt", 1),
    { isPrivate: true },
    { signal: new AbortController().signal, onProgress() {} }
  );
  const sent = XMLHttpRequestFixture.sent[0];
  assert.deepEqual(sent.open, ["POST", "/api/method/upload_file", true]);
  assert.equal(sent.form.get("is_private"), "1");
  assert.equal(sent.form.get("folder"), "Home/Attachments");
  delete globalThis.__;
});

test("typed network and abort errors localize display while server and custom messages remain intact", async () => {
  globalThis.__ = host.__;
  globalThis.XMLHttpRequest = XMLHttpRequestFixture;
  globalThis.window = globalThis;
  const loaded = await load(
    "AttachmentsList.vue",
    `export {useUploader} from ${JSON.stringify(
      resolve(ui, "useUploader.ts")
    )};export {setConfig} from 'frappe-ui';`
  );
  loaded.setConfig("maxFileSize", 1000);
  for (const [kind, expected] of [
    ["network", "Caricamento non riuscito"],
    ["server", "Dettaglio server invariato"],
  ]) {
    XMLHttpRequestFixture.outcome = kind;
    const uploader = loaded.useUploader();
    uploader.add([makeFile(`${kind}.txt`)]);
    await uploader.commit();
    assert.equal(uploader.items[0].status, "error");
    assert.equal(uploader.items[0].error, expected);
  }
  const custom = loaded.useUploader({
    transport: async () => {
      const error = new Error("Custom user message");
      error.kind = "network";
      throw error;
    },
  });
  custom.add([makeFile("user.txt")]);
  await custom.commit();
  assert.equal(custom.items[0].error, "Custom user message");
  const aborted = loaded.useUploader({
    transport: async () => {
      throw new DOMException("opaque", "AbortError");
    },
  });
  aborted.add([makeFile("abort.txt")]);
  await aborted.commit();
  assert.equal(aborted.items[0].error, "Annullato");
  XMLHttpRequestFixture.outcome = "success";
  delete globalThis.__;
});

test("chunk transport keeps request fields and AbortError identity while translating built-in failures", async () => {
  globalThis.__ = host.__;
  globalThis.XMLHttpRequest = XMLHttpRequestFixture;
  globalThis.window = globalThis;
  globalThis.frappe = { boot: { file_chunk_size: 2 } };
  const loaded = await load(
    "AttachmentsList.vue",
    `export {createFrappeTransport} from ${JSON.stringify(
      resolve(ui, "useFileUpload.ts")
    )};`
  );
  const upload = loaded.createFrappeTransport();
  XMLHttpRequestFixture.outcome = "success";
  XMLHttpRequestFixture.sent = [];
  const file = makeFile("chunked.txt", 5);
  const result = await upload(
    file,
    {
      isPrivate: false,
      folder: "Home/Attachments",
      optimize: true,
      maxWidth: 800,
    },
    { signal: new AbortController().signal, onProgress() {} }
  );
  assert.equal(result.file_url, "/private/files/upload.txt");
  assert.equal(XMLHttpRequestFixture.sent.length, 3);
  for (const [index, sent] of XMLHttpRequestFixture.sent.entries()) {
    assert.equal(sent.form.get("is_private"), "0");
    assert.equal(sent.form.get("folder"), "Home/Attachments");
    assert.equal(sent.form.get("chunk_index"), String(index));
    assert.equal(sent.form.get("total_chunk_count"), "3");
    assert.equal(sent.form.get("chunk_byte_offset"), String(index * 2));
    assert.equal(sent.form.get("total_file_size"), "5");
    assert.equal(sent.form.get("optimize"), "1");
    assert.equal(sent.form.get("max_width"), "800");
    assert.equal(sent.form.get("file").name, "chunked.txt");
  }
  const controller = new AbortController();
  controller.abort();
  const error = await upload(
    file,
    {},
    { signal: controller.signal, onProgress() {} }
  ).then(
    () => assert.fail("must abort"),
    (error) => error
  );
  assert.ok(error instanceof DOMException);
  assert.equal(error.name, "AbortError");
  assert.equal(error.message, "Caricamento annullato");
  XMLHttpRequestFixture.outcome = "network";
  await assert.rejects(
    upload(file, {}, { signal: new AbortController().signal, onProgress() {} }),
    /Caricamento non riuscito/
  );
  XMLHttpRequestFixture.outcome = "success";
  delete globalThis.frappe;
  delete globalThis.__;
});

function serverResponse(body, status = 400, beforeResponse) {
  globalThis.XMLHttpRequest = class extends XMLHttpRequestFixture {
    send(form) {
      XMLHttpRequestFixture.sent.push({ form, open: this.openArgs });
      this.readyState = 4;
      this.status = status;
      this.responseText =
        typeof body === "string" ? body : JSON.stringify(body);
      beforeResponse?.();
      this.onreadystatechange();
    }
  };
}

async function rejectedServerUpload(loaded) {
  const error = await loaded
    .createFrappeTransport()(
      makeFile("demo.txt"),
      {
        isPrivate: false,
        folder: "Home/Attachments",
        optimize: true,
        maxWidth: 640,
        maxHeight: 480,
      },
      { signal: new AbortController().signal, onProgress() {} }
    )
    .then(
      () => assert.fail("Expected server rejection"),
      (e) => e
    );
  assert.equal(error, globalThis.uploadState.error);
  assert.equal(error.name, "UploadError");
  assert.equal(error.kind, "server");
  const sent = XMLHttpRequestFixture.sent.at(-1);
  assert.deepEqual(sent.open, ["POST", "/api/method/upload_file", true]);
  assert.equal(sent.form.get("is_private"), "0");
  assert.equal(sent.form.get("folder"), "Home/Attachments");
  assert.equal(sent.form.get("optimize"), "1");
  assert.equal(sent.form.get("max_width"), "640");
  assert.equal(sent.form.get("max_height"), "480");
  assert.equal(sent.form.get("file").name, "demo.txt");
  return error;
}

test("default upload localizes only structured server fallbacks while preserving genuine detail, identity and HTTP fields", async () => {
  globalThis.__ = host.__;
  globalThis.window = globalThis;
  const loaded = await load(
    "AttachmentsList.vue",
    `export {createFrappeTransport} from ${JSON.stringify(
      resolve(ui, "useFileUpload.ts")
    )};export {setConfig} from 'frappe-ui';`
  );
  loaded.setConfig("maxFileSize", 1000);
  for (const [body, expected, serverMessages] of [
    [{}, "Caricamento non riuscito", []],
    ["<html>Error</html>", "Caricamento non riuscito", []],
    [{ _server_messages: "invalid JSON" }, "Caricamento non riuscito", []],
    [
      {
        _server_messages: JSON.stringify([
          JSON.stringify({ message: "Dettaglio uno" }),
          JSON.stringify({ message: "Dettaglio due" }),
        ]),
      },
      "Dettaglio uno\nDettaglio due",
      ["Dettaglio uno", "Dettaglio due"],
    ],
    [
      { _server_messages: JSON.stringify(["Upload failed"]) },
      "Upload failed",
      ["Upload failed"],
    ],
    [{ _error_message: "Upload failed" }, "Upload failed", []],
    [{ message: "Upload failed" }, "Upload failed", []],
    [{ message: "Custom server sentence" }, "Custom server sentence", []],
    [
      { exc_type: "MaxFileSizeReachedError", message: "Original size detail" },
      "Original size detail",
      [],
    ],
    [
      {
        exc_type: "MaxFileSizeReachedError",
        _error_message: "Original size error",
      },
      "Original size error",
      [],
    ],
    [{ _error_message: "", message: "" }, "Caricamento non riuscito", []],
  ]) {
    serverResponse(body, 503);
    const error = await rejectedServerUpload(loaded);
    assert.equal(error.message, expected);
    assert.equal(error.status, 503);
    assert.deepEqual(error.messages, serverMessages);
    assert.deepEqual(
      error.response,
      typeof body === "string" ? "Upload failed" : body
    );
  }
  delete globalThis.__;
  serverResponse({}, 400);
  assert.equal((await rejectedServerUpload(loaded)).message, "Upload failed");
  globalThis.XMLHttpRequest = XMLHttpRequestFixture;
});

test("server size fallback preserves response-time numeric config semantics including unset and nonfinite limits", async () => {
  globalThis.__ = host.__;
  globalThis.window = globalThis;
  const loaded = await load(
    "AttachmentsList.vue",
    `export {createFrappeTransport} from ${JSON.stringify(
      resolve(ui, "useFileUpload.ts")
    )};export {setConfig} from 'frappe-ui';`
  );
  for (const [limit, display] of [
    [50, "50 B"],
    ["75", "75 B"],
    [0.5, "0.5 B"],
    [1024 * 1024, "1.0 MB"],
    [0, null],
    [-1, null],
    [NaN, null],
    [Infinity, null],
    [undefined, null],
    [null, null],
    ["", null],
  ]) {
    loaded.setConfig("maxFileSize", 1000);
    serverResponse({ exc_type: "MaxFileSizeReachedError" }, 413, () =>
      loaded.setConfig("maxFileSize", limit)
    );
    const error = await rejectedServerUpload(loaded);
    assert.equal(
      error.message,
      display
        ? `La dimensione del file supera il limite consentito di ${display}.`
        : "La dimensione del file supera il limite consentito."
    );
    assert.equal(error.status, 413);
    assert.deepEqual(error.messages, []);
    assert.deepEqual(error.response, { exc_type: "MaxFileSizeReachedError" });
  }
  loaded.setConfig("maxFileSize", 1000);
  delete globalThis.__;
  serverResponse({ exc_type: "MaxFileSizeReachedError" }, 413, () =>
    loaded.setConfig("maxFileSize", 50)
  );
  assert.equal(
    (await rejectedServerUpload(loaded)).message,
    "File size exceeded the maximum allowed size of 50 B."
  );
  globalThis.XMLHttpRequest = XMLHttpRequestFixture;
});

test("server-shaped custom transport errors remain supplied presentation outside the default producer", async () => {
  globalThis.__ = host.__;
  const loaded = await load(
    "AttachmentsList.vue",
    `export {useUploader} from ${JSON.stringify(
      resolve(ui, "useUploader.ts")
    )};`
  );
  const error = new Error("Upload failed");
  Object.assign(error, {
    kind: "server",
    messages: [],
    status: 503,
    response: {},
  });
  const uploader = loaded.useUploader({
    transport: async () => {
      throw error;
    },
  });
  uploader.add([makeFile("custom.txt")]);
  await uploader.commit();
  assert.equal(uploader.items[0].error, "Upload failed");
  assert.equal(error.message, "Upload failed");
  assert.equal(error.kind, "server");
  assert.deepEqual(error.response, {});
  delete globalThis.__;
});
