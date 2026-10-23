from datetime import datetime
from pathlib import Path
from unittest.mock import call, patch

from babel.messages.extract import extract

import frappe
from frappe.desk.desktop import Workspace
from frappe.desk.doctype.dashboard_chart.dashboard_chart import (
	get_chart_config,
	get_group_by_chart_config,
)
from frappe.gettext.translate import PYTHON_KEYWORDS
from frappe.tests import UnitTestCase


class TestChartTranslationContext(UnitTestCase):
	def setUp(self):
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		self.addCleanup(
			setattr, frappe.local, "user_date_format", getattr(frappe.local, "user_date_format", None)
		)
		frappe.local.lang = "it"
		frappe.local.user_date_format = "dd/mm/yyyy"
		self.translations = {"Login": "Accedi", "Sales": "Vendite"}
		with Path(frappe.get_app_path("frappe", "gettext", "contextual_messages.py")).open("rb") as file:
			messages = {
				(message, context)
				for _line, message, _comments, context in extract(
					"frappe.gettext.extractors.python.extract", file, keywords=PYTHON_KEYWORDS
				)
			}
		if ("Login", "Dashboard Chart") in messages:
			self.translations["Login:Dashboard Chart"] = "Accessi"
		translations = patch("frappe.translate.get_all_translations", return_value=self.translations)
		translations.start()
		self.addCleanup(translations.stop)

	def test_workspace_chart_labels_use_context_without_changing_identity_or_permissions(self):
		charts = [
			frappe._dict(chart_name="Login", label="", name="ROW-1", width="Half"),
			frappe._dict(chart_name="Other Chart", label="Login", name="ROW-2", width="Full"),
			frappe._dict(chart_name="Custom Chart", label="Caffè aziendale", name="ROW-3", width="Half"),
			frappe._dict(chart_name="Sales", label="", name="ROW-4", width="Full"),
			frappe._dict(chart_name="Denied", label="", name="ROW-5", width="Full"),
		]
		workspace = Workspace.__new__(Workspace)
		workspace.doc = frappe._dict(charts=charts)
		with patch(
			"frappe.has_permission", side_effect=lambda doctype, doc=None, **kwargs: doc != "Denied"
		) as permissions:
			result = workspace.get_charts()
		self.assertEqual([row.label for row in result], ["Accessi", "Accessi", "Caffè aziendale", "Vendite"])
		self.assertEqual(
			[row.chart_name for row in result], ["Login", "Other Chart", "Custom Chart", "Sales"]
		)
		self.assertEqual([row.name for row in result], ["ROW-1", "ROW-2", "ROW-3", "ROW-4"])
		self.assertEqual([row.width for row in result], ["Half", "Full", "Half", "Full"])
		self.assertEqual(charts[-1].label, "")
		self.assertEqual(
			permissions.call_args_list,
			[call("Dashboard Chart", throw=False)]
			+ [call("Dashboard Chart", doc=row.chart_name) for row in charts],
		)
		self.assertEqual(frappe._("Login"), "Accedi")

	def test_workspace_denied_type_does_not_translate_or_return_charts(self):
		chart = frappe._dict(chart_name="Login", label="")
		workspace = Workspace.__new__(Workspace)
		workspace.doc = frappe._dict(charts=[chart])
		with patch("frappe.has_permission", return_value=False) as permissions:
			self.assertEqual(workspace.get_charts(), [])
		permissions.assert_called_once_with("Dashboard Chart", throw=False)
		self.assertEqual(chart, {"chart_name": "Login", "label": ""})

	def test_time_series_dataset_context_keeps_real_dates_counts_and_query_parameters(self):
		for name, target in [("Login", "Accessi"), ("Sales", "Vendite"), ("Custom Chart", "Custom Chart")]:
			with self.subTest(name=name):
				chart = frappe._dict(
					name=name,
					document_type="Activity Log",
					based_on="communication_date",
					chart_type="Count",
					parent_document_type="Parent",
				)
				original = dict(chart)
				filters = [["Activity Log", "status", "=", "Success"]]
				data = [("2026-10-19", 10, 2), ("2026-10-20", 20, 3)]
				with (
					patch("frappe.get_list", return_value=data) as provider,
					patch("frappe.client_cache.get_doc", return_value={"first_day_of_the_week": "Monday"}),
				):
					result = get_chart_config(
						chart, filters, "Last Week", "Daily", datetime(2026, 10, 19), datetime(2026, 10, 20)
					)
				self.assertEqual(
					result,
					{
						"labels": ["19/10/2026", "20/10/2026"],
						"dates": ["2026-10-19", "2026-10-20"],
						"datasets": [{"name": target, "values": [2, 3]}],
					},
				)
				provider.assert_called_once_with(
					"Activity Log",
					fields=["communication_date", {"SUM": "1"}, {"COUNT": "*"}],
					filters=filters,
					group_by="communication_date",
					order_by="communication_date",
					as_list=True,
					parent_doctype="Parent",
				)
				self.assertEqual(
					filters,
					[
						["Activity Log", "status", "=", "Success"],
						["Activity Log", "communication_date", ">=", "2026-10-19"],
						["Activity Log", "communication_date", "<=", datetime(2026, 10, 20)],
					],
				)
				self.assertEqual(chart, original)
				self.assertEqual(data, [("2026-10-19", 10, 2), ("2026-10-20", 20, 3)])

	def test_grouped_dataset_context_keeps_business_labels_values_filters_and_empty_result(self):
		for name, target in [("Login", "Accessi"), ("Sales", "Vendite"), ("Custom Chart", "Custom Chart")]:
			with self.subTest(name=name):
				chart = frappe._dict(
					name=name,
					document_type="Activity Log",
					group_by_based_on="user",
					group_by_type="Count",
					parent_document_type="Parent",
				)
				original = dict(chart)
				filters = [["Activity Log", "status", "=", "Success"]]
				data = [
					frappe._dict(name="demo@example.test", count=5),
					frappe._dict(name="other@example.test", count=2),
				]
				meta = frappe._dict(get_field=lambda fieldname: frappe._dict(fieldtype="Data", label="User"))
				with (
					patch("frappe.get_list", return_value=data) as provider,
					patch("frappe.get_meta", return_value=meta),
				):
					result = get_group_by_chart_config(chart, filters)
					self.assertEqual(
						result,
						{
							"labels": ["demo@example.test", "other@example.test"],
							"datasets": [{"name": target, "values": [5, 2]}],
						},
					)
					provider.assert_called_once_with(
						"Activity Log",
						fields=["user as name", {"COUNT": "1", "as": "count"}],
						filters=filters,
						parent_doctype="Parent",
						group_by="`tabActivity Log`.`user`",
						order_by="count desc",
						ignore_ifnull=True,
					)
					provider.return_value = []
					self.assertIsNone(get_group_by_chart_config(chart, filters))
				self.assertEqual(chart, original)
				self.assertEqual(filters, [["Activity Log", "status", "=", "Success"]])
