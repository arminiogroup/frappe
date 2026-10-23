import json

from .utils import get_line_number


def extract(fileobj, *args, **kwargs):
	"""Extract translatable text from standard Dashboard Chart JSON files."""
	text = fileobj.read().decode()
	data = json.loads(text)

	if not isinstance(data, dict) or data.get("doctype") != "Dashboard Chart":
		return

	if chart_name := data.get("chart_name"):
		yield get_line_number(text, "chart_name", chart_name), "_", chart_name, ["Name of a dashboard chart"]

	if message := data.get("empty_state_message"):
		yield (
			get_line_number(text, "empty_state_message", message),
			"_",
			message,
			["Empty state message of a dashboard chart"],
		)
