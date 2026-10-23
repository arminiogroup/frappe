import json
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from babel.messages.extract import extract

import frappe
from frappe.gettext.translate import PYTHON_KEYWORDS
from frappe.model.meta import Meta
from frappe.tests import UnitTestCase
from frappe.utils.dateutils import get_from_date_from_timespan
from frappe.utils.formatters import format_value


class TestAmbiguousUIContexts(UnitTestCase):
	def test_metadata_contexts_distinguish_frequency_chart_and_callable(self):
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.local.lang = "it"
		cases = [
			("core", "scheduled_job_type", "frequency", "All", "Ogni ciclo"),
			("core", "server_script", "event_frequency", "All", "Ogni ciclo"),
			("desk", "dashboard_chart", "type", "Bar", "Barre"),
			("core", "mapreduce_task", "map", None, "Funzione map"),
			("desk", "dashboard_chart", "timespan", "Last Week", "Ultima settimana"),
			("desk", "dashboard_chart", "timespan", "Last Month", "Ultimo mese"),
			("desk", "dashboard_chart", "timespan", "Last Quarter", "Ultimi tre mesi"),
			("desk", "dashboard_chart", "timespan", "Last Year", "Ultimo anno"),
		]
		with Path(__file__).with_name("contextual_messages.py").open("rb") as file:
			messages = {
				(message, context)
				for _line, message, _comments, context in extract(
					"frappe.gettext.extractors.python.extract", file, keywords=PYTHON_KEYWORDS
				)
			}
		translations = {
			"All": "Tutti",
			"Bar": "Bar",
			"Map": "Mappa",
			"Last Week": "Settimana scorsa",
			"Last Month": "Mese scorso",
			"Last Quarter": "Trimestre scorso",
			"Last Year": "Anno scorso",
		}
		for module, doctype, fieldname, value, target in cases:
			with self.subTest(doctype=doctype, fieldname=fieldname, value=value):
				metadata = json.loads(
					Path(
						frappe.get_app_path("frappe", module, "doctype", doctype, f"{doctype}.json")
					).read_text()
				)
				fields = {field["fieldname"]: field for field in metadata["fields"]}
				field = fields[fieldname]
				source = value or field["label"]
				context = metadata["name"]
				self.assertIn((source, context), messages)
				translations[f"{source}:{context}"] = target
				with patch("frappe.translate.get_all_translations", return_value=translations):
					if value:
						self.assertIn(value, field["options"].split("\n"))
						self.assertEqual(format_value(value, frappe._dict(field, parent=context)), target)
					else:
						meta = frappe._dict(name=context, get_label=lambda name: fields[name]["label"])
						self.assertEqual(Meta.get_translated_label(meta, fieldname), target)
					self.assertEqual(frappe._(source), translations[source])

	def test_chart_timespan_values_keep_their_recent_interval_semantics(self):
		end = datetime(2026, 10, 21, 14)
		for value, expected in [
			("Last Week", datetime(2026, 10, 14, 14)),
			("Last Month", datetime(2026, 9, 21, 14)),
			("Last Quarter", datetime(2026, 7, 21, 14)),
			("Last Year", datetime(2025, 10, 21, 14)),
		]:
			with self.subTest(timespan=value):
				self.assertEqual(get_from_date_from_timespan(end, value), expected)
