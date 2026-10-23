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
	"utils/common.js",
	"form/form.js",
	"ui/components/breadcrumbs.js",
	"ui/page.js",
	"form/toolbar.js",
	"views/breadcrumbs.js",
];
const sources = Object.fromEntries(
	paths.map((path) => [path, read(`frappe/public/js/frappe/${path}`)])
);
sources.jquery = readFileSync(require.resolve("jquery"), "utf8");
sources.componentUtils = require("esbuild").transformSync(
	read("frappe/public/js/frappe/ui/components/utils.js"),
	{ format: "iife", globalName: "componentUtils" }
).code;
const messages = {
	Set: "Imposta",
	Open: "Aperto",
	Female: "Femmina",
	Gender: "Genere",
	"Set:Synthetic Name": "Insieme contestuale",
	"Set:Other Name": "Altro insieme",
	"New {0}": "Crea {0}",
};

async function render(page, options = {}) {
	await page.setContent("<!doctype html><html><head><title></title></head><body></body></html>");
	return page.evaluate(
		({ sources, messages, options }) => {
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
			const slug = (value) => value.toLowerCase().replaceAll(" ", "-");
			let route;
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
						options.flagged === false
							? []
							: ["Synthetic Name", "Other Name", "Gender"],
					sysdefaults: {},
					doctype_layouts: [],
				},
				session: { user: "translator@example.com" },
				router: {
					slug,
					get_sub_path: () => `${slug(route[1])}/${encodeURIComponent(route[2])}`,
				},
				get_route: () => route,
				get_route_str: () => route.join("/"),
				route_titles: {},
				is_mobile: () => false,
				user: { has_role: () => !!options.userManager },
			};
			w.locals = { DocType: {} };
			for (const path of [
				"utils/utils.js",
				"dom.js",
				"translate.js",
				"model/model.js",
				"model/meta.js",
				"utils/common.js",
			]) {
				w.eval(sources[path].replace(/^import .*;\n/gm, ""));
			}
			w.frappe.utils.icon = () => "";
			w.eval(sources.componentUtils);
			w.safe_attrs = w.componentUtils.safe_attrs;
			w.safe_href = w.componentUtils.safe_href;
			for (const path of [
				"form/form.js",
				"ui/components/breadcrumbs.js",
				"ui/page.js",
				"form/toolbar.js",
				"views/breadcrumbs.js",
			]) {
				w.eval(
					sources[path]
						.replace(/^import .*;\n/gm, "")
						.replace(/^export default .*;\n/gm, "")
				);
			}
			const doctype = options.doctype || "Synthetic Name";
			const doc = { doctype, name: "Set", ...options.doc };
			route = ["Form", doctype, doc.name];
			const meta = {
				doctype: "DocType",
				name: doctype,
				translated_doctype: options.metadataFlag ?? 1,
				fields: [],
				allow_rename: 1,
				...options.meta,
			};
			if (options.titleField) {
				meta.title_field = "title";
				meta.fields = [
					{
						fieldname: "title",
						fieldtype: options.fieldtype || "Data",
						options: "Synthetic Name",
						parent: doctype,
					},
				];
			}
			w.locals.DocType[doctype] = meta;
			w.frappe.meta.sync(meta);
			w.locals[doctype] = { [doc.name]: doc };
			if (options.cacheTitle)
				w.frappe.utils.add_link_title("Synthetic Name", doc.title, options.cacheTitle);
			const frm = Object.create(w.frappe.ui.form.Form.prototype);
			Object.assign(frm, {
				doctype,
				docname: doc.name,
				doc,
				meta,
				fields_dict: {},
				perm: [{ write: options.write ? 1 : 0 }],
			});
			if (options.customTitle) frm.get_title = () => options.customTitle;
			const copied = [];
			w.frappe.utils.copy_to_clipboard = (value) => copied.push(value);
			const page = Object.create(w.frappe.ui.Page.prototype);
			Object.assign(page, {
				$title_area: $(
					'<div><nav class="navbar-breadcrumbs"><ol></ol></nav></div>'
				).appendTo(w.document.body),
				$sub_title_area: $("<h6>").appendTo(w.document.body),
				breadcrumbs: [],
				set_document_title: true,
			});
			frm.page = page;
			const toolbar = Object.create(w.frappe.ui.form.Toolbar.prototype);
			Object.assign(toolbar, { frm, page, set_indicator: () => {} });
			const snapshot = () =>
				JSON.stringify({
					doc,
					meta,
					fields: w.frappe.meta.docfield_map,
					titles: w.frappe._link_titles,
				});
			const before = snapshot();
			const observations = [];
			function observe() {
				toolbar.set_title();
				const header = {
					label: page.title,
					text: page.$title_area.find(".es-breadcrumbs__label").last().text(),
					subtitle: page.$sub_title_area.text(),
					editable: page.$title_area.hasClass("editable-title"),
					documentTitle: w.document.title,
					routeTitles: { ...w.frappe.route_titles },
				};
				page.$sub_title_area[0].click();
				const plain = {
					doctype: frm.doctype,
					doc,
					meta,
					doctype_layout: frm.doctype_layout,
				};
				const direct = w.frappe.ui.form.get_breadcrumbs(options.plain ? plain : frm);
				page.set_breadcrumbs(direct);
				const directText = page.$title_area.find(".es-breadcrumbs__label").last().text();
				if (options.missingDoc) delete w.locals[doctype][doc.name];
				const legacyForm = w.frappe.breadcrumbs.form_items(
					{ doctype: frm.doctype, layout_name: options.layoutName },
					"form"
				);
				const legacyPrint = w.frappe.breadcrumbs.form_items(
					{ doctype: frm.doctype, layout_name: options.layoutName },
					"print"
				);
				if (options.missingDoc) w.locals[doctype][doc.name] = doc;
				page.set_breadcrumbs(legacyPrint);
				observations.push({
					header,
					direct: JSON.parse(JSON.stringify(direct)),
					directText,
					legacyForm: JSON.parse(JSON.stringify(legacyForm)),
					legacyPrint: JSON.parse(JSON.stringify(legacyPrint)),
					legacyText: page.$title_area.find(".es-breadcrumbs__label").last().text(),
					legacyHref: page.$title_area.find("a").last().attr("href"),
					unexpectedElements: page.$title_area.find("img,script,style,svg").length,
					rawModelTitle: w.frappe.model.get_doc_title(doc),
					rawFormTitle: frm.get_title(),
				});
			}
			if (options.layoutName) {
				frm.doctype_layout = {
					name: options.layoutName,
					title: "Authored Layout",
					condition: "{}",
				};
				w.frappe.boot.doctype_layouts = [frm.doctype_layout];
			}
			observe();
			if (options.rerender) {
				if (options.rerender.flagged === false) w.frappe.boot.translated_doctypes = [];
				if (options.rerender.titleField) {
					meta.title_field = "title";
					meta.fields = [{ fieldname: "title", fieldtype: "Data", parent: frm.doctype }];
					w.frappe.meta.sync(meta);
				}
				if (options.rerender.doctype) {
					const next = options.rerender.doctype;
					frm.doctype = doc.doctype = meta.name = next;
					w.locals.DocType[next] = meta;
					w.locals[next] = { [doc.name]: doc };
					route[1] = next;
				}
				if (options.rerender.name) {
					const next = options.rerender.name;
					delete w.locals[frm.doctype][doc.name];
					doc.name = frm.docname = route[2] = next;
					w.locals[frm.doctype][next] = doc;
				}
				observe();
			}
			return {
				observations,
				copied,
				unchanged: options.rerender ? null : snapshot() === before,
			};
		},
		{ sources, messages, options }
	);
}

function labels(result, expected) {
	const row = result.observations[0];
	assert.equal(row.header.label, expected);
	assert.equal(row.header.text, expected);
	assert.equal(row.direct.at(-1).label, expected);
	assert.equal(row.directText, expected);
	assert.equal(row.legacyForm.at(-1).label, expected);
	assert.equal(row.legacyPrint.at(-1).label, expected);
	assert.equal(row.legacyText, expected);
	assert.equal(row.legacyPrint.at(-1).href, "/desk/synthetic-name/Set");
	assert.equal(row.unexpectedElements, 0);
	assert.equal(result.unchanged, true);
	assert.equal(row.header.editable, false);
	assert.equal(row.header.subtitle, "");
	assert.deepEqual(result.copied, []);
}

test("header and both current and legacy breadcrumb producers retain the own target context", async ({
	page,
}) => {
	const result = await render(page);
	labels(result, "Insieme contestuale");
	assert.equal(result.observations[0].header.documentTitle, "Insieme contestuale");
	assert.equal(
		result.observations[0].header.routeTitles["synthetic-name/Set"],
		"Insieme contestuale"
	);
});

test("the current print breadcrumb accepts a plain frm without adding Form methods", async ({
	page,
}) => {
	const result = await render(page, { plain: true });
	labels(result, "Insieme contestuale");
});

test("boot eligibility is authoritative and global fallback remains unchanged", async ({
	page,
}) => {
	labels(await render(page, { metadataFlag: 0 }), "Insieme contestuale");
	labels(await render(page, { flagged: false }), "Imposta");
	const fallback = await render(page, { doc: { name: "Open", is_custom: 1 } });
	const row = fallback.observations[0];
	for (const value of [row.header.label, row.directText, row.legacyText])
		assert.equal(value, "Aperto");
	assert.equal(fallback.unchanged, true);
});

test("missing translations and English preserve the existing canonical display", async ({
	page,
}) => {
	labels(await render(page, { lang: "en" }), "Set");
	const unknown = await render(page, { doc: { name: "Authored Example" } });
	const row = unknown.observations[0];
	for (const value of [row.header.label, row.directText, row.legacyText])
		assert.equal(value, "Authored Example");
	assert.equal(unknown.unchanged, true);
});

test("every render uses the current boot flag, DocType and canonical name", async ({ page }) => {
	for (const [rerender, expected] of [
		[{ flagged: false }, "Imposta"],
		[{ titleField: true }, "Imposta"],
		[{ doctype: "Other Name" }, "Altro insieme"],
		[{ name: "Open" }, "Aperto"],
	]) {
		const result = await render(page, { rerender });
		for (const [i, value] of [
			[0, "Insieme contestuale"],
			[1, expected],
		]) {
			const row = result.observations[i];
			assert.equal(row.header.label, value);
			assert.equal(row.directText, value);
			assert.equal(row.legacyText, value);
		}
	}
});

test("custom Form title overrides do not replace the established header and model breadcrumb sources", async ({
	page,
}) => {
	const result = await render(page, { customTitle: "Authored display override" });
	labels(result, "Insieme contestuale");
	assert.equal(result.observations[0].rawFormTitle, "Authored display override");
	assert.equal(result.observations[0].rawModelTitle, "Set");
});

test("title field business values keep existing global lookup, subtitle copy and edit gates", async ({
	page,
}) => {
	const result = await render(page, {
		titleField: true,
		doc: { name: "EXAMPLE-1", title: "Open" },
		write: true,
	});
	const row = result.observations[0];
	assert.equal(row.header.label, "Aperto");
	assert.equal(row.directText, "Aperto");
	assert.equal(row.legacyText, "Aperto");
	assert.equal(row.header.subtitle, "EXAMPLE-1");
	assert.equal(row.header.editable, true);
	assert.deepEqual(result.copied, ["EXAMPLE-1"]);
	assert.equal(result.unchanged, true);
});

test("present empty missing zero and canonical-equal title fields preserve the existing global fallback", async ({
	page,
}) => {
	for (const doc of [{ title: "" }, {}, { title: 0 }, { title: "Set" }]) {
		const result = await render(page, { titleField: true, doc });
		labels(result, "Imposta");
	}
});

test("cached Link title and raw toolbar title remain distinct without changing canonical routes", async ({
	page,
}) => {
	const result = await render(page, {
		titleField: true,
		fieldtype: "Link",
		doc: { name: "EXAMPLE-1", title: "Open" },
		cacheTitle: "Set",
	});
	const row = result.observations[0];
	assert.equal(row.header.label, "Aperto");
	assert.equal(row.directText, "Imposta");
	assert.equal(row.legacyText, "Imposta");
	assert.equal(row.rawModelTitle, "Set");
	assert.equal(row.legacyPrint.at(-1).href, "/desk/synthetic-name/EXAMPLE-1");
	assert.equal(result.unchanged, true);
});

test("new documents and missing legacy documents keep existing fallback", async ({ page }) => {
	const fresh = await render(page, {
		doctype: "Gender",
		doc: { name: "new-gender-example", __islocal: 1 },
	});
	for (const value of [
		fresh.observations[0].header.label,
		fresh.observations[0].directText,
		fresh.observations[0].legacyText,
	])
		assert.equal(value, "Crea Genere");
	const missing = await render(page, { missingDoc: true });
	assert.equal(missing.observations[0].header.label, "Insieme contestuale");
	assert.equal(missing.observations[0].directText, "Insieme contestuale");
	assert.equal(missing.observations[0].legacyText, "Set");
	const local = await render(page, { doc: { __islocal: 1 } });
	assert.equal(local.observations[0].directText, "Imposta");
	assert.equal(local.observations[0].legacyText, "Imposta");
});

test("single and permission-hidden lists retain breadcrumb visibility and canonical print links", async ({
	page,
}) => {
	for (const options of [{ meta: { issingle: 1 } }, { doctype: "User" }]) {
		const result = await render(page, options);
		const row = result.observations[0];
		assert.equal(row.direct.length, 1);
		assert.equal(row.legacyForm.length, 1);
		assert.equal(
			row.legacyPrint.at(-1).href,
			`/desk/${options.doctype ? "user" : "synthetic-name"}/Set`
		);
		assert.equal(result.unchanged, true);
	}
});

test("tree and layout filters keep their raw navigation values", async ({ page }) => {
	const result = await render(page, { meta: { is_tree: 1 }, layoutName: "Authored Layout" });
	const row = result.observations[0];
	assert.equal(row.direct[0].href, "/desk/synthetic-name/view/Tree?reset_filters=1");
	assert.equal(row.direct[1].label, "Authored Layout");
	assert.equal(row.direct[1].href.includes("_layout=Authored+Layout"), true);
	assert.equal(row.directText, "Insieme contestuale");
	assert.equal(row.legacyPrint[0].label, "Authored Layout");
	assert.equal(row.legacyPrint.at(-1).href, "/desk/synthetic-name/Set");
	assert.equal(result.unchanged, true);
});

test("hostile translated captions stay inert while canonical route identities remain encoded", async ({
	page,
}) => {
	const target = 'Nome <img src="x" onerror="throw 1"> & "sicuro"';
	const result = await render(page, { messages: { "Set:Synthetic Name": target } });
	const row = result.observations[0];
	assert.equal(row.header.label, 'Nome  & "sicuro"');
	assert.equal(row.directText, 'Nome  & "sicuro"');
	assert.equal(row.legacyText, 'Nome  & "sicuro"');
	assert.equal(row.unexpectedElements, 0);
	assert.equal(row.legacyPrint.at(-1).href, "/desk/synthetic-name/Set");
	assert.equal(result.unchanged, true);
	const hostile = await render(page, { doc: { name: 'Authored /<&"> name' } });
	assert.equal(
		hostile.observations[0].legacyPrint.at(-1).href,
		"/desk/synthetic-name/Authored%20%2F%3C%26%22%3E%20name"
	);
	assert.equal(hostile.observations[0].unexpectedElements, 0);
	assert.equal(hostile.unchanged, true);
});
