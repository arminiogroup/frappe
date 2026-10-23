import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "@playwright/test";

const require = createRequire(__filename);
const repository = resolve(__dirname, "../..");
const esbuild = require("esbuild");
const paths = [
	"frappe/public/js/frappe/format.js",
	"frappe/public/js/frappe/utils/utils.js",
	"frappe/public/js/frappe/translate.js",
	"frappe/public/js/frappe/model/model.js",
	"frappe/public/js/frappe/model/meta.js",
	"frappe/public/js/frappe/model/sync.js",
	"frappe/public/js/frappe/form/controls/base_control.js",
	"frappe/public/js/frappe/form/controls/base_input.js",
	"frappe/public/js/frappe/form/controls/data.js",
	"frappe/public/js/frappe/form/controls/select.js",
	"frappe/public/js/frappe/form/formatters.js",
	"frappe/public/js/frappe/form/controls/control.js",
];
const read = (path) => readFileSync(resolve(repository, path), "utf8");
const sources = Object.fromEntries(paths.map((path) => [path, read(path)]));
sources.jquery = readFileSync(require.resolve("jquery"), "utf8");
sources.dom = read("frappe/public/js/frappe/dom.js");
sources.context = esbuild.transformSync(
	read("frappe/public/js/frappe/utils/select_option_context.ts"),
	{ loader: "ts", format: "iife", globalName: "contextModule" }
).code;
const TARGETS = {
	"Sales Order Classic:Print Format Name": "Ordine di vendita (classico)",
	"Sales Order Modern:Print Format Name": "Ordine di vendita (moderno)",
};
sources.bulk = read("frappe/public/js/frappe/list/bulk_operations.js");

async function load(page, options = {}) {
	await page.route("**/*", (route) => route.abort());
	await page.setContent('<!doctype html><body><div id="fields"></div></body>');
	await page.evaluate(
		async ({ sources, targets, options }) => {
			const w = window;
			w.eval(sources.jquery);
			const $ = w.jQuery;
			$.fn.tooltip = function () {
				return this;
			};
			w.cstr = (v) => (v == null ? "" : String(v));
			w.cint = (v) => parseInt(v || 0, 10);
			w.is_null = (v) => v == null || v === "";
			w.copy_dict = (v) => ({ ...v });
			w.strip_html = (v) => $("<div>").html(v).text();
			w.cur_frm = null;
			const calls = [],
				messages = [],
				dialogs = [],
				qz = [];
			const owner = options.owner === undefined ? "Sales Order" : options.owner;
			const rows = options.rows || [
				{ print_format: "Sales Order Classic", printer: "PRINTER-RAW" },
				{ print_format: "Open", printer: "Open" },
			];
			const originalStorage = {
				print_format_printer_map: JSON.stringify({ [owner]: rows }),
			};
			const storage = new Proxy(originalStorage, {
				set() {
					throw Error("Persistence forbidden");
				},
			});
			Object.defineProperty(w, "localStorage", { value: storage });
			const records = options.records || [
				{ name: "Sales Order Classic", standard: "Yes" },
				{ name: "Sales Order Modern", standard: "Yes" },
				{ name: "Open", standard: "No" },
				{ name: "Unknown", standard: "Yes" },
			];
			const formats = records.map((row) => ({
				doctype: ":Print Format",
				doc_type: owner,
				docstatus: 0,
				disabled: 0,
				print_format_for: "DocType",
				...row,
			}));
			const meta = {
				name: owner,
				fields: [],
				default_print_format: "Sales Order Classic",
				is_submittable: 1,
				...options.meta,
			};
			w.locals = {
				DocType: { [owner]: meta },
				":Print Format": Object.fromEntries(formats.map((row) => [row.name, row])),
				":Print Settings": {
					"Print Settings": {
						enable_raw_printing: 1,
						allow_print_for_draft: 0,
						allow_print_for_cancelled: 0,
						pdf_page_size: "A4",
						...options.settings,
					},
				},
			};
			const synthetic = {
				Open: "Aperto",
				"Open:Print Format Name": "Formato aperto",
				Standard: "Standard di prova",
				"Ordine di vendita (classico)": "UNWANTED global retranslation",
			};
			w.frappe = {
				provide(path) {
					path.split(".").reduce((object, key) => (object[key] ||= {}), w);
				},
				ui: {
					form: {},
					badge: { html: () => "" },
					button: { html: () => "<button></button>" },
				},
				utils: {},
				model: {
					no_value_type: [],
					table_fields: [],
					layout_fields: ["Section Break", "Column Break"],
				},
				meta: {},
				form: {},
				pages: { print: {} },
				boot: {
					lang: options.lang || "it",
					translated_doctypes: [],
					link_title_doctypes: [],
					sysdefaults: {},
				},
				_messages: options.emptyDictionary
					? {}
					: { ...targets, ...synthetic, ...options.messages },
				session: { user: "translator@example.com" },
				user: { has_role: () => false },
				defaults: { is_enabled: () => false },
				perm: { get_field_display_status: () => "Write" },
				get_route: () => [],
				is_mobile: () => true,
				msgprint: (message) => messages.push(message),
				throw: (message) => {
					throw Error(String(message));
				},
				call(request) {
					calls.push({
						method: request.method,
						args: structuredClone(request.args),
						async: request.async,
					});
					if (request.method !== "frappe.client.get_list")
						throw Error("RPC action forbidden");
					request.callback?.({ message: [] });
					return Promise.resolve({ message: [] });
				},
			};
			w.open = () => {
				throw Error("Print action forbidden");
			};
			for (const path of pathsForEval(sources))
				w.eval(sources[path].replace(/^import .*;\n/gm, ""));
			function pathsForEval(values) {
				return Object.keys(values).filter(
					(path) =>
						path.endsWith(".js") &&
						!path.endsWith("select.js") &&
						!path.endsWith("formatters.js") &&
						!path.endsWith("/controls/control.js")
				);
			}
			w.eval(sources.dom);
			w.eval(sources.context);
			w.selectOptionContext = w.contextModule.selectOptionContext;
			w.eval(
				sources["frappe/public/js/frappe/form/controls/select.js"].replace(
					/^import .*;\n/gm,
					""
				)
			);
			w.eval(
				sources["frappe/public/js/frappe/form/formatters.js"].replace(
					/^import .*;\n/gm,
					""
				)
			);
			w.frappe.utils.icon = () => "<svg></svg>";
			w.frappe.utils.bind_actions_with_object = () => {};
			w.frappe.utils.is_rtl = () => false;
			w.frappe.utils.scroll_to = () => {};
			w.frappe.utils.is_xs = () => false;
			w.frappe.ui.keyCode = { ESCAPE: 27, TAB: 9, UP: 38, DOWN: 40 };
			w.frappe.model.user_settings = {};
			w.frappe.get_user_settings = () => null;
			w.frappe.utils.only_allow_num_decimal = () => {};
			w.frappe.dom.freeze = () => {};
			w.frappe.dom.unfreeze = () => {};
			w.frappe.dom.is_element_in_viewport = () => true;
			w.frappe.dom.is_element_in_modal = () => true;
			w.Sortable = class {
				constructor(element, settings) {
					this.element = element;
					this.settings = settings;
				}
				option() {}
			};
			w.frappe.ui.form.qz_get_printer_list = () => {
				qz.push("synthetic-list-only");
				return Promise.resolve(["PRINTER-RAW", "Open"]);
			};

			w.eval(
				sources["frappe/public/js/frappe/form/controls/control.js"].replace(
					/^import .*;\n/gm,
					""
				)
			);
			w.frappe.ui.Dialog = class {
				constructor(settings) {
					this.settings = settings;
					this.fields_dict = {};
					this.$wrapper = $("<div>").appendTo("body");
					for (const df of settings.fields) {
						if (!["Select", "Table"].includes(df.fieldtype)) continue;
						const field = w.frappe.ui.form.make_control({
							df,
							parent: this.$wrapper,
							render_input: 1,
						});
						this.fields_dict[df.fieldname] = field;
						if (df.default != null && field.set_input) field.set_input(df.default);
					}
					dialogs.push(this);
				}
				show() {}
				hide() {
					throw Error("Dialog action forbidden");
				}
				set_primary_action(label, callback) {
					this.primary = { label, callback };
				}
			};
			w.eval(
				sources.bulk.replace(
					"export default class BulkOperations",
					"window.BulkOperations = class BulkOperations"
				)
			);
			w.memory = {
				owner,
				meta,
				rows,
				storage: originalStorage,
				calls,
				messages,
				dialogs,
				qz,
				options,
				optionRows: (field) =>
					Array.from(field.input.options).map((option) => ({
						value: option.value,
						text: option.textContent,
						selected: option.selected,
						disabled: option.disabled,
					})),
				snapshot: () => structuredClone({ locals: w.locals, storage: originalStorage }),
				listenerCount: (field) =>
					(($._data(field.input, "events") || {})["select-change"] || []).filter(
						(row) => row.namespace === "print-format-name"
					).length,
			};
		},
		{ sources, targets: TARGETS, options }
	);
}

async function open(page, docs = [{ name: "ORDER-RAW", docstatus: 1 }]) {
	await page.evaluate((docs) => {
		const m = window.memory;
		const bulk = new window.BulkOperations({ doctype: "Sales Order" });
		bulk.doctype = m.owner;
		m.bulk = bulk;
		bulk.print(docs);
		m.dialog = m.dialogs.at(-1);
		m.field = m.dialog?.fields_dict.print_sel;
	}, docs);
}

test("bulk print uses owned captions and raw canonical options", async ({ page }) => {
	await load(page);
	await open(page);
	const result = await page.evaluate(() => ({
		options: window.memory.optionRows(window.memory.field),
		raw: window.memory.field.get_value(),
		snapshot: window.memory.snapshot(),
		calls: window.memory.calls,
		primary: typeof window.memory.dialog.primary.callback,
	}));
	assert.deepEqual(
		result.options.map((row) => row.text),
		[
			"Ordine di vendita (classico)",
			"Standard di prova",
			"Unknown",
			"Open",
			"Ordine di vendita (moderno)",
		]
	);
	assert.deepEqual(
		result.options.map((row) => row.value),
		["Sales Order Classic", "Standard", "Unknown", "Open", "Sales Order Modern"]
	);
	assert.equal(result.raw, "Sales Order Classic");
	assert.equal(result.primary, "function");
	assert.equal(result.snapshot.locals[":Print Format"].Open.name, "Open");
	assert.deepEqual(result.calls, [
		{
			method: "frappe.client.get_list",
			args: {
				doctype: "Letter Head",
				fields: ["name", "is_default"],
				filters: { disabled: 0 },
				limit_page_length: 0,
			},
			async: false,
		},
	]);
});

test("bulk caption guards check current full metadata and dedicated key", async ({ page }) => {
	await load(page);
	await open(page);
	const results = await page.evaluate(() => {
		const m = window.memory,
			record = structuredClone(locals[":Print Format"]["Sales Order Classic"]),
			before = m.snapshot();
		const rows = [];
		const capture = () => {
			m.field.set_input("Sales Order Classic");
			rows.push(m.optionRows(m.field).find((row) => row.value === "Sales Order Classic"));
		};
		for (const change of [
			{ standard: "No" },
			{ standard: true },
			{ disabled: 1 },
			{ docstatus: 2 },
			{ doc_type: "Other" },
			{ name: "Renamed" },
			{ print_format_for: "Report" },
		]) {
			locals[":Print Format"][record.name] = { ...record, ...change };
			capture();
		}
		delete locals[":Print Format"][record.name];
		capture();
		locals[":Print Format"][record.name] = record;
		m.meta.name = "Other";
		capture();
		m.meta.name = m.owner;
		const target = frappe._messages[record.name + ":Print Format Name"];
		delete frappe._messages[record.name + ":Print Format Name"];
		capture();
		frappe._messages[record.name + ":Print Format Name"] = target;
		return { rows, before, after: m.snapshot() };
	});
	assert.equal(results.rows.length, 10);
	for (const row of results.rows) {
		assert.equal(row.text, "Sales Order Classic");
		assert.equal(row.value, "Sales Order Classic");
	}
	assert.deepEqual(results.after, results.before);
});

test("bulk requires a nonempty captured owner even with matching forged empty metadata", async ({
	page,
}) => {
	await load(page, { owner: "" });
	await open(page);
	const result = await page.evaluate(() => window.memory.optionRows(window.memory.field));
	assert.equal(
		result.find((row) => row.value === "Sales Order Classic").text,
		"Sales Order Classic"
	);
	assert.equal(result.find((row) => row.value === "Standard").text, "Standard di prova");
});

test("bulk refresh and lifecycle preserve control methods values and listeners", async ({
	page,
}) => {
	await load(page);
	await open(page);
	const result = await page.evaluate(() => {
		const m = window.memory,
			f = m.field,
			original = f.set_options,
			before = m.snapshot(),
			rows = [];
		for (let i = 0; i < 4; i++) {
			f.df.on_make?.(f);
			f.set_input("Sales Order Modern");
			f.refresh();
			rows.push({
				listeners: m.listenerCount(f),
				caption: m.optionRows(f).find((row) => row.value === "Sales Order Modern").text,
				raw: f.get_value(),
				same: f.set_options === original,
			});
		}
		m.bulk.doctype = "Other";
		f.set_input("Sales Order Modern");
		const stale = m.optionRows(f).find((row) => row.value === "Sales Order Modern").text;
		m.bulk.doctype = m.owner;
		return { rows, stale, before, after: m.snapshot() };
	});
	for (const row of result.rows) {
		assert.deepEqual(row, {
			listeners: 1,
			caption: "Ordine di vendita (moderno)",
			raw: "Sales Order Modern",
			same: true,
		});
	}
	assert.equal(result.stale, "Sales Order Modern");
	assert.deepEqual(result.after, result.before);
});

test("bulk empty dictionary and missing default retain canonical choices", async ({ page }) => {
	await load(page, { emptyDictionary: true, meta: { default_print_format: "Not in list" } });
	await open(page);
	const result = await page.evaluate(() => ({
		rows: window.memory.optionRows(window.memory.field),
		default: window.memory.field.df.default,
	}));
	assert.deepEqual(
		result.rows.map((row) => row.value),
		["Not in list", "Standard", "Unknown", "Open", "Sales Order Modern"]
	);
	assert.deepEqual(
		result.rows.map((row) => row.text),
		result.rows.map((row) => row.value)
	);
	assert.equal(result.default, "Not in list");
});

test("bulk undefined default keeps prior option source and fallback", async ({ page }) => {
	await load(page, { meta: { default_print_format: undefined } });
	await open(page);
	const result = await page.evaluate(() => ({
		rows: window.memory.optionRows(window.memory.field),
		raw: window.memory.field.get_value(),
		default: window.memory.field.df.default,
	}));
	assert.deepEqual(
		result.rows.map((row) => row.value),
		["Standard", "Unknown", "Open", "Sales Order Modern", "Sales Order Classic"]
	);
	assert.equal(result.default, undefined);
	assert.equal(result.raw, null);
});

test("bulk retains existing draft cancel empty and maximum guards", async ({ page }) => {
	await load(page);
	const result = await page.evaluate(() => {
		const m = window.memory,
			b = new window.BulkOperations({ doctype: m.owner });
		const before = m.snapshot();
		for (const docs of [
			[],
			[{ name: "DRAFT", docstatus: 0 }],
			[{ name: "CANCELLED", docstatus: 2 }],
			Array.from({ length: 501 }, (_, index) => ({ name: "ROW-" + index, docstatus: 1 })),
		])
			b.print(docs);
		return {
			dialogs: m.dialogs.length,
			messages: m.messages,
			before,
			after: m.snapshot(),
			calls: m.calls,
		};
	});
	assert.equal(result.dialogs, 0);
	assert.equal(result.messages.length, 4);
	assert.deepEqual(result.after, result.before);
	assert.equal(result.calls.length, 4);
});

test("bulk background threshold and permitted draft settings are unchanged", async ({ page }) => {
	await load(page, { settings: { allow_print_for_draft: 1, allow_print_for_cancelled: 1 } });
	const result = await page.evaluate(() => {
		const b = new window.BulkOperations({ doctype: window.memory.owner });
		const rows = [];
		for (const count of [25, 26]) {
			b.print(
				Array.from({ length: count }, (_, i) => ({
					name: "ROW-" + i,
					docstatus: i === 0 ? 0 : i === 1 ? 2 : 1,
				}))
			);
			const d = window.memory.dialogs.at(-1),
				field = d.settings.fields.find((row) => row.fieldname === "background_print");
			rows.push({
				default: field.default,
				read_only: field.read_only,
				action: typeof d.primary.callback,
			});
		}
		return rows;
	});
	assert.deepEqual(result, [
		{ default: false, read_only: false, action: "function" },
		{ default: true, read_only: true, action: "function" },
	]);
});
