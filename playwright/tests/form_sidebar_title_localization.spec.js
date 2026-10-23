import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "@playwright/test";

const require = createRequire(__filename);
const repository = resolve(__dirname, "../..");
const read = (path) => readFileSync(resolve(repository, path), "utf8");
const paths = [
	"frappe/public/js/frappe/utils/utils.js",
	"frappe/public/js/frappe/dom.js",
	"frappe/public/js/frappe/translate.js",
	"frappe/public/js/frappe/model/model.js",
	"frappe/public/js/frappe/model/meta.js",
	"frappe/public/js/frappe/microtemplate.js",
	"frappe/public/js/frappe/form/formatters.js",
	"frappe/public/js/frappe/form/form.js",
	"frappe/public/js/frappe/form/sidebar/form_sidebar.js",
];
const sources = Object.fromEntries(paths.map((path) => [path, read(path)]));
sources.jquery = readFileSync(require.resolve("jquery"), "utf8");
sources.context = require("esbuild").transformSync(
	read("frappe/public/js/frappe/utils/select_option_context.ts"),
	{ loader: "ts", format: "iife", globalName: "contextModule" }
).code;
sources.template = read("frappe/public/js/frappe/form/templates/form_sidebar.html");
const metadata = [
	"frappe/core/doctype/doctype/doctype.json",
	"frappe/core/doctype/document_naming_rule/document_naming_rule.json",
	"frappe/core/doctype/comment/comment.json",
	"frappe/contacts/doctype/gender/gender.json",
].map((path) => JSON.parse(read(path)));
const messages = {
	User: "Utente",
	Like: "Mi piace",
	Open: "Aperto",
	Set: "Imposta",
	Female: "Femmina",
	"Document Naming Rule": "Regola di denominazione dei documenti",
	"New {0}": "Crea {0}",
	"Open:Sidebar Choice": "Opzione contestuale",
	"Open:Synthetic Title": "Opzione del tipo",
};

async function render(page, options = {}) {
	await page.setContent("<!doctype html><html><body></body></html>");
	return page.evaluate(
		({ sources, metadata, messages, options }) => {
			const w = window;
			const negativeValues = ["Open", "Set"];
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
					translated_doctypes: metadata
						.filter((row) => row.translated_doctype)
						.map((row) => row.name),
					sysdefaults: {},
				},
				session: { user: "translator@example.com" },
				templates: {},
				help: { has_help: () => false },
			};
			w.locals = { DocType: {} };
			for (const path of pathsForRuntime()) {
				w.eval(sources[path].replace(/^import .*;\n/gm, ""));
			}
			function pathsForRuntime() {
				return Object.keys(sources).filter(
					(path) =>
						path.endsWith(".js") &&
						!path.endsWith("formatters.js") &&
						!path.endsWith("form.js") &&
						!path.endsWith("form_sidebar.js")
				);
			}
			w.frappe.utils.icon = () => "";
			w.eval(sources.context);
			w.selectOptionContext = w.contextModule.selectOptionContext;
			for (const path of [
				"frappe/public/js/frappe/form/formatters.js",
				"frappe/public/js/frappe/form/form.js",
				"frappe/public/js/frappe/form/sidebar/form_sidebar.js",
			]) {
				w.eval(sources[path].replace(/^import .*;\n/gm, ""));
			}
			for (const source of metadata) {
				const meta = structuredClone(source);
				meta.fields = meta.fields.map((df) => ({ ...df, parent: meta.name }));
				w.locals.DocType[meta.name] = meta;
				w.frappe.meta.sync(meta);
			}
			if (options.field) {
				const meta = {
					name: "Synthetic Title",
					doctype: "DocType",
					title_field: "title",
					fields: [{ fieldname: "title", parent: "Synthetic Title", ...options.field }],
				};
				w.locals.DocType[meta.name] = meta;
				w.frappe.meta.sync(meta);
			}
			const doctype =
				options.doctype || (options.field ? "Synthetic Title" : "Document Naming Rule");
			const meta = w.frappe.get_meta(doctype);
			if (options.missingField) meta.title_field = "missing_field";
			const doc = { doctype, name: "EXAMPLE-1", document_type: "User", ...options.doc };
			if (options.removeValue) delete doc[meta.title_field];
			if (options.cacheTitle)
				w.frappe.utils.add_link_title(
					options.cacheTitle.doctype,
					doc[meta.title_field],
					options.cacheTitle.title
				);
			const frm = Object.create(w.frappe.ui.form.Form.prototype);
			Object.assign(frm, { doctype, docname: doc.name, meta, doc, fields_dict: {} });
			if (options.customTitle !== undefined) frm.get_title = () => options.customTitle;
			const df = meta.title_field && frm.get_docfield(meta.title_field);
			let formatterCalls = 0;
			const customFormatter = () => {
				formatterCalls++;
				return "Authored field caption";
			};
			if (options.customFormatter) df.formatter = customFormatter;
			if (options.lateFormatter)
				w.frappe.meta.docfield_map[doctype][meta.title_field].formatter = customFormatter;
			const title = frm.get_title();
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
			const html = w.frappe.render_template("form_sidebar", {
				doctype,
				frm,
				can_write: false,
				image_field: false,
			});
			const holder = $("<div>").html(html).appendTo(w.document.body);
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
				visibleHTML: titleNode.find("span").html(),
				modelTitle: frm.get_title(),
				rawTitle: title,
				copy: titleNode.attr("data-copy"),
				copied,
				name: nameNode.text().trim(),
				nameCopy: nameNode.attr("data-copy"),
				nameRows: nameNode.length,
				unexpectedElements: titleNode.find("img,script,style,svg,a").length,
				rawStateUnchanged: snapshot() === before,
				formatterCalls,
				formatterIdentityUnchanged:
					(!options.customFormatter || df.formatter === customFormatter) &&
					(!options.lateFormatter ||
						w.frappe.meta.docfield_map[doctype][meta.title_field].formatter ===
							customFormatter),
				globalOpen: w.__(negativeValues[0]),
				globalSet: w.__(negativeValues[1]),
				isNew: !!frm.is_new(),
			};
		},
		{ sources, metadata, messages, options }
	);
}

function unchanged(result, title, name = "EXAMPLE-1") {
	assert.equal(result.rawTitle, title);
	assert.equal(result.modelTitle, title);
	assert.equal(result.copy, title);
	assert.deepEqual(result.copied, title === name ? [title] : [title, name]);
	assert.equal(result.nameRows, title === name ? 0 : 1);
	assert.equal(result.nameCopy, title === name ? undefined : name);
	assert.equal(result.rawStateUnchanged, true);
	assert.equal(result.formatterCalls, 0);
	assert.equal(result.formatterIdentityUnchanged, true);
	assert.equal(result.unexpectedElements, 0);
}

test("metadata Link title display translates while the actual copy handler and model retain raw values", async ({
	page,
}) => {
	const result = await render(page);
	assert.equal(result.visible, "Utente");
	unchanged(result, "User");
});

test("Dynamic Link uses its current target and clones the field without changing metadata or cached values", async ({
	page,
}) => {
	for (const target of ["DocType", "User"]) {
		const result = await render(page, {
			field: { fieldtype: "Dynamic Link", options: "target" },
			doc: { target, title: target === "DocType" ? "User" : "Open" },
		});
		assert.equal(result.visible, target === "DocType" ? "Utente" : "Open");
		unchanged(result, target === "DocType" ? "User" : "Open");
		assert.equal(result.globalOpen, "Aperto");
	}
});

test("Select titles keep actual metadata parent and explicit context with English and missing-key fallback", async ({
	page,
}) => {
	const comment = await render(page, { doctype: "Comment", doc: { comment_type: "Like" } });
	assert.equal(comment.visible, "Mi piace");
	unchanged(comment, "Like");
	for (const [context, lang, value, expected] of [
		["Sidebar Choice", "it", "Open", "Opzione contestuale"],
		[undefined, "it", "Open", "Opzione del tipo"],
		["Sidebar Choice", "en", "Open", "Open"],
		["Sidebar Choice", "it", "Authored choice", "Authored choice"],
	]) {
		const result = await render(page, {
			field: { fieldtype: "Select", context },
			lang,
			doc: { title: value },
		});
		assert.equal(result.visible, expected);
		unchanged(result, value);
	}
});

test("empty missing zero and absent title fields preserve canonical name fallback and row equality", async ({
	page,
}) => {
	for (const options of [
		{ doc: { document_type: "" } },
		{ removeValue: true },
		{ field: { fieldtype: "Select" }, doc: { title: 0 } },
		{ missingField: true },
	]) {
		const result = await render(page, options);
		assert.equal(result.visible, "EXAMPLE-1");
		unchanged(result, "EXAMPLE-1");
	}
	const sameName = await render(page, { doc: { name: "User" } });
	assert.equal(sameName.visible, "Utente");
	unchanged(sameName, "User", "User");
});

test("cached Link titles display through the target policy without changing the raw copy or canonical field", async ({
	page,
}) => {
	const linked = await render(page, {
		doc: { document_type: "DocType" },
		cacheTitle: { doctype: "DocType", title: "User" },
	});
	assert.equal(linked.visible, "Utente");
	unchanged(linked, "User");
	const business = await render(page, {
		field: { fieldtype: "Link", options: "User" },
		doc: { title: "Open" },
		cacheTitle: { doctype: "User", title: "Set" },
	});
	assert.equal(business.visible, "Set");
	unchanged(business, "Set");
	assert.equal(business.globalSet, "Imposta");
});

test("new and explicitly supplied Form titles retain their existing display and copied values", async ({
	page,
}) => {
	const fresh = await render(page, {
		doc: { name: "new-document-naming-rule-example", __islocal: 1 },
	});
	assert.equal(fresh.visible, "Crea Regola di denominazione dei documenti");
	assert.equal(fresh.isNew, true);
	unchanged(
		fresh,
		"Crea Regola di denominazione dei documenti",
		"new-document-naming-rule-example"
	);
	const custom = await render(page, { customTitle: "Authored Open" });
	assert.equal(custom.visible, "Authored Open");
	unchanged(custom, "Authored Open");
});

test("explicit and late standard DocField formatters are never introduced into the sidebar title", async ({
	page,
}) => {
	for (const options of [{ customFormatter: true }, { lateFormatter: true }]) {
		const result = await render(page, options);
		assert.equal(result.visible, "User");
		unchanged(result, "User");
	}
});

test("authored business names and non-selector title field types stay raw despite global collisions", async ({
	page,
}) => {
	for (const fieldtype of [
		"Data",
		"Small Text",
		"Code",
		"Text Editor",
		"Read Only",
		"Date",
		"Link",
	]) {
		const result = await render(page, {
			field: { fieldtype, options: "User" },
			doc: { title: "Open" },
		});
		assert.equal(result.visible, "Open");
		unchanged(result, "Open");
		assert.equal(result.globalOpen, "Aperto");
	}
});

test("translated and authored HTML-like titles stay escaped while raw canonical copy remains unchanged", async ({
	page,
}) => {
	const translated = await render(page, {
		messages: { User: 'Utente <img src="x" onerror="throw 1"> sicuro' },
	});
	assert.equal(translated.visible, "Utente  sicuro");
	unchanged(translated, "User");
	const quoted = await render(page, {
		field: { fieldtype: "Link", options: "User" },
		doc: { title: 'Authored <&"> title' },
	});
	assert.equal(quoted.visible, 'Authored <&"> title');
	assert.equal(quoted.visibleHTML.includes("&lt;"), true);
	unchanged(quoted, 'Authored <&"> title');
});

test("translated DocTypes without a title field use their name translation context", async ({
	page,
}) => {
	const result = await render(page, { doctype: "Gender", doc: { name: "Female" } });
	assert.equal(result.visible, "Femmina");
	unchanged(result, "Female", "Female");
});
