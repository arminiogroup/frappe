import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "@playwright/test";

const require = createRequire(__filename);
const repository = resolve(__dirname, "../..");
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
	"frappe/public/js/frappe/form/controls/control.js",
	"frappe/public/js/frappe/views/communication.js",
];
const sources = Object.fromEntries(
	paths.map((path) => [path, readFileSync(resolve(repository, path), "utf8")])
);
sources.jquery = readFileSync(require.resolve("jquery"), "utf8");
sources.serial = readFileSync(resolve(repository, "frappe/public/js/frappe/dom.js"), "utf8");
sources.context = require("esbuild").transformSync(
	readFileSync(
		resolve(repository, "frappe/public/js/frappe/utils/select_option_context.ts"),
		"utf8"
	),
	{ loader: "ts", format: "iife", globalName: "contextModule" }
).code;
const TARGETS = {
	"Sales Order Classic:Print Format Name": "Ordine di vendita (classico)",
	"Sales Order Modern:Print Format Name": "Ordine di vendita (moderno)",
};

async function load(page, options = {}) {
	await page.route("**/*", (route) => route.abort());
	await page.setContent('<!doctype html><body><div id="fields"></div></body>');
	return page.evaluate(
		async ({ sources, targets, options }) => {
			const w = window;
			w.eval(sources.jquery);
			const $ = w.jQuery;
			$.fn.tooltip = function () {
				return this;
			};
			w.cstr = (value) => (value == null ? "" : String(value));
			w.cint = (value) => Number.parseInt(value || 0, 10);
			w.is_null = (value) => value == null || value === "";
			w.copy_dict = (value) => ({ ...value });
			w.strip_html = (value) => $("<div>").html(value).text();
			const records = options.records || [
				{ name: "Sales Order Classic", standard: "Yes" },
				{ name: "Sales Order Modern", standard: "Yes", default_print_language: "de" },
				{ name: "Open", standard: "No" },
				{ name: "Credit Note", standard: "No" },
				{ name: "Unknown", standard: "Yes" },
			];
			const formats = records.map((row) => ({
				doctype: ":Print Format",
				doc_type: "Sales Order",
				docstatus: 0,
				disabled: 0,
				print_format_for: "DocType",
				...row,
			}));
			w.locals = {
				DocType: {
					"Sales Order": {
						name: "Sales Order",
						fields: [],
						default_print_format: "Sales Order Classic",
					},
				},
				":Print Format": Object.fromEntries(formats.map((row) => [row.name, row])),
				":Print Settings": { "Print Settings": { enable_raw_printing: 0 } },
			};
			const synthetic = {
				Open: "Aperto",
				"Open:Print Format Name": "Formato aperto",
				"Credit Note": "Nota di credito",
				"Credit Note:Print Format Name": "Formato nota di credito",
				Standard: "Standard di prova",
			};
			const calls = [];
			const dialogs = [];
			const menus = [];
			w.frappe = {
				provide(path) {
					path.split(".").reduce((object, key) => (object[key] ||= {}), w);
				},
				ui: { form: {}, badge: { html: () => "" }, divider: { html: () => "" } },
				utils: {},
				model: { no_value_type: [], table_fields: [] },
				meta: {},
				views: {},
				boot: {
					lang: options.lang || "it",
					translated_doctypes: [],
					link_title_doctypes: [],
					sysdefaults: {},
					user: {},
					email_accounts: [],
				},
				_messages: options.emptyDictionary
					? {}
					: { ...targets, ...synthetic, ...options.messages },
				defaults: { is_enabled: () => true },
				session: { user: "translator@example.com" },
				get_route: () => [],
				format: (value) => value || "",
				call() {
					throw Error("No email, preview or external action");
				},
				db: {
					async get_value(...args) {
						calls.push(args);
						return { message: { name: "DEFAULT-LH-RAW" } };
					},
				},
			};
			for (const path of pathsForControls())
				w.eval(sources[path].replace(/^import .*;\n/gm, ""));
			function pathsForControls() {
				return Object.keys(sources).filter(
					(path) =>
						path.endsWith(".js") &&
						!path.endsWith("select.js") &&
						!path.endsWith("/controls/control.js") &&
						!path.endsWith("communication.js")
				);
			}
			w.frappe.utils.icon = () => "<svg></svg>";
			w.frappe.format = (value) => value || "";
			const dom = sources.serial;
			w.eval(
				dom.slice(dom.indexOf("frappe.run_serially ="), dom.indexOf("frappe.load_image ="))
			);
			w.eval(sources.context);
			w.selectOptionContext = w.contextModule.selectOptionContext;
			w.eval(
				sources["frappe/public/js/frappe/form/controls/select.js"].replace(
					/^import .*;\n/gm,
					""
				)
			);
			w.eval(
				sources["frappe/public/js/frappe/form/controls/control.js"].replace(
					/^import .*;\n/gm,
					""
				)
			);
			w.eval(
				sources["frappe/public/js/frappe/views/communication.js"].replace(
					/^import .*;\n/gm,
					""
				)
			);
			const control = (df) =>
				w.frappe.ui.form.make_control({
					df: { label: "Print Format", fieldtype: "Select", ...df },
					parent: w.document.querySelector("#fields"),
					render_input: 1,
					only_input: true,
				});
			const leaf = (value = "") => ({
				df: {},
				get_value() {
					return value;
				},
				set_input(next) {
					value = next;
				},
				set_value(next) {
					value = next;
					return Promise.resolve();
				},
				$input: $("<input>"),
			});
			const composer = Object.create(w.frappe.views.CommunicationComposer.prototype);
			composer.frm = {
				events: {},
				doctype: "Sales Order",
				meta: w.locals.DocType["Sales Order"],
				doc: { name: "ORDER-RAW", letter_head: "DOC-LH-RAW", ...options.doc },
				docname: "ORDER-RAW",
			};
			composer.doc = composer.frm.doc;
			composer.letter_head = "";
			composer.print_format = options.selected || "Sales Order Modern";
			composer._language_labels = { it: "Italiano", de: "Deutsch", fr: "Français" };
			const descriptor = composer
				.get_fields()
				.find((field) => field.fieldname === "select_print_format");
			const field = control(descriptor);
			const delegate = { calls: [], result: { tag: "instance-return" } };
			if (options.customSetOptions) {
				const original = field.set_options;
				field.set_options = function (value) {
					delegate.calls.push({ self: this === field, value });
					original.call(this, value);
					return delegate.result;
				};
			}
			const fields = {
				select_print_format: field,
				select_letter_head: leaf(),
				print_language: leaf("it"),
				attach_document_print: leaf(0),
				send_me_a_copy: leaf(0),
				send_read_receipt: leaf(0),
				send_after: leaf(),
				subject: leaf(),
			};
			composer.dialog = {
				fields_dict: fields,
				$body: $("<div>").appendTo("body"),
				$wrapper: $("<div>"),
				get_value: (name) => fields[name]?.get_value(),
				set_value: (name, value) => fields[name].set_value(value),
			};
			w.frappe.ui.button = () => $("<button>");
			w.frappe.ui.button.html = () => "<button></button>";
			w.frappe.ui.dropdown = (settings) => {
				if (settings.button?.tooltip === "Attach document print") menus.push(settings);
				return $("<button>");
			};
			w.frappe.ui.Dialog = class {
				constructor(settings) {
					this.settings = settings;
					this.fields_dict = {};
					for (const df of settings.fields) {
						this.fields_dict[df.fieldname] =
							df.fieldtype === "Select" ? control({ ...df }) : leaf(df.default);
						if (df.fieldtype === "Select" && df.default !== undefined)
							this.fields_dict[df.fieldname].set_input(df.default);
					}
					dialogs.push(this);
				}
				show() {}
				hide() {}
			};
			const snapshot = () => JSON.stringify({ locals: w.locals, doc: composer.doc });
			const state = snapshot();
			composer.setup_print();
			await new Promise((resolve) => setTimeout(resolve, 0));
			const optionRows = (value) =>
				Array.from(value.input.options).map((option) => ({
					value: option.value,
					text: option.textContent,
					selected: option.selected,
					disabled: option.disabled,
				}));
			w.memory = {
				composer,
				field,
				fields,
				dialogs,
				menus,
				calls,
				delegate,
				state,
				snapshot,
				optionRows,
				control,
			};
			return {
				options: optionRows(field),
				selected: composer.selected_format(),
				language: fields.print_language.get_value(),
				letterhead: fields.select_letter_head.get_value(),
				stateUnchanged: snapshot() === state,
				dfOptions: field.df.options,
			};
		},
		{ sources, targets: TARGETS, options }
	);
}

test("actual hidden Select keeps native values and displays only eligible standard captions", async ({
	page,
}) => {
	const result = await load(page);
	assert.equal(
		result.options.find((row) => row.value === "Sales Order Classic").text,
		"Ordine di vendita (classico)"
	);
	assert.equal(
		result.options.find((row) => row.value === "Sales Order Modern").text,
		"Ordine di vendita (moderno)"
	);
	for (const name of ["Open", "Credit Note", "Unknown"])
		assert.equal(result.options.find((row) => row.value === name).text, name);
	assert.equal(result.options.find((row) => row.value === "Standard").text, "Standard di prova");
	assert.equal(result.selected, "Sales Order Modern");
	assert.equal(result.language, "de");
	assert.equal(result.letterhead, "");
	assert.equal(result.stateUnchanged, true);
	assert.equal(result.dfOptions, undefined);
});

test("print-settings Select, lazy menu and composed metadata card use one caption policy", async ({
	page,
}) => {
	await load(page);
	const result = await page.evaluate(() => {
		const { composer, dialogs, menus, optionRows, fields } = window.memory;
		composer.open_print_settings();
		composer.render_composer_layout();
		composer.$composer
			.find(".email-composer-print-format")
			.append('<span class="email-composer-print-card__meta"></span>');
		composer.render_print_card_meta();
		return {
			settings: optionRows(dialogs[0].fields_dict.print_format),
			menu: menus[0].options().map((row) => row.label),
			card: composer.$composer.find(".email-composer-print-card__meta").text(),
			raw: fields.select_print_format.get_value(),
			selected: dialogs[0].fields_dict.print_format.get_value(),
		};
	});
	assert.equal(
		result.settings.find((row) => row.value === "Sales Order Classic").text,
		"Ordine di vendita (classico)"
	);
	assert.equal(result.settings.find((row) => row.value === "Credit Note").text, "Credit Note");
	assert.ok(result.menu.includes("Ordine di vendita (classico)"));
	assert.ok(result.menu.includes("Open"));
	assert.equal(result.card, "Ordine di vendita (moderno) • Deutsch");
	assert.equal(result.raw, "Sales Order Modern");
	assert.equal(result.selected, result.raw);
});

test("actual local menu callback retains canonical selection and language precedence", async ({
	page,
}) => {
	await load(page, { doc: { language: "fr" } });
	const result = await page.evaluate(async () => {
		const { composer, menus, fields, snapshot, state, calls } = window.memory;
		composer.render_composer_layout();
		const rows = menus[0].options();
		const classic =
			rows.find((row) => row.label === "Ordine di vendita (classico)") ||
			rows.find((row) => row.label === "Sales Order Classic");
		await classic.onclick();
		return {
			selected: composer.selected_format(),
			field: fields.select_print_format.get_value(),
			attach: fields.attach_document_print.get_value(),
			language: fields.print_language.get_value(),
			unchanged: snapshot() === state,
			external: calls,
		};
	});
	assert.equal(result.selected, "Sales Order Classic");
	assert.equal(result.field, "Sales Order Classic");
	assert.equal(result.attach, 1);
	assert.equal(result.language, "fr");
	assert.equal(result.unchanged, true);
	assert.deepEqual(result.external, []);
});

test("native change and print-settings local callback never store translated captions", async ({
	page,
}) => {
	await load(page);
	await page.locator("#fields select").first().selectOption("Sales Order Classic");
	const result = await page.evaluate(async () => {
		const { composer, dialogs, fields, snapshot, state } = window.memory;
		composer.open_print_settings();
		await dialogs[0].settings.primary_action({
			print_format: "Sales Order Modern",
			letter_head: "LH-RAW",
			print_language: "it",
		});
		return {
			selected: composer.selected_format(),
			values: Object.fromEntries(
				["select_print_format", "select_letter_head", "print_language"].map((name) => [
					name,
					fields[name].get_value(),
				])
			),
			unchanged: snapshot() === state,
		};
	});
	assert.deepEqual(result.values, {
		select_print_format: "Sales Order Modern",
		select_letter_head: "LH-RAW",
		print_language: "it",
	});
	assert.equal(result.selected, "Sales Order Modern");
	assert.equal(result.unchanged, true);
});

test("repeated setup delegates current instance set_options with exact this, value and return", async ({
	page,
}) => {
	await load(page, { customSetOptions: true });
	const result = await page.evaluate(() => {
		const { composer, field, delegate, optionRows } = window.memory;
		const schema = JSON.stringify(field.df.options);
		composer.setup_print();
		const before = delegate.calls.length;
		const result = field.set_options("Sales Order Modern");
		return {
			once: delegate.calls.length === before + 1,
			call: delegate.calls.at(-1),
			sameReturn: result === delegate.result,
			selected: composer.selected_format(),
			schema: JSON.stringify(field.df.options) === schema,
			options: optionRows(field),
		};
	});
	assert.equal(result.once, true);
	assert.deepEqual(result.call, { self: true, value: "Sales Order Modern" });
	assert.equal(result.sameReturn, true);
	assert.equal(result.schema, true);
	assert.equal(result.selected, "Sales Order Modern");
	assert.equal(
		result.options.find((row) => row.value === "Sales Order Classic").text,
		"Ordine di vendita (classico)"
	);
});

test("locale and dictionary changes refresh text even when options-array identity is unchanged", async ({
	page,
}) => {
	await load(page);
	const result = await page.evaluate(() => {
		const { field, optionRows } = window.memory;
		const oldOptions = field.last_options;
		window.frappe.boot.lang = "fr";
		window.frappe._messages["Sales Order Classic:Print Format Name"] = "Commande (classique)";
		field.set_input("Sales Order Classic");
		return {
			text: optionRows(field).find((row) => row.value === "Sales Order Classic").text,
			sameOptions: field.last_options === oldOptions,
			raw: field.get_value(),
		};
	});
	assert.equal(result.text, "Commande (classique)");
	assert.equal(result.sameOptions, true);
	assert.equal(result.raw, "Sales Order Classic");
});

test("current metadata ineligibility overrides prior translated display", async ({ page }) => {
	await load(page);
	const result = await page.evaluate(() => {
		const { field, composer, optionRows } = window.memory;
		const baseline = structuredClone(window.locals[":Print Format"]["Sales Order Classic"]);
		const observed = [];
		for (const update of [
			{ standard: "No" },
			{ disabled: 1 },
			{ docstatus: 2 },
			{ doc_type: "Other DocType" },
			{ name: "Different name" },
			{ print_format_for: "Report" },
		]) {
			window.locals[":Print Format"]["Sales Order Classic"] = { ...baseline, ...update };
			field.set_input("Sales Order Classic");
			observed.push(
				optionRows(field).find((row) => row.value === "Sales Order Classic").text
			);
		}
		window.locals[":Print Format"]["Sales Order Classic"] = baseline;
		composer.frm.doctype = "Different DocType";
		field.set_input("Sales Order Classic");
		observed.push(optionRows(field).find((row) => row.value === "Sales Order Classic").text);
		return observed;
	});
	assert.deepEqual(result, Array(7).fill("Sales Order Classic"));
});

test("actual namespace rename, disable sync and missing rows retain raw option identities", async ({
	page,
}) => {
	await load(page);
	const result = await page.evaluate(() => {
		const { field, optionRows } = window.memory;
		const original = structuredClone(window.locals[":Print Format"]["Sales Order Classic"]);
		window.frappe.model.rename_doc_in_locals("Print Format", original.name, "Renamed format");
		field.set_input(original.name);
		const renamed = optionRows(field).find((row) => row.value === original.name);
		window.frappe.model.sync_print_format_for_meta({
			...original,
			doctype: "Print Format",
			disabled: 1,
		});
		field.set_input(original.name);
		const disabled = optionRows(field).find((row) => row.value === original.name);
		window.locals[":Print Format"][original.name] = { name: original.name, standard: "Yes" };
		field.set_input(original.name);
		const partial = optionRows(field).find((row) => row.value === original.name);
		return { renamed, disabled, partial };
	});
	for (const row of Object.values(result)) assert.equal(row.text, "Sales Order Classic");
	for (const row of Object.values(result)) assert.equal(row.value, "Sales Order Classic");
});

test("authored collisions remain raw while translated markup is final literal option text", async ({
	page,
}) => {
	const name = 'Unsafe <&">';
	const caption = 'Formato <b>speciale</b> & "citato"';
	await load(page, {
		records: [
			{ name: "Sales Order Classic", standard: "Yes" },
			{ name: "Sales Order Modern", standard: "Yes" },
			{ name, standard: "Yes" },
			{ name: "Open", standard: "No" },
		],
		messages: { [name + ":Print Format Name"]: caption },
	});
	const result = await page.evaluate(() => {
		const { field, optionRows, composer, snapshot, state } = window.memory;
		const initial = {
			options: optionRows(field),
			markup: field.input.querySelectorAll("b,img").length,
			unchanged: snapshot() === state,
			raw: composer.selected_format(),
		};
		composer.frm.meta.default_print_format = "Missing default";
		composer.setup_print();
		return {
			...initial,
			missingDefault: optionRows(field).map((row) => row.value),
			missingDefaultSelected: composer.selected_format(),
		};
	});
	assert.deepEqual(result.missingDefault, [
		"Missing default",
		"Standard",
		"Open",
		name,
		"Sales Order Modern",
	]);
	assert.equal(result.missingDefaultSelected, "Sales Order Modern");
	assert.equal(result.options.find((row) => row.value === name).text, caption);
	assert.equal(result.options.find((row) => row.value === "Open").text, "Open");
	assert.equal(result.markup, 0);
	assert.equal(result.unchanged, true);
});

test("empty dictionaries, built-in Standard and missing form keep their existing fallback paths", async ({
	page,
}) => {
	const result = await load(page, { emptyDictionary: true, selected: "Standard" });
	assert.equal(result.options.find((row) => row.value === "Standard").text, "Standard");
	assert.ok(result.options.every((row) => row.text === row.value));
	assert.equal(result.selected, "Standard");
	assert.equal(result.language, "it");
	const noForm = await page.evaluate(() => {
		const { composer, fields, field, optionRows } = window.memory;
		composer.frm = null;
		fields.attach_document_print.wrapper = document.createElement("div");
		document.body.append(fields.attach_document_print.wrapper);
		composer.setup_print();
		field.set_input("Sales Order Classic");
		return {
			text: optionRows(field).find((row) => row.value === "Sales Order Classic").text,
			hidden: fields.attach_document_print.wrapper.style.display === "none",
			raw: composer.selected_format(),
		};
	});
	assert.equal(noForm.hidden, true);
	assert.equal(noForm.raw, "Sales Order Classic");
	assert.equal(noForm.text, "Sales Order Classic");
});
