import json
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from babel.messages.extract import extract_from_file
from babel.util import pathmatch

import frappe
from frappe.gettext.extractors.doctype import extract
from frappe.gettext.extractors.utils import get_line_number
from frappe.gettext.translate import PYTHON_KEYWORDS, get_method_map
from frappe.tests import UnitTestCase

ACTION_FILES = (
	"core/doctype/scheduled_job_type/scheduled_job_type.json",
	"desk/doctype/system_console/system_console.json",
	"website/doctype/website_settings/website_settings.json",
)


class TestDocType(UnitTestCase):
	def setUp(self):
		self.addCleanup(frappe.set_user, frappe.session.user)
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.set_user("translator@example.com")
		frappe.local.lang = "it"

	def test_extract_line_numbers(self):
		doctype_json = frappe.as_json(
			{
				"doctype": "DocType",
				"name": "Test Ticket",
				"fields": [
					{
						"fieldname": "status",
						"fieldtype": "Select",
						"label": "Status",
						"description": "Ticket",
						"options": "Open\nClosed",
					},
					{"fieldname": "ticket", "fieldtype": "Data", "label": "Ticket"},
				],
				"permissions": [{"role": "System Manager"}],
			}
		)
		lines = doctype_json.splitlines()

		def line_of(snippet):
			return next(i for i, line in enumerate(lines, start=1) if snippet in line)

		messages = [
			(lineno, message)
			for lineno, _funcname, message, _comments in extract(BytesIO(doctype_json.encode()))
		]

		self.assertEqual(
			messages,
			[
				(line_of('"name": "Test Ticket"'), "Test Ticket"),
				(line_of('"label": "Status"'), "Status"),
				(line_of('"description": "Ticket"'), "Ticket"),
				(line_of('"options": "Open\\nClosed"'), "Open"),
				(line_of('"options": "Open\\nClosed"'), "Closed"),
				(line_of('"label": "Ticket"'), "Ticket"),
				(line_of('"role": "System Manager"'), "System Manager"),
			],
		)

	def configured_messages(self, relative):
		path = Path(frappe.get_app_path("frappe", relative))
		filename = f"frappe/{relative}"
		method = next(method for pattern, method in get_method_map("frappe") if pathmatch(pattern, filename))
		self.assertEqual(method, "frappe.gettext.extractors.doctype.extract")
		return list(extract_from_file(method, str(path), keywords=PYTHON_KEYWORDS))

	def test_standard_action_labels_and_groups_are_extracted(self):
		rows = 0
		for relative in ACTION_FILES:
			path = Path(frappe.get_app_path("frappe", relative))
			before = path.read_bytes()
			text = before.decode()
			data = json.loads(text)
			messages = self.configured_messages(relative)
			for action in data["actions"]:
				for key in ("label", "group"):
					if not (message := action.get(key)):
						continue
					rows += 1
					with self.subTest(doctype=data["name"], key=key, message=message):
						self.assertIn(
							(
								get_line_number(text, key, message),
								message,
								[f"{key.title()} of an action in DocType '{data['name']}'"],
								None,
							),
							messages,
						)
			self.assertEqual(path.read_bytes(), before)
		self.assertEqual(rows, 7)

	def test_hidden_actions_stay_translatable_and_identifiers_stay_raw(self):
		data = {
			"name": "Action Extraction Test",
			"doctype": "DocType",
			"actions": [
				{
					"label": "Review record",
					"group": "Record actions",
					"action": "example.app.review",
					"action_type": "Server Action",
					"hidden": 1,
				},
				{"label": "Review history", "action": "/app/history", "action_type": "Route"},
			],
		}
		before = frappe.as_json(data)
		messages = list(extract(BytesIO(before.encode())))
		self.assertEqual(
			[(message, comments) for _, _, message, comments in messages],
			[
				("Action Extraction Test", ["Name of a DocType"]),
				("Review record", ["Label of an action in DocType 'Action Extraction Test'"]),
				("Record actions", ["Group of an action in DocType 'Action Extraction Test'"]),
				("Review history", ["Label of an action in DocType 'Action Extraction Test'"]),
			],
		)
		self.assertEqual(frappe.as_json(data), before)
		self.assertTrue(all(function == "_" for _, function, _, _ in messages))

	def test_actual_extracted_keys_enable_italian_action_labels(self):
		keys = {
			message for relative in ACTION_FILES for _, message, _, _ in self.configured_messages(relative)
		}
		targets = {
			"Clear Cache": "Svuota la cache",
			"Skip Next Execution": "Salta la prossima esecuzione",
		}
		with patch(
			"frappe.translate.get_all_translations",
			return_value={key: value for key, value in targets.items() if key in keys},
		):
			for source, target in targets.items():
				with self.subTest(source=source):
					self.assertEqual(frappe._(source), target)
			unknown = "Unknown custom action"
			self.assertEqual(frappe._(unknown), unknown)
		self.assertEqual(frappe.session.user, "translator@example.com")

	def test_missing_empty_and_legacy_actions_remain_compatible(self):
		for actions in (None, [], [{"label": "", "group": ""}, {"action": "/app/raw-route"}]):
			data = {"name": "Empty Actions Test", "doctype": "DocType"}
			if actions is not None:
				data["actions"] = actions
			self.assertEqual(
				[message for _, _, message, _ in extract(BytesIO(frappe.as_json(data).encode()))],
				["Empty Actions Test"],
			)
		self.assertEqual(list(extract(BytesIO(b"[]"))), [])

	def test_actions_do_not_replace_existing_metadata_extraction(self):
		data = {
			"name": "Metadata Actions Test",
			"doctype": "DocType",
			"description": "Record description",
			"fields": [{"fieldname": "title", "fieldtype": "Data", "label": "Record title"}],
			"links": [{"group": "Related records"}],
			"permissions": [{"role": "Record Reviewer"}],
			"actions": [{"label": "Review record", "group": "Record actions"}],
		}
		messages = list(extract(BytesIO(frappe.as_json(data).encode())))
		self.assertEqual(
			{message for _, _, message, _ in messages},
			{
				"Metadata Actions Test",
				"Record description",
				"Record title",
				"Related records",
				"Record Reviewer",
				"Review record",
				"Record actions",
			},
		)
