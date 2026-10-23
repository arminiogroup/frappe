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
const bundle = (path, globalName) =>
	esbuild.buildSync({
		entryPoints: [resolve(repository, path)],
		bundle: true,
		write: false,
		format: "iife",
		globalName,
		platform: "browser",
	}).outputFiles[0].text;
sources.grid = bundle("frappe/public/js/frappe/form/grid.js", "gridModule");
sources.layout = bundle("frappe/public/js/frappe/form/layout.js", "layoutModule");
sources.table = read("frappe/public/js/frappe/form/controls/table.js").replace(
	/^import Grid.*;$/gm,
	"const Grid=gridModule.default;"
);
sources.printer = read("frappe/printing/page/print/print.js");

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
			w.eval(sources.grid);
			w.eval(sources.layout);
			w.eval(sources.table);
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
			w.eval(sources.printer);
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

async function open(page) {
	await page.evaluate(async () => {
		const m = window.memory,
			view = Object.create(frappe.ui.form.PrintView.prototype);
		view.frm = { doctype: m.owner, meta: m.meta, doc: { name: "ORDER-RAW" } };
		view.print_format_selector = $("<select>")
			.append($("<option>").attr("value", "Sales Order Classic"))
			.val("Sales Order Classic");
		m.view = view;
		view.printer_setting_dialog();
		await new Promise((resolve) => setTimeout(resolve, 20));
		m.dialog = m.dialogs.at(-1);
		m.grid = m.dialog.fields_dict.printer_mapping.grid;
		m.row = m.grid.grid_rows[0];
		m.df = m.grid.df.fields.find((field) => field.fieldname === "print_format");
		m.readonly = frappe.ui.form.make_control({
			df: { ...m.df, read_only: 1 },
			doc: { print_format: m.row.doc.print_format },
			parent: $("<div>").appendTo("body"),
			render_input: 1,
		});
	});
}

test("printer grid localizes standard and preserves custom collapsed names", async ({ page }) => {
	await load(page);
	await open(page);
	const result = await page.evaluate(() => ({
		static: window.memory.grid.grid_rows.map((row) =>
			row.columns.print_format.static_area.text()
		),
		data: window.memory.grid
			.get_data()
			.map((row) => ({ print_format: row.print_format, printer: row.printer })),
		mapping: window.memory.view.get_mapped_printer(),
		storage: window.memory.storage,
		qz: window.memory.qz,
		html: window.memory.row.columns.print_format.static_area.html(),
	}));
	assert.deepEqual(result.static, ["Ordine di vendita (classico)", "Open"]);
	assert.equal(result.html, "<span>Ordine di vendita (classico)</span>");
	assert.deepEqual(result.data, [
		{ print_format: "Sales Order Classic", printer: "PRINTER-RAW" },
		{ print_format: "Open", printer: "Open" },
	]);
	assert.deepEqual(result.mapping, [result.data[0]]);
	assert.deepEqual(result.qz, ["synthetic-list-only"]);
	assert.equal(
		result.storage.print_format_printer_map,
		JSON.stringify({ "Sales Order": result.data })
	);
});

test("printer inline expanded and readonly use actual native controls", async ({ page }) => {
	await load(page);
	await open(page);
	const result = await page.evaluate(() => {
		const m = window.memory;
		m.row.toggle_editable_row(true);
		const inline = m.optionRows(m.row.on_grid_fields_dict.print_format);
		m.row.toggle_editable_row(false);
		const collapsed = m.row.columns.print_format.static_area.text();
		m.row.show_form();
		const expanded = m.optionRows(m.row.grid_form.fields_dict.print_format);
		m.row.hide_form();
		return {
			inline,
			collapsed,
			expanded,
			readonly: m.readonly.$wrapper.find(".control-value").text(),
			raw: m.row.doc.print_format,
		};
	});
	assert.deepEqual(
		result.inline.map((row) => row.text),
		[
			"Ordine di vendita (classico)",
			"Standard di prova",
			"Unknown",
			"Open",
			"Ordine di vendita (moderno)",
		]
	);
	assert.deepEqual(result.expanded, result.inline);
	assert.equal(result.collapsed, "Ordine di vendita (classico)");
	assert.equal(result.readonly, "Ordine di vendita (classico)");
	assert.equal(result.raw, "Sales Order Classic");
});

test("printer guard matrix keeps raw names across collapsed editor and readonly", async ({
	page,
}) => {
	await load(page);
	await open(page);
	const result = await page.evaluate(() => {
		const m = window.memory,
			before = m.snapshot(),
			record = structuredClone(locals[":Print Format"]["Sales Order Classic"]),
			rows = [];
		m.row.toggle_editable_row(true);
		const capture = () => {
			const f = m.row.on_grid_fields_dict.print_format;
			f.set_input(record.name);
			m.row.refresh_field("print_format");
			m.readonly.refresh();
			rows.push({
				static: m.row.columns.print_format.static_area.text(),
				editor: m.optionRows(f).find((row) => row.value === record.name).text,
				readonly: m.readonly.$wrapper.find(".control-value").text(),
				raw: m.row.doc.print_format,
			});
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
	assert.equal(result.rows.length, 10);
	for (const row of result.rows)
		assert.deepEqual(row, {
			static: "Sales Order Classic",
			editor: "Sales Order Classic",
			readonly: "Sales Order Classic",
			raw: "Sales Order Classic",
		});
	assert.deepEqual(result.after, result.before);
});

test("printer captured empty owner cannot use a dedicated name", async ({ page }) => {
	await load(page, { owner: "" });
	await open(page);
	const result = await page.evaluate(() => ({
		static: window.memory.row.columns.print_format.static_area.text(),
		readonly: window.memory.readonly.$wrapper.find(".control-value").text(),
	}));
	assert.deepEqual(result, { static: "Sales Order Classic", readonly: "Sales Order Classic" });
});

test("printer label text is escaped without DOM-node returns or styling", async ({ page }) => {
	const name = 'Unsafe <&">',
		caption = 'Formato <b>speciale</b> & "citato"';
	await load(page, {
		records: [{ name, standard: "Yes" }],
		meta: { default_print_format: name },
		rows: [{ print_format: name, printer: "PRINTER-RAW" }],
		messages: { [name + ":Print Format Name"]: caption },
	});
	await open(page);
	const result = await page.evaluate(() => {
		const m = window.memory;
		m.row.toggle_editable_row(true);
		return {
			static: m.row.columns.print_format.static_area.text(),
			html: m.row.columns.print_format.static_area.html(),
			readonly: m.readonly.$wrapper.find(".control-value").text(),
			readonlyHtml: m.readonly.$wrapper.find(".control-value").html(),
			editor: m
				.optionRows(m.row.on_grid_fields_dict.print_format)
				.find((row) => row.value === m.row.doc.print_format).text,
			raw: m.row.doc.print_format,
			elements: m.row.columns.print_format.static_area.find("b,img,script").length,
			attributes:
				m.row.columns.print_format.static_area.find("span")[0]?.attributes.length ?? null,
		};
	});
	assert.equal(result.static, caption);
	assert.equal(result.readonly, caption);
	assert.equal(result.editor, caption);
	assert.equal(result.raw, name);
	assert.equal(result.elements, 0);
	assert.equal(result.attributes, 0);
	assert.equal(result.html, '<span>Formato &lt;b&gt;speciale&lt;/b&gt; &amp; "citato"</span>');
	assert.equal(result.readonlyHtml, result.html);
});

test("printer actual formatter preserves primitive empty fallback", async ({ page }) => {
	await load(page);
	await open(page);
	const result = await page.evaluate(() =>
		[null, undefined, "", 0].map((value) => {
			const df = window.memory.df;
			return {
				value,
				actual: frappe.format(value, df),
				previous: frappe.format(value, { ...df, formatter: undefined }),
			};
		})
	);
	for (const row of result) assert.equal(row.actual, row.previous);
});

test("printer repeated row lifecycle has one listener and canonical mapping", async ({ page }) => {
	await load(page);
	await open(page);
	const result = await page.evaluate(() => {
		const m = window.memory,
			before = m.snapshot(),
			rows = [];
		for (let i = 0; i < 4; i++) {
			m.row.toggle_editable_row(true);
			const f = m.row.on_grid_fields_dict.print_format,
				original = f.set_options;
			f.df.on_make?.(f);
			f.set_input("Sales Order Classic");
			rows.push({
				caption: m.optionRows(f).find((row) => row.value === "Sales Order Classic").text,
				listeners: m.listenerCount(f),
				same: f.set_options === original,
			});
			m.row.toggle_editable_row(false);
			m.row.show_form();
			const expanded = m.row.grid_form.fields_dict.print_format;
			rows.push({
				caption: m.optionRows(expanded).find((row) => row.value === "Sales Order Classic")
					.text,
				listeners: m.listenerCount(expanded),
				same: expanded.set_options === frappe.ui.form.ControlSelect.prototype.set_options,
			});
			m.row.hide_form();
		}
		return {
			rows,
			before,
			after: m.snapshot(),
			mapping: m.view.get_mapped_printer(),
			storage: m.storage,
		};
	});
	for (const row of result.rows)
		assert.deepEqual(row, {
			caption: "Ordine di vendita (classico)",
			listeners: 1,
			same: true,
		});
	assert.deepEqual(result.after, result.before);
	assert.deepEqual(result.mapping, [
		{ print_format: "Sales Order Classic", printer: "PRINTER-RAW" },
	]);
});

test("printer English unknown and stale owners remain raw", async ({ page }) => {
	await load(page, { emptyDictionary: true });
	await open(page);
	const result = await page.evaluate(() => {
		const m = window.memory,
			rows = [
				m.row.columns.print_format.static_area.text(),
				m.readonly.$wrapper.find(".control-value").text(),
			];
		frappe._messages = {
			"Sales Order Classic:Print Format Name": "Ordine di vendita (classico)",
		};
		m.view.frm.doctype = "Other";
		m.row.refresh_field("print_format");
		m.readonly.refresh();
		rows.push(
			m.row.columns.print_format.static_area.text(),
			m.readonly.$wrapper.find(".control-value").text()
		);
		m.view.frm.doctype = m.owner;
		return rows;
	});
	assert.deepEqual(result, [
		"Sales Order Classic",
		"Sales Order Classic",
		"Sales Order Classic",
		"Sales Order Classic",
	]);
});
