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
const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const read = (path) => readFileSync(resolve(root, path), "utf8");

function host(t, mobile = false) {
  const dom = new JSDOM("<!doctype html><body></body>");
  t.after(() => dom.window.close());
  const $ = jquery(dom.window);
  const composers = [];
  const editors = [];
  const frappe = {
    _messages: {
      Like: "Mi piace",
      Reply: "Rispondi",
      "Reply All": "Rispondi a tutti",
      Edit: "Modifica",
      Save: "Salva",
      Rispondi: "SECOND PASS",
      Modifica: "SECOND PASS",
      "Reply:Discussion Reply": "Risposta",
    },
    provide() {},
    utils: {},
    session: {
      user: "translator@example.com",
      user_email: "translator@example.com",
    },
    boot: { user: {}, email_accounts: [] },
    defaults: { is_enabled: () => false },
    ui: {
      form: {
        make_control(options) {
          const editor = {
            options,
            set_value(value) {
              this.value = value;
            },
            quill: { enable() {} },
          };
          editors.push(editor);
          return editor;
        },
      },
    },
    is_mobile: () => mobile,
    user: { has_role: () => false },
    model: { can_delete: () => false },
    user_info: () => ({ fullname: "Example Person" }),
    markdown: (value) => value,
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
    cint: (value) => Number.parseInt(value, 10) || 0,
    cstr: (value) => String(value ?? ""),
    strip_html: (value) => $("<div>").html(value).text(),
    comment_when: (creation) => creation,
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const path of [
    "frappe/public/js/frappe/format.js",
    "frappe/public/js/frappe/translate.js",
  ])
    vm.runInContext(read(path), context);
  vm.runInContext(
    read("frappe/public/js/frappe/utils/utils.js")
      .replace('import deep_equal from "fast-deep-equal";', "")
      .replace('import number_systems from "./number_systems";', "")
      .replace(
        'import { CHART_PALETTE } from "../ui/components/utils.js";',
        ""
      ),
    context
  );
  Object.assign(frappe.utils, {
    icon: (name) => `<svg data-icon="${name}"></svg>`,
    get_form_link: (doctype, name, _html, label) =>
      `<a data-doctype="${doctype}" data-name="${name}">${label}</a>`,
    xss_sanitise: (value) => value,
  });
  vm.runInContext(
    read("frappe/public/js/frappe/form/footer/base_timeline.js").replace(
      "export default BaseTimeline;",
      ""
    ),
    context
  );
  vm.runInContext(
    read(
      "frappe/public/js/frappe/form/footer/version_timeline_content_builder.js"
    ).replace(
      "export { get_version_timeline_content, get_user_link, get_user_message };",
      ""
    ),
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
  const timeline = Object.create(sandbox.FormTimeline.prototype);
  timeline.frm = {
    doctype: "Task",
    doc: { name: "Example task", email: "recipient@example.com" },
    comment_box: { get_value: () => "<p>Testo utente</p>" },
  };
  timeline.doc_info = { like_logs: [] };
  const box = () =>
    $(
      '<div><div class="custom-actions"></div><div class="more-actions"><ul class="dropdown-menu"><li></li></ul></div><div class="content">Contenuto utente</div></div>'
    );
  return { $, frappe, sandbox, timeline, composers, editors, box };
}

test("reaction producer supplies the translated title to the actual badge renderer", (t) => {
  const { timeline, frappe } = host(t);
  const log = {
    owner: "translator@example.com",
    creation: "2026-10-20 10:30:00",
  };
  timeline.doc_info.like_logs = [log];
  const items = timeline.get_like_timeline_contents();
  assert.equal(items[0].title, "Mi piace");
  const item = timeline.get_timeline_item(items[0]);
  assert.equal(item.find(".timeline-badge").attr("title"), "Mi piace");
  assert.equal(item.find("svg").attr("data-icon"), "heart");
  assert.equal(item.attr("data-timestamp"), log.creation);
  assert.equal(timeline.doc_info.like_logs[0], log);
  const custom = frappe.ui.BaseTimeline.prototype.get_timeline_item.call(
    timeline,
    {
      icon: "heart",
      title: "Like",
      content: "Etichetta utente",
      creation: log.creation,
    }
  );
  assert.equal(custom.find(".timeline-badge").attr("title"), "Like");
});

test("desktop reply titles retain actual composer callbacks and canonical data", (t) => {
  const { timeline, box, composers } = host(t);
  const wrapper = box();
  const doc = {
    sender: "sender@example.com",
    recipients: "recipient@example.com",
    subject: "Subject Medium",
    cc: "copy@example.com",
    bcc: "hidden@example.com",
  };
  timeline.setup_reply(wrapper, doc);
  const reply = wrapper.find(".custom-actions .reply");
  const replyAll = wrapper.find(".custom-actions .reply-all");
  assert.equal(reply.attr("title"), "Rispondi");
  assert.equal(replyAll.attr("title"), "Rispondi a tutti");
  assert.equal(reply.find("svg").attr("data-icon"), "reply");
  assert.equal(reply.text(), "");
  reply.trigger("click");
  replyAll.trigger("click");
  assert.equal(composers[0].title, "Rispondi");
  assert.equal(composers[0].recipients, doc.sender);
  assert.equal(composers[0].last_email, doc);
  assert.equal(composers[0].reply_all, false);
  assert.equal(composers[1].reply_all, true);
  assert.equal(composers[1].cc, doc.cc);
  assert.equal(composers[1].bcc, doc.bcc);
  assert.equal(composers[1].subject, doc.subject);
});

test("mobile reply menu uses transported display without losing click handlers", (t) => {
  const { timeline, box, composers } = host(t, true);
  const wrapper = box();
  const doc = {
    sender: "sender@example.com",
    recipients: "recipient@example.com",
    subject: "Subject",
    cc: "",
    bcc: "",
  };
  timeline.setup_reply(wrapper, doc);
  const items = wrapper.find(".dropdown-menu .dropdown-item");
  assert.deepEqual(items.map((_, element) => element.textContent).get(), [
    "Rispondi",
    "Rispondi a tutti",
  ]);
  assert.equal(items.find("svg").length, 0);
  assert.equal(wrapper.find(".custom-actions").children().length, 0);
  items.eq(0).trigger("click");
  items.eq(1).trigger("click");
  assert.equal(composers[0].last_email, doc);
  assert.equal(composers[0].reply_all, false);
  assert.equal(composers[1].reply_all, true);
});

test("actual mobile edit action retains translated text and editor state transition", (t) => {
  const { timeline, box, editors } = host(t, true);
  const wrapper = box();
  const doc = {
    name: "Example comment",
    owner: "translator@example.com",
    content: "<p>Testo originale</p>",
    published: 1,
  };
  timeline.setup_comment_actions(wrapper, doc);
  const edit = wrapper
    .find(".dropdown-menu .dropdown-item")
    .filter((_, element) => element.textContent === "Modifica");
  assert.equal(edit.length, 1);
  assert.equal(editors[0].value, doc.content);
  edit.trigger("click");
  assert.equal(edit.text(), "Salva");
  assert.equal(doc.content, "<p>Testo originale</p>");
  assert.equal(editors[0].options.df.fieldname, "comment");
});

test("supplied title and visible text stay literal and are never translated twice", (t) => {
  const { $, timeline, box } = host(t, true);
  const wrapper = box();
  const title = $('<a class="action-btn custom">Testo secondario</a>').attr(
    "title",
    "Titolo <b>utente</b>"
  );
  const text = $('<button class="action-btn other"></button>').text("Modifica");
  timeline.add_dropdown_item(wrapper, [title, text]);
  assert.equal(title.text(), "Titolo <b>utente</b>");
  assert.equal(title.find("b").length, 0);
  assert.equal(text.text(), "Modifica");
  assert.equal(title.hasClass("dropdown-item"), true);
});

test("unknown action keeps the exact existing class-derived formatted fallback", (t) => {
  const { $, timeline, box, frappe } = host(t, true);
  frappe._messages["{0}"] = "<b>{0}</b>";
  const wrapper = box();
  const unknown = $('<a class="action-btn test-action"></a>');
  timeline.add_dropdown_item(wrapper, [unknown]);
  assert.equal(unknown.find("b").text(), "Test Action");
  assert.equal(unknown.hasClass("dropdown-item"), true);
});

test("empty reaction logs and absent edit ownership retain their existing guards", (t) => {
  const { timeline, box } = host(t, true);
  assert.equal(timeline.get_like_timeline_contents().length, 0);
  const wrapper = box();
  timeline.setup_comment_actions(wrapper, {
    owner: "someone@example.com",
    content: "Altro testo",
  });
  assert.equal(wrapper.find(".dropdown-menu .dropdown-item").length, 0);
});
