import { test, expect } from "../support";

test.describe("Filter Group", () => {
	test("preserves numeric filter values with a comma decimal separator", async ({
		page,
		desk,
	}) => {
		await page.goto("/desk/website");
		await desk.ready();

		const filters = await page.evaluate(async () => {
			const original_number_format = frappe.boot.sysdefaults.number_format;
			frappe.boot.sysdefaults.number_format = "#.###,##";
			await frappe.model.with_doctype("Currency");

			const $parent = $("<div>").appendTo("body");
			try {
				const filter_group = new frappe.ui.FilterGroup({
					parent: $parent,
					doctype: "Currency",
					on_change: () => {},
				});

				await filter_group.add_filter(
					"Currency",
					"smallest_currency_fraction_value",
					"=",
					7.95
				);

				return filter_group.get_filters();
			} finally {
				$parent.remove();
				frappe.boot.sysdefaults.number_format = original_number_format;
			}
		});

		expect(filters).toEqual([["Currency", "smallest_currency_fraction_value", "=", 7.95]]);
	});

	test("translates the applied-filter count title and preserves the button state", async ({
		page,
		desk,
	}) => {
		await page.goto("/desk/website");
		await desk.ready();

		const observed = await page.evaluate(() => {
			const messages = frappe._messages;
			const previous_filter_group = window.fltr;
			const $parent = $("<div>").appendTo("body");
			try {
				const filter_group = new frappe.ui.FilterGroup({
					parent: $parent,
					doctype: "Currency",
					on_change: () => {},
				});
				const $button = $(
					'<button class="btn btn-default"><span class="filter-icon"></span><span class="button-label"></span></button>'
				).appendTo($parent);
				filter_group.filter_button = $button;
				const titles = [];
				const states = [];
				for (const dictionary of [
					{
						Filter: "Filtro",
						"Filters {0}": "Filtri {0}",
						"{0} Filter Applied": "{0} filtro applicato",
						"{0} Filters Applied": "{0} filtri applicati",
					},
					{},
				]) {
					frappe._messages = dictionary;
					for (const count of [1, 2, 12, 0, 1]) {
						const filters = Array.from({ length: count }, () => ({}));
						filter_group.filters = filters;
						filter_group.update_filter_button();
						titles.push($button.attr("title"));
						states.push({
							label: $button.find(".button-label").text(),
							badge: $button.find(".filter-label").text(),
							active: $button.hasClass("btn-primary-light"),
							default: $button.hasClass("btn-default"),
							icon: $button.find(".filter-icon").hasClass("active"),
							same_filters: filter_group.filters === filters,
						});
					}
				}
				return { titles, states };
			} finally {
				$parent.remove();
				frappe._messages = messages;
				if (previous_filter_group === undefined) {
					delete window.fltr;
				} else {
					window.fltr = previous_filter_group;
				}
			}
		});

		expect(observed.titles).toEqual([
			"1 filtro applicato",
			"2 filtri applicati",
			"12 filtri applicati",
			"0 filtri applicati",
			"1 filtro applicato",
			"1 Filter Applied",
			"2 Filters Applied",
			"12 Filters Applied",
			"0 Filters Applied",
			"1 Filter Applied",
		]);
		expect(observed.states).toEqual(
			["Filtri", "Filters"].flatMap((label) =>
				[1, 2, 12, 0, 1].map((count) => ({
					label: count ? `${label} ${count}` : label === "Filtri" ? "Filtro" : "Filter",
					badge: count ? String(count) : "",
					active: count > 0,
					default: count === 0,
					icon: count > 0,
					same_filters: true,
				}))
			)
		);
	});

	test("applies a combobox MultiSelect pick in a filter row", async ({ page, desk }) => {
		await page.goto("/desk/website");
		await desk.ready();
		await page.evaluate(async () => {
			// the combobox for this page only: other tests run with the setting as it is
			frappe.sys_defaults.enable_combobox_link_field = 1;
			await frappe.model.with_doctype("ToDo");
			const $parent = $('<div class="test-filter-group">').appendTo(
				".page-container:visible .page-body"
			);
			window.test_filter_group = new frappe.ui.FilterGroup({
				parent: $parent,
				doctype: "ToDo",
				on_change: () => window.test_filter_changes++,
			});
			await window.test_filter_group.add_filter("ToDo", "priority", "in", ["High"]);
		});
		// only the pick counts, not the row being added
		await page.waitForFunction(() => frappe.request.ajax_count === 0);
		await page.evaluate(() => (window.test_filter_changes = 0));

		await page.locator(".test-filter-group .filter-field .es-combobox").click();
		await page
			.locator(".es-combobox__panel[data-state='open']")
			.getByRole("option", { name: "Medium", exact: true })
			.click();

		await expect.poll(() => page.evaluate(() => window.test_filter_changes)).toBe(1);
		expect(await page.evaluate(() => window.test_filter_group.get_filters())).toEqual([
			["ToDo", "priority", "in", ["High", "Medium"]],
		]);
	});
});
