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
	"frappe/frappe/public/js/frappe/model/meta.js",
	"frappe/frappe/public/js/frappe/request.js",
	"frappe/frappe/public/js/frappe/form/print_utils.js",
];
const sources = Object.fromEntries(paths.map((path) => [path, read(path)]));
sources.printFormatMeta = read("frappe/frappe/printing/doctype/print_format/print_format.json");
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
 "Accounts Receivable Standard:Print Format Name": "Crediti verso clienti (standard)",
 "Accounts Payable Standard:Print Format Name": "Debiti verso fornitori (standard)",
 "Twin One:Print Format Name": "Formato identico",
 "Twin Two:Print Format Name": "Formato identico",
 'Unsafe <&">:Print Format Name': 'Formato <img src=x onerror="bad()"> & "citato"',
 "Disabled:Print Format Name": "Disattivato",
 "Denied:Print Format Name": "Negato",
 "DocType Only:Print Format Name": "Solo documento",
 "Open:Print Format Name": "Apri formato", Open: "Aperto",
};
const records = [
 {name:"Accounts Receivable Standard",standard:"Yes"},
 {name:"Accounts Payable Standard",standard:"Yes",report:"Accounts Payable"},
 {name:"Twin One",standard:"Yes"}, {name:"Twin Two",standard:"Yes"},
 {name:'Unsafe <&">',standard:"Yes"},
 {name:"Disabled",standard:"Yes",disabled:1}, {name:"Denied",standard:"Yes",permitted:false},
 {name:"DocType Only",standard:"Yes",print_format_for:"DocType",doc_type:"Sales Order"},
 {name:"Open",standard:"No"}, {name:"Crediti custom new",standard:"No"},
 {name:"Fresh custom 100%",standard:"No"},
].map(row=>({print_format_for:"Report",report:"Accounts Receivable",doc_type:null,disabled:0,...row}));

async function load({ initialRecords = [], serverRecords = records } = {}) {
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
	let data = structuredClone(serverRecords);
	w.frappe = {
		provide(path) { path.split(".").reduce((o, key) => o[key] ||= {}, w); },
		ui: { form: {} },
		pages: { print: {} },
		utils: {},
		boot: { user:{can_create:["Print Format"],can_read:["Print Format"],can_select:["Print Format"],last_selected_values:{}}, lang: "it", translated_doctypes: [], link_title_doctypes: [], sysdefaults: {}, json_request_apps: [] },
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
	w.eval(read("frappe/frappe/public/js/frappe/model/model.js"));
 w.eval(read("frappe/frappe/public/js/frappe/model/meta.js"));
 const deliveredMeta = JSON.parse(sources.printFormatMeta);
 deliveredMeta.fields = deliveredMeta.fields.map(df=>({...df,parent:"Print Format"}));
 w.locals.DocType["Print Format"] = deliveredMeta;
 w.frappe.meta.sync(deliveredMeta);
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
 const callbacks = [];
 w.locals[":Print Settings"]={"Print Settings":{}};
 w.frappe.defaults.get_default=()=>null;
 w.frappe.boot.letter_heads={};
 w.frappe.query_report={report_name:"Accounts Receivable"};
 const view=w.frappe.query_report;
 let lastDialog;
 w.frappe.prompt=(columns,callback,title)=>{
  const df=columns.find(df=>df.fieldname==="print_format");
  const field=df?w.frappe.ui.form.make_control({df,parent:w.document.getElementById("fields"),render_input:1}):null;
  if(field&&df.default)field.set_input(df.default);
  lastDialog={fields_dict:field?{print_format:field}:{},callback,columns,title};return lastDialog;
 };
 w.frappe.dom.eval(read("frappe/frappe/public/js/frappe/form/print_utils.js"));
 function control(defaultName=null,isQuery=true) {
  const d=w.frappe.ui.get_print_settings(false,settings=>callbacks.push(structuredClone(settings)),null,null,isQuery,null,defaultName);
  return d.fields_dict.print_format;
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
	return { w, $, notices, queries, calls, pending, control, view, callbacks, dialog:()=>lastDialog, search, deliver, settle,
		setRecords(value) { data = structuredClone(value); },
		close() { frame.remove(); },
	};
}
`;

async function run(page, body) {
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
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
	assert.deepEqual(errors, []);
}

test("Report on_make instance binding verifies the default and preserves callback canonical identity", async ({
	page,
}) => {
	await run(
		page,
		`const env=await load();try{
 const f=env.control("Accounts Receivable Standard");
 await assert.equal(f.input.value,"Accounts Receivable Standard");await env.settle();
 await assert.equal(f.input.value,"Crediti verso clienti (standard)");
 await assert.equal(f.get_input_value(),"Accounts Receivable Standard");
 await assert.equal(f.value,"Accounts Receivable Standard");
 await assert.equal(env.calls.length,1);
 await assert.equal(env.calls[0].endpoint,"frappe.desk.search.search_link");
 await assert.equal(env.calls[0].args.filters.report,"Accounts Receivable");
 await assert.equal(env.calls[0].args.filters.print_format_for,"Report");
 await assert.equal(env.calls[0].args.filters.standard,"Yes");
 const settings={print_format:f.get_value(),with_letter_head:0,pick_columns:1,columns:["rate"]};
 env.dialog().callback(settings);
 await assert.equal(env.callbacks[0].print_format,"Accounts Receivable Standard");
 await assert.equal(env.callbacks[0].pick_columns,0);await assert.equal(env.callbacks[0].columns,null);
 await assert.equal(env.w.locals[":Print Settings"]["Print Settings"].print_format,null);
 }finally{env.close();}`
	);
});

test("Italian search uses actual request and server dispatch with Report filters and custom primary rows", async ({
	page,
}) => {
	await run(
		page,
		`const env=await load();try{
 const f=env.control();await env.search(f,"Crediti");await env.settle();
 await assert.ok(f.awesomplete.ul.textContent.includes("Crediti verso clienti (standard)"));
 await assert.ok(f.awesomplete.ul.textContent.includes("Accounts Receivable Standard"));
 await assert.ok(f.awesomplete._list.some(row=>row.value==="Crediti custom new"));
 await assert.ok(!f.awesomplete._list.some(row=>row.value==="Accounts Payable Standard"));
 await assert.ok(!f.awesomplete._list.some(row=>row.value==="Disabled"||row.value==="Denied"||row.value==="DocType Only"));
 await assert.equal(env.queries.length,2);
 await assert.ok(env.queries.every(q=>q.ignore_permissions===false&&!q.ignore_user_permissions));
 await assert.equal(env.calls[1].args.txt,"Crediti");
 await assert.equal(env.calls[0].args.page_length,Object.keys(messages).filter(k=>k.endsWith(":Print Format Name")).length);
 }finally{env.close();}`
	);
});

test("only Report selector instance changes and custom canonical collisions remain authored", async ({
	page,
}) => {
	await run(
		page,
		`const env=await load();try{
 const f=env.control();const plain=env.w.frappe.ui.form.make_control({df:{fieldtype:"Link",fieldname:"ordinary",options:"Print Format"},parent:env.w.document.getElementById("fields"),render_input:1});
 await assert.ok(!Object.hasOwn(plain,"on_input"));
 f.set_input("Open");await assert.equal(f.input.value,"Open");
 await env.search(f,"Open");await env.settle();
 await assert.ok(f.awesomplete._list.some(row=>row.value==="Open"));
 await assert.equal(f.get_translated("Open"),"Open");
 plain.set_input("Accounts Receivable Standard");await assert.equal(plain.input.value,"Accounts Receivable Standard");
 await assert.equal(env.control(null,false),undefined);
 }finally{env.close();}`
	);
});

test("equal captions retain distinct canonical rows, escaped secondary names and real keyboard validation", async ({
	page,
}) => {
	await run(
		page,
		`const env=await load();try{
 const f=env.control();await env.search(f,"Formato");await env.settle();
 await assert.ok(f.awesomplete._list.some(row=>row.value==="Twin One"));
 await assert.ok(f.awesomplete._list.some(row=>row.value==="Twin Two"));
 await assert.ok(f.awesomplete.ul.textContent.includes("Twin One"));await assert.ok(f.awesomplete.ul.textContent.includes("Twin Two"));
 await assert.ok(!f.awesomplete.ul.querySelector("img"));
 const index=Array.from(f.awesomplete.ul.children).findIndex(element=>element.textContent.includes("Twin Two"));
 await assert.ok(index>=0);
 f.awesomplete.goto(index);
 f.input.dispatchEvent(new env.w.KeyboardEvent("keydown",{key:"Enter",keyCode:13,bubbles:true,cancelable:true}));
 await ticks();await env.settle();
 await assert.equal(f.value,"Twin Two");await assert.equal(f.get_input_value(),"Twin Two");
 await assert.equal(f.input.value,"Formato identico");
 await assert.ok(env.calls.some(call=>call.endpoint==="frappe.client.validate_link_and_fetch"&&call.args.docname==="Twin Two"));
 }finally{env.close();}`
	);
});

test("current Report namespace and metadata source changes revoke prior verified display", async ({
	page,
}) => {
	await run(
		page,
		`const env=await load();try{
 const f=env.control();await env.search(f,"Crediti");await env.settle();
 await assert.equal(f.get_translated("Accounts Receivable Standard"),"Crediti verso clienti (standard)");
 env.view.report_name="Accounts Payable";
 await assert.equal(f.get_translated("Accounts Receivable Standard"),"Accounts Receivable Standard");
 await env.search(f,"Debiti");await env.settle();
 await assert.ok(f.awesomplete._list.some(row=>row.value==="Accounts Payable Standard"));
 env.w.locals[":Print Format"]["Accounts Payable Standard"]={name:"Accounts Payable Standard",standard:"No",disabled:0,print_format_for:"Report",report:"Accounts Payable"};
 await assert.equal(f.get_translated("Accounts Payable Standard"),"Accounts Payable Standard");
 env.w.locals[":Print Format"]["Accounts Payable Standard"].standard="Yes";
 env.w.locals[":Print Format"]["Accounts Payable Standard"].disabled=1;
 await assert.equal(f.get_translated("Accounts Payable Standard"),"Accounts Payable Standard");
 }finally{env.close();}`
	);
});

test("changed locale and dedicated message values invalidate stored choices", async ({ page }) => {
	await run(
		page,
		`const env=await load();try{
 const f=env.control();await env.search(f,"Crediti");await env.settle();
 env.w.frappe.boot.lang="fr";env.w.frappe._messages["Accounts Receivable Standard:Print Format Name"]="Créances clients";
 await assert.equal(f.get_translated("Accounts Receivable Standard"),"Accounts Receivable Standard");
 await env.search(f,"Créances");await env.settle();
 await assert.equal(f.get_translated("Accounts Receivable Standard"),"Créances clients");
 await assert.ok(f.awesomplete.ul.textContent.includes("Créances clients"));
 }finally{env.close();}`
	);
});

test("late default query never overwrites typed text and source failure keeps fresh canonical primary behavior", async ({
	page,
}) => {
	await run(
		page,
		`const env=await load();try{
 const f=env.control("Accounts Receivable Standard");
 await env.search(f,"Fresh");
 if(env.pending.length>1){await env.deliver(1);await env.deliver(0);}else await env.deliver(0);
 await env.settle();
 await assert.equal(f.input.value,"Fresh");
 await assert.ok(f.awesomplete._list.some(row=>row.value==="Fresh custom 100%"));
 await env.search(f,"Open");
 const failureIndex=env.pending.findIndex(delivery=>delivery.call.args.filters.standard==="Yes");
 if(failureIndex>=0){const [failure]=env.pending.splice(failureIndex,1);failure.fail();await ticks();}
 await env.settle();
 await assert.ok(f.awesomplete._list.some(row=>row.value==="Open"));
 await assert.ok(JSON.stringify(env.notices).includes("Genuine source failure"));
 }finally{env.close();}`
	);
});
test("present inconsistent or renamed local metadata cannot authorize a standard caption", async ({
	page,
}) => {
	await run(
		page,
		`const env=await load();try{
 const f=env.control();await env.search(f,"Crediti");await env.settle();
 const name="Accounts Receivable Standard";
 await assert.equal(f.get_translated(name),"Crediti verso clienti (standard)");
 env.w.locals[":Print Format"][name]={name:"Renamed format",standard:"Yes",disabled:0,print_format_for:"Report",report:"Accounts Receivable"};
 f.set_input(name);await assert.equal(f.input.value,name);await assert.equal(f.get_input_value(),name);
 env.w.locals[":Print Format"][name].name=name;
 f.set_input(name);await assert.equal(f.input.value,"Crediti verso clienti (standard)");
 env.w.locals[":Print Format"][name].name="Local rename";
 f.set_input(name);await assert.equal(f.input.value,name);
 }finally{env.close();}`
	);
});

test("partial, custom, wrong-namespace and missing-message defaults stay canonical", async ({
	page,
}) => {
	await run(
		page,
		`const name="Accounts Receivable Standard";
 for(const row of [
 {name},
 {name,standard:"No",disabled:0,print_format_for:"Report",report:"Accounts Receivable"},
 {name,standard:"Yes",disabled:0,print_format_for:"DocType",report:"Accounts Receivable"},
 {name,standard:"Yes",disabled:0,print_format_for:"Report",report:"Accounts Payable"},
 {name,standard:"Yes",disabled:1,print_format_for:"Report",report:"Accounts Receivable"},
 ]) {const env=await load({initialRecords:[row]});try{
 const f=env.control(name);await env.settle();await assert.equal(f.input.value,name);await assert.equal(f.value,name);
 }finally{env.close();}}
 const env=await load();try{
 delete env.w.frappe._messages[name+":Print Format Name"];
 const f=env.control(name);await env.settle();await assert.equal(f.input.value,name);await assert.equal(f.value,name);
 }finally{env.close();}`
	);
});

test("absent Report namespace declines captions while retaining the original empty Report query", async ({
	page,
}) => {
	await run(
		page,
		`for(const missing of [false,true]){const env=await load();try{
 if(missing)delete env.w.frappe.query_report;else env.view.report_name="";
 const f=env.control("Accounts Receivable Standard");await env.settle();
 await assert.equal(f.input.value,"Accounts Receivable Standard");
 await env.search(f,"Accounts");await env.settle();
 await assert.ok(env.calls.every(call=>call.args.filters.report===""));
 await assert.equal(f.get_translated("Accounts Receivable Standard"),"Accounts Receivable Standard");
 }finally{env.close();}}`
	);
});

test("repeated refresh retains one input binding and keeps the default canonical model", async ({
	page,
}) => {
	await run(
		page,
		`const env=await load();try{
 const f=env.control("Accounts Receivable Standard");await env.settle();
 const before=env.w.jQuery._data(f.input,"events").input.length;
 for(let n=0;n<3;n++)f.refresh();
 await assert.equal(env.w.jQuery._data(f.input,"events").input.length,before);
 await assert.equal(f.input.value,"Crediti verso clienti (standard)");
 await assert.equal(f.value,"Accounts Receivable Standard");
 const start=env.calls.length;await env.search(f,"Debiti");await env.settle();
 await assert.equal(env.calls.length-start,2);
 }finally{env.close();}`
	);
});

test("out-of-order supplemental responses keep only the current term's verified choices", async ({
	page,
}) => {
	await run(
		page,
		`const env=await load();try{
 const f=env.control();await env.search(f,"Debiti");await env.search(f,"Crediti");
 await env.deliver(1);await env.deliver(0);await env.settle();
 await assert.ok(f.awesomplete._list.some(row=>row.value==="Accounts Receivable Standard"));
 await assert.ok(!f.awesomplete._list.some(row=>row.value==="Accounts Payable Standard"));
 await assert.equal(f.input.value,"Crediti");
 }finally{env.close();}`
	);
});

test("a detached field never starts a primary search after the new supplement resolves", async ({
	page,
}) => {
	await run(
		page,
		`const env=await load();try{
 const f=env.control();await env.search(f,"Crediti");f.$wrapper.remove();await env.settle();
 await assert.equal(env.calls.length,1);await assert.equal(f.value,null);
 }finally{env.close();}`
	);
});

test("lost focus or edited text prevents a late supplement from starting a stale primary request", async ({
	page,
}) => {
	await run(
		page,
		`for(const blur of [true,false]){const env=await load();try{
 const f=env.control();await env.search(f,"Crediti");
 if(blur)env.w.document.getElementById("outside").focus();else f.$input.val("changed text");
 await env.settle();
 await assert.equal(env.calls.filter(call=>call.endpoint==="frappe.desk.search.search_link").length,1);
 const validations=env.calls.filter(call=>call.endpoint==="frappe.client.validate_link_and_fetch");
 await assert.equal(validations.length,blur?1:0);
 if(blur)await assert.equal(validations[0].args.docname,"Crediti");
 else await assert.equal(f.input.value,"changed text");
 }finally{env.close();}}`
	);
});

test("supplement completion exceeds the primary page limit without broadening its canonical query", async ({
	page,
}) => {
	await run(
		page,
		`const rows=Array.from({length:16},(_,n)=>({name:"Canonical "+n,standard:"Yes",disabled:0,print_format_for:"Report",report:"Accounts Receivable",doc_type:null}));
 const env=await load({serverRecords:rows});try{
 rows.forEach((row,n)=>env.w.frappe._messages[row.name+":Print Format Name"]="Formato numero "+n);
 const f=env.control();await env.search(f,"Formato numero");await env.settle();
 await assert.equal(f.awesomplete._list.filter(row=>rows.some(record=>record.name===row.value)).length,16);
 await assert.equal(env.calls[1].args.page_length,10);
 await assert.equal(env.calls[1].args.txt,"Formato numero");
 await assert.ok(!Object.hasOwn(env.calls[1].args.filters,"standard"));
 await assert.ok(!Object.hasOwn(env.calls[1].args.filters,"name"));
 await assert.ok(env.calls[0].args.page_length>=16);
 }finally{env.close();}`
	);
});

test("server LIKE matches, canonical duplicates and action rows retain their original meanings", async ({
	page,
}) => {
	await run(
		page,
		`const env=await load();try{
 const f=env.control();
 env.w.frappe.ui.form.ControlLink.link_options=()=>[{value:"custom-action",label:"Custom action",action(){throw Error("must not invoke");}}];
 await env.search(f,"Fr_sh");await env.settle();
 await assert.ok(f.awesomplete._list.some(row=>row.value==="Fresh custom 100%"));
 await assert.ok(f.awesomplete._list.some(row=>row.value==="create_new__link_option"));
 await assert.ok(f.awesomplete._list.some(row=>row.value==="advanced_search__link_option"));
 await assert.ok(f.awesomplete._list.some(row=>row.value==="custom-action"));
 await assert.equal(env.calls.at(-1).args.txt,"Fr_sh");
 await env.search(f,"Accounts Receivable");await env.settle();
 await assert.equal(f.awesomplete._list.filter(row=>row.value==="Accounts Receivable Standard").length,1);
 }finally{env.close();}`
	);
});

test("selected translated caption survives native blur and raw custom blur validates unchanged", async ({
	page,
}) => {
	await run(
		page,
		`const env=await load();try{
 const f=env.control();await env.search(f,"Crediti");await env.settle();
 const index=Array.from(f.awesomplete.ul.children).findIndex(element=>element.textContent.includes("Accounts Receivable Standard"));
 await assert.ok(index>=0);f.awesomplete.goto(index);
 f.input.dispatchEvent(new env.w.KeyboardEvent("keydown",{key:"Enter",keyCode:13,bubbles:true,cancelable:true}));await ticks();await env.settle();
 env.w.document.getElementById("outside").focus();await ticks();await env.settle();
 await assert.equal(f.input.value,"Crediti verso clienti (standard)");await assert.equal(f.value,"Accounts Receivable Standard");
 f.input.focus();f.$input.val("Open");env.w.document.getElementById("outside").focus();await ticks();await env.settle();
 await assert.equal(f.value,"Open");await assert.equal(f.input.value,"Open");
 await assert.ok(env.calls.some(call=>call.endpoint==="frappe.client.validate_link_and_fetch"&&call.args.docname==="Open"));
 }finally{env.close();}`
	);
});
