import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
const jquery = require("jquery");
const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const read = (path) => readFileSync(resolve(root, path), "utf8");

function host(t) {
  const dom = new JSDOM("<!doctype html><body></body>");
  t.after(() => dom.window.close());
  const $ = jquery(dom.window);
  const composers = [];
  const handlers = {};
  const frappe = {
    _messages: {
      Comment: "Commento",
      "Comment:Comment Action": "Commenta",
      Reply: "Rispondi",
      "Reply:Discussion Reply": "Risposta",
      "Reply All": "Rispondi a tutti",
    },
    session: {
      user: "translator@example.com",
      user_email: "translator@example.com",
    },
    boot: { email_accounts: [] },
    avatar: () => '<span class="avatar"></span>',
    markdown: (value) => value,
    ui: {
      keys: {
        get_key: (event) =>
          event.ctrlKey && event.key === "Enter" ? "ctrl+enter" : "",
      },
      form: {
        Control: class {},
        ControlTextEditor: class {
          bind_events() {}
          get_value() {
            return this.editorValue;
          }
        },
        on: (doctype, events) => (handlers[doctype] = events),
      },
    },
    utils: { debounce: (callback) => callback },
    views: {
      CommunicationComposer: class {
        constructor(args) {
          composers.push(args);
        }
      },
    },
  };
  const sandbox = {
    frappe,
    $,
    jQuery: $,
    Quill: { register() {} },
    Mention: {},
    BaseTimeline: class {},
    strip_html: (value) => $("<div>").html(value).text(),
    cstr: (value) => String(value ?? ""),
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const path of [
    "frappe/public/js/frappe/format.js",
    "frappe/public/js/frappe/translate.js",
  ]) {
    vm.runInContext(read(path), context, { filename: path });
  }
  vm.runInContext(
    read("frappe/public/js/frappe/form/controls/comment.js")
      .replace('import Quill from "quill";', "")
      .replace('import Mention from "./quill-mention/quill.mention";', ""),
    context
  );
  vm.runInContext(
    read("frappe/public/js/frappe/form/controls/base_input.js").replace(
      'import { InfoCard } from "../info_card";',
      ""
    ),
    context
  );
  vm.runInContext(
    read("frappe/core/doctype/communication/communication.js"),
    context
  );
  vm.runInContext(
    read("frappe/public/js/frappe/form/footer/form_timeline.js")
      .replace('import BaseTimeline from "./base_timeline";', "")
      .replace(
        'import {\n\tget_version_timeline_content,\n\tget_user_link,\n\tget_user_message,\n} from "./version_timeline_content_builder";',
        ""
      )
      .replace(
        "export default FormTimeline;",
        "globalThis.FormTimeline = FormTimeline;"
      ),
    context
  );
  return { $, frappe, handlers, composers, sandbox };
}

test("comment action submits unchanged editor content by click and keyboard", (t) => {
  const { $, frappe, sandbox } = host(t);
  const values = [];
  const editor = Object.create(frappe.ui.form.ControlComment.prototype);
  Object.assign(editor, {
    parent: $("body"),
    editorValue: "<p>Un commento <b>Medium</b> &amp; Reply</p>",
    on_submit: (value) => values.push(value),
    quill: { on() {} },
  });
  editor.make_wrapper();
  editor.bind_events();
  assert.equal(editor.button.text().trim(), "Commenta");
  editor.button.trigger("click");
  const key = $.Event("keydown", { ctrlKey: true, key: "Enter" });
  editor.$wrapper.trigger(key);
  assert.equal(key.isDefaultPrevented(), true);
  assert.deepEqual(values, [editor.editorValue, editor.editorValue]);
  assert.equal(sandbox.__("Comment"), "Commento");
  const withoutWrapper = Object.create(frappe.ui.form.ControlComment.prototype);
  Object.assign(withoutWrapper, { no_wrapper: true, parent: $("body") });
  withoutWrapper.make_wrapper();
  assert.equal(withoutWrapper.button.length, 0);
});

test("actual metadata label transport distinguishes reply noun from mail action", (t) => {
  const { $, frappe, sandbox } = host(t);
  const metadata = JSON.parse(
    read("frappe/website/doctype/discussion_reply/discussion_reply.json")
  );
  const field = metadata.fields.find((field) => field.fieldname === "reply");
  const label = $("<label>")[0];
  const input = Object.create(frappe.ui.form.ControlInput.prototype);
  Object.assign(input, {
    df: { ...field, parent: metadata.name },
    label_span: label,
  });
  input.set_label();
  assert.equal(label.textContent, "Risposta");
  assert.equal(input.df.label, "Reply");
  assert.equal(input.df.fieldname, "reply");
  assert.equal(sandbox.__("Reply"), "Rispondi");
});

test("communication reply buttons retain received-email guards and raw callbacks", (t) => {
  const { handlers } = host(t);
  for (const [medium, direction, expected] of [
    ["Email", "Received", true],
    ["Email", "Sent", false],
    ["Phone", "Received", false],
  ]) {
    const buttons = new Map();
    const calls = [];
    const frm = {
      doc: {
        communication_type: "Communication",
        communication_medium: medium,
        sent_or_received: direction,
        status: "Linked",
      },
      is_new: () => false,
      set_df_property() {},
      add_custom_button: (label, callback) => buttons.set(label, callback),
      trigger: (name) => calls.push(name),
    };
    handlers.Communication.refresh(frm);
    assert.equal(buttons.has("Rispondi"), expected);
    assert.equal(buttons.has("Rispondi a tutti"), expected);
    if (expected) {
      buttons.get("Rispondi")();
      buttons.get("Rispondi a tutti")();
      assert.deepEqual(calls, ["reply", "reply_all"]);
    }
  }
});

test("actual reply composer retains recipients and reply-all payload", (t) => {
  const { frappe, sandbox, composers } = host(t);
  frappe.boot.email_accounts = [
    {
      email_account: "Example outgoing",
      enable_outgoing: 1,
      email_id: "translator@example.com",
    },
  ];
  const timeline = Object.create(sandbox.FormTimeline.prototype);
  timeline.frm = {
    doctype: "Task",
    doc: { name: "Example task", email: "fallback@example.com" },
    comment_box: { get_value: () => "<p>Testo utente Reply</p>" },
  };
  const message = {
    sender: "sender@example.com",
    recipients: "translator@example.com, other@example.com",
    cc: "cc@example.com",
    bcc: "bcc@example.com",
    subject: "Subject Medium",
  };
  timeline.compose_mail(message, true);
  const args = composers[0];
  assert.equal(args.title, "Rispondi");
  assert.equal(args.recipients, "sender@example.com");
  assert.equal(args.cc, "other@example.com, cc@example.com");
  assert.equal(args.bcc, "bcc@example.com");
  assert.equal(args.subject, message.subject);
  assert.equal(args.last_email, message);
  assert.equal(args.doc, timeline.frm.doc);
  assert.equal(args.reply_all, true);
  assert.equal(args.is_a_reply, true);
  assert.equal(args.message, "<p>Testo utente Reply</p>");
  timeline.compose_mail();
  assert.equal(composers[1].title, null);
  assert.equal(composers[1].is_a_reply, false);
  assert.equal(composers[1].recipients, "fallback@example.com");
});
