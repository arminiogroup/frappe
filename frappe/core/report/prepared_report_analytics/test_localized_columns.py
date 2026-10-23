import copy
from unittest.mock import patch

import frappe
from frappe.core.report.prepared_report_analytics.prepared_report_analytics import get_columns
from frappe.tests import UnitTestCase


class TestLocalizedColumns(UnitTestCase):
	def setUp(self):
		self.addCleanup(frappe.set_user, frappe.session.user)
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.set_user("translator@example.com")
		frappe.local.lang = "it"
		self.enterContext(
			patch(
				"frappe.translate.get_all_translations",
				return_value={
					"Start": "Avvia",
					"Start:Time": "Inizio",
					"Runtime in Minutes": "Durata in minuti",
					"Runtime in Seconds": "Durata in secondi",
				},
			)
		)

	def test_timestamp_heading_keeps_column_and_runtime_contracts(self):
		self.assertEqual(frappe.session.user, "translator@example.com")
		for in_minutes, runtime_label in [(0, "Durata in secondi"), (1, "Durata in minuti")]:
			with self.subTest(in_minutes=in_minutes):
				filters = frappe._dict(in_minutes=in_minutes, top_10=1, report="Rapporto dimostrativo")
				before = copy.deepcopy(filters)
				columns = get_columns(filters)
				self.assertEqual(
					[column["fieldname"] for column in columns],
					["name", "report_name", "creation", "report_end_time", "runtime", "peak_memory_usage"],
				)
				self.assertEqual(
					[column["fieldtype"] for column in columns],
					["Link", "Data", "DateTime", "DateTime", "float", "float"],
				)
				self.assertEqual([column["width"] for column in columns], [250] * 6)
				self.assertEqual(columns[0]["options"], "Prepared Report")
				self.assertEqual(columns[4]["label"], runtime_label)
				self.assertEqual(filters, before)
				self.assertEqual(frappe._("Start"), "Avvia")
				self.assertEqual(columns[2]["label"], "Inizio")
