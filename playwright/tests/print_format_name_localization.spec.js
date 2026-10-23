import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "@playwright/test";

const nodeRequire = createRequire(__filename);
const repository = resolve(__dirname, "../..");
const read = (relative) =>
	readFileSync(resolve(repository, relative.replace(/^frappe\//, "")), "utf8");
const paths = [
	"frappe/frappe/public/js/frappe/utils/utils.js",
	"frappe/frappe/public/js/frappe/translate.js",
	"frappe/frappe/public/js/frappe/dom.js",
	"frappe/frappe/public/js/frappe/form/controls/base_control.js",
	"frappe/frappe/public/js/frappe/form/controls/base_input.js",
	"frappe/frappe/public/js/frappe/form/controls/data.js",
	"frappe/frappe/public/js/frappe/form/controls/link.js",
	"frappe/frappe/public/js/frappe/form/controls/select.js",
	"frappe/frappe/public/js/frappe/form/controls/control.js",
	"frappe/frappe/public/js/frappe/ui/awesomplete.js",
	"frappe/frappe/public/js/frappe/model/sync.js",
	"frappe/frappe/public/js/frappe/model/model.js",
	"frappe/frappe/public/js/frappe/request.js",
	"frappe/frappe/printing/page/print/print.js",
];
const sources = Object.fromEntries(paths.map((path) => [path, read(path)]));
// The production factory imports this actual helper; the classic-control harness strips imports.
sources.comboboxEnabled = read(
	"frappe/frappe/public/js/frappe/form/controls/link_combobox.js"
).match(/frappe\.ui\.form\.is_combobox_link_enabled = function \(\) \{[\s\S]*?\n\};/)[0];
sources.jquery = readFileSync(nodeRequire.resolve("jquery"), "utf8");
sources.awesomplete = readFileSync(nodeRequire.resolve("awesomplete"), "utf8");
sources.selectContext = nodeRequire("esbuild").transformSync(
	read("frappe/frappe/public/js/frappe/utils/select_option_context.ts"),
	{ loader: "ts", format: "iife", globalName: "selectContextModule" }
).code;
const metadata = JSON.parse(read("frappe/frappe/printing/doctype/print_format/print_format.json"));
const benchPython = resolve(repository, "../../env/bin/python");
const python = process.env.PYTHON || (existsSync(benchPython) ? benchPython : "python3");
const pythonProvider = `import json
import re
import sys
from werkzeug.datastructures import Headers
from unittest.mock import patch

import frappe
import frappe.handler
import frappe.translate
from frappe.model.meta import Meta


def main():
    payload = json.load(sys.stdin)
    endpoint = payload["endpoint"]
    assert endpoint in (
        "frappe.desk.search.search_link",
        "frappe.client.validate_link_and_fetch",
        "frappe.printing.page.print.print.get_print_styles",
    )
    args = payload["args"]
    records = payload["records"]
    metadata = payload["metadata"]
    meta = Meta.__new__(Meta)
    meta.__dict__.update(metadata)
    meta.fields = [frappe._dict(field) for field in metadata["fields"]]
    for field in ("title_field", "search_fields", "translated_doctype", "show_title_field_in_link", "sort_field", "sort_order", "issingle", "is_virtual"):
        meta.__dict__.setdefault(field, None)
    queries = []
    frappe.local.session = frappe._dict(user="translator@example.com")
    frappe.local.flags = frappe._dict()
    frappe.local.conf = frappe._dict()
    frappe.local.lang = "en"
    frappe.local.form_dict = frappe._dict(args)
    frappe.local.request = frappe._dict(method=payload["method"], path=f"/api/method/{endpoint}")
    frappe.local.response_headers = Headers()

    def get_list(doctype, **kwargs):
        assert doctype == "Print Format"
        assert kwargs["ignore_permissions"] is False
        assert not kwargs["ignore_user_permissions"]
        queries.append(kwargs)

        def matches(row, condition):
            _, key, operator, value = condition
            actual = row.get(key)
            if operator == "=":
                return actual == value
            if operator == "!=":
                return actual != value
            if operator == "in":
                return actual in value
            if operator == "like":
                pattern = "".join(".*" if c == "%" else "." if c == "_" else re.escape(c) for c in value)
                return re.fullmatch(pattern, str(actual), re.I) is not None
            raise AssertionError(operator)

        permitted = [
            row for row in records
            if row.get("permitted", True)
            and all(matches(row, f) for f in kwargs["filters"])
            and (not kwargs["or_filters"] or any(matches(row, f) for f in kwargs["or_filters"]))
        ]
        start = kwargs["limit_start"]
        limit = kwargs["limit_page_length"]
        permitted = permitted[start:] if limit is None else permitted[start:start + limit]
        return [
            [row["name"], *([1] if any(isinstance(field, dict) for field in kwargs["fields"]) else [])]
            for row in permitted
        ]

    def get_value(doctype, name, fields, **kwargs):
        assert doctype == "Print Format"
        row = next((row for row in records if row["name"] == name), None)
        return {field: row.get(field) for field in fields} if row else None

    database = frappe._dict(escape=lambda value: repr(value), get_value=get_value, get_global=lambda key: None)
    with (
        patch.object(frappe, "db", database),
        patch.object(frappe, "get_hooks", return_value=frappe._dict()),
        patch.object(frappe, "get_installed_apps", return_value=["frappe"]),
        patch.object(frappe, "get_meta", return_value=meta),
        patch.object(frappe, "get_list", side_effect=get_list),
        patch.object(frappe, "get_all", return_value=[]),
        patch.object(frappe, "is_table", return_value=False),
        patch.object(frappe.translate, "get_all_translations", return_value={}),
        patch.object(frappe.handler, "get_server_script_map", return_value={}),
    ):
        result = frappe.handler.execute_cmd(endpoint)
    assert not any(name == "erpnext" or name.startswith("erpnext.") for name in sys.modules)
    print(json.dumps({"message": result, "queries": queries}, default=str))


if __name__ == "__main__":
    main()
`;
const browserHarness = `const assert = Object.fromEntries(["ok", "equal", "deepEqual"].map((method) => [method,
 (...args) => parent.__printFormatAssert(method, args.map((value) => typeof value === "function" ? { functionValue: true } : value))]));
const read = (relative) => sources[relative];
const ticks = async () => { await new Promise((resolve) => setTimeout(resolve, 15)); };
const messages = {
	"Sales Order Classic:Print Format Name": "Ordine di vendita (classico)",
	"Sales Order Modern:Print Format Name": "Ordine di vendita (moderno)",
	"Twin One:Print Format Name": "Formato identico",
	"Twin Two:Print Format Name": "Formato identico",
	'Unsafe <&">:Print Format Name': 'Formato <img src=x onerror="bad()"> & "citato"',
	"Disabled:Print Format Name": "Disattivato",
	"Denied:Print Format Name": "Negato",
	"Report Only:Print Format Name": "Solo report",
	"Wrong DocType:Print Format Name": "Altro documento",
	"Open:Print Format Name": "Apri formato",
	Open: "Aperto",
	"Credit Note": "Nota di credito",
	"Credit Note:Print Format Name": "Formato nota di credito",
};
const records = [
	{ name: "Sales Order Classic", standard: "Yes" },
	{ name: "Sales Order Modern", standard: "Yes", custom_format: 1 },
	{ name: "Twin One", standard: "Yes" },
	{ name: "Twin Two", standard: "Yes" },
	{ name: 'Unsafe <&">', standard: "Yes" },
	{ name: "Disabled", standard: "Yes", disabled: 1 },
	{ name: "Denied", standard: "Yes", permitted: false },
	{ name: "Report Only", standard: "Yes", print_format_for: "Report" },
	{ name: "Wrong DocType", standard: "Yes", doc_type: "Purchase Order" },
	{ name: "Open", standard: "No" },
	{ name: "Ordine custom new", standard: "No" },
	{ name: "Credit Note", standard: "Yes" },
	{ name: "Fresh custom 100%", standard: "No" },
].map((row) => ({ doc_type: "Sales Order", print_format_for: "DocType", disabled: 0, ...row }));

async function load({ candidate = true, initialRecords = records } = {}) {
	const frame = document.createElement("iframe");
	frame.srcdoc = '<!doctype html><head><base href="https://example.test/"></head><body><div id="fields"></div><button id="outside">Outside</button></body>';
	const ready = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
	document.body.append(frame);
	await ready;
	const w = frame.contentWindow;
	w.eval(sources.jquery);
	const $ = w.jQuery;
	$.format = (text, values) => text.replace(/\\{(\\d+)\\}/g, (_, index) => values[index]);
	w.cstr = (v) => v == null ? "" : String(v);
	w.cint = (v) => Number.parseInt(v || 0, 10);
	w.is_null = (v) => v == null || v === "";
	w.strip_html = (v) => $("<div>").html(v).text();
	w.locals = { DocType: {}, ":Print Format": Object.fromEntries(initialRecords.map((r) => [r.name, { ...r }])) };
	const notices = [];
	const queries = [];
	const calls = [];
	const pending = [];
	let data = structuredClone(initialRecords);
	w.frappe = {
		provide(path) { path.split(".").reduce((o, key) => o[key] ||= {}, w); },
		ui: { form: {} },
		pages: { print: {} },
		utils: {},
		boot: { lang: "it", translated_doctypes: [], link_title_doctypes: [], sysdefaults: {}, json_request_apps: [] },
		_messages: { ...messages },
		meta: { get_docfield: () => null },
		model: {
			can_create: () => true,
			can_read: () => true,
			can_select: () => true,
			no_value_type: [],
			table_fields: [],
			is_non_std_field: () => false,
		},
		get_route: () => [],
		get_meta: () => ({}),
		defaults: { is_enabled: () => true },
		is_online: () => true,
		session: { user: "translator@example.com", logged_in_user: "translator@example.com" },
		msgprint: (value) => notices.push(value),
		hide_msgprint() {},
		show_alert: (value) => notices.push(value),
	};
	w.frappe.scrub = (value) => value.toLowerCase().replaceAll(" ", "_");
	w.eval(read("frappe/frappe/public/js/frappe/utils/utils.js").replace(/^import .*;\\n/gm, ""));
	w.frappe.utils.icon = () => "<svg></svg>";
	w.frappe.format = (value) => value || "";
	w.eval(read("frappe/frappe/public/js/frappe/translate.js"));
	const domSource = read("frappe/frappe/public/js/frappe/dom.js");
	w.eval(domSource.slice(domSource.indexOf("frappe.run_serially ="), domSource.indexOf("frappe.load_image =")));
	w.frappe.dom = {};
	w.eval(\`Object.assign(frappe.dom, {\${domSource.slice(domSource.indexOf("eval: function (txt)"), domSource.indexOf("remove_script_and_style: function"))}});\`);
	w.eval(sources.awesomplete);
	w.BaseAwesomplete = w.Awesomplete;
	w.eval(read("frappe/frappe/public/js/frappe/ui/awesomplete.js")
		.replace('import BaseAwesomplete from "awesomplete";', "")
		.replace("export default class Awesomplete", "class Awesomplete"));
	for (const name of ["base_control", "base_input", "data", "link"]) {
		w.eval(read(\`frappe/frappe/public/js/frappe/form/controls/\${name}.js\`).replace(/^import .*;\\n/gm, ""));
	}
	w.eval(sources.selectContext);
	w.selectOptionContext = w.selectContextModule.selectOptionContext;
	w.eval(read("frappe/frappe/public/js/frappe/form/controls/select.js").replace(/^import .*;\\n/gm, ""));
	w.eval(read("frappe/frappe/public/js/frappe/model/sync.js"));
	w.eval(sources.comboboxEnabled);
	w.eval(read("frappe/frappe/public/js/frappe/form/controls/control.js").replace(/^import .*;\\n/gm, ""));
	w.eval(read("frappe/frappe/public/js/frappe/request.js"));
	$.ajax = (options) => {
		const deferred = $.Deferred();
		const args = typeof options.data === "string" ? JSON.parse(options.data) : { ...options.data };
		for (const [key, value] of Object.entries(args)) {
			if (typeof value === "string" && ["filters", "fields_to_fetch"].includes(key)) args[key] = JSON.parse(value);
		}
		const call = { endpoint: options.url.replace("/api/method/", ""), args, method: options.type };
		calls.push(call);
		const xhr = {
			statusCode: () => ({ status: call.failure ? 417 : 200 }),
			getResponseHeader: () => "application/json",
			responseText: "{}",
		};
		const delivery = {
			call,
			async succeed(override) {
				const output = override || await parent.__printFormatRpc({ ...call, records: data });
				queries.push(...(output.queries || []));
				deferred.resolve({ message: output.message }, "success", xhr);
			},
			fail() {
				call.failure = true;
				xhr.responseJSON = { message: "Genuine source failure", _server_messages: JSON.stringify([JSON.stringify({ message: "Genuine source failure" })]) };
				xhr.responseText = JSON.stringify(xhr.responseJSON);
				deferred.reject(xhr, "error");
			},
		};
		pending.push(delivery);
		return deferred.promise();
	};
	const pageSource = read("frappe/frappe/printing/page/print/print.js");
	w.frappe.dom.eval(pageSource);
	const offset = pageSource.lastIndexOf("\\nfunction print_format_link_options(");
	const optionsFor = offset >= 0
		? new w.Function(\`\${pageSource.slice(offset)}\\nreturn print_format_link_options;\`)()
		: () => ({});
	const view = { frm: { doctype: "Sales Order" } };
	function control(adapt = candidate) {
		const field = w.frappe.ui.form.make_control({
			df: {
				fieldtype: "Link", fieldname: "print_format", options: "Print Format", label: "Print Format",
				filter_description: "Stable filter description",
				get_query: () => ({ filters: { doc_type: view.frm.doctype, print_format_for: ["in", ["DocType", ""]] } }),
			},
			parent: w.document.getElementById("fields"), render_input: 1,
			...(adapt ? optionsFor(view) : {}),
		});
		return field;
	}
	async function search(field, term) {
		field.$input.val(term);
		field.input.focus();
		field.input.dispatchEvent(new w.Event("input", { bubbles: true }));
		field._debounced_input_handler.flush();
		await ticks();
	}
	async function deliver(index = 0, override) {
		const [delivery] = pending.splice(index, 1);
		await assert.ok(Boolean(delivery), "an actual AJAX request is awaiting delivery");
		await delivery.succeed(override);
		await ticks();
		return delivery.call;
	}
	async function settle() {
		for (let n = 0; pending.length && n < 20; n++) await deliver();
		await assert.equal(pending.length, 0);
	}
	return { w, $, notices, queries, calls, pending, control, view, search, deliver, settle,
		setRecords(value) { data = structuredClone(value); },
		close() { frame.remove(); },
	};
}
`;

async function run(page, body) {
	await page.route("**/*", (route) => route.abort());
	await page.setContent("<!doctype html><body></body>");
	await page.exposeFunction("__printFormatAssert", (method, args) => assert[method](...args));
	await page.exposeFunction("__printFormatRpc", (payload) =>
		JSON.parse(
			execFileSync(python, ["-c", pythonProvider], {
				input: JSON.stringify({ ...payload, metadata }),
				env: { ...process.env, PYTHONPATH: repository },
				encoding: "utf8",
			})
		)
	);
	await page.evaluate(
		({ sources, harness, body }) =>
			new Function("sources", `${harness}\nreturn (async () => {${body}\n})();`)(sources),
		{
			sources,
			harness: browserHarness,
			body,
		}
	);
}

test("actual constructor, request adapter, server dispatch and locked autocomplete recover Italian names", async ({
	page,
}) => {
	await run(
		page,
		`	const env = await load();
	try {
		const field = env.control();
		await env.search(field, "Ordine");
		await env.settle();

		await assert.ok(field.awesomplete.ul.textContent.includes("Ordine di vendita (classico)"));
		await assert.ok(field.awesomplete.ul.textContent.includes("Sales Order Classic"));
		await assert.ok(field.awesomplete.ul.textContent.includes("Ordine custom new"));
		await assert.equal(field.awesomplete._list.filter((row) => row.value === "Sales Order Classic").length, 1);
		await assert.equal(env.queries.length, 2);
		await assert.ok(env.queries.every((q) => q.ignore_permissions === false));
		await assert.equal(env.calls[0].args.page_length, Object.keys(messages).filter((key) => key.endsWith(":Print Format Name")).length);
		await assert.equal(env.calls[1].args.txt, "Ordine");
	} finally { env.close(); }`
	);
});

test("underlying plain control preserves the raw standard-name display and missing Italian lookup", async ({
	page,
}) => {
	await run(
		page,
		`	const env = await load({ candidate: false });
	try {
		const field = env.control();
		field.set_input("Sales Order Classic");
		await assert.equal(field.input.value, "Sales Order Classic");
		await env.search(field, "Ordine");
		await env.settle();
		await assert.ok(!field.awesomplete._list.some((row) => row.value === "Sales Order Classic"));
		await assert.ok(field.awesomplete._list.some((row) => row.value === "Ordine custom new"));
		await assert.equal(env.calls.length, 1);
	} finally { env.close(); }`
	);
});

test("only the opted-in instance changes; metadata is standard provenance, not custom renderer type", async ({
	page,
}) => {
	await run(
		page,
		`	const env = await load();
	try {
		const adapted = env.control();
		const plain = env.control(false);
		await assert.ok(Object.hasOwn(adapted, "on_input"));
		await assert.ok(!Object.hasOwn(plain, "on_input"));
		adapted.set_input("Sales Order Modern");
		plain.set_input("Sales Order Modern");
		await assert.equal(adapted.input.value, "Ordine di vendita (moderno)");
		await assert.equal(adapted.get_input_value(), "Sales Order Modern");
		await assert.equal(plain.input.value, "Sales Order Modern");
		for (const name of ["Open", "Disabled", "Report Only", "Wrong DocType"]) {
			await assert.equal(adapted.get_translated(name), name);
		}
		await assert.equal(env.w.frappe.boot.translated_doctypes.length, 0);
		await assert.equal(env.w.frappe.ui.form.ControlLink.link_options, undefined);
		await assert.equal(env.w.print_format_link_options, undefined);
	} finally { env.close(); }`
	);
});

test("complete supplement retains real filters, permission flags and legacy empty namespace eligibility", async ({
	page,
}) => {
	await run(
		page,
		`	const extra = [...records, { name: "Legacy", standard: "Yes", doc_type: "Sales Order", print_format_for: "", disabled: 0 }];
	const env = await load({ initialRecords: extra });
	try {
		env.w.frappe._messages["Legacy:Print Format Name"] = "Formato precedente";
		const field = env.control();
		await env.search(field, "formato");
		await env.settle();
		const choices = Array.from(field._print_format_choices || [], (row) => row.value);
		for (const excluded of ["Disabled", "Denied", "Open", "Wrong DocType", "Report Only"]) await assert.ok(!choices.includes(excluded));
		await assert.ok(choices.includes("Legacy"));
		await assert.ok(choices.includes("Sales Order Modern"));
		await assert.equal(env.queries[0].limit_page_length, 12);
		await assert.ok(env.queries.every((query) => query.ignore_permissions === false && !query.ignore_user_permissions));
		await assert.deepEqual(env.calls[1].args.filters, { doc_type: "Sales Order", print_format_for: ["in", ["DocType", ""]] });
	} finally { env.close(); }`
	);
});

test("canonical primary LIKE wildcard matches and all action rows survive local supplement filtering", async ({
	page,
}) => {
	await run(
		page,
		`	const env = await load();
	try {
		const field = env.control();
		await env.search(field, "Fresh%100");
		await env.settle();
		await assert.ok(field.awesomplete.ul.textContent.includes("Fresh custom 100%"));
		for (const name of ["filter_description__link_option", "create_new__link_option", "advanced_search__link_option"]) {
			await assert.ok(field.awesomplete._list.some((row) => row.value === name));
		}
		await assert.ok(!field.awesomplete.ul.textContent.includes("Ordine di vendita (classico)"));
		await assert.ok(Boolean(env.queries[1]), "the supplement and primary queries both ran");
		await assert.ok(env.queries[1].or_filters.some((filter) => filter[2] === "like" && filter[3] === "%Fresh%100%"));
	} finally { env.close(); }`
	);
});

test("canonical duplicates merge once, while equal translated labels keep distinct raw secondary IDs", async ({
	page,
}) => {
	await run(
		page,
		`	const env = await load();
	try {
		const field = env.control();
		await env.search(field, "Twin");
		await env.deliver();
		await env.deliver(0, { message: [
			{ value: "Twin One", label: "Twin One", description: "first" },
			{ value: "Twin One", label: "Twin One", description: "second" },
			{ value: "Twin Two", label: "Twin Two", description: "third" },
		] });
		await assert.equal(field.awesomplete._list.filter((row) => row.value === "Twin One").length, 1);
		await assert.equal(field.awesomplete.get_item("Twin One").description, "first, second");
		await assert.ok(field.awesomplete.ul.textContent.includes("Twin One"));
		await assert.ok(field.awesomplete.ul.textContent.includes("Twin Two"));
		await assert.equal(Array.from(field.awesomplete.ul.querySelectorAll("strong")).filter((el) => el.textContent === "Formato identico").length, 2);
	} finally { env.close(); }`
	);
});

test("locked Awesomplete keyboard selection preserves each equal-caption canonical identity through validation", async ({
	page,
}) => {
	await run(
		page,
		`	for (const canonical of ["Twin One", "Twin Two"]) {
		const env = await load();
		try {
			const field = env.control();
			await env.search(field, "Formato");
			await env.settle();
			const index = Array.from(field.awesomplete.ul.children).findIndex((element) => element.textContent.includes(canonical));
			await assert.ok(index >= 0);
			field.awesomplete.goto(index);
			field.input.dispatchEvent(new env.w.KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
			await ticks();
			await env.settle();
			await assert.equal(field.input.value, "Formato identico");
			await assert.equal(field.get_input_value(), canonical);
			await assert.equal(field.value, canonical);
			await assert.equal(env.calls.at(-1).endpoint, "frappe.client.validate_link_and_fetch");
			await assert.equal(env.calls.at(-1).args.docname, canonical);
			await assert.ok(!Object.hasOwn(env.calls.at(-1).args.filters, "standard"));
		} finally { env.close(); }
	}`
	);
});

test("selection then native blur keeps canonical value; raw new custom blur uses the unchanged validator", async ({
	page,
}) => {
	await run(
		page,
		`	const env = await load();
	try {
		const field = env.control();
		await env.search(field, "Ordine");
		await env.settle();
		const row = Array.from(field.awesomplete.ul.children).find((el) => el.textContent.includes("Sales Order Classic"));
		await assert.ok(Boolean(row), "the Italian search returned the canonical standard choice");
		row.click();
		await ticks();
		await env.settle();
		env.w.document.getElementById("outside").focus();
		await ticks();
		await env.settle();
		await assert.equal(field.get_input_value(), "Sales Order Classic");
		await assert.equal(field.value, "Sales Order Classic");
		field.selected = false;
		field.$input.val("Ordine custom new");
		field.input.focus();
		env.w.document.getElementById("outside").focus();
		await ticks();
		await env.settle();
		await assert.equal(field.value, "Ordine custom new");
		await assert.equal(env.calls.at(-1).args.docname, "Ordine custom new");
	} finally { env.close(); }`
	);
});

test("translated labels and raw secondary IDs are text-escaped; global name collisions do not replace IDs", async ({
	page,
}) => {
	await run(
		page,
		`	const env = await load();
	try {
		const field = env.control();
		await env.search(field, "");
		await env.settle();
		const html = field.awesomplete.ul;
		await assert.equal(html.querySelector("img"), null);
		await assert.ok(html.textContent.includes('Formato <img src=x onerror="bad()"> & "citato"'));
		await assert.ok(html.textContent.includes('Unsafe <&">'));
		const credit = Array.from(html.children).find((el) => el.textContent.includes("Formato nota di credito"));
		await assert.ok(credit.textContent.includes("Credit Note"));
		await assert.ok(!credit.textContent.includes("Nota di credito"));
	} finally { env.close(); }`
	);
});

test("late supplement cannot start a stale primary after a newer input or native blur", async ({
	page,
}) => {
	await run(
		page,
		`	const env = await load();
	try {
		const field = env.control();
		await env.search(field, "Ordine");
		await env.search(field, "Formato");
		await env.deliver(1);
		await env.deliver(0);
		await env.settle();
		await assert.deepEqual(env.calls.filter((call) => call.args.txt).map((call) => call.args.txt), ["Formato"]);
		await assert.ok(field.awesomplete.ul.textContent.includes("Twin One"));
		await env.search(field, "Ordine");
		env.w.document.getElementById("outside").focus();
		await env.deliver();
		await env.settle();
		await assert.equal(env.pending.length, 0);
		await assert.equal(env.calls.filter((call) => call.endpoint === "frappe.desk.search.search_link" && call.args.txt === "Ordine").length, 0);
	} finally { env.close(); }`
	);
});

test("supplement failure retains server error detail and falls back to fresh primary custom results", async ({
	page,
}) => {
	await run(
		page,
		`	const env = await load();
	try {
		const field = env.control();
		await env.search(field, "Ordine");
		const delivery = env.pending.shift();
		delivery.fail();
		await ticks();
		await env.settle();
		await assert.ok(field.awesomplete.ul.textContent.includes("Ordine custom new"));
		await assert.equal(field._print_format_choices?.length, 0);
		await assert.ok(env.notices.some((value) => JSON.stringify(value).includes("Genuine source failure")));
	} finally { env.close(); }`
	);
});

test("locale and eligibility changes invalidate only this control cache and reject an obsolete pending source", async ({
	page,
}) => {
	await run(
		page,
		`	const env = await load();
	try {
		const field = env.control();
		const plain = env.control(false);
		plain.$input.cache.unrelated = "preserve";
		await env.search(field, "Ordine");
		await env.settle();
		await assert.ok(field.$input.cache["Print Format"].Ordine);
		env.w.frappe.boot.lang = "fr";
		env.w.frappe._messages["Sales Order Classic:Print Format Name"] = "Bon de commande classique";
		env.setRecords(records.map((row) => row.name === "Sales Order Modern" ? { ...row, disabled: 1 } : row));
		await env.search(field, "Bon");
		await env.settle();
		await assert.ok(!Object.hasOwn(field.$input.cache["Print Format"], "Ordine"));
		await assert.ok(field.awesomplete.ul.textContent.includes("Bon de commande classique"));
		await assert.ok(!field._print_format_choices?.some((row) => row.value === "Sales Order Modern"));
		await assert.equal(plain.$input.cache.unrelated, "preserve");
		await env.search(field, "Ordine");
		env.w.frappe.boot.lang = "it";
		await env.deliver();
		await assert.equal(env.pending.length, 0);
	} finally { env.close(); }`
	);
});

test("dynamic namespace save/delete/rename and doctype changes do not become a fixed local whitelist", async ({
	page,
}) => {
	await run(
		page,
		`	const env = await load();
	try {
		const field = env.control();
		delete env.w.locals[":Print Format"]["Sales Order Classic"];
		await env.search(field, "Ordine");
		await env.settle();
		await assert.ok(field._print_format_choices?.some((row) => row.value === "Sales Order Classic"));
		const fresh = { name: "Nuovo formato utente", standard: "No", doc_type: "Sales Order", print_format_for: "DocType", disabled: 0 };
		env.setRecords([...records.filter((row) => row.name !== "Sales Order Classic"), fresh]);
		env.w.locals[":Print Format"][fresh.name] = fresh;
		await env.search(field, "Nuovo");
		await env.settle();
		await assert.ok(field.awesomplete.ul.textContent.includes(fresh.name));
		await assert.ok(!field._print_format_choices?.some((row) => row.value === "Sales Order Classic"));
		await env.search(field, "Ordine");
		env.view.frm.doctype = "Purchase Order";
		await env.deliver();
		await assert.equal(env.pending.length, 0);
		await env.search(field, "Altro");
		await env.settle();
		await assert.deepEqual(Array.from(field._print_format_choices || [], (row) => row.value), ["Wrong DocType"]);
	} finally { env.close(); }`
	);
});

test("actual PrintView sidebar construction and selected_format keep preview identity canonical", async ({
	page,
}) => {
	await run(
		page,
		`	const env = await load();
	try {
		const view = Object.assign(Object.create(env.w.frappe.ui.form.PrintView.prototype), {
			frm: { doctype: "Sales Order" },
			page: { sidebar: env.$("<div>").appendTo(env.w.document.body) },
			print_settings: { repeat_header_footer: 1 },
		});
		view.setup_sidebar();
		await env.settle();
		await assert.ok(Object.hasOwn(view.print_format_field, "on_input"));
		await assert.ok(!Object.hasOwn(view.language_field, "on_input"));
		view.set_print_format_value("Sales Order Classic");
		await assert.equal(view.print_format_selector.val(), "Ordine di vendita (classico)");
		await assert.equal(view.selected_format(), "Sales Order Classic");
		await assert.equal(view.get_print_format().name, "Sales Order Classic");
		view.set_print_format_value("");
		await assert.equal(view.selected_format(), "Standard");
		delete view.print_format_field;
		view.print_format_selector.val("Print Designer canonical");
		await assert.equal(view.selected_format(), "Print Designer canonical");
	} finally { env.close(); }`
	);
});

test("actual namespace synchronization preserves rename/disable behavior without publishing translations into names", async ({
	page,
}) => {
	await run(
		page,
		`	const env = await load();
	try {
		const field = env.control();
		const original = { ...records[0], doctype: "Print Format", docstatus: 0 };
		env.w.frappe.model.sync_print_format_for_meta(original);
		await assert.equal(env.w.locals[":Print Format"][original.name].doctype, ":Print Format");
		env.w.frappe.model.rename_doc_in_locals("Print Format", original.name, "Renamed standard");
		await assert.equal(env.w.locals[":Print Format"][original.name], undefined);
		await assert.equal(env.w.locals[":Print Format"]["Renamed standard"].name, "Renamed standard");
		await assert.equal(field.get_translated("Renamed standard"), "Renamed standard");
		env.w.frappe.model.sync_print_format_for_meta({ ...original, disabled: 1 });
		await assert.equal(env.w.locals[":Print Format"][original.name], undefined);
		await env.search(field, "Ordine");
		env.w.frappe.model.sync_print_format_for_meta(original);
		await env.deliver();
		await assert.equal(env.pending.length, 0);
		await assert.equal(env.calls.length, 1);
	} finally { env.close(); }`
	);
});

test("the pre-existing primary-response race remains reproducible and is not claimed fixed", async ({
	page,
}) => {
	await run(
		page,
		`	for (const candidate of [false, true]) {
		const env = await load({ candidate });
		try {
			const field = env.control();
			await env.search(field, "Ordine");
			if (candidate) await env.deliver();
			await env.search(field, "Twin");
			if (candidate) await env.deliver(1);
			await env.deliver(1);
			await env.deliver(0);
			await assert.equal(field.input.value, "Twin");
			await assert.ok(field.awesomplete.ul.textContent.includes("Ordine custom new"));
		} finally { env.close(); }
	}
`
	);
});

test("actual preview, PDF and email option producers keep canonical format and document values", async ({
	page,
}) => {
	await run(
		page,
		`	const env = await load();
	try {
		const field = env.control();
		field.set_input("Sales Order Classic");
		const captured = {};
		const doc = { doctype: "Sales Order", name: "QA <&> / 1" };
		const view = Object.assign(Object.create(env.w.frappe.ui.form.PrintView.prototype), {
			print_format_field: field,
			print_format_selector: field.$input,
			letterhead_selector: env.$("<input>").val(""),
			frm: { doctype: doc.doctype, docname: doc.name, doc,
				email_doc(_event, options) { captured.email = options; return { dialog: { set_value() {} } }; },
			},
			additional_settings: {},
			page_overrides: {},
			print_settings: {},
			print_wrapper: env.$('<div><div class="preview-beta-wrapper"><iframe></iframe></div></div>').appendTo(env.w.document.body),
		});
		view.preview_beta();
		const preview = new URL(view.print_wrapper.find("iframe").prop("src"));
		await assert.equal(preview.searchParams.get("print_format"), "Sales Order Classic");
		await assert.equal(preview.searchParams.get("name"), doc.name);
		env.w.open = (url) => { captured.pdf = String(url); return {}; };
		view.render_pdf();
		const pdf = new URL(captured.pdf, "https://example.test");
		await assert.equal(pdf.searchParams.get("print_format"), "Sales Order Classic");
		await assert.equal(pdf.searchParams.get("name"), doc.name);
		view.email_doc();
		await assert.equal(captured.email.print_format, "Sales Order Classic");
		await assert.equal(captured.email.letter_head, "");
		await assert.equal(doc.name, "QA <&> / 1");
		await assert.equal(env.calls.length, 0);

	} finally { env.close(); }`
	);
});

test("an unselected Italian caption stays subject to canonical Link validation", async ({
	page,
}) => {
	await run(
		page,
		`	const env = await load();
	try {
		const field = env.control();
		await env.search(field, "Ordine di vendita (classico)");
		await env.settle();
		env.w.document.getElementById("outside").focus();
		await ticks();
		await env.settle();
		await assert.equal(env.calls.at(-1).endpoint, "frappe.client.validate_link_and_fetch");
		await assert.equal(env.calls.at(-1).args.docname, "Ordine di vendita (classico)");
		await assert.equal(field.value, undefined);
		await assert.ok(env.notices.some((notice) => String(notice.message).includes("did not match")));
	} finally { env.close(); }`
	);
});

test("missing dedicated dictionary entries leave custom names raw and do not add a supplement request", async ({
	page,
}) => {
	await run(
		page,
		`	const env = await load();
	try {
		env.w.frappe._messages = { Open: "Aperto" };
		const field = env.control();
		await env.search(field, "Open");
		await env.settle();
		await assert.equal(env.calls.length, 1);
		await assert.equal(env.calls[0].args.txt, "Open");
		await assert.ok(field.awesomplete.ul.textContent.includes("Open"));
		await assert.ok(!field.awesomplete.ul.textContent.includes("Aperto"));
		await assert.equal(field.get_translated("Sales Order Classic"), "Sales Order Classic");
	} finally { env.close(); }`
	);
});

test("a prior supplement cannot translate a same-ID format changed to authored standardNo before another search", async ({
	page,
}) => {
	await run(
		page,
		`	const env = await load();
	try {
		const field = env.control();
		await env.search(field, "Ordine");
		await env.settle();
		await assert.ok(field._print_format_choices?.some((row) => row.value === "Sales Order Classic"));
		const requests = env.calls.length;
		env.w.frappe.model.sync_print_format_for_meta({ ...records[0], doctype: "Print Format", docstatus: 0, standard: "No" });
		await assert.equal(env.w.locals[":Print Format"]["Sales Order Classic"].standard, "No");
		await assert.equal(field.get_translated("Sales Order Classic"), "Sales Order Classic");
		field.set_input("Sales Order Classic");
		await assert.equal(field.input.value, "Sales Order Classic");
		await assert.equal(field.get_input_value(), "Sales Order Classic");
		await assert.equal(env.calls.length, requests);
	} finally { env.close(); }`
	);
});

test("a prior supplement cannot authorize translated display after the current document type changes", async ({
	page,
}) => {
	await run(
		page,
		`	const env = await load();
	try {
		const field = env.control();
		await env.search(field, "Ordine");
		await env.settle();
		const requests = env.calls.length;
		env.view.frm.doctype = "Purchase Order";
		await assert.ok(field._print_format_choices?.some((row) => row.value === "Sales Order Classic"));
		await assert.equal(field.get_translated("Sales Order Classic"), "Sales Order Classic");
		field.set_input("Sales Order Classic");
		await assert.equal(field.input.value, "Sales Order Classic");
		await assert.equal(field.get_input_value(), "Sales Order Classic");
		await assert.equal(env.calls.length, requests);
	} finally { env.close(); }`
	);
});

test("an actual local disable sync revokes a prior supplement before another query", async ({
	page,
}) => {
	await run(
		page,
		`	const env = await load();
	try {
		const field = env.control();
		await env.search(field, "Ordine");
		await env.settle();
		const requests = env.calls.length;
		env.w.frappe.model.sync_print_format_for_meta({ ...records[0], doctype: "Print Format", docstatus: 0, disabled: 1 });
		await assert.equal(env.w.locals[":Print Format"]["Sales Order Classic"], undefined);
		await assert.ok(field._print_format_choices?.some((row) => row.value === "Sales Order Classic"));
		await assert.equal(field.get_translated("Sales Order Classic"), "Sales Order Classic");
		field.set_input("Sales Order Classic");
		await assert.equal(field.input.value, "Sales Order Classic");
		await assert.equal(field.get_input_value(), "Sales Order Classic");
		await assert.equal(env.calls.length, requests);
	} finally { env.close(); }`
	);
});

test("an actual local rename sync revokes the prior canonical choice while preserving the authored new ID", async ({
	page,
}) => {
	await run(
		page,
		`	const env = await load();
	try {
		const field = env.control();
		await env.search(field, "Ordine");
		await env.settle();
		const requests = env.calls.length;
		env.w.frappe.model.rename_doc_in_locals("Print Format", "Sales Order Classic", "Nuovo nome autore");
		await assert.equal(env.w.locals[":Print Format"]["Sales Order Classic"], undefined);
		await assert.equal(field.get_translated("Sales Order Classic"), "Sales Order Classic");
		field.set_input("Sales Order Classic");
		await assert.equal(field.input.value, "Sales Order Classic");
		field.set_input("Nuovo nome autore");
		await assert.equal(field.input.value, "Nuovo nome autore");
		await assert.equal(field.get_input_value(), "Nuovo nome autore");
		await assert.equal(env.calls.length, requests);
	} finally { env.close(); }`
	);
});

test("fresh server choices still translate a legitimately absent initial metadata record", async ({
	page,
}) => {
	await run(
		page,
		`	const env = await load();
	try {
		delete env.w.locals[":Print Format"]["Sales Order Classic"];
		const field = env.control();
		await assert.equal(field.get_translated("Sales Order Classic"), "Sales Order Classic");
		await env.search(field, "Ordine");
		await env.settle();
		await assert.equal(env.w.locals[":Print Format"]["Sales Order Classic"], undefined);
		await assert.equal(field.get_translated("Sales Order Classic"), "Ordine di vendita (classico)");
		field.set_input("Sales Order Classic");
		await assert.equal(field.input.value, "Ordine di vendita (classico)");
		await assert.equal(field.get_input_value(), "Sales Order Classic");
		const requests = env.calls.length;
		env.w.frappe.model.sync_print_format_for_meta({ ...records[0], doctype: "Print Format", docstatus: 0, standard: "No" });
		await assert.equal(field.get_translated("Sales Order Classic"), "Sales Order Classic");
		field.set_input("Sales Order Classic");
		await assert.equal(field.input.value, "Sales Order Classic");
		await assert.equal(env.calls.length, requests);
	} finally { env.close(); }`
	);
});

test("a late primary keeps its own rows but cannot reappend obsolete supplemental choices after metadata changes", async ({
	page,
}) => {
	await run(
		page,
		`	const env = await load();
	try {
		const field = env.control();
		await env.search(field, "Ordine");
		await env.deliver();
		await assert.ok(field._print_format_choices?.some((row) => row.value === "Sales Order Classic"));
		env.w.frappe.model.sync_print_format_for_meta({ ...records[0], doctype: "Print Format", docstatus: 0, standard: "No" });
		await env.deliver();
		await assert.ok(field.awesomplete._list.some((row) => row.value === "Ordine custom new"));
		await assert.ok(!field.awesomplete._list.some((row) => row.value === "Sales Order Classic"));
		await assert.ok(field.awesomplete._list.some((row) => row.value === "advanced_search__link_option"));
		await assert.equal(field.get_translated("Sales Order Classic"), "Sales Order Classic");
		await assert.equal(env.calls.length, 2);
	} finally { env.close(); }`
	);
});

const letterheadHarness = `
async function letterheadView({ readable = false, row = {}, omit = false, remoteData, defaultName = "Default authored head", defaultResponse, defaultDeferred, documentHead = "" } = {}) {
    const name = row.name || "Sales Order Modern";
    const format = { ...records[1], doctype: ":Print Format", docstatus: 0, format_data: JSON.stringify({letter_head: "Loaded authored head"}), ...row };
    const initialRecords = omit ? [] : [format];
    const env = await load({initialRecords});
    env.w.frappe.boot.user = {can_read: readable ? ["Print Format"] : [], can_select: ["Print Format", "Letter Head", "Language"], can_create: [], can_write: []};
    env.w.eval(read("frappe/frappe/public/js/frappe/model/model.js"));
    const view = Object.create(env.w.frappe.ui.form.PrintView.prototype);
    const sidebar = env.$("<div>").appendTo(env.w.document.body);
    Object.assign(view, {page: {sidebar}, frm: {doctype: "Sales Order", doc: {doctype: "Sales Order", name: "EXAMPLE-ORDER-1", language: "it", letter_head: documentHead}}, print_settings: {repeat_header_footer: 1}});
    view.setup_style_picker = () => {};
    view.setup_page_settings = () => {};
    view.toggle_style_picker = () => {};
    const remote = [], defaults = [], previews = [], order = [];
    let rpcData = remoteData === undefined ? {format_data: JSON.stringify({letter_head: "Fresh server head"})} : remoteData;
    let rpcError;
    env.w.frappe.call = options => {
        await_assert_rpc(options);
        remote.push({method: options.method, args: structuredClone(options.args)});
        return rpcError ? Promise.reject(rpcError) : Promise.resolve({message: rpcData});
    };
    function await_assert_rpc(options) {
        if (options.method !== "frappe.client.get" || options.args.doctype !== "Print Format") throw new Error("Unexpected RPC in the letterhead probe");
    }
    env.w.frappe.db = {get_value: (...args) => {
        defaults.push(structuredClone(args)); order.push("default-request");
        const response = defaultDeferred || Promise.resolve(defaultResponse === undefined ? {message: {name: defaultName}} : defaultResponse);
        return response.then(value => {order.push("default-resolved"); return value;});
    }};
    view.preview = () => {
        order.push("preview");
        previews.push({format: view.selected_format(), letterhead: view.letterhead_selector.val(), language: view.lang_code});
    };
    view.setup_sidebar();
    async function change(selected = name) {
        view.print_format_field.set_input(selected);
        view.print_format_field.df.change();
        await ticks(); await ticks();
    }
    return {env, view, format, remote, defaults, previews, order, change, setError(error) {rpcError = error;}, close() {env.close();}};
}
`;

test("restricted print users switch standard and authored formats through the actual control change without a full record read", async ({
	page,
}) => {
	await run(
		page,
		letterheadHarness +
			`
        for (const row of [
            {name: "Sales Order Modern", standard: "Yes", format_data: JSON.stringify({letter_head: "Open"})},
            {name: "Open", standard: "No", format_data: JSON.stringify({letter_head: "Open"})},
        ]) {
            const state = await letterheadView({row});
            try {
                await assert.equal(state.env.w.frappe.model.can_read("Print Format"), false);
                await state.change();
                await assert.equal(state.view.selected_format(), row.name);
                await assert.equal(state.view.print_format_selector.val(), row.standard === "Yes" ? "Ordine di vendita (moderno)" : "Open");
                await assert.deepEqual(state.previews, [{format: row.name, letterhead: "Open", language: "it"}]);
                await assert.equal(state.remote.length, 0);
                await assert.equal(state.defaults.length, 0);
                await assert.equal(state.env.w.__("Open"), "Aperto");
            } finally {state.close();}
        }
    `
	);
});

test("delivered format data preserves malformed null empty and raw authored letterhead semantics", async ({
	page,
}) => {
	await run(
		page,
		letterheadHarness +
			`
        for (const [data, expected, usesDefault] of [
            [null, "Default authored head", true],
            ["", "Default authored head", true],
            ["not valid JSON", "Default authored head", true],
            ["{}", "Default authored head", true],
            [JSON.stringify({letter_head: null}), "Default authored head", true],
            [JSON.stringify({letter_head: false}), "Default authored head", true],
            [JSON.stringify({letter_head: ""}), "", false],
            [JSON.stringify({letter_head: 'Authored <&"> head'}), 'Authored <&"> head', false],
        ]) {
            const state = await letterheadView({row: {format_data: data}});
            try {
                const raw = JSON.stringify(state.env.w.locals[":Print Format"]);
                await state.change();
                await assert.deepEqual(state.previews, [{format: "Sales Order Modern", letterhead: expected, language: "it"}]);
                await assert.equal(state.defaults.length, Number(usesDefault));
                await assert.equal(state.remote.length, 0);
                await assert.equal(JSON.stringify(state.env.w.locals[":Print Format"]), raw);
            } finally {state.close();}
        }
    `
	);
});

test("read-capable users retain the fresh canonical server request and record-specific permission rejection", async ({
	page,
}) => {
	await run(
		page,
		letterheadHarness +
			`
        const state = await letterheadView({readable: true});
        try {
            await assert.equal(state.env.w.frappe.model.can_read("Print Format"), true);
            await state.change();
            await assert.deepEqual(state.remote, [{method: "frappe.client.get", args: {doctype: "Print Format", name: "Sales Order Modern"}}]);
            await assert.equal(state.previews[0].letterhead, "Fresh server head");
            await assert.equal(JSON.parse(state.format.format_data).letter_head, "Loaded authored head");
            const denied = new Error("Genuine record permission denial");
            denied.name = "PermissionError";
            state.setError(denied);
            let received;
            try {await state.view.update_letterhead_for_print_format();} catch (error) {received = error;}
            await assert.equal(received === denied, true);
            await assert.equal(state.remote.length, 2);
            await assert.equal(state.previews.length, 1);
            await assert.equal(state.view.letterhead_selector.val(), "Fresh server head");
        } finally {state.close();}
    `
	);
});

test("actual local disable cancel rename and document changes revoke delivered letterhead eligibility", async ({
	page,
}) => {
	await run(
		page,
		letterheadHarness +
			`
        for (const kind of ["disabled", "cancelled", "renamed", "doctype"]) {
            const state = await letterheadView();
            try {
                state.view.print_format_field.set_input("Sales Order Modern");
                const model = state.env.w.frappe.model;
                if (kind === "disabled") model.sync_print_format_for_meta({...state.format, doctype: "Print Format", disabled: 1});
                if (kind === "cancelled") model.sync_print_format_for_meta({...state.format, doctype: "Print Format", docstatus: 2});
                if (kind === "renamed") model.rename_doc_in_locals("Print Format", "Sales Order Modern", "Renamed authored format");
                if (kind === "doctype") {
                    state.view.frm.doctype = "Purchase Order";
                    state.view.frm.doc.doctype = "Purchase Order";
                } else {
                    await assert.equal(state.env.w.locals[":Print Format"]["Sales Order Modern"], undefined);
                }
                await state.change("Sales Order Modern");
                await assert.deepEqual(state.remote, [{method: "frappe.client.get", args: {doctype: "Print Format", name: "Sales Order Modern"}}]);
                await assert.equal(state.previews[0].letterhead, "Fresh server head");
                if (kind === "renamed") {
                    await state.change("Renamed authored format");
                    await assert.equal(state.view.selected_format(), "Renamed authored format");
                    await assert.equal(state.remote.length, 1);
                    await assert.equal(state.previews[1].letterhead, "Loaded authored head");
                }
            } finally {state.close();}
        }
    `
	);
});

test("fresh custom partial and ineligible local rows retain the exact canonical read fallback", async ({
	page,
}) => {
	await run(
		page,
		letterheadHarness +
			`
        for (const kind of ["fresh", "partial", "wrong-name", "wrong-doctype", "report", "disabled", "cancelled"]) {
            const state = await letterheadView({omit: kind === "fresh"});
            try {
                const row = state.env.w.locals[":Print Format"]["Sales Order Modern"];
                if (kind === "partial") delete row.format_data;
                if (kind === "wrong-name") row.name = "Different canonical ID";
                if (kind === "wrong-doctype") row.doc_type = "Purchase Order";
                if (kind === "report") row.print_format_for = "Report";
                if (kind === "disabled") row.disabled = "1";
                if (kind === "cancelled") row.docstatus = 2;
                const selected = kind === "fresh" ? "Fresh authored format" : "Sales Order Modern";
                await state.change(selected);
                await assert.deepEqual(state.remote, [{method: "frappe.client.get", args: {doctype: "Print Format", name: selected}}]);
                await assert.equal(state.previews[0].format, selected);
                await assert.equal(state.previews[0].letterhead, "Fresh server head");
                state.setError(new Error("Original fallback denial"));
                let rejected = false;
                try {await state.view.update_letterhead_for_print_format();} catch (_) {rejected = true;}
                await assert.equal(rejected, true);
                await assert.equal(state.remote.length, 2);
                await assert.equal(state.previews.length, 1);
            } finally {state.close();}
        }
    `
	);
});

test("Standard and legacy document formats preserve default lookup and canonical format behavior", async ({
	page,
}) => {
	await run(
		page,
		letterheadHarness +
			`
        for (const selected of ["", "Standard"]) {
            const state = await letterheadView();
            try {
                await state.change(selected);
                await assert.deepEqual(state.previews, [{format: "Standard", letterhead: "Default authored head", language: "it"}]);
                await assert.equal(state.remote.length, 0);
                await assert.deepEqual(state.defaults, [["Letter Head", {disabled: 0, is_default: 1, letter_head_for: "DocType"}, "name"]]);
            } finally {state.close();}
        }
        const legacy = await letterheadView({row: {print_format_for: "", format_data: JSON.stringify({letter_head: "Legacy authored head"})}});
        try {
            await legacy.change();
            await assert.equal(legacy.remote.length, 0);
            await assert.equal(legacy.previews[0].letterhead, "Legacy authored head");
        } finally {legacy.close();}
    `
	);
});

test("actual default-letterhead work remains awaited and a missing default never clears the user's current value", async ({
	page,
}) => {
	await run(
		page,
		letterheadHarness +
			`
        let release;
        const pending = new Promise(resolve => {release = resolve;});
        const deferred = await letterheadView({row: {format_data: null}, defaultDeferred: pending});
        try {
            await deferred.change();
            await assert.equal(deferred.previews.length, 0);
            await assert.deepEqual(deferred.order, ["default-request"]);
            release({message: {name: "Deferred authored head"}});
            await ticks(); await ticks();
            await assert.deepEqual(deferred.order, ["default-request", "default-resolved", "preview"]);
            await assert.equal(deferred.previews[0].letterhead, "Deferred authored head");
        } finally {deferred.close();}
        const absent = await letterheadView({row: {format_data: null}, defaultResponse: {message: {}}});
        try {
            absent.view.letterhead_selector.val("Kept authored head");
            await absent.change();
            await assert.equal(absent.previews[0].letterhead, "Kept authored head");
        } finally {absent.close();}
        const stored = await letterheadView({row: {format_data: null}, documentHead: "Stored authored head", defaultResponse: {message: {name: "Stored authored head"}}});
        try {
            await stored.change();
            await assert.deepEqual(stored.defaults, [["Letter Head", {name: "Stored authored head", disabled: 0}, "name"]]);
            await assert.equal(stored.previews[0].letterhead, "Stored authored head");
        } finally {stored.close();}
    `
	);
});
