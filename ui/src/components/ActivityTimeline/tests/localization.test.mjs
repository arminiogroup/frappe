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
const { createSSRApp } = require("vue");
const { renderToString } = require("vue/server-renderer");
const ui = resolve(root, "ui/src/components/ActivityTimeline");
const messages = {
  "No activity yet": "Nessuna attività",
  "Load more": "Carica altro",
  Discard: "Scarta",
  Save: "Salva",
  Guest: "Ospite",
  To: "A",
  Cc: "Cc",
  Bcc: "Ccn",
  Sent: "Inviata",
  Read: "Lettura",
  "Read:Communication": "Letto",
  "Email content": "Contenuto dell'e-mail",
  "{0} attached {1}": "{1}: allegato da {0}",
  "{0} removed attachment {1}": "{1}: rimosso da {0}",
  "{0} liked": "A {0} piace questo elemento",
  "{0} assigned {1}: {2}": "{1}: attività assegnata da {0}: {2}",
  "Assignment of {0} removed by {1}": "{1} ha rimosso l'assegnazione di {0}",
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
    nodePaths: [
      resolve(root, "node_modules"),
      resolve(root, "island-toolchain/node_modules"),
    ],
    plugins: [
      {
        name: "vue-localization-test",
        setup(builder) {
          builder.onResolve({ filter: /^~icons\// }, ({ path }) => ({
            path,
            namespace: "stub",
          }));
          builder.onResolve(
            { filter: /^frappe-ui(?:\/editor)?$/ },
            ({ path }) => ({ path, namespace: "stub" })
          );
          builder.onLoad({ filter: /.*/, namespace: "stub" }, ({ path }) => {
            if (path.startsWith("~icons/"))
              return {
                contents: `import {h} from 'vue'; export default {render(){return h('svg',{'data-icon':${JSON.stringify(
                  path
                )}})}}`,
              };
            return {
              contents: `import {h} from 'vue'; export {dayjsLocal} from ${JSON.stringify(
                resolve(
                  root,
                  "island-toolchain/node_modules/frappe-ui/src/utils/dayjs.ts"
                )
              )};
              const simple=(tag)=>({props:['label','theme','text'],setup(props,{slots}){return ()=>h(tag,{'data-theme':props.theme,title:props.text},[props.label,slots.default?.(),slots.header?.()])}});
              export const Button=simple('button'), Badge=simple('span'), Tooltip=simple('span'), Dialog=simple('div'), LoadingIndicator=simple('span'), Editor=simple('div'), EditorContent=simple('div'), CommentKit={};`,
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

test("attachment translations reorder actor and filename without losing link or privacy", async () => {
  globalThis.__ = host.__;
  const { component } = await load("LogItem.vue");
  for (const action of ["added", "removed"]) {
    const html = await render(component, {
      activity: {
        timestamp: "",
        type: "attachment_log",
        key: "attachment:demo",
        author: { fullname: "Mario <Rossi>" },
        data: {
          action,
          fileName: "report <1>.pdf",
          fileUrl: "/private/files/report.pdf",
          isPrivate: true,
        },
      },
    });
    assert.match(html, /href="\/private\/files\/report.pdf"/);
    assert.match(html, /report &lt;1&gt;.pdf/);
    assert.match(html, /Mario &lt;Rossi&gt;/);
    assert.match(html, /data-icon="~icons\/lucide\/lock"/);
    assert.ok(
      html.indexOf("report &lt;1&gt;.pdf") < html.indexOf("Mario &lt;Rossi&gt;")
    );
    assert.match(html, action === "added" ? /allegato da/ : /rimosso da/);
  }
  delete globalThis.__;
  assert.match(
    await render(component, {
      activity: {
        timestamp: "",
        type: "attachment_log",
        author: { fullname: "Mario" },
        data: { action: "added", fileName: "file.pdf", isPrivate: false },
      },
    }),
    /attached/
  );
});

test("default controls translate while custom labels and recipient data stay intact", async () => {
  globalThis.__ = host.__;
  const loadMore = (await load("LoadMoreButton.vue")).component;
  assert.match(await render(loadMore), /Carica altro/);
  assert.match(
    await render(loadMore, { label: "Customer label" }),
    /Customer label/
  );
  const email = (await load("EmailItem.vue")).component;
  const html = await render(email, {
    email: {
      timestamp: "",
      type: "email",
      data: {
        sender: "mario@example.com",
        to: "recipient@example.com",
        bcc: "private@example.com",
        content: "",
        deliveryStatus: "Sent",
      },
    },
  });
  assert.match(html, /Ospite/);
  assert.match(html, /Inviata/);
  assert.match(html, /data-theme="green"/);
  assert.match(html, /Ccn/);
  assert.match(html, /recipient@example.com/);
  assert.match(html, /private@example.com/);
  assert.match(html, /title="Contenuto dell&#39;e-mail"/);
  delete globalThis.__;
});

test("assignment matching accepts translated reordered templates and legacy stored comments", async () => {
  const loaded = await load(
    "LoadMoreButton.vue",
    `export {getAssignee, dateFormat, timeAgo} from ${JSON.stringify(
      resolve(ui, "utils.ts")
    )};`
  );
  globalThis.__ = host.__;
  assert.equal(
    loaded.getAssignee("Anna: attività assegnata da Mario: Demo", "Assigned"),
    "Anna"
  );
  assert.equal(
    loaded.getAssignee(
      "Mario ha rimosso l'assegnazione di Anna",
      "Assignment Completed"
    ),
    "Anna"
  );
  assert.equal(
    loaded.getAssignee("Mario assigned Anna: Demo", "Assigned"),
    "Anna"
  );
  assert.equal(loaded.getAssignee("User text", "Assigned"), null);
  delete globalThis.__;
  assert.equal(
    loaded.getAssignee("Mario assigned Anna: Demo", "Assigned"),
    "Anna"
  );
  assert.equal(loaded.dateFormat("2026-01-02", "YYYY-MM-DD"), "2026-01-02");
  assert.equal(loaded.dateFormat(), "");
  assert.equal(loaded.timeAgo(), "");
});

test("default dates use actual host timezone and Italian relative-time helpers", async () => {
  const loaded = await load(
    "LoadMoreButton.vue",
    `export {dateFormat, timeAgo} from ${JSON.stringify(
      resolve(ui, "utils.ts")
    )};`
  );
  const fixed = Date.parse("2026-10-21T12:00:00Z");
  const moment = require("moment-timezone");
  const priorNow = moment.now;
  moment.now = () => fixed;
  host.moment = moment;
  host.Date = class extends Date {
    constructor(...args) {
      super(...(args.length ? args : [fixed]));
    }
  };
  host.setInterval = () => {};
  host.frappe.datetime = {};
  host.frappe.provide = () => {};
  host.frappe.boot = { time_zone: { system: "UTC", user: "Europe/Rome" } };
  host.frappe.sys_defaults = {
    date_format: "dd/mm/yyyy",
    time_format: "HH:mm",
  };
  host.$.extend = Object.assign;
  Object.assign(messages, {
    yesterday: "ieri",
    "{0} days ago": "{0} giorni fa",
  });
  for (const name of ["datetime", "pretty_date"]) {
    vm.runInContext(
      readFileSync(
        resolve(root, `frappe/public/js/frappe/utils/${name}.js`),
        "utf8"
      ),
      context
    );
  }
  globalThis.__ = host.__;
  globalThis.frappe = host.frappe;
  try {
    assert.equal(loaded.dateFormat("2026-10-20 12:00:00"), "20/10/2026 14:00");
    assert.equal(loaded.timeAgo("2026-10-20 12:00:00"), "ieri");
    assert.equal(loaded.timeAgo("2026-10-19 12:00:00"), "2 giorni fa");
    assert.equal(loaded.dateFormat("2026-01-02", "YYYY-MM-DD"), "2026-01-02");
  } finally {
    moment.now = priorNow;
    delete globalThis.frappe;
    delete globalThis.__;
  }
});

test("live likes translate through the actual subscription normalizer without changing row keys", async () => {
  const loaded = await load(
    "LoadMoreButton.vue",
    `export {createLiveUpdates} from ${JSON.stringify(
      resolve(ui, "liveUpdates.ts")
    )};`
  );
  const handlers = {};
  const socket = {
    emit() {},
    on(event, callback) {
      handlers[event] = callback;
    },
    off() {},
  };
  const resource = { data: [], fetched: false };
  let stop;
  const app = createSSRApp({
    setup() {
      stop = loaded.createLiveUpdates(
        "ToDo",
        "DEMO-1",
        resource,
        undefined,
        async () => {}
      )();
      return () => null;
    },
  });
  app.provide("socket", socket);
  await renderToString(app);
  globalThis.__ = host.__;
  handlers.docinfo_update({
    key: "like_logs",
    action: "add",
    doc: {
      name: "LIKE-1",
      owner: "mario@example.com",
      comment_by: "Mario",
      reference_doctype: "ToDo",
      reference_name: "DEMO-1",
      creation: "2026-10-20 12:00:00",
    },
  });
  assert.equal(resource.data[0].data.text, "A Mario piace questo elemento");
  assert.equal(resource.data[0].key, "log:LIKE-1");
  assert.equal(resource.data[0].data.subtype, "like");
  assert.equal(resource.data[0].author.email, "mario@example.com");
  stop();
  delete globalThis.__;
});

test("email read status uses communication context instead of access permission", async () => {
  globalThis.__ = host.__;
  const loaded = await load(
    "EmailItem.vue",
    `export {translate} from ${JSON.stringify(
      resolve(root, "ui/src/utils/translate.ts")
    )};`
  );
  const data = {
    sender: "mario@example.com",
    content: "",
    deliveryStatus: "Read",
  };
  const html = await render(loaded.component, {
    email: { timestamp: "", type: "email", data },
  });
  assert.match(html, /Letto/);
  assert.doesNotMatch(html, /Lettura/);
  assert.match(html, /data-theme="blue"/);
  assert.equal(data.deliveryStatus, "Read");
  assert.equal(loaded.translate("Read", [], "Communication"), "Letto");
  assert.equal(loaded.translate("Read"), "Lettura");
  delete globalThis.__;
  assert.equal(loaded.translate("Read", [], "Communication"), "Read");
});
