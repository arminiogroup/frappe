import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "@playwright/test";

const require = createRequire(__filename);
const repository = resolve(__dirname, "../..");
const read = (path) => readFileSync(resolve(repository, path), "utf8");
const paths = [
	"utils/utils.js",
	"dom.js",
	"translate.js",
	"model/model.js",
	"model/meta.js",
	"microtemplate.js",
	"form/formatters.js",
	"form/form.js",
	"form/sidebar/form_sidebar.js",
];
const sources = Object.fromEntries(
	paths.map((path) => [path, read(`frappe/public/js/frappe/${path}`)])
);
sources.jquery = readFileSync(require.resolve("jquery"), "utf8");
sources.context = require("esbuild").transformSync(
	read("frappe/public/js/frappe/utils/select_option_context.ts"),
	{ loader: "ts", format: "iife", globalName: "contextModule" }
).code;
sources.template = read("frappe/public/js/frappe/form/templates/form_sidebar.html");
const gender = JSON.parse(read("frappe/contacts/doctype/gender/gender.json"));
const messages = {
	Female: "Femmina",
	Gender: "Genere",
	Set: "Imposta",
	Open: "Aperto",
	"New {0}": "Crea {0}",
	"Set:Synthetic Name": "Insieme contestuale",
	"0:Synthetic Name": "Zero contestuale",
};

async function render(page, options = {}) {
	await page.setContent("<!doctype html><html><body></body></html>");
	return page.evaluate(
		({ sources, gender, messages, options }) => {
			const w = window;
			w.eval(sources.jquery);
			const $ = w.jQuery;
			$.fn.tooltip = function () {
				return this;
			};
			$.format = (text, values) => text.replace(/\{(\d+)\}/g, (_, i) => values[i]);
			w.cstr = (value) => (value == null ? "" : String(value));
			w.cint = (value) => Number.parseInt(value || 0, 10);
			w.is_null = (value) => value == null || value === "";
			w.copy_dict = (value) => ({ ...value });
			w.strip_html = (value) => $("<div>").html(value).text();
			w.frappe = {
				provide(path) {
					path.split(".").reduce((object, key) => (object[key] ||= {}), w);
				},
				ui: { form: {}, badge: { html: () => "" }, button: { html: () => "" } },
				utils: {},
				_messages: options.lang === "en" ? {} : { ...messages, ...options.messages },
				boot: {
					lang: options.lang || "it",
					translated_doctypes:
						options.flagged === false ? [] : ["Gender", "Synthetic Name"],
					sysdefaults: {},
				},
				session: { user: "translator@example.com" },
				templates: {},
				help: { has_help: () => false },
			};
			w.locals = { DocType: {} };
			for (const path of [
				"utils/utils.js",
				"dom.js",
				"translate.js",
				"model/model.js",
				"model/meta.js",
				"microtemplate.js",
			]) {
				w.eval(sources[path].replace(/^import .*;\n/gm, ""));
			}
			w.frappe.utils.icon = () => "";
			w.eval(sources.context);
			w.selectOptionContext = w.contextModule.selectOptionContext;
			for (const path of [
				"form/formatters.js",
				"form/form.js",
				"form/sidebar/form_sidebar.js",
			]) {
				w.eval(sources[path].replace(/^import .*;\n/gm, ""));
			}
			const doctype = options.doctype || "Synthetic Name";
			const meta =
				doctype === "Gender"
					? structuredClone(gender)
					: {
							name: doctype,
							doctype: "DocType",
							translated_doctype: options.metadataFlag ?? 1,
							fields: options.titleField
								? [
										{
											fieldname: "title",
											fieldtype: options.fieldtype || "Data",
											label: "Title",
										},
								  ]
								: [],
					  };
			if (options.titleField) meta.title_field = "title";
			meta.fields = meta.fields.map((df) => ({ ...df, parent: doctype }));
			w.locals.DocType[doctype] = meta;
			w.frappe.meta.sync(meta);
			const doc = { doctype, name: "Set", ...options.doc };
			if (options.missingName) delete doc.name;
			w.locals[doctype] = { [doc.name]: doc };
			if (options.cacheTitle)
				w.frappe.utils.add_link_title(doctype, doc.name, options.cacheTitle);
			const frm = Object.create(w.frappe.ui.form.Form.prototype);
			Object.assign(frm, { doctype, docname: doc.name, doc, meta, fields_dict: {} });
			if (Object.hasOwn(options, "customTitle")) frm.get_title = () => options.customTitle;
			if (meta.title_field) frm.get_docfield(meta.title_field);
			const snapshot = () =>
				JSON.stringify({
					doc,
					meta,
					fields: w.frappe.meta.docfield_map,
					copies: w.frappe.meta.docfield_copy,
					titles: w.frappe._link_titles,
				});
			const before = snapshot();
			w.frappe.templates.form_sidebar = sources.template;
			const holder = $("<div>")
				.html(
					w.frappe.render_template("form_sidebar", {
						doctype,
						frm,
						can_write: false,
						image_field: false,
					})
				)
				.appendTo(w.document.body);
			const copied = [];
			w.frappe.utils.copy_to_clipboard = (value) => copied.push(value);
			const sidebar = new w.frappe.ui.form.Sidebar({ sidebar: holder });
			sidebar.setup_copy_event();
			const titleNode = holder.find(".form-title-text");
			titleNode[0].click();
			const nameNode = holder.find(".form-name-copy");
			if (nameNode.length) nameNode[0].click();
			return {
				visible: titleNode.find("span").text(),
				html: titleNode.find("span").html(),
				model: frm.get_title(),
				copy: titleNode.attr("data-copy"),
				copied,
				nameRows: nameNode.length,
				nameCopy: nameNode.attr("data-copy"),
				unexpectedElements: titleNode.find("img,script,svg,a").length,
				unchanged: snapshot() === before,
				selfLink: w.frappe.format(
					doc.name,
					{ fieldtype: "Link", options: doctype },
					{ only_value: true },
					doc
				),
			};
		},
		{ sources, gender, messages, options }
	);
}

function raw(result, title, name = title) {
	assert.equal(result.model, title);
	assert.equal(result.copy, title);
	assert.deepEqual(result.copied, title === name ? [title] : [title, String(name)]);
	assert.equal(result.nameRows, title === name ? 0 : 1);
	assert.equal(result.nameCopy, title === name ? undefined : String(name));
	assert.equal(result.unchanged, true);
	assert.equal(result.unexpectedElements, 0);
}

test("name-only metadata uses its existing target context and preserves the canonical copy handler", async ({
	page,
}) => {
	const result = await render(page);
	assert.equal(result.visible, "Insieme contestuale");
	raw(result, "Set");
});

test("real Frappe translated metadata names display with the same dictionary used by links", async ({
	page,
}) => {
	const result = await render(page, { doctype: "Gender", doc: { name: "Female" } });
	assert.equal(result.visible, "Femmina");
	raw(result, "Female");
});

test("boot opt-in is authoritative even when the local metadata flag differs", async ({
	page,
}) => {
	const optedIn = await render(page, { metadataFlag: 0 });
	assert.equal(optedIn.visible, "Insieme contestuale");
	raw(optedIn, "Set");
	const optedOut = await render(page, { flagged: false });
	assert.equal(optedOut.visible, "Set");
	raw(optedOut, "Set");
});

test("context misses retain existing global fallback including authored name collisions", async ({
	page,
}) => {
	const result = await render(page, { doc: { name: "Open", is_custom: 1 } });
	assert.equal(result.visible, "Aperto");
	raw(result, "Open");
});

test("cached self-link titles never replace the actual model name or raw copied identity", async ({
	page,
}) => {
	const result = await render(page, { cacheTitle: "Open" });
	assert.equal(result.visible, "Insieme contestuale");
	assert.equal(result.selfLink, "Aperto");
	raw(result, "Set");
});

test("English and unknown authored names keep untranslated fallback", async ({ page }) => {
	for (const options of [{ lang: "en" }, { doc: { name: "Authored Example" } }]) {
		const result = await render(page, options);
		const expected = options.doc?.name || "Set";
		assert.equal(result.visible, expected);
		raw(result, expected);
	}
});

test("new documents and distinct supplied Form titles retain their existing output", async ({
	page,
}) => {
	const fresh = await render(page, {
		doctype: "Gender",
		doc: { name: "new-gender-example", __islocal: 1 },
	});
	assert.equal(fresh.visible, "Crea Genere");
	raw(fresh, "Crea Genere", "new-gender-example");
	for (const title of ["Authored Open", "", 0]) {
		const result = await render(page, { customTitle: title });
		assert.equal(result.visible, String(title));
		assert.equal(result.model, title);
		assert.equal(result.copy, String(title));
		assert.equal(result.unchanged, true);
	}
});

test("present empty missing and zero title fields retain their canonical-name fallback", async ({
	page,
}) => {
	for (const doc of [{ title: "" }, {}, { title: 0 }]) {
		const result = await render(page, { titleField: true, doc });
		assert.equal(result.visible, "Set");
		raw(result, "Set");
	}
	const authored = await render(page, { titleField: true, doc: { title: "Open" } });
	assert.equal(authored.visible, "Open");
	raw(authored, "Open", "Set");
});

test("translated markup is escaped and canonical quoted names remain raw for copying", async ({
	page,
}) => {
	const name = 'Authored <&"> name';
	const target = 'Nome <img src="x" onerror="throw 1"> & "sicuro"';
	const result = await render(page, {
		doc: { name },
		messages: { [`${name}:Synthetic Name`]: target },
	});
	assert.equal(result.visible, 'Nome  & "sicuro"');
	assert.equal(result.html.includes("<img"), false);
	assert.equal(result.html.includes("&amp;"), true);
	raw(result, name);
});

test("empty missing and numeric names retain the model string and raw equality behavior", async ({
	page,
}) => {
	for (const options of [{ doc: { name: "" } }, { missingName: true }]) {
		const result = await render(page, options);
		const name = options.missingName ? undefined : "";
		assert.equal(result.visible, String(name));
		if (options.missingName) {
			assert.equal(result.model, "undefined");
			assert.equal(result.copy, "undefined");
			assert.deepEqual(result.copied, ["undefined", "undefined"]);
			assert.equal(result.nameRows, 1);
			assert.equal(result.nameCopy, "undefined");
			assert.equal(result.unchanged, true);
		} else raw(result, String(name), name);
	}
	const zero = await render(page, { doc: { name: "0" } });
	assert.equal(zero.visible, "Zero contestuale");
	raw(zero, "0");
});
