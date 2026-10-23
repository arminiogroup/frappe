import json
from pathlib import Path
from unittest.mock import patch

from babel.messages.extract import extract

import frappe
from frappe.gettext.translate import PYTHON_KEYWORDS
from frappe.model.meta import Meta
from frappe.tests import UnitTestCase
from frappe.website.report.website_analytics.website_analytics import WebsiteAnalytics


class TestLocalizedMedium(UnitTestCase):
	def setUp(self):
		self.addCleanup(frappe.set_user, frappe.session.user)
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.set_user("translator@example.com")
		frappe.local.lang = "it"

	def test_actual_group_column_uses_metadata_context_without_changing_schema(self):
		metadata = json.loads(
			Path(
				frappe.get_app_path("frappe", "website", "doctype", "web_page_view", "web_page_view.json")
			).read_text()
		)
		fields = {field["fieldname"]: frappe._dict(field) for field in metadata["fields"]}
		meta = Meta.__new__(Meta)
		meta.__dict__.update(name=metadata["name"], _fields=fields)
		with Path(frappe.get_app_path("frappe", "gettext", "contextual_messages.py")).open("rb") as file:
			messages = {
				(message, context)
				for _line, message, _comments, context in extract(
					"frappe.gettext.extractors.python.extract", file, keywords=PYTHON_KEYWORDS
				)
			}
		translations = {"Medium": "Media", "Path": "Percorso", "Source": "Origine"}
		if ("Medium", "Web Page View") in messages:
			translations["Medium:Web Page View"] = "Canale"
		for fieldname, target in [("medium", "Canale"), ("path", "Percorso"), ("source", "Origine")]:
			with self.subTest(fieldname=fieldname):
				report = WebsiteAnalytics(
					{"group_by": fieldname, "from_date": "2026-10-01", "to_date": "2026-10-20"}
				)
				filters = dict(report.filters)
				query_filters = dict(report.query_filters)
				with (
					patch("frappe.get_meta", return_value=meta) as get_meta,
					patch("frappe.translate.get_all_translations", return_value=translations),
				):
					columns = report.get_columns()
				get_meta.assert_called_once_with("Web Page View")
				self.assertEqual(
					columns[0],
					{
						"fieldname": fieldname,
						"label": target,
						"fieldtype": "Data",
						"width": 500,
						"align": "left",
					},
				)
				self.assertEqual(
					columns[1:],
					[
						{"fieldname": "count", "label": "Page Views", "fieldtype": "Int", "width": 150},
						{
							"fieldname": "unique_count",
							"label": "Unique Visitors",
							"fieldtype": "Int",
							"width": 150,
						},
					],
				)
				self.assertEqual(report.filters, filters)
				self.assertEqual(report.query_filters, query_filters)
				self.assertEqual(meta.get_label(fieldname), fields[fieldname].label)
