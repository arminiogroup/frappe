import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const read = (relative) =>
  readFileSync(new URL(relative, import.meta.url), "utf8");

function load() {
  const jquery = (value) => {
    if (typeof value === "object")
      return { is: (tag) => tag === "a" && value.tagName === "a" };
    return Array.from(
      value.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>|[^<]+/g),
      ([text]) =>
        text.startsWith("<a")
          ? { tagName: "a", outerHTML: text }
          : { textContent: text }
    ).filter((node) => node.textContent !== "/>");
  };
  jquery.isEmptyObject = (value) => !value || Object.keys(value).length === 0;
  const host = {
    jQuery: jquery,
    $: jquery,
    frappe: {
      session: { user: "translator@example.com" },
      user_info: () => ({ fullname: "Collaboratore" }),
      utils: {
        escape_html: (value) => value,
        xss_sanitise: (value) => value,
      },
      _messages: {
        "You cancelled this document {1}:Form timeline":
          "Hai annullato questo documento {1}",
        "You cancelled this document {0}:Form timeline":
          "Hai annullato questo documento {0}",
        "{0} cancelled this document {1}:Form timeline":
          "{0} ha annullato questo documento {1}",
        "You cancelled this document:Form timeline":
          "Hai annullato questo documento",
        "You submitted this document {0}:Form timeline":
          "Hai confermato questo documento {0}",
        "via {0}": "tramite {0}",
        ToDo: "Attività da svolgere",
      },
    },
  };
  host.window = host;
  const context = vm.createContext(host);
  for (const file of ["../../format.js", "../../translate.js"])
    vm.runInContext(read(file), context);
  const utils = read("../../utils/utils.js");
  const formLink = utils.slice(
    utils.indexOf("get_form_link: function"),
    utils.indexOf("\n\tget_route_label(")
  );
  const isCurrentUser = utils.slice(
    utils.indexOf("is_current_user(user) {"),
    utils.indexOf("\n\tdebug: {")
  );
  vm.runInContext(
    `Object.assign(frappe.utils, {${formLink}${isCurrentUser}});`,
    context
  );
  vm.runInContext(
    read("./version_timeline_content_builder.js").replace(
      "export { get_version_timeline_content, get_user_link, get_user_message };",
      ""
    ),
    context
  );
  return { host, context };
}

for (const [owner, reference, state] of [
  ["translator@example.com", { doctype: "ToDo", docname: "NOTE-IT-0001" }, 2],
  ["translator@example.com", { label: "tramite procedura" }, 2],
  ["colleague@example.com", { doctype: "ToDo", docname: "NOTE-IT-0001" }, 2],
  ["translator@example.com", null, 2],
  ["translator@example.com", { doctype: "ToDo", docname: "NOTE-IT-0001" }, 1],
]) {
  test(`timeline state ${state} preserves ${owner} and ${
    reference?.docname || reference?.label || "no reference"
  }`, () => {
    const { host, context } = load();
    const data = {
      changed: [["docstatus", state === 2 ? 1 : 0, state]],
      updater_reference: reference,
    };
    const version = {
      name: "VERSION-IT-0001",
      owner,
      data: JSON.stringify(data),
    };
    const snapshot = JSON.stringify(version);
    context.version = version;
    const output = vm.runInContext(
      "get_version_timeline_content(version, {})",
      context
    );
    assert.equal(output.length, 1);
    const html = output[0];
    assert.doesNotMatch(html, /\{\d+\}/);
    assert.ok(html.includes("/desk/version/VERSION-IT-0001"));
    assert.ok(
      html.includes(
        state === 1
          ? "Hai confermato questo documento"
          : owner === host.frappe.session.user
          ? "Hai annullato questo documento"
          : "ha annullato questo documento"
      )
    );
    if (reference?.docname)
      assert.ok(
        html.includes(
          '<a href="/desk/todo/NOTE-IT-0001">tramite Attività da svolgere</a>'
        )
      );
    if (reference?.label) assert.ok(html.includes(reference.label));
    if (owner !== host.frappe.session.user)
      assert.ok(html.includes("/desk/user/colleague%40example.com"));
    assert.equal(JSON.stringify(version), snapshot);
    assert.equal(data.changed[0][2], state);
  });
}
