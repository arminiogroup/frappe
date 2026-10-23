import json
from io import BytesIO

from .html_template import extract as extract_html
from .utils import get_line_number


def extract(fileobj, *args, **kwargs):
	"""Extract captions and marked template messages from source-backed Print Formats."""
	text = fileobj.read().decode()
	data = json.loads(text)
	if not isinstance(data, dict) or data.get("doctype") != "Print Format":
		return

	if data.get("standard") == "Yes" and data.get("name"):
		yield get_line_number(text, "name", data["name"]), "pgettext", ("Print Format Name", data["name"]), []

	for key in ("html", "format_data"):
		value = data.get(key)
		if not value:
			continue
		lineno = text.count("\n", 0, text.index(json.dumps(key) + ":")) + 1
		messages = [("template", "html", value)]
		if key == "format_data":
			layout = json.loads(value) if isinstance(value, str) else value
			messages = _layout_messages(layout)

		for kind, path, message in messages:
			comment = f"{path} in Print Format '{data.get('name', '')}'"
			if kind == "caption":
				yield lineno, "_", message, [comment]
			else:
				for _line, function, extracted, comments in extract_html(
					BytesIO(message.encode()), *args, **kwargs
				):
					yield lineno, function, extracted, [*comments, comment]


def _layout_messages(layout):
	if isinstance(layout, list):
		for index, field in enumerate(layout):
			if isinstance(field, dict):
				yield from _field_messages(field, f"format_data[{index}]", classic=True)
	elif isinstance(layout, dict):
		zones = [("header", layout.get("header"))]
		zones.extend(
			(f"sections[{index}]", section) for index, section in enumerate(layout.get("sections") or [])
		)
		zones.append(("footer", layout.get("footer")))
		for path, zone in zones:
			if isinstance(zone, str):
				yield "template", path, zone
			elif isinstance(zone, dict):
				if path.startswith("sections[") and zone.get("label"):
					yield "caption", f"{path}.label", zone["label"]
				for column_index, column in enumerate(zone.get("columns") or []):
					if not isinstance(column, dict):
						continue
					for field_index, field in enumerate(column.get("fields") or []):
						if isinstance(field, dict):
							yield from _field_messages(
								field, f"{path}.columns[{column_index}].fields[{field_index}]"
							)


def _field_messages(field, path, classic=False):
	fieldtype = field.get("fieldtype")
	if field.get("label") and fieldtype not in (
		"HTML",
		"Divider",
		"Spacer",
		"Static Text",
		"Field Template",
		"Typst",
		"Column Break",
		"Tab Break",
	):
		yield "caption", f"{path}.label", field["label"]
	for index, column in enumerate(field.get("table_columns") or []):
		if isinstance(column, dict) and column.get("label"):
			yield "caption", f"{path}.table_columns[{index}].label", column["label"]
	if fieldtype == "Static Text":
		for line in (field.get("text") or "").split("\n"):
			if line:
				yield "caption", f"{path}.text", line
	key = "options" if classic else "html"
	if (
		fieldtype == "HTML" or (classic and field.get("fieldname") == "print_heading_template")
	) and field.get(key):
		yield "template", f"{path}.{key}", field[key]
