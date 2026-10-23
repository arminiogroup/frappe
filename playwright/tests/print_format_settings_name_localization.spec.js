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
	"frappe/public/js/frappe/form/doctype_settings/registry.js",
	"frappe/public/js/frappe/form/doctype_settings/tabs/print_format.js",
];
const sources = Object.fromEntries(
	paths.map((path) => [path, readFileSync(resolve(repository, path), "utf8")])
);
sources.jquery = readFileSync(require.resolve("jquery"), "utf8");
const TARGETS = {
	"Sales Order Classic:Print Format Name": "Ordine di vendita (classico)",
	"Sales Order Modern:Print Format Name": "Ordine di vendita (moderno)",
};

async function load(page, options = {}) {
	await page.route("**/*", (route) => route.abort());
	await page.setContent("<!doctype html><body></body>");
	return page.evaluate(
		async ({ sources, targets, options }) => {
			const w = window;
			w.eval(sources.jquery);
			const $ = w.jQuery;
			w.cstr = (value) => (value == null ? "" : String(value));
			w.cint = (value) => Number.parseInt(value || 0, 10);
			w.locals = {
				DocType: { "Sales Order": { name: "Sales Order", fields: [], is_submittable: 1 } },
			};
			const calls = [];
			const reads = [];
			const dialogs = [];
			const errors = [];
			const rows = options.rows || [
				{ name: "Sales Order Modern", standard: "Yes" },
				{ name: "Open", standard: "No" },
				{ name: "Sales Order Classic", standard: "Yes" },
			];
			w.frappe = {
				provide(path) {
					path.split(".").reduce((object, key) => (object[key] ||= {}), w);
				},
				ui: { form: {}, badge: { html: () => "" }, skeleton: () => $("<div>") },
				utils: {},
				model: {},
				meta: {},
				boot: { lang: options.lang || "it", sysdefaults: {} },
				_messages: options.emptyDictionary ? {} : { ...targets, ...options.messages },
				db: {
					async get_value(doctype, name, fieldname) {
						reads.push({ doctype, name, fieldname });
						return {
							message: {
								value: options.default || "Sales Order Classic",
								default_print_format: "",
							},
						};
					},
				},
				async call(request) {
					calls.push(structuredClone(request));
					if (request.method !== "frappe.desk.reportview.get_list")
						throw Error("Forbidden action or preview request");
					if (options.denied) throw Error("Read permission denied");
					return {
						message:
							request.args.doctype === "Print Format"
								? rows
								: options.sample
								? [{ name: "SAMPLE-RAW" }]
								: [],
					};
				},
				set_route() {
					throw Error("No editing or navigation action");
				},
				prompt() {
					throw Error("No create action");
				},
			};
			for (const path of Object.keys(sources).filter(
				(path) => path.endsWith(".js") && !path.endsWith("tabs/print_format.js")
			)) {
				w.eval(sources[path].replace(/^import .*;\n/gm, ""));
			}
			w.frappe.utils.icon = () => "<svg></svg>";
			w.frappe.ui.Dialog = class {
				constructor(settings) {
					this.settings = settings;
					this.fields_dict = { preview: { $wrapper: $("<div>") } };
					dialogs.push(this);
				}
				show() {}
			};
			w.frappe.doctype_settings.render_error = (_panel, _reload, error) =>
				errors.push(error.message);
			const path = "frappe/public/js/frappe/form/doctype_settings/tabs/print_format.js";
			w.eval(
				`${sources[path]}\nwindow.seedPreviewCache = (names) => names.forEach((name) => html_cache.set(\`Sales Order::\${name}::SAMPLE-RAW\`, Promise.resolve(null))); window.previewCacheKeys = () => [...html_cache.keys()];`
			);
			w.seedPreviewCache(rows.map((row) => row.name));
			const panel = {
				body: $("<div>").appendTo("body"),
				dialog: {
					hide() {
						throw Error("No edit action");
					},
				},
				set_view(view) {
					this.view = view;
				},
			};
			w.frappe.doctype_settings.builders["print-format"](panel, "Sales Order");
			const state = JSON.stringify(w.locals);
			panel.view.render();
			await new Promise((resolve) => setTimeout(resolve, 10));
			w.memory = { panel, rows, calls, reads, dialogs, errors, state };
			return {
				labels: panel.body
					.find(".dts-pf-name")
					.map((_, node) => node.textContent)
					.get(),
				canonical: panel.body
					.find(".dts-pf-thumb")
					.map((_, node) => $(node).data("pf"))
					.get(),
				calls,
				reads,
				errors,
				stateUnchanged: JSON.stringify(w.locals) === state,
			};
		},
		{ sources, targets: TARGETS, options }
	);
}

test("manager standard captions translate without changing canonical ordering or queries", async ({
	page,
}) => {
	const result = await load(page);
	assert.deepEqual(result.labels, [
		"Ordine di vendita (classico)",
		"Ordine di vendita (moderno)",
		"Open",
	]);
	assert.deepEqual(result.canonical, ["Sales Order Classic", "Sales Order Modern", "Open"]);
	assert.equal(result.calls.length, 2);
	assert.deepEqual(result.calls[0], {
		method: "frappe.desk.reportview.get_list",
		args: {
			fields: ["name", "standard"],
			limit: 0,
			filters: { doc_type: "Sales Order" },
			order_by: "standard asc, name asc",
			doctype: "Print Format",
		},
		type: "GET",
	});
	assert.deepEqual(result.calls[1].args, {
		fields: ["name"],
		limit: 1,
		filters: { docstatus: 1 },
		order_by: "modified desc",
		doctype: "Sales Order",
	});
	assert.deepEqual(
		result.reads.map((row) => row.doctype),
		["Property Setter", "DocType"]
	);
	assert.equal(result.stateUnchanged, true);
});

test("authored names and non-Yes standard values ignore global and dedicated collisions", async ({
	page,
}) => {
	const rows = [
		{ name: "Open", standard: "No" },
		{ name: "Sales Order Classic", standard: "No" },
		{ name: "Credit Note", standard: true },
		{ name: "Unknown" },
	];
	const result = await load(page, {
		rows,
		messages: {
			Open: "Aperto",
			"Open:Print Format Name": "Formato aperto",
			"Credit Note": "Nota di credito",
			"Credit Note:Print Format Name": "Documento a credito",
		},
	});
	const ordered = ["Sales Order Classic", "Open", "Credit Note", "Unknown"];
	assert.deepEqual(result.labels, ordered);
	assert.deepEqual(result.canonical, ordered);
});

test("preview title uses the same caption while cached render identity remains raw", async ({
	page,
}) => {
	await load(page, { sample: true });
	const result = await page.evaluate(async () => {
		const { panel, calls, dialogs } = window.memory;
		const before = [...window.previewCacheKeys()];
		panel.body.find(".dts-pf-thumb").first().trigger("click");
		await new Promise((resolve) => setTimeout(resolve, 10));
		return {
			title: dialogs[0].settings.title,
			calls,
			before,
			after: window.previewCacheKeys(),
		};
	});
	assert.equal(result.title, "Preview: Ordine di vendita (classico)");
	assert.deepEqual(result.after, result.before);
	assert.ok(result.after.includes("Sales Order::Sales Order Classic::SAMPLE-RAW"));
	assert.equal(result.calls.length, 2);
});

test("loaded standard rows remain eligible in the manager even when disabled elsewhere", async ({
	page,
}) => {
	const result = await load(page, {
		rows: [{ name: "Sales Order Classic", standard: "Yes", disabled: 1 }],
	});
	assert.deepEqual(result.labels, ["Ordine di vendita (classico)"]);
	assert.equal(Object.hasOwn(result.calls[0].args.filters, "disabled"), false);
});

test("reload reads current rows and locale without relabeling saved identities", async ({
	page,
}) => {
	await load(page);
	const result = await page.evaluate(async () => {
		const { panel, rows, state } = window.memory;
		rows[0].standard = "No";
		window.frappe.boot.lang = "fr";
		window.frappe._messages["Sales Order Classic:Print Format Name"] = "Commande (classique)";
		window.frappe._messages["Sales Order Modern:Print Format Name"] = "Commande (moderne)";
		panel.view.render();
		await new Promise((resolve) => setTimeout(resolve, 10));
		return {
			labels: panel.body
				.find(".dts-pf-name")
				.map((_, node) => node.textContent)
				.get(),
			unchanged: JSON.stringify(window.locals) === state,
			calls: window.memory.calls.length,
		};
	});
	assert.deepEqual(result.labels, ["Commande (classique)", "Sales Order Modern", "Open"]);
	assert.equal(result.unchanged, true);
	assert.equal(result.calls, 4);
});

test("literal names and translated markup stay text in cards and escaped preview titles", async ({
	page,
}) => {
	const name = 'Unsafe <&">';
	const target = 'Formato <b>speciale</b> & "citato"';
	const result = await load(page, {
		rows: [{ name, standard: "Yes" }],
		sample: true,
		default: name,
		messages: { [name + ":Print Format Name"]: target },
	});
	assert.deepEqual(result.labels, [target]);
	assert.deepEqual(result.canonical, [name]);
	const preview = await page.evaluate(() => {
		const { panel, dialogs } = window.memory;
		panel.body.find(".dts-pf-thumb").trigger("click");
		return {
			title: dialogs[0].settings.title,
			markup: panel.body.find(".dts-pf-name b,.dts-pf-name img").length,
		};
	});
	assert.equal(
		preview.title,
		"Preview: Formato &lt;b&gt;speciale&lt;/b&gt; &amp; &quot;citato&quot;"
	);
	assert.equal(preview.markup, 0);
});

test("missing dictionaries, empty results and denied read delivery retain existing fallbacks", async ({
	page,
}) => {
	let result = await load(page, { emptyDictionary: true });
	assert.deepEqual(result.labels, result.canonical);
	await page.reload();
	result = await load(page, { rows: [] });
	assert.deepEqual(result.labels, []);
	assert.equal(result.calls.length, 2);
	await page.reload();
	result = await load(page, { denied: true });
	assert.deepEqual(result.errors, ["Read permission denied"]);
	assert.deepEqual(result.labels, []);
});
