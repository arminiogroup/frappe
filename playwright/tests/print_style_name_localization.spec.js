import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "@playwright/test";

const require = createRequire(__filename);
const repository = resolve(__dirname, "../..");
const esbuild = require("esbuild");
const paths = [
	"frappe/public/js/frappe/utils/utils.js",
	"frappe/public/js/frappe/translate.js",
	"frappe/public/js/frappe/model/model.js",
	"frappe/public/js/frappe/dom.js",
	"frappe/public/js/frappe/form/controls/base_control.js",
	"frappe/public/js/frappe/form/controls/base_input.js",
	"frappe/public/js/frappe/form/controls/data.js",
	"frappe/public/js/frappe/form/controls/select.js",
	"frappe/public/js/frappe/form/controls/control.js",
	"frappe/printing/page/print/print.js",
];
const read = (path) => readFileSync(resolve(repository, path), "utf8");
const sources = Object.fromEntries(paths.map((path) => [path, read(path)]));
sources.jquery = readFileSync(require.resolve("jquery"), "utf8");
sources.context = esbuild.transformSync(
	read("frappe/public/js/frappe/utils/select_option_context.ts"),
	{
		loader: "ts",
		format: "iife",
		globalName: "contextModule",
	}
).code;
const TARGETS = {
	"Redesign:Print Style": "Rinnovato",
	"Modern:Print Style": "Moderno",
	"Classic:Print Style": "Classico",
	"Striped:Print Style": "Righe alternate",
	"Monochrome:Print Style": "Monocromatico",
};

async function load(page, options = {}) {
	const errors = [];
	const requests = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route("**/*", (route) => {
		requests.push(route.request().url());
		return route.abort();
	});
	await page.setContent('<!doctype html><body><div id="sidebar"></div></body>');
	await page.evaluate(
		async ({ sources, targets, options }) => {
			window.eval(sources.jquery);
			window.cint = (value) => Number.parseInt(value || 0, 10);
			window.cstr = (value) => (value == null ? "" : String(value));
			window.is_null = (value) => value == null || value === "";
			window.locals = {
				":Print Format": {
					"Custom Format": { name: "Custom Format", custom_format: 1, raw_printing: 0 },
				},
			};
			const calls = { xcall: [], preview: 0, forbidden: 0 };
			const canonical = ["Redesign", "Modern", "Classic", "Striped", "Monochrome"];
			const styles =
				options.styles ||
				[
					"Custom first",
					"Monochrome",
					"Striped",
					"Classic",
					"Modern",
					"Redesign",
					"Custom last",
				].map((name) => ({
					name,
					label: options.lang === "en" ? name : targets[name + ":Print Style"] || name,
				}));
			const rowsBefore = JSON.stringify(styles);
			window.frappe = {
				provide(path) {
					path.split(".").reduce((object, key) => (object[key] ??= {}), window);
				},
				ui: { form: {} },
				utils: {},
				model: {},
				pages: { print: {} },
				boot: { lang: options.lang || "it", sysdefaults: {} },
				_messages: options.lang === "en" ? {} : { ...targets, ...options.messages },
				session: { user: "translator@example.com" },
				format: (value) => value,
				call() {
					calls.forbidden++;
					throw Error("RPC action forbidden");
				},
				xcall(method, args) {
					calls.xcall.push({ method, args: structuredClone(args) });
					if (method !== "frappe.printing.page.print.print.get_print_styles")
						throw Error("Unexpected read delivery");
					return Promise.resolve(
						args?.with_labels ? structuredClone(styles) : styles.map((row) => row.name)
					);
				},
			};
			window.open = () => {
				calls.forbidden++;
				throw Error("Print action forbidden");
			};
			for (const path of pathsForEval(sources))
				window.eval(sources[path].replace(/^import .*;\n/gm, ""));
			function pathsForEval(values) {
				return Object.keys(values).filter(
					(path) =>
						path.endsWith(".js") &&
						!path.endsWith("select.js") &&
						!path.endsWith("/controls/control.js")
				);
			}
			window.eval(sources.context);
			window.selectOptionContext = window.contextModule.selectOptionContext;
			window.eval(
				sources["frappe/public/js/frappe/form/controls/select.js"].replace(
					/^import .*;\n/gm,
					""
				)
			);
			window.eval(
				sources["frappe/public/js/frappe/form/controls/control.js"].replace(
					/^import .*;\n/gm,
					""
				)
			);
			const view = Object.create(frappe.ui.form.PrintView.prototype);
			view.sidebar = $("#sidebar");
			view.page_settings = $("<div>").appendTo(view.sidebar);
			view.print_settings = {
				print_style: options.defaultStyle || "Modern",
				print_font: "Inter",
			};
			view.print_format_selector = $("<select>").append(
				$('<option value="Standard">Standard</option>'),
				$('<option value="Custom Format">Custom Format</option>')
			);
			view.preview = () => {
				calls.preview++;
			};
			const settingsBefore = JSON.stringify(view.print_settings);
			view.setup_style_picker();
			await Promise.resolve();
			await Promise.resolve();
			const snapshot = () => ({
				names: view.print_styles,
				buttons: view.style_picker
					.find(".print-style-option")
					.map((index, button) => ({
						name: button.dataset.style,
						label: $(button).find(".print-style-name").text(),
						pressed: button.getAttribute("aria-pressed"),
						className: button.className,
						thumbClass: $(button).find(".print-style-thumb").attr("class"),
					}))
					.get(),
				selected: view.get_print_style(),
				settings: structuredClone(view.print_settings),
				visible: view.style_picker.css("display") !== "none",
			});
			const fontWrapper = view.style_picker.find('[data-fieldname="print_font"]').get(0);
			window.fixture = {
				view,
				calls,
				snapshot,
				canonical,
				styles,
				rowsBefore,
				settingsBefore,
				font: fontWrapper.fieldobj,
			};
		},
		{ sources, targets: TARGETS, options }
	);
	return async () => {
		assert.deepEqual(errors, []);
		assert.deepEqual(requests, []);
		assert.equal(await page.evaluate(() => window.fixture.calls.forbidden), 0);
		assert.equal(
			await page.evaluate(
				() => JSON.stringify(window.fixture.styles) === window.fixture.rowsBefore
			),
			true
		);
		assert.equal(
			await page.evaluate(
				() =>
					JSON.stringify(window.fixture.view.print_settings) ===
					window.fixture.settingsBefore
			),
			true
		);
	};
}

test("the real style picker displays owned labels while keeping canonical order and attributes", async ({
	page,
}) => {
	const finish = await load(page);
	const result = await page.evaluate(() => window.fixture.snapshot());
	assert.deepEqual(result.names, [
		"Redesign",
		"Modern",
		"Classic",
		"Striped",
		"Monochrome",
		"Custom first",
		"Custom last",
	]);
	assert.deepEqual(
		result.buttons.map((row) => row.label),
		[
			"Rinnovato",
			"Moderno",
			"Classico",
			"Righe alternate",
			"Monocromatico",
			"Custom first",
			"Custom last",
		]
	);
	assert.deepEqual(
		result.buttons.map((row) => row.name),
		result.names
	);
	assert.equal(result.buttons.find((row) => row.name === "Modern").pressed, "true");
	assert.equal(
		result.buttons.find((row) => row.name === "Modern").className.includes("active"),
		true
	);
	assert.equal(result.buttons[0].thumbClass, "print-style-thumb print-style-thumb--redesign");
	assert.equal(result.visible, true);
	await finish();
});

test("the picker opts into labels without replacing its actual font ControlSelect", async ({
	page,
}) => {
	const finish = await load(page);
	const result = await page.evaluate(() => ({
		calls: window.fixture.calls,
		fontIsActualSelect: window.fixture.font instanceof frappe.ui.form.ControlSelect,
		fontOptions: window.fixture.font.$input
			.find("option")
			.map((index, row) => row.value)
			.get(),
	}));
	assert.deepEqual(result.calls.xcall, [
		{
			method: "frappe.printing.page.print.print.get_print_styles",
			args: { with_labels: true },
		},
	]);
	assert.equal(result.calls.preview, 0);
	assert.equal(result.fontIsActualSelect, true);
	assert.deepEqual(result.fontOptions, [
		"",
		"Inter",
		"Roboto",
		"Open Sans",
		"Lato",
		"Noto Sans",
		"IBM Plex Sans",
		"Lora",
		"Merriweather",
	]);
	await finish();
});

test("returned custom canonical-name labels are not retranslated through global or context keys", async ({
	page,
}) => {
	const finish = await load(page, {
		styles: [
			{ name: "Classic", label: "Classic" },
			{ name: "Open", label: "Open" },
			{ name: "Modern", label: "Moderno" },
		],
		messages: {
			Classic: "Wrong global custom caption",
			"Classic:Print Style": "Wrong contextual custom caption",
			Open: "Wrong global name",
		},
	});
	const labels = await page.evaluate(() =>
		window.fixture.snapshot().buttons.map((row) => [row.name, row.label])
	);
	assert.deepEqual(labels, [
		["Modern", "Moderno"],
		["Classic", "Classic"],
		["Open", "Open"],
	]);
	await finish();
});

test("memory style selection keeps raw names and stored settings with only the preview boundary recorded", async ({
	page,
}) => {
	const finish = await load(page);
	const result = await page.evaluate(() => {
		const view = window.fixture.view;
		view.style_picker.find('[data-style="Monochrome"]').trigger("click");
		return {
			...window.fixture.snapshot(),
			calls: window.fixture.calls,
			rawProperty: view.print_style,
		};
	});
	assert.equal(result.selected, "Monochrome");
	assert.equal(result.rawProperty, "Monochrome");
	assert.equal(result.settings.print_style, "Modern");
	assert.equal(result.calls.preview, 1);
	assert.equal(result.calls.xcall.length, 1);
	assert.equal(result.buttons.find((row) => row.name === "Monochrome").pressed, "true");
	assert.equal(result.buttons.find((row) => row.name === "Modern").pressed, "false");
	await finish();
});

test("owned and authored labels remain text and canonical attributes escape exactly once", async ({
	page,
}) => {
	const custom = 'Custom "name" & <svg onload="wrong">';
	const label = 'Stile "citato" & <b>dettaglio</b>';
	const finish = await load(page, {
		styles: [
			{ name: custom, label: custom },
			{ name: "Modern", label },
		],
	});
	const result = await page.evaluate(() => ({
		rows: window.fixture.snapshot().buttons,
		bold: window.fixture.view.style_picker.find(".print-style-name b").length,
		injected: window.fixture.view.style_picker.find("[onload], [onerror]").length,
	}));
	assert.deepEqual(
		result.rows.map((row) => [row.name, row.label]),
		[
			["Modern", label],
			[custom, custom],
		]
	);
	assert.equal(result.bold, 0);
	assert.equal(result.injected, 0);
	await finish();
});

test("English and server raw-name fallbacks stay unchanged", async ({ page }) => {
	const finish = await load(page, { lang: "en" });
	const result = await page.evaluate(() => window.fixture.snapshot());
	assert.deepEqual(
		result.buttons.map((row) => row.label),
		result.names
	);
	assert.equal(
		await page.evaluate(() => window.fixture.view.print_style_label("Unknown name")),
		"Unknown name"
	);
	await finish();
});

test("empty responses and nonstandard formats preserve the existing hidden-picker guard", async ({
	page,
}) => {
	const finish = await load(page, { styles: [] });
	const result = await page.evaluate(() => {
		const view = window.fixture.view;
		const initial = window.fixture.snapshot();
		view.print_format_selector.val("Custom Format");
		view.toggle_style_picker();
		return { initial, custom: window.fixture.snapshot() };
	});
	assert.deepEqual(result.initial.buttons, []);
	assert.equal(result.initial.visible, false);
	assert.equal(result.custom.visible, false);
	assert.equal(result.custom.selected, "");
	await finish();
});

test("repeated rendering keeps returned label ownership and one click listener", async ({
	page,
}) => {
	const finish = await load(page, {
		messages: {
			Rinnovato: "Wrong second translation",
			Redesign: "Wrong global interpretation",
		},
	});
	const result = await page.evaluate(() => {
		const view = window.fixture.view;
		const first = window.fixture.snapshot();
		view.render_style_options();
		view.render_style_options();
		return {
			first,
			last: window.fixture.snapshot(),
			handlers: $._data(view.style_picker.get(0), "events").click.length,
			calls: window.fixture.calls,
		};
	});
	assert.equal(result.first.buttons[0].label, "Rinnovato");
	assert.deepEqual(result.last, result.first);
	assert.equal(result.handlers, 1);
	assert.equal(result.calls.preview, 0);
	assert.equal(result.calls.xcall.length, 1);
	await finish();
});
