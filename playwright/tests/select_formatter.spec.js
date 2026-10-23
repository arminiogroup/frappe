import { test, expect } from "../support";

test.describe("Select formatter", () => {
	test.beforeEach(async ({ page, desk }) => {
		await page.goto("/desk");
		await desk.ready();
	});

	test("uses field context before parent context and keeps the default fallback", async ({
		page,
	}) => {
		const formatted = await page.evaluate(() => {
			const messages = frappe._messages;
			frappe._messages = {
				...messages,
				Actual: "Effettivo",
				"Actual:Sales Taxes and Charges": "Importo fisso",
				"Actual:Budget Variance Report": "Consuntivo",
			};
			const df = {
				fieldtype: "Select",
				fieldname: "charge_type",
				parent: "Sales Taxes and Charges",
			};
			try {
				return {
					parent: frappe.format("Actual", df),
					context: frappe.format("Actual", { ...df, context: "Budget Variance Report" }),
					fallback: frappe.format("Actual", { ...df, context: "No translation" }),
					untranslated: frappe.format("Untranslated choice", df),
				};
			} finally {
				frappe._messages = messages;
			}
		});

		expect(formatted).toEqual({
			parent: "Importo fisso",
			context: "Consuntivo",
			fallback: "Effettivo",
			untranslated: "Untranslated choice",
		});
	});

	test("translates custom-formatted values without changing empty or non-string values", async ({
		page,
	}) => {
		const formatted = await page.evaluate(() => {
			const messages = frappe._messages;
			const previous_fields = frappe.meta.docfield_map["Select Formatter Test"];
			frappe._messages = {
				...messages,
				Actual: "Effettivo",
				"Original formatted:Select Formatter Test": "Scelta formattata",
			};
			frappe.meta.docfield_map["Select Formatter Test"] = {
				choice: { formatter: (value) => `${value} formatted` },
			};
			try {
				return {
					custom: frappe.format("Original", {
						fieldtype: "Select",
						fieldname: "choice",
						parent: "Select Formatter Test",
					}),
					without_field: frappe.form.formatters.Select("Actual"),
					null_value: frappe.form.formatters.Select(null),
					undefined_value: frappe.form.formatters.Select(undefined),
					zero: frappe.form.formatters.Select(0),
				};
			} finally {
				frappe._messages = messages;
				if (previous_fields === undefined) {
					delete frappe.meta.docfield_map["Select Formatter Test"];
				} else {
					frappe.meta.docfield_map["Select Formatter Test"] = previous_fields;
				}
			}
		});

		expect(formatted).toEqual({
			custom: "Scelta formattata",
			without_field: "Effettivo",
			null_value: "",
			undefined_value: "",
			zero: 0,
		});
	});
});
