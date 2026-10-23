// Copyright (c) 2018, Frappe Technologies and contributors
// For license information, please see license.txt

frappe.ui.form.on("Print Settings", {
	print_style: function (frm) {
		frappe.db.get_value("Print Style", frm.doc.print_style, "preview").then((r) => {
			if (r.message.preview) {
				frm.get_field("print_style_preview").$wrapper.html(
					`<img src="${r.message.preview}" class="img-responsive">`
				);
			} else {
				frm.get_field("print_style_preview").$wrapper.html(
					`<p style="margin: 60px 0px" class="text-center text-muted">${__(
						"No Preview"
					)}</p>`
				);
			}
		});
	},
	onload: function (frm) {
		setup_print_settings_style_link(frm);
		frm.script_manager.trigger("print_style");
	},
});

function setup_print_settings_style_link(frm) {
	const field = frm?.fields_dict?.print_style;
	const Link = frappe.ui.form.ControlLink.prototype;
	const names = ["Redesign", "Modern", "Classic", "Striped", "Monochrome"];
	const identity = () =>
		frm?.doctype === "Print Settings" &&
		frm.doc?.doctype === "Print Settings" &&
		field &&
		field.frm === frm &&
		field.df.fieldname === "print_style" &&
		field.df.fieldtype === "Link" &&
		field.df.options === "Print Style" &&
		field.df.parent === "Print Settings";
	if (!identity()) return false;
	const existing = field._print_settings_style_labels;
	if (existing) {
		if (existing.document !== frm.doc) {
			if (
				frm.doc.name !== "Print Settings" ||
				frm.docname !== frm.doc.name ||
				existing.document.name !== frm.doc.name ||
				!existing.retire()
			)
				return false;
		} else {
			existing.attach();
			existing.load("", true);
			return true;
		}
	}
	let own_filter = null;
	const custom = () =>
		Boolean(
			field.get_query ||
				field.df.get_query ||
				field.df.query ||
				field.df.filters ||
				field.df.link_filters ||
				field.get_search_args !== Link.get_search_args ||
				field.get_options !== Link.get_options ||
				field.get_reference_doctype !== Link.get_reference_doctype ||
				field.set_custom_query !== Link.set_custom_query ||
				field.df.formatter ||
				field.formatter ||
				(field.custom_awesomplete_filter &&
					field.custom_awesomplete_filter !== own_filter) ||
				field.df.read_only ||
				field.df.ignore_user_permissions ||
				field.df.label !== "Print Style" ||
				(frappe.boot.link_title_doctypes || []).includes("Print Style") ||
				(frappe.boot.translated_doctypes || []).includes("Print Style")
		);
	if (
		custom() ||
		field.get_translated !== Link.get_translated ||
		field.on_input !== Link.on_input ||
		field.merge_duplicates !== Link.merge_duplicates
	)
		return false;
	const document = frm.doc;
	const original = {
		get_translated: field.get_translated,
		on_input: field.on_input,
		merge_duplicates: field.merge_duplicates,
		custom_awesomplete_filter: field.custom_awesomplete_filter,
	};
	const raw = Symbol("owned-caption-raw-row");
	const extra = Symbol("owned-supplement-row");
	const state = {
		document,
		retired: false,
		source: null,
		labels: new Map(),
		choices: [],
		sequence: 0,
		owned_displays: new Map(),
		ready: false,
		term: "",
	};
	const local_row = (name) => locals["Print Style"]?.[name] || locals[":Print Style"]?.[name];
	const eligible_local = (name) => {
		const row = local_row(name);
		return !row || (row.name === name && cint(row.standard) === 1 && !cint(row.disabled));
	};
	const alias_available = (name, caption) => {
		const mapped = field.title_value_map?.[caption];
		return !mapped || mapped === name || state.owned_displays.get(caption) === mapped;
	};
	const source = () =>
		JSON.stringify([
			frappe.boot.lang,
			frm.doctype,
			frm.docname,
			field.df.parent,
			field.df.fieldname,
			field.df.fieldtype,
			field.df.options,
			names.map((name) => {
				const row = local_row(name);
				return [
					name,
					frappe._messages[`${name}:Print Style`],
					row ? [row.name, row.standard, row.disabled] : null,
				];
			}),
		]);
	const applicable = () =>
		!state.retired &&
		identity() &&
		frm.doc === document &&
		frm.fields_dict.print_style === field &&
		!custom() &&
		field.get_translated === state.get_translated &&
		field.on_input === state.on_input &&
		field.merge_duplicates === state.merge_duplicates;
	const current = () => applicable() && state.source === source();
	const selected = (before) => {
		const value = field.value || frm.doc.print_style;
		if (!field.$input || !value) return;
		const shown = field.$input.val();
		if (
			shown === value ||
			field.get_input_value() === value ||
			(before && before.value === value && before.parsed === value && before.shown === shown)
		)
			field.set_formatted_input(value);
	};
	state.load = async function (term, refresh_selected = false) {
		if (!field.input || !field.input.isConnected || !applicable()) return false;
		const request = ++state.sequence;
		state.ready = false;
		state.term = term;
		const fingerprint = source();
		const requested_input = field.input;
		let api_rows = [];
		try {
			const requested_names = [
				...new Set([
					...names,
					...names
						.map((name) => frappe._messages[`${name}:Print Style`])
						.filter((label) => typeof label === "string" && label),
				]),
			];
			api_rows = await frappe.xcall("frappe.printing.page.print.print.get_print_styles", {
				with_labels: true,
				names: requested_names,
			});
		} catch (_) {
			/* Optional captions must not block the original search. */
		}
		if (
			request !== state.sequence ||
			fingerprint !== source() ||
			!applicable() ||
			field.input !== requested_input ||
			!requested_input.isConnected ||
			(!refresh_selected && (field.$input.val() !== term || !field.$input.is(":focus")))
		)
			return false;
		if (!Array.isArray(api_rows)) api_rows = [];
		const positives = api_rows.filter(
			(row) =>
				row &&
				names.includes(row.name) &&
				typeof row.label === "string" &&
				row.label &&
				row.label !== row.name &&
				frappe._messages[`${row.name}:Print Style`] === row.label &&
				eligible_local(row.name)
		);
		const candidates = positives.map((row) => row.name);
		let permission_rows = [];
		if (candidates.length) {
			const args = field.get_search_args("");
			if (!args || args.query || args.filters) return false;
			args.filters = { standard: 1, name: ["in", candidates] };
			args.page_length = candidates.length;
			try {
				const response = await frappe.call({
					method: "frappe.desk.search.search_link",
					args,
					no_spinner: true,
				});
				permission_rows = Array.isArray(response.message) ? response.message : [];
			} catch (_) {
				/* Failed permission reads cannot authorize supplementary choices. */
			}
		}
		if (
			request !== state.sequence ||
			fingerprint !== source() ||
			!applicable() ||
			field.input !== requested_input ||
			!requested_input.isConnected ||
			(!refresh_selected && (field.$input.val() !== term || !field.$input.is(":focus")))
		)
			return false;
		const permitted = new Set(permission_rows.map((row) => row.value));
		const labels = new Map(
			positives.filter((row) => permitted.has(row.name)).map((row) => [row.name, row.label])
		);
		const undecorated = new Map(labels);
		for (const [name, caption] of undecorated) {
			if (
				!alias_available(name, caption) ||
				api_rows.some(
					(row) =>
						row.name !== name &&
						(row.name === caption || undecorated.get(row.name) === caption)
				)
			)
				labels.delete(name);
		}
		const before = {
			value: field.value || frm.doc.print_style,
			shown: field.$input.val(),
			parsed: field.get_input_value(),
		};
		for (const [display, name] of state.owned_displays) {
			if (labels.get(name) !== display) {
				if (field.title_value_map?.[display] === name)
					delete field.title_value_map[display];
				state.owned_displays.delete(display);
			}
		}
		state.source = fingerprint;
		state.labels = labels;
		state.choices = permission_rows.filter((row) => labels.has(row.value));
		state.ready = true;
		if (refresh_selected) selected(before);
		state.publish(term);
		return true;
	};
	field.get_translated = function (value) {
		if (
			current() &&
			eligible_local(value) &&
			state.labels.has(value) &&
			alias_available(value, state.labels.get(value))
		) {
			const display = state.labels.get(value);
			state.owned_displays.set(display, value);
			return display;
		}
		return original.get_translated.call(this, value);
	};
	const decorate = (results, term, include_choices) => {
		const rows = original.merge_duplicates.call(
			field,
			results.filter((row) => !row[extra]).map((row) => ({ ...(row[raw] || row) }))
		);
		const primary_names = new Set(rows.map((row) => row.value));
		if (include_choices && current() && state.ready && state.term === term) {
			for (const row of state.choices) {
				const label = state.labels.get(row.value);
				if (
					!primary_names.has(row.value) &&
					(!term ||
						label.toLowerCase().includes(term.toLowerCase()) ||
						row.value.toLowerCase().includes(term.toLowerCase()))
				)
					rows.push({ ...row, [extra]: true });
			}
		}
		return rows.map((row) => {
			const result = { ...row, [raw]: { ...row } };
			const label = current()
				? field.get_translated(row.label || row.value)
				: row.label || row.value;
			if (!row.action && label !== (row.label || row.value))
				result.html = `<strong>${frappe.utils.escape_html(
					label
				)}</strong><br><span class="small">${frappe.utils.escape_html(row.value)}</span>`;
			return result;
		});
	};
	state.publish = (term) => {
		if (
			!current() ||
			!state.ready ||
			state.term !== term ||
			field.$input.val() !== term ||
			!field.$input.is(":focus")
		)
			return;
		const cache = field.$input.cache?.["Print Style"];
		if (Array.isArray(cache?.[term])) {
			cache[term] = decorate(cache[term], term, true);
			field.awesomplete.list = cache[term];
		}
	};
	field.on_input = function (event) {
		const term = event ? event.target.value : this.$input.val();
		state.ready = false;
		++state.sequence;
		const cache = this.$input.cache?.["Print Style"];
		if (Array.isArray(cache?.[term])) cache[term] = decorate(cache[term], term, false);
		const result = original.on_input.call(this, event);
		if (applicable()) state.load(term);
		return result;
	};
	field.merge_duplicates = function (results) {
		const rows = decorate(results, this.$input.val(), false);
		Promise.resolve().then(() => state.publish(state.term));
		return rows;
	};
	state.get_translated = field.get_translated;
	state.on_input = field.on_input;
	state.merge_duplicates = field.merge_duplicates;
	state.attach = function () {
		if (!applicable()) return;
		if (!field.input || !field.awesomplete || !field._debounced_input_handler) return;
		if (state.input === field.input && state.handler === field._debounced_input_handler)
			return;
		field._debounced_input_handler.cancel();
		field.$input.off("input", field._debounced_input_handler);
		state.handler = frappe.utils.debounce(field.on_input.bind(field), 500);
		field._debounced_input_handler = state.handler;
		field.$input.on("input", state.handler);
		state.input = field.input;
	};
	state.retire = function () {
		if (state.retired) return false;
		const owned =
			field.get_translated === state.get_translated &&
			field.on_input === state.on_input &&
			field.merge_duplicates === state.merge_duplicates &&
			field.custom_awesomplete_filter === own_filter &&
			(!state.handler || field._debounced_input_handler === state.handler);
		state.retired = true;
		++state.sequence;
		state.ready = false;
		const restore = (rows) => rows.filter((row) => !row[extra]).map((row) => row[raw] || row);
		const cache = field.$input?.cache?.["Print Style"];
		for (const term of Object.keys(cache || {})) {
			if (Array.isArray(cache[term])) cache[term] = restore(cache[term]);
		}
		if (Array.isArray(field.awesomplete?._list))
			field.awesomplete.list = restore(field.awesomplete._list);
		for (const [display, name] of state.owned_displays) {
			if (field.title_value_map?.[display] === name) delete field.title_value_map[display];
		}
		state.owned_displays.clear();
		state.labels.clear();
		state.choices = [];
		for (const method of ["get_translated", "on_input", "merge_duplicates"]) {
			if (field[method] === state[method]) field[method] = original[method];
		}
		if (field.custom_awesomplete_filter === own_filter)
			field.custom_awesomplete_filter = original.custom_awesomplete_filter;
		if (state.handler) {
			state.handler.cancel();
			$(state.input).off("input", state.handler);
			if (field._debounced_input_handler === state.handler) {
				field._debounced_input_handler = frappe.utils.debounce(
					field.on_input.bind(field),
					500
				);
				field.$input.on("input", field._debounced_input_handler);
			}
		}
		if (owned && field._print_settings_style_labels === state)
			delete field._print_settings_style_labels;
		return owned;
	};
	own_filter = field.custom_awesomplete_filter = function () {
		Promise.resolve().then(() => {
			state.attach();
			state.load("", true);
		});
	};
	field._print_settings_style_labels = state;
	state.attach();
	state.load("", true);
	return true;
}
