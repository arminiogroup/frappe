import json
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory

from babel.messages.extract import extract_from_dir
from babel.util import pathmatch
from frappe.gettext.extractors.utils import get_line_number
from frappe.gettext.translate import PYTHON_KEYWORDS, get_method_map
from frappe.tests import UnitTestCase

import frappe


class TestDashboardChart(UnitTestCase):
	def setUp(self):
		self.addCleanup(frappe.set_user, frappe.session.user)
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.set_user("translator@example.com")
		frappe.local.lang = "it"

	def configured_messages(self, data, relative="sample/dashboard_chart/activity/activity.json"):
		before = deepcopy(data)
		text = json.dumps(data, indent=1)
		with TemporaryDirectory() as directory:
			path = Path(directory) / relative
			path.parent.mkdir(parents=True)
			path.write_text(text)
			messages = list(
				extract_from_dir(
					directory,
					method_map=get_method_map("frappe"),
					keywords=PYTHON_KEYWORDS,
				)
			)
			self.assertEqual(path.read_text(), text)
		self.assertEqual(data, before)
		return text, messages

	def test_configured_dispatch_extracts_name_and_empty_state(self):
		text, messages = self.configured_messages(
			{
				"doctype": "Dashboard Chart",
				"chart_name": "Activity by category",
				"empty_state_message": "Your activity, grouped by category.",
			}
		)
		self.assertEqual(
			messages,
			[
				(
					"sample/dashboard_chart/activity/activity.json",
					get_line_number(text, "chart_name", "Activity by category"),
					"Activity by category",
					["Name of a dashboard chart"],
					None,
				),
				(
					"sample/dashboard_chart/activity/activity.json",
					get_line_number(text, "empty_state_message", "Your activity, grouped by category."),
					"Your activity, grouped by category.",
					["Empty state message of a dashboard chart"],
					None,
				),
			],
		)

	def test_optional_fields_are_independent(self):
		for field in ("chart_name", "empty_state_message"):
			with self.subTest(field=field):
				_, messages = self.configured_messages({"doctype": "Dashboard Chart", field: "Chart text"})
				self.assertEqual([message for _, _, message, _, _ in messages], ["Chart text"])
		for data in (
			{"doctype": "Dashboard Chart"},
			{"doctype": "Dashboard Chart", "chart_name": "", "empty_state_message": ""},
			{"doctype": "Dashboard Chart", "chart_name": None, "empty_state_message": None},
		):
			with self.subTest(data=data):
				self.assertEqual(self.configured_messages(data)[1], [])

	def test_only_dashboard_chart_dicts_are_extracted(self):
		for data in (
			[],
			[{"doctype": "Dashboard Chart", "chart_name": "Not a standard chart object"}],
			None,
			"Dashboard Chart",
			1,
			{"chart_name": "Missing document type"},
			{"doctype": "Report", "chart_name": "Different document type"},
		):
			with self.subTest(data=data):
				self.assertEqual(self.configured_messages(data)[1], [])

	def test_configuration_and_canonical_identifiers_are_not_messages(self):
		_, messages = self.configured_messages(
			{
				"doctype": "Dashboard Chart",
				"name": "CHART-RAW-NAME",
				"chart_name": "Visible chart name",
				"empty_state_message": "Visible empty chart message",
				"source": "example.chart_source",
				"document_type": "Raw Transaction",
				"filters_json": '[{ "company": "Company@example.com" }]',
				"type": "Line",
				"chart_type": "Custom",
				"custom_options": '{"colors":["#111111"]}',
				"roles": [{"role": "Raw Role"}],
			}
		)
		self.assertEqual(
			[message for _, _, message, _, _ in messages],
			["Visible chart name", "Visible empty chart message"],
		)

	def test_line_numbers_comments_and_literal_content(self):
		name = 'Attività "Nord"'
		message = "No <b>records</b> for {0}\nChoose a filter."
		text, messages = self.configured_messages(
			{
				"description": name,
				"doctype": "Dashboard Chart",
				"chart_name": name,
				"empty_state_message": message,
			}
		)
		self.assertEqual(
			[(line, value, comments, context) for _, line, value, comments, context in messages],
			[
				(get_line_number(text, "chart_name", name), name, ["Name of a dashboard chart"], None),
				(
					get_line_number(text, "empty_state_message", message),
					message,
					["Empty state message of a dashboard chart"],
					None,
				),
			],
		)
		self.assertNotEqual(get_line_number(text, "description", name), messages[0][1])

	def test_existing_doctype_and_report_dispatch_remain_unchanged(self):
		methods = get_method_map("frappe")
		for path, expected in (
			("frappe/desk/doctype/dashboard_chart/dashboard_chart.json", "doctype"),
			("frappe/desk/report/activity/activity.json", "report"),
			("frappe/desk/doctype/test/kanban_board/test.json", "kanban_board"),
		):
			with self.subTest(path=path):
				selected = next(method for pattern, method in methods if pathmatch(pattern, path))
				self.assertEqual(selected, f"frappe.gettext.extractors.{expected}.extract")
		_, messages = self.configured_messages(
			{
				"doctype": "DocType",
				"name": "Dashboard Chart",
				"chart_name": "Not a chart instance",
				"empty_state_message": "Not an instance message",
			},
			relative="desk/doctype/dashboard_chart/dashboard_chart.json",
		)
		self.assertEqual([message for _, _, message, _, _ in messages], ["Dashboard Chart"])
