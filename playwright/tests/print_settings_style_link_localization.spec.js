// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
// License: MIT. See LICENSE

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const { test } = require("@playwright/test");
const path = require("node:path");
const APP = process.env.PRINT_SETTINGS_LINK_SOURCE || path.resolve(__dirname, "../..");
const PYTHON = process.env.PYTHON || path.resolve(APP, "../../env/bin/python");
const SITES = process.env.PRINT_SETTINGS_LINK_SITES || path.resolve(APP, "../../sites");
const PROVIDER = String.raw`import json
import os
import re
import sys
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from werkzeug.datastructures import Headers

import frappe
import frappe.handler
import frappe.translate
import frappe.utils
from frappe.model.meta import Meta


ALLOWED_ENDPOINTS = (
    "frappe.printing.page.print.print.get_print_styles",
    "frappe.desk.search.search_link",
    "frappe.client.validate_link_and_fetch",
)
QUERY = "style_memory.custom_query"


def provide(payload):
    endpoint = payload["endpoint"]
    assert endpoint in ALLOWED_ENDPOINTS
    args = deepcopy(payload.get("args", {}))
    assert args.get("doctype", "Print Style") == "Print Style"
    records = deepcopy(payload["records"])
    messages = dict(payload.get("messages", {}))
    assert len({row["name"] for row in records}) == len(records)
    metadata = json.loads(Path(frappe.get_app_path("frappe", "printing/doctype/print_style/print_style.json")).read_text())
    meta = Meta.__new__(Meta)
    meta.__dict__.update(metadata)
    meta.fields = [frappe._dict(field) for field in metadata["fields"]]
    for name in ("title_field", "search_fields", "translated_doctype", "show_title_field_in_link", "issingle", "is_virtual"):
        meta.__dict__.setdefault(name, None)
    lists, apis, customs, values, dictionaries = [], [], [], [], []

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
            regex = "".join(".*" if c == "%" else "." if c == "_" else re.escape(c) for c in value)
            return re.fullmatch(regex, str(actual), re.I) is not None
        raise AssertionError(("Unexpected memory filter", condition))

    def get_list(doctype, **kwargs):
        assert doctype == "Print Style"
        assert kwargs["ignore_permissions"] is False
        assert kwargs["ignore_user_permissions"] is False
        lists.append(deepcopy(kwargs))
        if payload.get("deny_all"):
            raise frappe.PermissionError("Memory permission denial")
        rows = [
            row for row in records
            if row.get("permitted", True)
            and all(matches(row, f) for f in kwargs["filters"])
            and (not kwargs["or_filters"] or any(matches(row, f) for f in kwargs["or_filters"]))
        ]
        # Actual search.py asks the leaf for the original metadata sort and paging.
        rows.sort(key=lambda row: row.get("creation", ""), reverse=True)
        start, limit = kwargs["limit_start"], kwargs["limit_page_length"]
        rows = rows[start:] if limit is None else rows[start:start + limit]
        assert kwargs["as_list"] is True
        return [[row["name"], *([1] if any(isinstance(field, dict) for field in kwargs["fields"]) else [])] for row in rows]

    def get_all(doctype, **kwargs):
        assert doctype == "Print Style"
        apis.append(deepcopy(kwargs))
        filters = kwargs["filters"]
        assert filters.get("disabled") == 0
        if "name" in filters:
            assert set(filters) == {"disabled", "name"}
            operator, names = filters["name"]
            assert operator == "in" and 0 < len(names) <= 10
            assert all(isinstance(name, str) for name in names)
            assert kwargs["limit_page_length"] == len(names)
        else:
            assert filters == {"disabled": 0}
            names = None
            assert "limit_page_length" not in kwargs
        assert kwargs["order_by"] == "creation asc"
        # This API intentionally uses get_all, not permission-scoped get_list.
        rows = sorted((row for row in records if row.get("disabled", 0) == 0 and (names is None or row["name"] in names)), key=lambda row: row.get("creation", ""))
        if names is not None:
            rows = rows[:kwargs["limit_page_length"]]
        if kwargs.get("pluck"):
            assert kwargs["pluck"] == "name"
            return [row["name"] for row in rows]
        assert kwargs["fields"] == ["name", "standard"]
        return [frappe._dict({key: row.get(key) for key in kwargs["fields"]}) for row in rows]

    def database_value(doctype, name, fields, **kwargs):
        assert doctype == "Print Style"
        values.append({"doctype": doctype, "name": name, "fields": fields, "kwargs": kwargs})
        row = next((row for row in records if row["name"] == name), None)
        return frappe._dict({field: row.get(field) for field in fields}) if row else None

    def dictionary(lang):
        dictionaries.append(lang)
        return messages if lang == "it" else {}

    @frappe.whitelist()
    def custom_query(doctype, txt, searchfield, start, page_len, filters, **kwargs):
        assert doctype == "Print Style"
        customs.append({"doctype": doctype, "txt": txt, "searchfield": searchfield, "start": start, "page_len": page_len, "filters": deepcopy(filters), "kwargs": kwargs})
        return deepcopy(payload.get("custom_results", []))

    original_attr = frappe.get_attr

    def get_attr(name):
        return custom_query if name == QUERY else original_attr(name)

    def get_meta(doctype, *args, **kwargs):
        assert doctype == "Print Style"
        return meta

    def blocked(name):
        def stop(*args, **kwargs):
            raise AssertionError("Unexpected database operation: " + name)
        return stop

    class Database:
        escape = staticmethod(repr)
        get_value = staticmethod(database_value)
        get_global = staticmethod(lambda key: None)

        def __getattr__(self, name):
            return blocked(name)

    frappe.local.session = frappe._dict(user="translator@example.com", data=frappe._dict())
    frappe.local.flags = frappe._dict()
    frappe.local.conf = frappe._dict()
    frappe.local.lang = "it"
    frappe.local.form_dict = frappe._dict(args)
    frappe.local.request = frappe._dict(method=payload.get("method", "POST"), path="/api/method/" + endpoint)
    frappe.local.response_headers = Headers()
    if hasattr(frappe.local, "job"):
        del frappe.local.job
    with (
        patch.object(frappe, "db", Database()),
        patch.object(frappe, "get_hooks", return_value=frappe._dict()),
        patch.object(frappe, "get_installed_apps", return_value=["frappe"]),
        patch.object(frappe, "get_meta", side_effect=get_meta),
        patch.object(frappe, "get_list", side_effect=get_list),
        patch.object(frappe, "get_all", side_effect=get_all),
        patch.object(frappe, "get_attr", side_effect=get_attr),
        patch.object(frappe.utils, "get_attr", side_effect=get_attr),
        patch.object(frappe, "is_table", return_value=False),
        patch.object(frappe.translate, "get_all_translations", side_effect=dictionary),
        patch.object(frappe.handler, "get_server_script_map", return_value={}),
    ):
        try:
            result = frappe.handler.execute_cmd(endpoint)
            error = None
        except frappe.PermissionError as exc:
            result = None
            error = {"type": type(exc).__name__, "message": str(exc)}
    return {"message": result, "error": error, "queries": lists, "api_queries": apis, "custom_queries": customs, "value_reads": values, "dictionary_reads": dictionaries, "request_args": args, "raw_records_unchanged": records == payload["records"], "identity": "translator@example.com", "live_QA_authorization_claim": False}


def main():
    frappe.init(site="", sites_path=os.environ["PRINT_SETTINGS_LINK_SITES"])
    try:
        print(json.dumps(provide(json.load(sys.stdin)), ensure_ascii=False, default=str))
    finally:
        frappe.destroy()


if __name__ == "__main__":
    main()
`;
const paths = [
	"utils/utils.js",
	"translate.js",
	"dom.js",
	"model/model.js",
	"model/meta.js",
	"model/sync.js",
	"request.js",
	"form/controls/base_control.js",
	"form/controls/base_input.js",
	"form/controls/data.js",
	"form/controls/link.js",
	"form/controls/control.js",
	"form/layout.js",
	"form/section.js",
	"form/column.js",
	"form/tab.js",
	"form/form.js",
	"form/undo_manager.js",
	"form/script_manager.js",
	"ui/awesomplete.js",
];
const sources = Object.fromEntries(
	paths.map((p) => [p, fs.readFileSync(APP + "/frappe/public/js/frappe/" + p, "utf8")])
);
sources.jquery = fs.readFileSync(require.resolve("jquery"), "utf8");
sources.awesomplete = fs.readFileSync(require.resolve("awesomplete"), "utf8");
sources.settings = JSON.parse(
	fs.readFileSync(APP + "/frappe/printing/doctype/print_settings/print_settings.json", "utf8")
);
sources.style = JSON.parse(
	fs.readFileSync(APP + "/frappe/printing/doctype/print_style/print_style.json", "utf8")
);
sources.settingsScript = fs.readFileSync(
	APP + "/frappe/printing/doctype/print_settings/print_settings.js",
	"utf8"
);
const messages = process.env.PRINT_SETTINGS_LINK_MESSAGES
	? JSON.parse(fs.readFileSync(process.env.PRINT_SETTINGS_LINK_MESSAGES, "utf8")).messages
	: {
			"Redesign:Print Style": "Rinnovato",
			"Modern:Print Style": "Moderno",
			"Classic:Print Style": "Classico",
			"Striped:Print Style": "Righe alternate",
			"Monochrome:Print Style": "Monocromatico",
	  };
const records = [
	{ name: "Redesign", standard: 1 },
	{ name: "Modern", standard: 1 },
	{ name: "Classic", standard: 1 },
	{ name: "Striped", standard: 1 },
	{ name: "Monochrome", standard: 1 },
	{ name: "Classico custom", standard: 0 },
	{ name: "Fresh 100%", standard: 0 },
	{ name: "Unknown standard", standard: 1 },
].map((r, i) => ({
	doctype: "Print Style",
	disabled: 0,
	preview: "",
	print_style_name: r.name,
	creation: String(i),
	...r,
}));

async function run(page, body, options = {}) {
	await page.route("**/*", (r) => r.abort());
	await page.setContent(
		'<!doctype html><body><div id="form"></div><button id="outside">Outside</button></body>'
	);
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.exposeFunction("memoryRpc", (payload) =>
		JSON.parse(
			execFileSync(PYTHON, ["-c", PROVIDER], {
				input: JSON.stringify(payload),
				encoding: "utf8",
				env: { ...process.env, PYTHONPATH: APP, PRINT_SETTINGS_LINK_SITES: SITES },
			})
		)
	);
	let failure;
	try {
		await page.evaluate(
			async ({ sources, messages, records, options, body }) => {
				const w = window;
				w.eval(sources.jquery);
				const $ = w.jQuery;
				$.fn.tooltip = function () {
					return this;
				};
				$.format = (s, args) => s.replace(/\{(\d+)\}/g, (_, i) => args[i]);
				w.cstr = (v) => (v == null ? "" : String(v));
				w.cint = (v) => parseInt(v || 0, 10);
				w.is_null = (v) => v == null || v === "";
				w.copy_dict = (v) => ({ ...v });
				w.strip_html = (v) => $("<div>").html(v).text();
				w.cur_frm = null;
				w.locals = {
					DocType: {},
					"Print Settings": {
						"Print Settings": {
							doctype: "Print Settings",
							name: "Print Settings",
							docstatus: 0,
							print_style: options.initial || "Redesign",
						},
					},
				};
				const calls = [],
					queries = [],
					pending = [],
					notices = [],
					previews = [],
					onMakes = [];
				let data = structuredClone(options.records || records);
				w.frappe = {
					provide(p) {
						p.split(".").reduce((o, k) => (o[k] ||= {}), w);
					},
					ui: { form: {} },
					utils: {},
					model: {},
					meta: {},
					views: {},
					flags: {},
					boot: {
						lang: options.lang || "it",
						user: {
							can_create: ["Print Style"],
							can_read: ["Print Style"],
							can_select: ["Print Style"],
							last_selected_values: {},
						},
						translated_doctypes: [],
						link_title_doctypes: [],
						sysdefaults: {},
						json_request_apps: [],
						desk_settings: {},
					},
					_messages: options.empty ? {} : { ...messages, ...options.messages },
					defaults: { is_enabled: () => true, get_default: () => null },
					get_route: () => [],
					session: {
						user: "translator@example.com",
						logged_in_user: "translator@example.com",
					},
					is_online: () => true,
					msgprint: (v) => notices.push(v),
					hide_msgprint() {},
					show_alert: (v) => notices.push(v),
					perm: {
						get_field_display_status: () => (options.readOnly ? "Read" : "Write"),
						get_perm: () => [{ read: 1, write: 1 }],
					},
					db: {
						get_value: async (...args) => {
							previews.push(args);
							return { message: { preview: "" } };
						},
					},
				};
				w.eval(sources["utils/utils.js"].replace(/^import .*;\n/gm, ""));
				w.frappe.utils.icon = () => "<svg></svg>";
				w.frappe.format = (v) => v || "";
				w.eval(sources["translate.js"]);
				const dom = sources["dom.js"];
				w.eval(
					dom.slice(
						dom.indexOf("frappe.run_serially ="),
						dom.indexOf("frappe.load_image =")
					)
				);
				w.frappe.dom = {};
				w.eval(
					`Object.assign(frappe.dom,{${dom.slice(
						dom.indexOf("eval: function (txt)"),
						dom.indexOf("remove_script_and_style: function")
					)}});`
				);
				w.eval(sources.awesomplete);
				w.BaseAwesomplete = w.Awesomplete;
				w.eval(
					sources["ui/awesomplete.js"]
						.replace('import BaseAwesomplete from "awesomplete";', "")
						.replace("export default class Awesomplete", "class Awesomplete")
				);
				for (const p of [
					"form/controls/base_control.js",
					"form/controls/base_input.js",
					"form/controls/data.js",
					"form/controls/link.js",
					"model/model.js",
					"model/meta.js",
					"model/sync.js",
					"form/controls/control.js",
				])
					w.eval(sources[p].replace(/^import .*;\n/gm, ""));
				const settings = structuredClone(sources.settings);
				settings.fields = settings.fields
					.filter((df) => df.fieldname === "print_style")
					.map((df) => ({ ...df, parent: "Print Settings", ...options.df }));
				if (options.onMake)
					settings.fields[0].on_make = (f) => {
						onMakes.push(f.df.fieldname);
						if (options.onMake === "custom-input")
							f.on_input = function () {
								calls.push({ custom_input: true });
							};
					};
				settings.__js = sources.settingsScript;
				const style = structuredClone(sources.style);
				style.fields = style.fields.map((df) => ({ ...df, parent: "Print Style" }));
				for (const meta of [settings, style]) {
					w.locals.DocType[meta.name] = meta;
					w.frappe.meta.sync(meta);
				}
				w.locals["Print Style"] = Object.fromEntries(
					(options.localRecords || []).map((row) => [row.name, { ...row }])
				);
				w.eval(sources["request.js"]);
				$.ajax = (opts) => {
					const deferred = $.Deferred();
					const args =
						typeof opts.data === "string" ? JSON.parse(opts.data) : { ...opts.data };
					for (const [k, v] of Object.entries(args))
						if (typeof v === "string" && ["filters", "fields_to_fetch"].includes(k))
							args[k] = JSON.parse(v);
					const call = {
						endpoint: opts.url.replace("/api/method/", ""),
						method: opts.type,
						args,
					};
					calls.push(call);
					const xhr = {
						status: 200,
						statusCode() {
							return this;
						},
						getResponseHeader: () => "application/json",
						responseText: "{}",
					};
					const delivery = {
						call,
						async succeed(override) {
							const out =
								override ||
								(await w.memoryRpc({
									...call,
									records: data,
									messages: w.frappe._messages,
								}));
							queries.push(...(out.queries || []));
							if (out.error) throw Error(JSON.stringify(out.error));
							if (
								out.response &&
								(!options.reload ||
									call.endpoint !== "frappe.desk.form.load.getdoc" ||
									call.method !== "GET" ||
									args.doctype !== "Print Settings" ||
									args.name !== "Print Settings")
							)
								throw Error("Unexpected full-response memory leaf");
							deferred.resolve(
								out.response || { message: out.message },
								"success",
								xhr
							);
						},
						fail() {
							xhr.status = 0;
							xhr.responseJSON = { message: "Memory failure" };
							xhr.responseText = JSON.stringify(xhr.responseJSON);
							deferred.reject(xhr, "error");
						},
					};
					pending.push(delivery);
					return deferred.promise();
				};
				for (const p of ["form/section.js", "form/column.js", "form/tab.js"])
					w.eval(
						sources[p].replace(
							"export default class ",
							`window.${p
								.split("/")
								.pop()
								.split(".")[0]
								.replace(/^./, (v) => v.toUpperCase())} = class `
						)
					);
				w.eval(sources["form/layout.js"].replace(/^import .*;\n/gm, ""));
				w.eval(
					sources["form/undo_manager.js"].replace(
						"export class UndoManager",
						"window.UndoManager = class UndoManager"
					)
				);
				w.eval(sources["form/form.js"].replace(/^import .*;\n/gm, ""));
				w.eval(sources["form/script_manager.js"]);
				w.frappe.ui.form.Dashboard = class {};
				w.frappe.ui.form.FormTour = class {};
				w.frappe.ui.form.States = class {};
				const frm = new w.frappe.ui.form.Form("Print Settings", $("#form"), false, null);
				Object.assign(frm, {
					doctype: "Print Settings",
					docname: "Print Settings",
					doc: w.locals["Print Settings"]["Print Settings"],
					meta: settings,
					layout_main: $("#form"),
					cscript: {},
					events: {},
					script_manager: null,
					perm: [{ read: 1, write: 1 }],
					doctype_layout: null,
					$wrapper: $("#form"),
				});
				frm.setup_std_layout();
				const field = frm.fields_dict.print_style;
				const preview = { $wrapper: $("<div>") };
				const original_get_field = frm.get_field;
				frm.get_field = function (name) {
					return name === "print_style_preview"
						? preview
						: original_get_field.call(this, name);
				};
				if (options.translatedOverride)
					field.get_translated = (value) => "AUTHORED " + value;
				if (options.getQuery)
					field.get_query = () => ({
						query: "style_memory.custom_query",
						filters: { standard: 1 },
					});
				if (options.searchArgs)
					field.get_search_args = function (term) {
						return {
							...w.frappe.ui.form.ControlLink.prototype.get_search_args.call(
								this,
								term
							),
							filters: { standard: 1 },
						};
					};
				if (options.made) frm.layout.refresh(frm.doc);
				frm.script_manager = new w.frappe.ui.form.ScriptManager({ frm });
				w.cur_frm = frm;
				frm.script_manager.setup();
				frm.watch_model_updates();
				if (options.reload) {
					w.frappe.views.formview = { "Print Settings": { frm } };
					w.frappe.workflow = { is_read_only: () => false };
					w.frappe.route_hooks = {};
					Object.assign(frm, {
						setup_done: true,
						wrapper: $("#form")[0],
						page: { sidebar: $("<div>"), page_actions: $("<div>") },
					});
					frm.opendocs[frm.docname] = true;
					frm.refresh_header = () => {};
					frm.dashboard.after_refresh = () => {};
				}
				const tick = async () => {
					await new Promise((r) => setTimeout(r, 10));
				};
				async function deliver(index = 0, override) {
					const [d] = pending.splice(index, 1);
					if (!d) throw Error("No pending request");
					await d.succeed(override);
					await tick();
					return d.call;
				}
				async function settle() {
					await tick();
					for (let n = 0; n < 30 && pending.length; n++) await deliver();
					if (pending.length) throw Error("Unsettled memory requests");
				}
				async function onload() {
					await frm.script_manager.trigger("onload");
					await tick();
				}
				async function search(term) {
					field.input.focus();
					field.$input.val(term);
					field.input.dispatchEvent(new Event("input", { bubbles: true }));
					field._debounced_input_handler.flush();
					await tick();
				}
				const env = {
					w,
					$,
					frm,
					field,
					calls,
					queries,
					pending,
					notices,
					previews,
					onMakes,
					onload,
					deliver,
					settle,
					search,
					tick,
					records: () => data,
					setRecords(r) {
						data = structuredClone(r);
					},
					make() {
						frm.layout.refresh(frm.doc);
					},
					inputHandlers() {
						return ($._data(field.input, "events")?.input || []).map((h) => h.handler);
					},
				};
				const eq = (a, b, msg = "") => {
					if (JSON.stringify(a) !== JSON.stringify(b))
						throw Error(msg + "\n" + JSON.stringify(a) + " != " + JSON.stringify(b));
				};
				const ok = (v, msg = "") => {
					if (!v) throw Error(msg);
				};
				await new Function("env", "eq", "ok", `return(async()=>{${body}})();`)(
					env,
					eq,
					ok
				);
			},
			{ sources, messages, records, options, body }
		);
	} catch (error) {
		failure = error;
	}
	assert.deepEqual(errors, []);
	if (failure) throw failure;
}

test("actual not-made Form/Layout onload creates one contextual input preserving canonical value", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();eq(env.field.input.value,'Rinnovato');eq(env.field.get_input_value(),'Redesign');eq(env.frm.doc.print_style,'Redesign');eq(env.inputHandlers().length,1);eq(env.previews[0],['Print Style','Redesign','preview']);`
	);
});
test("already-made Form/Layout input is rebound once across repeated onload setup", async ({
	page,
}) => {
	await run(
		page,
		`const initial=env.field._debounced_input_handler;await env.onload();await env.settle();eq(env.field.input.value,'Rinnovato');ok(initial!==env.field._debounced_input_handler);const current=env.field._debounced_input_handler;await env.onload();await env.settle();await env.onload();await env.settle();eq(env.field._debounced_input_handler,current);eq(env.inputHandlers().length,1);await env.search('Rinnov');await env.settle();ok(env.field.awesomplete._list.some(r=>r.value==='Redesign'));eq(env.frm.doc.print_style,'Redesign');`,
		{ made: true }
	);
});

test("Italian autocomplete keeps fresh custom primary rows plus permission-checked canonical supplement", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();await env.search('Classico');await env.settle();const values=env.field.awesomplete._list.map(r=>r.value);ok(values.includes('Classic'),'standard supplement');ok(values.includes('Classico custom'),'authored primary');ok(env.queries.every(q=>q.ignore_permissions===false&&!q.ignore_user_permissions));const primary=env.calls.find(c=>c.args.txt==='Classico');eq(primary.args.doctype,'Print Style');eq(primary.args.reference_doctype,'Print Settings');eq(primary.args.link_fieldname,'print_style');ok(env.field.awesomplete.ul.textContent.includes('Classico'));ok(env.field.awesomplete.ul.textContent.includes('Classic'));eq(env.frm.doc.print_style,'Redesign');`
	);
});
test("custom canonical-name record and unknown standard remain authored without dictionary-only authorization", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();eq(env.field.input.value,'Classic');eq(env.field.get_translated('Unknown standard'),'Unknown standard');eq(env.field.get_input_value(),'Classic');`,
		{
			initial: "Classic",
			records: records.map((r) => (r.name === "Classic" ? { ...r, standard: 0 } : r)),
			messages: { "Unknown standard:Print Style": "Sconosciuto" },
		}
	);
});
test("label API never permits denied or disabled rows as supplemental choices", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();eq(env.field.input.value,'Classic');await env.search('Classico');await env.settle();ok(!env.field.awesomplete._list.some(r=>r.value==='Classic'||r.value==='Striped'));eq(env.field.get_translated('Classic'),'Classic');eq(env.field.get_translated('Striped'),'Striped');`,
		{
			initial: "Classic",
			records: records.map((r) =>
				r.name === "Classic"
					? { ...r, permitted: false }
					: r.name === "Striped"
					? { ...r, disabled: 1 }
					: r
			),
		}
	);
});
test("fresh local standard0 or disabled metadata invalidates old positive caption immediately", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();eq(env.field.get_translated('Redesign'),'Rinnovato');env.w.locals['Print Style'].Redesign={name:'Redesign',standard:0,disabled:0};eq(env.field.get_translated('Redesign'),'Redesign');env.field.set_input('Redesign');eq(env.field.input.value,'Redesign');eq(env.frm.doc.print_style,'Redesign');`
	);
});
test("empty dictionary and English fallback preserve canonical values and original search", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();eq(env.field.input.value,'Redesign');await env.search('Classic');await env.settle();ok(env.field.awesomplete._list.some(r=>r.value==='Classic'));eq(env.field.get_value(),'Classic');eq(env.frm.doc.print_style,'Redesign');`,
		{ empty: true, lang: "en" }
	);
});
test("explicit query override is declined and original query/filter/reference contract retained", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();await env.settle();ok(!env.field._print_settings_style_labels);eq(env.field.input.value,'Redesign');await env.search('typed raw');await env.settle();eq(env.calls.length,1);eq(env.calls[0].args.query,'style_memory.custom_query');eq(env.calls[0].args.txt,'typed raw');eq(env.calls[0].args.filters,{standard:1});eq(env.calls[0].args.reference_doctype,'Print Settings');`,
		{ made: true, getQuery: true }
	);
});
test("explicit formatter remains outside local adapter ownership", async ({ page }) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();ok(!env.field._print_settings_style_labels);eq(env.field.input.value,'Redesign');eq(env.calls.length,0);`,
		{ df: { formatter: "customformatter" } }
	);
});
test("duplicate translated captions decline alias ownership and preserve canonical raw names", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();eq(env.field.input.value,'Redesign');eq(env.field.get_translated('Modern'),'Modern');eq(env.field.get_input_value(),'Redesign');await env.search('Stile');await env.settle();ok(!env.field.awesomplete._list.some(r=>r.value==='Redesign'||r.value==='Modern'),'ambiguous aliases are not supplemental choices');eq(env.field.title_value_map.Stile,undefined);await env.search('Redesign');await env.settle();ok(env.field.awesomplete._list.some(r=>r.value==='Redesign'),'original raw search remains usable');eq(env.frm.doc.print_style,'Redesign');`,
		{ messages: { "Redesign:Print Style": "Stile", "Modern:Print Style": "Stile" } }
	);
});
test("hostile caption remains escaped text in selected input and actual Awesomplete DOM", async ({
	page,
}) => {
	const hostile = '<img src=x onerror="bad()"> & "citato"';
	await run(
		page,
		`await env.onload();env.make();await env.settle();eq(env.field.input.value,${JSON.stringify(
			hostile
		)});eq(env.field.get_input_value(),'Classic');await env.search('citato');await env.settle();eq(env.field.awesomplete.ul.querySelectorAll('img').length,0);ok(env.field.awesomplete.ul.textContent.includes('citato'));eq(env.frm.doc.print_style,'Classic');`,
		{ initial: "Classic", messages: { "Classic:Print Style": hostile } }
	);
});
test("old locale response cannot replace newer current locale authority", async ({ page }) => {
	await run(
		page,
		`await env.onload();env.make();await env.tick();ok(env.pending.length>0,'prototype label authority request expected');env.w.frappe.boot.lang='fr';env.w.frappe._messages['Redesign:Print Style']='Renouvelé';await env.onload();ok(env.pending.length>=2,'second locale request');await env.deliver(1);await env.deliver(1);eq(env.field.input.value,'Renouvelé');await env.deliver(0);await env.settle();eq(env.field.input.value,'Renouvelé');eq(env.field.get_input_value(),'Redesign');`
	);
});
test("provided on_make callback remains untouched and runs once and repeated setup does not duplicate handler", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();eq(env.onMakes,['print_style']);const handler=env.field._debounced_input_handler;await env.onload();await env.settle();eq(env.onMakes,['print_style']);eq(env.field._debounced_input_handler,handler);eq(env.inputHandlers().length,1);eq(env.field.input.value,'Rinnovato');`,
		{ onMake: true }
	);
});
test("original primary create and advanced-search action rows remain present", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();await env.search('Classico');await env.settle();const rows=env.field.awesomplete._list;ok(rows.some(r=>r.value==='Classic'),'translated supplement present');ok(rows.some(r=>r.value==='create_new__link_option'));ok(rows.some(r=>r.value==='advanced_search__link_option'));eq(env.frm.doc.print_style,'Redesign');`
	);
});
test("actual keyboard selection validates and stores canonical ID then invokes raw preview callback", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();await env.search('Classico');await env.settle();const index=env.field.awesomplete.suggestions.findIndex(item=>item.value==='Classic');ok(index>=0,'Italian canonical suggestion available');env.field.awesomplete.goto(index);env.field.input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,which:13,bubbles:true}));await env.tick();await env.settle();eq(env.frm.doc.print_style,'Classic');eq(env.field.get_input_value(),'Classic');eq(env.field.input.value,'Classico');ok(env.calls.some(c=>c.endpoint==='frappe.client.validate_link_and_fetch'&&c.args.docname==='Classic'));ok(env.previews.some(c=>JSON.stringify(c)===JSON.stringify(['Print Style','Classic','preview'])));`
	);
});
test("actual blur with canonical raw value retains original validation and contextual display", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();env.field.input.focus();env.field.$input.val('Modern');env.w.document.getElementById('outside').focus();await env.tick();await env.settle();eq(env.frm.doc.print_style,'Modern');eq(env.field.get_input_value(),'Modern');eq(env.field.input.value,'Moderno');ok(env.previews.some(c=>JSON.stringify(c)===JSON.stringify(['Print Style','Modern','preview'])));`
	);
});
test("standard flag changed between label and permission responses never gains caption authority", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.tick();ok(env.pending.length>0,'label request');await env.deliver();ok(env.pending.length>0,'permission request');eq(env.pending[0].call.args.filters.standard,1);env.setRecords(env.records().map(r=>r.name==='Classic'?{...r,standard:0}:r));await env.settle();eq(env.field.input.value,'Classic');eq(env.field.get_translated('Classic'),'Classic');eq(env.frm.doc.print_style,'Classic');`,
		{ initial: "Classic" }
	);
});
test("explicit custom caption method remains untouched and no label authority call is made", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();ok(!env.field._print_settings_style_labels);eq(env.field.input.value,'AUTHORED Redesign');eq(env.calls.length,0);eq(env.field.get_input_value(),'Redesign');`,
		{ translatedOverride: true }
	);
});
test("explicit custom field-label declaration declines this exact built-in-field ownership", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();ok(!env.field._print_settings_style_labels);eq(env.field.input.value,'Redesign');eq(env.calls.length,0);`,
		{ df: { label: "Authored Style label" } }
	);
});
test("caption colliding with authored raw name declines alias ownership and never translates the custom record", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();eq(env.field.input.value,'Redesign');eq(env.field.get_translated('Rinnovato'),'Rinnovato');eq(env.field.get_input_value(),'Redesign');eq(env.field.title_value_map.Rinnovato,undefined);env.field.$input.val('Rinnovato');eq(env.field.get_input_value(),'Rinnovato');eq(env.frm.doc.print_style,'Redesign');`,
		{
			records: [
				...records,
				{
					doctype: "Print Style",
					name: "Rinnovato",
					standard: 0,
					disabled: 0,
					preview: "",
					print_style_name: "Rinnovato",
					creation: "99",
				},
			],
			messages: { Rinnovato: "Unrelated global" },
		}
	);
});
test("older permission response cannot reinstate a now nonstandard canonical record", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.tick();ok(env.pending.length>0,'initial label request');await env.deliver();ok(env.pending.length>0,'old permission request');env.setRecords(env.records().map(r=>r.name==='Classic'?{...r,standard:0}:r));await env.onload();await env.deliver(1);await env.deliver(1);eq(env.field.get_translated('Classic'),'Classic');await env.deliver(0,{message:[{value:'Classic',label:'Classic'}]});await env.settle();eq(env.field.get_translated('Classic'),'Classic');eq(env.inputHandlers().length,1);`
	);
});
test("empty label authority preserves raw selected input and the original primary search", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.tick();ok(env.pending.length>0,'label request');await env.deliver(0,{message:[]});await env.settle();eq(env.field.input.value,'Redesign');await env.search('Classic');ok(env.pending.length>0,'fresh label request');await env.deliver(env.pending.findIndex(d=>d.call.endpoint.includes('get_print_styles')),{message:[]});await env.settle();ok(env.calls.some(c=>c.endpoint==='frappe.desk.search.search_link'&&c.args.txt==='Classic'));ok(env.field.awesomplete._list.some(r=>r.value==='Classic'));eq(env.frm.doc.print_style,'Redesign');`
	);
});
test("failed label authority falls back to raw display without replacing primary search", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.tick();ok(env.pending.length>0,'label request');env.pending.shift().fail();await env.tick();await env.settle();eq(env.field.input.value,'Redesign');await env.search('Classic');ok(env.pending.length>0,'fresh label request');eq(env.calls.filter(c=>c.endpoint==='frappe.desk.search.search_link'&&c.args.txt==='Classic').length,1,'primary precedes optional rejection');env.pending.splice(env.pending.findIndex(d=>d.call.endpoint.includes('get_print_styles')),1)[0].fail();await env.tick();await env.settle();ok(env.calls.some(c=>c.endpoint==='frappe.desk.search.search_link'&&c.args.txt==='Classic'),JSON.stringify({calls:env.calls,input:env.field.input.value,active:env.w.document.activeElement.outerHTML,notices:env.notices}));ok(env.field.awesomplete._list.some(r=>r.value==='Classic'));eq(env.frm.doc.print_style,'Redesign');`
	);
});
test("focus leaving does not delay primary search or publish late optional suggestions", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();await env.search('Redesign');env.w.document.getElementById('outside').focus();await env.settle();eq(env.calls.filter(c=>c.endpoint==='frappe.desk.search.search_link'&&c.args.txt==='Redesign').length,1);eq(env.frm.doc.print_style,'Redesign');`
	);
});
test("already-made pending original debounce is cancelled rather than remaining bound after setup", async ({
	page,
}) => {
	await run(
		page,
		`env.field.$input.val('Old raw');env.field.input.dispatchEvent(new Event('input',{bubbles:true}));await env.onload();await env.settle();await new Promise(r=>setTimeout(r,550));await env.settle();ok(!env.calls.some(c=>c.args.txt==='Old raw'),'old captured handler cancelled');eq(env.inputHandlers().length,1);await env.search('Classico');await env.settle();eq(env.calls.filter(c=>c.endpoint==='frappe.desk.search.search_link'&&c.args.txt==='Classico').length,1);`,
		{ made: true }
	);
});
test("old owned caption alias is invalidated while unrelated authored title mapping is preserved", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();eq(env.field.title_value_map.Rinnovato,'Redesign');env.field.title_value_map.AUTHORED='Custom raw';env.setRecords(env.records().map(r=>r.name==='Redesign'?{...r,standard:0}:r));await env.onload();await env.settle();eq(env.field.input.value,'Redesign');eq(env.field.title_value_map.Rinnovato,undefined);eq(env.field.title_value_map.AUTHORED,'Custom raw');eq(env.frm.doc.print_style,'Redesign');`
	);
});
test("four real Layout refresh and onload cycles retain one owned handler and current canonical model", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();const handler=env.field._debounced_input_handler;for(let i=0;i<4;i++){env.make();await env.onload();await env.settle();eq(env.field._debounced_input_handler,handler);eq(env.inputHandlers().length,1);eq(env.field.input.value,'Rinnovato');eq(env.field.get_input_value(),'Redesign');}await env.search('Classico');await env.settle();eq(env.calls.filter(c=>c.endpoint==='frappe.desk.search.search_link'&&c.args.txt==='Classico').length,1);eq(env.frm.doc.print_style,'Redesign');`
	);
});
test("not-made authored on_make input callback and original already-bound event behavior are preserved", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();eq(env.onMakes,['print_style']);eq(env.field.input.value,'Redesign');eq(env.inputHandlers().length,1);eq(env.calls.length,0);await env.search('Authored');await env.settle();eq(env.calls.length,1);eq(env.calls[0].endpoint,'frappe.desk.search.search_link');eq(env.calls[0].args.txt,'Authored');env.field.on_input();eq(env.calls[1],{custom_input:true});eq(env.frm.doc.print_style,'Redesign');`,
		{ onMake: "custom-input" }
	);
});
test("original cached and fresh custom suggestions progress while every label request stays pending", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.tick();env.field.$input.cache['Print Style']={'Classico':[{value:'Cached custom',label:'Cached custom'}]};await env.search('Classico');eq(env.calls.filter(c=>c.endpoint==='frappe.desk.search.search_link'&&c.args.txt==='Classico').length,1);ok(env.field.awesomplete._list.some(r=>r.value==='Cached custom'),'original cache is visible before optional delivery');ok(env.pending.some(d=>d.call.endpoint.includes('get_print_styles')));await env.deliver(env.pending.findIndex(d=>d.call.endpoint==='frappe.desk.search.search_link'));ok(env.field.awesomplete._list.some(r=>r.value==='Classico custom'),'fresh custom primary result');ok(!env.field.awesomplete._list.some(r=>r.value==='Classic'));eq(env.frm.doc.print_style,'Redesign');`
	);
});
test("fresh primary rows and actions progress while optional permission delivery stays pending", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();await env.search('Classico');ok(env.pending.some(d=>d.call.endpoint.includes('get_print_styles')),'optional label stage expected');await env.deliver(env.pending.findIndex(d=>d.call.endpoint.includes('get_print_styles')));const supplement=env.pending.find(d=>d.call.args.filters?.standard===1);ok(supplement,'supplement is pending');await env.deliver(env.pending.findIndex(d=>d.call.args.txt==='Classico'));ok(env.field.awesomplete._list.some(r=>r.value==='Classico custom'));ok(!env.field.awesomplete._list.some(r=>r.value==='Classic'));ok(env.field.awesomplete._list.some(r=>r.value==='advanced_search__link_option'));ok(env.pending.includes(supplement));eq(env.frm.doc.print_style,'Redesign');`
	);
});
test("rejected optional permission lookup leaves already delivered primary custom rows and actions usable", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();await env.search('Classico');eq(env.calls.filter(c=>c.args.txt==='Classico').length,1,'primary precedes optional permission rejection');ok(env.pending.some(d=>d.call.endpoint.includes('get_print_styles')),'optional label stage expected');await env.deliver(env.pending.findIndex(d=>d.call.endpoint.includes('get_print_styles')));await env.deliver(env.pending.findIndex(d=>d.call.args.txt==='Classico'));env.pending.splice(env.pending.findIndex(d=>d.call.args.filters?.standard===1),1)[0].fail();await env.tick();ok(env.field.awesomplete._list.some(r=>r.value==='Classico custom'));ok(!env.field.awesomplete._list.some(r=>r.value==='Classic'));ok(env.field.awesomplete._list.some(r=>r.value==='advanced_search__link_option'));eq(env.frm.doc.print_style,'Redesign');`
	);
});
test("actual supported link_filters declaration declines decoration and preserves original filtered query", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();ok(!env.field._print_settings_style_labels);await env.search('Classic');await env.settle();eq(env.calls.length,1);eq(env.calls[0].args.filters,{standard:['=',1]});eq(env.calls[0].args.txt,'Classic');eq(env.calls[0].args.reference_doctype,'Print Settings');eq(env.calls[0].args.link_fieldname,'print_style');ok(env.queries.every(q=>q.ignore_permissions===false&&!q.ignore_user_permissions));ok(env.field.awesomplete._list.some(r=>r.value==='Classic'));`,
		{ df: { link_filters: '[["Print Style","standard","=",1]]' } }
	);
});
test("authored get_search_args before setup remains outside decoration and original filtered query progresses", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();ok(!env.field._print_settings_style_labels);await env.search('Classic');await env.settle();eq(env.calls.length,1);eq(env.calls[0].args.filters,{standard:1});eq(env.calls[0].args.txt,'Classic');eq(env.calls[0].args.reference_doctype,'Print Settings');ok(env.field.awesomplete._list.some(r=>r.value==='Classic'));`,
		{ searchArgs: true }
	);
});
test("authored get_search_args added after setup keeps primary progress and receives no further decoration request", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();const count=env.calls.length;const original=env.w.frappe.ui.form.ControlLink.prototype.get_search_args;env.field.get_search_args=function(term){return {...original.call(this,term),filters:{standard:1}};};await env.onload();await env.search('Classic');await env.settle();eq(env.calls.length,count+1);eq(env.calls.at(-1).args.filters,{standard:1});eq(env.calls.at(-1).args.txt,'Classic');eq(env.field.get_translated('Classic'),'Classic');ok(env.field.awesomplete._list.some(r=>r.value==='Classic'));`
	);
});
test("optional labels and permissions finishing before primary publish only after original primary cache exists", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();await env.search('Classico');ok(env.pending.some(d=>d.call.endpoint.includes('get_print_styles')),'optional label stage expected');await env.deliver(env.pending.findIndex(d=>d.call.endpoint.includes('get_print_styles')));ok(env.pending.some(d=>d.call.args.filters?.standard===1),'optional permission stage expected');await env.deliver(env.pending.findIndex(d=>d.call.args.filters?.standard===1));ok(env.pending.some(d=>d.call.args.txt==='Classico'),'original primary stays independent');ok(!env.field.awesomplete._list.some(r=>r.value==='Classic'));await env.deliver(env.pending.findIndex(d=>d.call.args.txt==='Classico'));ok(env.field.awesomplete._list.some(r=>r.value==='Classic'));ok(env.field.awesomplete._list.some(r=>r.value==='Classico custom'));ok(env.field.awesomplete._list.some(r=>r.value==='advanced_search__link_option'));eq(env.frm.doc.print_style,'Redesign');`
	);
});
test("late permission result cannot publish after the field owner identity changes", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();await env.search('Classico');eq(env.calls.filter(c=>c.args.txt==='Classico').length,1,'primary precedes owner change');ok(env.pending.some(d=>d.call.endpoint.includes('get_print_styles')),'optional label stage expected');await env.deliver(env.pending.findIndex(d=>d.call.endpoint.includes('get_print_styles')));await env.deliver(env.pending.findIndex(d=>d.call.args.txt==='Classico'));env.field.frm={doctype:'Print Settings'};ok(env.pending.some(d=>d.call.args.filters?.standard===1),'optional permission stage expected');await env.deliver(env.pending.findIndex(d=>d.call.args.filters?.standard===1));eq(env.field.get_translated('Classic'),'Classic');ok(!env.field.awesomplete._list.some(r=>r.value==='Classic'));ok(env.field.awesomplete._list.some(r=>r.value==='Classico custom'));eq(env.frm.doc.print_style,'Redesign');`
	);
});
test("late optional permission for a previous term cannot replace the current primary suggestions", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();await env.search('Classico');eq(env.calls.filter(c=>c.args.txt==='Classico').length,1,'first primary progresses');ok(env.pending.some(d=>d.call.endpoint.includes('get_print_styles')),'optional label stage expected');await env.deliver(env.pending.findIndex(d=>d.call.endpoint.includes('get_print_styles')));await env.deliver(env.pending.findIndex(d=>d.call.args.txt==='Classico'));await env.search('Modern');eq(env.calls.filter(c=>c.args.txt==='Modern').length,1,'second primary progresses');await env.deliver(env.pending.findIndex(d=>d.call.args.txt==='Modern'));ok(env.pending.some(d=>d.call.args.filters?.standard===1),'optional permission stage expected');await env.deliver(env.pending.findIndex(d=>d.call.args.filters?.standard===1));ok(!env.field.awesomplete._list.some(r=>r.value==='Classic'));ok(env.field.awesomplete._list.some(r=>r.value==='Modern'));await env.settle();eq(env.field.input.value,'Modern');ok(!env.field.awesomplete._list.some(r=>r.value==='Classic'));eq(env.frm.doc.print_style,'Redesign');`
	);
});
test("authored caption method added after setup keeps its original HTML rendering without owned secondary identity", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();const count=env.calls.length;env.field.get_translated=value=>'AUTHORED '+value;await env.search('Classic');await env.settle();eq(env.calls.length,count+1);eq(env.field.get_translated('Classic'),'AUTHORED Classic');ok(env.field.awesomplete.ul.textContent.includes('AUTHORED Classic'));const row=env.field.awesomplete._list.find(r=>r.value==='Classic');ok(row);eq(row.html,undefined);eq(env.frm.doc.print_style,'Redesign');`
	);
});

test("actual Reload replaces the document and recovers captions supplements canonical selection and one handler", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();const Form=env.w.frappe.ui.form.Form.prototype;ok(env.frm.reload_doc===Form.reload_doc);ok(env.frm.refresh===Form.refresh);ok(env.frm.trigger_onload===Form.trigger_onload);ok(env.frm.render_form===Form.render_form);const field=env.field;for(let i=0;i<2;i++){const oldDoc=env.frm.doc;const oldState=field._print_settings_style_labels;const reload=env.frm.reload_doc();eq(env.w.locals['Print Settings']['Print Settings'],undefined);eq(env.frm.opendocs['Print Settings'],undefined);const getdoc=env.pending.findIndex(d=>d.call.endpoint==='frappe.desk.form.load.getdoc');ok(getdoc>=0,'actual with_doc dispatched getdoc');await env.deliver(getdoc,{response:{docs:[{doctype:'Print Settings',name:'Print Settings',docstatus:0,print_style:'Redesign'}]}});await reload;await env.settle();ok(env.frm.doc!==oldDoc,'sync must install a fresh document object');ok(env.frm.doc===env.w.locals['Print Settings']['Print Settings']);ok(env.frm.fields_dict.print_style===field);ok(field.doc===env.frm.doc);eq(env.frm.opendocs['Print Settings'],true);eq(field.input.value,'Rinnovato','Reload must recover contextual selected display');eq(field.get_input_value(),'Redesign');ok(field._print_settings_style_labels!==oldState,'new document needs a fresh adapter generation');await env.onload();await env.settle();eq(env.inputHandlers().length,1);await env.search('Classico');await env.settle();ok(field.awesomplete._list.some(r=>r.value==='Classic'),'Reload must recover localized supplemental match');ok(field.awesomplete._list.some(r=>r.value==='Classico custom'));eq(env.frm.doc.print_style,'Redesign');}const index=field.awesomplete.suggestions.findIndex(item=>item.value==='Classic');ok(index>=0);field.awesomplete.goto(index);field.input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,which:13,bubbles:true}));await env.tick();await env.settle();eq(env.frm.doc.print_style,'Classic');eq(field.get_input_value(),'Classic');eq(field.input.value,'Classico');ok(env.calls.some(c=>c.endpoint==='frappe.client.validate_link_and_fetch'&&c.args.docname==='Classic'));ok(env.previews.some(c=>JSON.stringify(c)===JSON.stringify(['Print Style','Classic','preview'])));`,
		{ reload: true }
	);
});
test("Reload retires a pending old label response before a new generation publishes captions", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.tick();const oldLabel=env.pending.find(d=>d.call.endpoint.includes('get_print_styles'));ok(oldLabel,'old label request is pending');const reload=env.frm.reload_doc();const getdoc=env.pending.findIndex(d=>d.call.endpoint==='frappe.desk.form.load.getdoc');ok(getdoc>=0);await env.deliver(getdoc,{response:{docs:[{doctype:'Print Settings',name:'Print Settings',docstatus:0,print_style:'Modern'}]}});await reload;ok(env.pending.some(d=>d!==oldLabel&&d.call.endpoint.includes('get_print_styles')),'new document must start its own label generation');await env.deliver(env.pending.findIndex(d=>d!==oldLabel&&d.call.endpoint.includes('get_print_styles')));await env.deliver(env.pending.findIndex(d=>d.call.args.filters?.standard===1));eq(env.field.input.value,'Moderno');const count=env.calls.length;await env.deliver(env.pending.indexOf(oldLabel),{message:[{name:'Classic',label:'Classico'}]});await env.settle();eq(env.calls.length,count,'retired label response cannot start another permission query');eq(env.field.input.value,'Moderno');eq(env.field.get_translated('Redesign'),'Rinnovato');eq(env.frm.doc.print_style,'Modern');eq(env.inputHandlers().length,1);`,
		{ reload: true }
	);
});
test("Reload retires late old permission authority without reinstating now nonstandard supplemental choices", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();await env.search('Classico');await env.deliver(env.pending.findIndex(d=>d.call.endpoint.includes('get_print_styles')));const oldPermission=env.pending.find(d=>d.call.args.filters?.standard===1);ok(oldPermission,'old permission request is pending');await env.deliver(env.pending.findIndex(d=>d.call.args.txt==='Classico'));env.setRecords(env.records().map(r=>r.name==='Classic'?{...r,standard:0}:r));const reload=env.frm.reload_doc();await env.deliver(env.pending.findIndex(d=>d.call.endpoint==='frappe.desk.form.load.getdoc'),{response:{docs:[{doctype:'Print Settings',name:'Print Settings',docstatus:0,print_style:'Modern'}]}});await reload;ok(env.pending.some(d=>d!==oldPermission&&d.call.endpoint.includes('get_print_styles')),'new document label stage expected');await env.deliver(env.pending.findIndex(d=>d.call.endpoint.includes('get_print_styles')));await env.deliver(env.pending.findIndex(d=>d!==oldPermission&&d.call.args.filters?.standard===1));eq(env.field.input.value,'Moderno');await env.search('Classico');await env.deliver(env.pending.findIndex(d=>d.call.args.txt==='Classico'));await env.deliver(env.pending.findIndex(d=>d.call.endpoint.includes('get_print_styles')));await env.deliver(env.pending.findIndex(d=>d!==oldPermission&&d.call.args.filters?.standard===1));ok(!env.field.awesomplete._list.some(r=>r.value==='Classic'));await env.deliver(env.pending.indexOf(oldPermission),{message:[{value:'Classic',label:'Classic'}]});await env.settle();eq(env.field.get_translated('Classic'),'Classic');ok(!env.field.awesomplete._list.some(r=>r.value==='Classic'));ok(env.field.awesomplete._list.some(r=>r.value==='Classico custom'));eq(env.frm.doc.print_style,'Modern');ok(env.previews.some(c=>JSON.stringify(c)===JSON.stringify(['Print Style','Modern','preview'])));eq(env.inputHandlers().length,1);`,
		{ reload: true }
	);
});
test("Reload removes only owned aliases cache decoration and queued handler while preserving authored rows and actions", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();await env.search('Classico');await env.settle();const cache=env.field.$input.cache['Print Style'];ok(cache.Classico.some(r=>r.value==='Classic'),'old owned supplement exists');const action=cache.Classico.find(r=>r.value==='advanced_search__link_option').action;const authored={value:'AUTHORED ROW',label:'Authored',html:'<em>Authored HTML</em>'};cache.AUTHORED=[authored];env.field.title_value_map.AUTHORED='Custom raw';env.field.title_value_map.Classico='Authored alternate';const oldHandler=env.field._debounced_input_handler;env.field.$input.val('queued old text');env.field.input.dispatchEvent(new Event('input',{bubbles:true}));env.setRecords(env.records().map(r=>r.name==='Classic'?{...r,standard:0}:r));const reload=env.frm.reload_doc();await env.deliver(env.pending.findIndex(d=>d.call.endpoint==='frappe.desk.form.load.getdoc'),{response:{docs:[{doctype:'Print Settings',name:'Print Settings',docstatus:0,print_style:'Modern'}]}});await reload;ok(env.pending.some(d=>d.call.endpoint.includes('get_print_styles')),'new generation starts before optional delivery');eq(env.field.title_value_map.Rinnovato,undefined,'old owned selected alias retired');eq(env.field.title_value_map.AUTHORED,'Custom raw');eq(env.field.title_value_map.Classico,'Authored alternate','authored replacement of an old alias is retained');ok(cache.AUTHORED[0]===authored);eq(cache.AUTHORED[0].html,'<em>Authored HTML</em>');ok(!cache.Classico.some(r=>r.value==='Classic'),'old supplement retired');ok(cache.Classico.some(r=>r.value==='Classico custom'));ok(cache.Classico.find(r=>r.value==='advanced_search__link_option').action===action);await env.settle();await new Promise(r=>setTimeout(r,550));await env.settle();ok(!env.calls.some(c=>c.args.txt==='queued old text'),'retired debounce must be cancelled');ok(env.field._debounced_input_handler!==oldHandler);eq(env.inputHandlers().length,1);eq(env.field.input.value,'Moderno');eq(env.frm.doc.print_style,'Modern');`,
		{ reload: true }
	);
});
test("Reload retirement respects an authored query and leaves original primary search usable without a new adapter", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();const original=env.w.frappe.ui.form.ControlLink.prototype.get_search_args;const authored=function(term){return {...original.call(this,term),filters:{standard:1}};};env.field.get_search_args=authored;const reload=env.frm.reload_doc();await env.deliver(env.pending.findIndex(d=>d.call.endpoint==='frappe.desk.form.load.getdoc'),{response:{docs:[{doctype:'Print Settings',name:'Print Settings',docstatus:0,print_style:'Modern'}]}});await reload;await env.settle();ok(!env.field._print_settings_style_labels,'custom query prevents a new generation from owning decoration');ok(env.field.get_search_args===authored);ok(env.field.get_translated===env.w.frappe.ui.form.ControlLink.prototype.get_translated);const count=env.calls.length;await env.search('Classic');await env.settle();eq(env.calls.length,count+1);eq(env.calls.at(-1).args.txt,'Classic');eq(env.calls.at(-1).args.filters,{standard:1});ok(env.field.awesomplete._list.some(r=>r.value==='Classic'));eq(env.field.input.value,'Classic');eq(env.frm.doc.print_style,'Modern');eq(env.inputHandlers().length,1);`,
		{ reload: true }
	);
});
test("Reload retirement preserves an authored input handler across repeated setup", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();const field=env.field;const original=env.w.frappe.ui.form.ControlLink.prototype.on_input;field._debounced_input_handler.cancel();field.$input.off('input',field._debounced_input_handler);const authored=env.w.frappe.utils.debounce(original.bind(field),500);field._debounced_input_handler=authored;field.$input.on('input',authored);const reload=env.frm.reload_doc();await env.deliver(env.pending.findIndex(d=>d.call.endpoint==='frappe.desk.form.load.getdoc'),{response:{docs:[{doctype:'Print Settings',name:'Print Settings',docstatus:0,print_style:'Modern'}]}});await reload;await env.settle();ok(field._debounced_input_handler===authored,'retirement preserves immediate authored handler');for(let i=0;i<2;i++){await env.onload();await env.settle();ok(field._debounced_input_handler===authored,'repeated setup must continue declining authored handler ownership');eq(env.inputHandlers().length,1);}eq(field.get_translated('Modern'),'Modern');const count=env.calls.length;await env.search('Classic');await env.settle();eq(env.calls.length,count+1);eq(env.calls.at(-1).args.txt,'Classic');ok(field.awesomplete._list.some(r=>r.value==='Classic'));eq(env.frm.doc.print_style,'Modern');`,
		{ reload: true }
	);
});

test("every adapted input requests at most five canonical names and five exact contextual collision names", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();await env.search('Classico');await env.settle();const labels=env.calls.filter(c=>c.endpoint.includes('get_print_styles'));eq(labels.length,2);const wanted=['Redesign','Modern','Classic','Striped','Monochrome','Rinnovato','Moderno','Classico','Righe alternate','Monocromatico'];for(const call of labels){eq(call.args.with_labels,true);const names=typeof call.args.names==='string'?JSON.parse(call.args.names):call.args.names;eq(names,wanted);ok(names.length<=10);ok(names.every(name=>typeof name==='string'));}const supplements=env.calls.filter(c=>c.args.filters?.standard===1);eq(supplements.length,2);ok(supplements.every(c=>c.args.page_length<=5&&c.args.filters.name[1].length<=5));eq(env.frm.doc.print_style,'Redesign');`
	);
});
test("bounded exact collision lookup ignores unrelated custom names while retaining raw denied and disabled semantics", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();eq(env.field.input.value,'Classic');await env.search('Classico');await env.settle();const rows=env.field.awesomplete._list;ok(!rows.some(r=>r.value==='Classic'));ok(rows.some(r=>r.value==='Classico'));eq(env.field.get_translated('Classico'),'Classico');eq(env.field.get_translated('Striped'),'Striped');eq(env.field.get_translated('Modern'),'Modern');const labels=env.calls.filter(c=>c.endpoint.includes('get_print_styles'));ok(labels.every(c=>!c.args.names.includes('Unrelated custom')));eq(env.field.get_input_value(),'Classico');eq(env.frm.doc.print_style,'Classic');`,
		{
			initial: "Classic",
			records: [
				...records.map((r) =>
					r.name === "Striped"
						? { ...r, disabled: 1 }
						: r.name === "Modern"
						? { ...r, permitted: false }
						: r
				),
				{ name: "Classico", standard: 0, disabled: 0, creation: "2000" },
				{ name: "Unrelated custom", standard: 0, disabled: 0, creation: "2001" },
			],
		}
	);
});

test("authored Classic caption and previously qualified raw names cannot resolve to the canonical Classic ID", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.settle();eq(env.field.input.value,'Classic');eq(env.field.get_translated('Classic'),'Classic');eq(env.field.title_value_map.Classico,undefined);eq(env.field.title_value_map['Classico (Classic)'],undefined);env.field.input.focus();env.field.$input.val('Classico');eq(env.field.get_input_value(),'Classico');env.field.$input.val('Classico (Classic)');eq(env.field.get_input_value(),'Classico (Classic)');env.w.document.getElementById('outside').focus();await env.tick();await env.settle();eq(env.frm.doc.print_style,'Classico (Classic)');eq(env.field.get_input_value(),'Classico (Classic)');eq(env.field.input.value,'Classico (Classic)');ok(env.calls.some(c=>c.endpoint==='frappe.client.validate_link_and_fetch'&&c.args.docname==='Classico (Classic)'));ok(!env.calls.some(c=>c.endpoint==='frappe.client.validate_link_and_fetch'&&c.args.docname==='Classic'));ok(env.previews.some(c=>JSON.stringify(c)===JSON.stringify(['Print Style','Classico (Classic)','preview'])));`,
		{
			initial: "Classic",
			records: [
				...records,
				...["Classico", "Classico (Classic)"].map((name, i) => ({
					name,
					standard: 0,
					disabled: 0,
					creation: String(90 + i),
				})),
			],
		}
	);
});

test("default ControlLink raw title mapping remains owned by its original record when a caption would reuse its key", async ({
	page,
}) => {
	await run(
		page,
		`await env.onload();env.make();await env.tick();env.field.translate_and_set_input_value('Classico','Classico');eq(env.field.title_value_map.Classico,'Classico');await env.settle();eq(env.field.title_value_map.Classico,'Classico');eq(env.field.get_translated('Classic'),'Classic');env.field.set_input('Classic');eq(env.field.input.value,'Classic');eq(env.field.get_input_value(),'Classic');eq(env.field.title_value_map.Classico,'Classico');eq(env.frm.doc.print_style,'Redesign');`,
		{ records: [...records, { name: "Classico", standard: 0, disabled: 1, creation: "99" }] }
	);
});
