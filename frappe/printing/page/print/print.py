import frappe


@frappe.whitelist()
def get_print_styles(with_labels: bool = False, names: list[str] | str | None = None):
	"""Return enabled styles, optionally restricted to at most ten exact names."""
	filters = {"disabled": 0}
	query = {}
	if names is not None:
		try:
			names = frappe.parse_json(names)
		except ValueError:
			frappe.throw(
				frappe._("Invalid arguments"), frappe.ValidationError, title=frappe._("Invalid Request")
			)
		if not isinstance(names, list) or len(names) > 10 or not all(isinstance(name, str) for name in names):
			frappe.throw(
				frappe._("Invalid arguments"), frappe.ValidationError, title=frappe._("Invalid Request")
			)
		if not names:
			return []
		names = list(dict.fromkeys(names))
		filters["name"] = ["in", names]
		query["limit_page_length"] = len(names)
	if not with_labels:
		return frappe.get_all("Print Style", filters=filters, pluck="name", order_by="creation asc", **query)

	styles = frappe.get_all(
		"Print Style", filters=filters, fields=["name", "standard"], order_by="creation asc", **query
	)
	standard_names = ("Redesign", "Modern", "Classic", "Striped", "Monochrome")
	return [
		{
			"name": style.name,
			"label": frappe._(style.name, context="Print Style")
			if style.standard == 1 and style.name in standard_names
			else style.name,
		}
		for style in styles
	]


@frappe.whitelist()
def get_print_settings_to_show(doctype: str, docname: str):
	doc = frappe.get_doc(doctype, docname)
	doc.check_permission("read")
	print_settings = frappe.get_single("Print Settings")

	if hasattr(doc, "get_print_settings"):
		fields = doc.get_print_settings() or []
	else:
		return []

	print_settings_fields = []
	for fieldname in fields:
		df = print_settings.meta.get_field(fieldname)
		if not df:
			continue
		df.default = print_settings.get(fieldname)
		print_settings_fields.append(df)

	return print_settings_fields
