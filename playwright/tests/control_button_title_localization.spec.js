import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "@playwright/test";

const require = createRequire(__filename);
const repository = resolve(__dirname, "../..");
const paths = [
	"frappe/public/js/frappe/utils/utils.js",
	"frappe/public/js/frappe/translate.js",
	"frappe/public/js/frappe/model/model.js",
	"frappe/public/js/frappe/form/controls/base_control.js",
	"frappe/public/js/frappe/form/controls/base_input.js",
	"frappe/public/js/frappe/form/controls/data.js",
	"frappe/public/js/frappe/form/controls/button.js",
	"frappe/public/js/frappe/form/controls/control.js",
];
const sources = Object.fromEntries(
	paths.map((path) => [path, readFileSync(resolve(repository, path), "utf8")])
);
sources.jquery = readFileSync(require.resolve("jquery"), "utf8");
const TARGETS = {
	"Update Rate and Availability": "Aggiorna costi unitari e disponibilità",
};
const stockField = {
	fieldname: "get_stock_and_rate",
	fieldtype: "Button",
	label: "Update Rate and Availability",
	oldfieldtype: "Button",
	options: "get_stock_and_rate",
	print_hide: 1,
	parent: "Stock Entry",
};

async function load(page, messages = TARGETS) {
	const errors = [];
	const requests = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route("**/*", (route) => {
		requests.push(route.request().url());
		return route.abort();
	});
	await page.setContent('<!doctype html><body><div id="fields"></div></body>');
	await page.evaluate(
		({ sources, messages, stockField }) => {
			window.eval(sources.jquery);
			window.cint = (value) => Number.parseInt(value || 0, 10);
			window.is_null = (value) => value == null || value === "";
			window.cstr = (value) => (value == null ? "" : String(value));
			window.locals = {};
			const actions = { click: 0, rpc: 0 };
			window.frappe = {
				provide(path) {
					path.split(".").reduce((object, key) => (object[key] ??= {}), window);
				},
				ui: { form: {} },
				utils: {},
				model: {},
				boot: { lang: "it" },
				_messages: { ...messages },
				session: { user: "translator@example.com" },
				format: (value) => value,
				call() {
					actions.rpc++;
					throw Error("RPC forbidden");
				},
			};
			for (const path of Object.keys(sources).filter((path) => path.endsWith(".js"))) {
				window.eval(sources[path].replace(/^import .*;\n/gm, ""));
			}
			const create = (properties = {}, render = true) => {
				const click = () => {
					actions.click++;
					throw Error("Button actions forbidden");
				};
				const df = { ...stockField, click, ...properties };
				const field = frappe.ui.form.make_control({
					parent: document.getElementById("fields"),
					render_input: render,
					df,
				});
				field.originalClick = click;
				return field;
			};
			const snapshot = (field) => ({
				caption: field.$input.text(),
				title: field.$input.attr("title"),
				fieldname: field.df.fieldname,
				label: field.df.label,
				options: field.df.options,
				type: field.$input.attr("type"),
				className: field.$input.attr("class"),
				clickIdentity: field.df.click === field.originalClick,
				clickListeners: $._data(field.input, "events").click.length,
				icons: field.$input.find("svg").length,
			});
			window.fixture = { create, snapshot, actions };
		},
		{ sources, messages, stockField }
	);
	return async () => {
		assert.deepEqual(await page.evaluate(() => window.fixture.actions), { click: 0, rpc: 0 });
		assert.deepEqual(errors, []);
		assert.deepEqual(requests, []);
	};
}

test("Stock Entry button fallback help matches its contextual caption", async ({ page }) => {
	const finish = await load(page);
	const result = await page.evaluate(() => {
		const field = window.fixture.create();
		return window.fixture.snapshot(field);
	});
	assert.equal(result.caption, "Aggiorna costi unitari e disponibilità");
	assert.equal(result.title, result.caption);
	assert.equal(result.label, "Update Rate and Availability");
	assert.equal(result.options, "get_stock_and_rate");
	assert.equal(result.fieldname, "get_stock_and_rate");
	assert.equal(result.type, "button");
	assert.equal(result.clickListeners, 1);
	assert.equal(result.clickIdentity, true);
	await finish();
});

test("make_input translates the fallback before later label refresh", async ({ page }) => {
	const finish = await load(page);
	const title = await page.evaluate(() => {
		const field = window.fixture.create({}, false);
		field.make_input();
		return field.$input.attr("title");
	});
	assert.equal(title, "Aggiorna costi unitari e disponibilità");
	await finish();
});

test("fallback help uses the same parent context as the caption", async ({ page }) => {
	const finish = await load(page, {
		Open: "Aperto",
		"Open:Stock Entry": "Apri contestuale",
		"Open:Other Parent": "Apri altro",
	});
	const values = await page.evaluate(() =>
		["Stock Entry", "Other Parent", undefined].map((parent) => {
			const field = window.fixture.create({ label: "Open", parent });
			return window.fixture.snapshot(field);
		})
	);
	assert.deepEqual(
		values.map(({ caption, title }) => [caption, title]),
		[
			["Apri contestuale", "Apri contestuale"],
			["Apri altro", "Apri altro"],
			["Aperto", "Aperto"],
		]
	);
	await finish();
});

test("set_label updates only the default help and retains callback identity", async ({ page }) => {
	const finish = await load(page, { ...TARGETS, "Open:Stock Entry": "Apri contestuale" });
	const result = await page.evaluate(() => {
		const field = window.fixture.create();
		const initial = window.fixture.snapshot(field);
		field.set_label("Open");
		return { initial, changed: window.fixture.snapshot(field) };
	});
	assert.equal(result.changed.caption, "Apri contestuale");
	assert.equal(result.changed.title, result.changed.caption);
	assert.equal(result.changed.label, "Open");
	for (const property of [
		"fieldname",
		"options",
		"type",
		"className",
		"clickIdentity",
		"clickListeners",
	]) {
		assert.equal(result.changed[property], result.initial[property]);
	}
	await finish();
});

test("refresh follows the active dictionary without rebuilding the button", async ({ page }) => {
	const finish = await load(page, { "Open:Stock Entry": "Apri iniziale" });
	const result = await page.evaluate(() => {
		const field = window.fixture.create({ label: "Open" });
		const input = field.input;
		frappe._messages["Open:Stock Entry"] = "Apri aggiornato";
		field.refresh();
		return { ...window.fixture.snapshot(field), sameInput: input === field.input };
	});
	assert.equal(result.caption, "Apri aggiornato");
	assert.equal(result.title, result.caption);
	assert.equal(result.sameInput, true);
	assert.equal(result.clickListeners, 1);
	await finish();
});

test("missing and empty translations preserve English source fallback", async ({ page }) => {
	const finish = await load(page, {
		"Update Rate and Availability": "",
		"Update Rate and Availability:Stock Entry": "",
	});
	const result = await page.evaluate(() => {
		const first = window.fixture.snapshot(window.fixture.create());
		frappe._messages = {};
		const second = window.fixture.snapshot(window.fixture.create());
		return [first, second];
	});
	for (const value of result) {
		assert.equal(value.caption, "Update Rate and Availability");
		assert.equal(value.title, value.caption);
	}
	await finish();
});

test("truthy explicit titles retain original HTML parsing and refresh behavior", async ({
	page,
}) => {
	const finish = await load(page, {
		...TARGETS,
		Open: "Aperto",
		"Explicit &amp; fixed": "Not used",
	});
	const result = await page.evaluate(() => {
		const field = window.fixture.create({ title: "Explicit &amp; fixed" });
		const initial = window.fixture.snapshot(field);
		field.set_label("Open");
		const changed = window.fixture.snapshot(field);
		field.df.title = "Another explicit title";
		field.refresh();
		return { initial, changed, refreshed: window.fixture.snapshot(field) };
	});
	assert.equal(result.initial.title, "Explicit & fixed");
	assert.equal(result.changed.title, result.initial.title);
	assert.equal(result.changed.caption, "Aperto");
	assert.equal(result.refreshed.title, result.initial.title);
	assert.equal(result.refreshed.caption, result.changed.caption);
	await finish();
});

test("explicit human titles still override SVG-only button labels", async ({ page }) => {
	const finish = await load(page);
	const result = await page.evaluate(() => {
		const label = '<svg aria-hidden="true"><use href="#icon-refresh"></use></svg>';
		const field = window.fixture.create({ label, title: "Human icon action" });
		field.refresh();
		return { ...window.fixture.snapshot(field), rawLabelPreserved: field.df.label === label };
	});
	assert.equal(result.title, "Human icon action");
	assert.equal(result.icons, 1);
	assert.equal(result.rawLabelPreserved, true);
	await finish();
});

test("fallback help excludes the visible icon markup", async ({ page }) => {
	const finish = await load(page);
	const result = await page.evaluate(() =>
		window.fixture.snapshot(window.fixture.create({ icon: "refresh" }))
	);
	assert.equal(result.icons, 1);
	assert.equal(result.caption.trim(), "Aggiorna costi unitari e disponibilità");
	assert.equal(result.title, "Aggiorna costi unitari e disponibilità");
	assert.equal(result.title.includes("<svg"), false);
	await finish();
});

test("fallback attributes escape exactly once while caption HTML remains unchanged", async ({
	page,
}) => {
	const translation = 'Azione "citata" & <b>dettaglio</b> ` =';
	const finish = await load(page, { "Quoted action": translation });
	const result = await page.evaluate(() => {
		const field = window.fixture.create({ label: "Quoted action" }, false);
		field.make_input();
		const initial = field.$input.attr("title");
		field.refresh();
		const refreshed = field.$input.attr("title");
		return {
			initial,
			refreshed,
			caption: field.$input.html(),
			boldElements: field.$input.find("b").length,
			unexpectedAttribute: field.$input.attr("onmouseover"),
		};
	});
	assert.equal(result.initial, translation);
	assert.equal(result.refreshed, translation);
	assert.equal(result.boldElements, 1);
	assert.equal(result.caption.includes("<b>dettaglio</b>"), true);
	assert.equal(result.unexpectedAttribute, undefined);
	await finish();
});

test("nullish labels and falsy explicit titles retain their original normalization", async ({
	page,
}) => {
	const finish = await load(page);
	const result = await page.evaluate(() => {
		const labels = [null, undefined, 0, false, ""];
		const normalized = labels.map((label) => {
			const field = window.fixture.create({ label });
			return { caption: field.$input.text(), title: field.$input.attr("title") };
		});
		const titles = [undefined, null, "", 0, false].map((title) => {
			const field = window.fixture.create({ title });
			return window.fixture.snapshot(field);
		});
		return { normalized, titles };
	});
	assert.deepEqual(result.normalized, [
		{ caption: "null", title: "" },
		{ caption: "undefined", title: "" },
		{ caption: "0", title: "0" },
		{ caption: "false", title: "false" },
		{ caption: "", title: "" },
	]);
	for (const value of result.titles) {
		assert.equal(value.title, "Aggiorna costi unitari e disponibilità");
	}
	await finish();
});

test("early label updates and repeated refresh preserve raw control attributes", async ({
	page,
}) => {
	const finish = await load(page, { Open: "Apri" });
	const result = await page.evaluate(() => {
		const field = window.fixture.create({ button_color: "Primary", btn_size: "sm" }, false);
		field.set_label("Open");
		field.refresh();
		const first = window.fixture.snapshot(field);
		field.set_label("");
		field.refresh();
		field.refresh();
		return { first, final: window.fixture.snapshot(field), canWrite: field.can_write() };
	});
	assert.equal(result.first.title, "Apri");
	assert.equal(result.first.caption, "Apri");
	assert.deepEqual(result.final, result.first);
	assert.equal(result.canWrite, true);
	assert.equal(result.final.className.includes("btn-sm"), true);
	assert.equal(result.final.className.includes("btn-primary"), true);
	assert.equal(result.final.options, "get_stock_and_rate");
	assert.equal(result.final.type, "button");
	assert.equal(result.final.clickIdentity, true);
	assert.equal(result.final.clickListeners, 1);
	await finish();
});
