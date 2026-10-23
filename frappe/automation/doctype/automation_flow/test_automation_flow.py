# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# License: MIT. See LICENSE

import json
from unittest.mock import patch

import frappe
from frappe.automation.doctype.automation_flow.automation_flow import AutomationFlow
from frappe.automation_engine.actions.core import SetFieldValue
from frappe.tests import IntegrationTestCase, UnitTestCase


class TestAutomationMessages(UnitTestCase):
	def setUp(self):
		self.addCleanup(frappe.set_user, frappe.session.user)
		frappe.set_user("translator@example.com")
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.local.lang = "it"

	def test_context_errors_translate_action_and_trigger_labels(self):
		action = SetFieldValue()
		action.supported_trigger_types = ["Manual"]
		doc = frappe._dict(trigger_type="Scheduled", document_type=None)
		translations = {"Set Field Value": "Imposta valore del campo", "Scheduled": "Pianificato"}
		with patch("frappe.translate.get_all_translations", return_value=translations):
			with self.assertRaises(frappe.ValidationError) as error:
				AutomationFlow.validate_action_context(doc, action)
			self.assertIn("Imposta valore del campo", str(error.exception))
			doc.document_type = "ToDo"
			with self.assertRaises(frappe.ValidationError) as error:
				AutomationFlow.validate_action_context(doc, action)
			self.assertIn("Imposta valore del campo", str(error.exception))
			self.assertIn("Pianificato", str(error.exception))
		self.assertEqual(action.label, "Set Field Value")
		self.assertEqual(doc.trigger_type, "Scheduled")
		self.assertEqual(doc.document_type, "ToDo")

	def test_missing_document_error_translates_the_trigger_label(self):
		doc = frappe._dict(trigger_type="Doc Created", document_type=None)
		with patch("frappe.translate.get_all_translations", return_value={"Doc Created": "Documento creato"}):
			with self.assertRaises(frappe.ValidationError) as error:
				AutomationFlow.validate_trigger_config(doc)
		self.assertIn("Documento creato", str(error.exception))
		self.assertEqual(doc.trigger_type, "Doc Created")


def set_field(field, value):
	return {"action_type": "SetFieldValue", "params": json.dumps({"field": field, "value": value})}


def make_automation(**kwargs):
	doc = frappe.new_doc("Automation Flow")
	doc.title = kwargs.pop("title", "Test Automation")
	doc.trigger_type = kwargs.pop("trigger_type", "Doc Created")
	doc.document_type = kwargs.pop("document_type", "ToDo")
	actions = kwargs.pop("actions", [_default_action(doc.document_type)])
	for key, value in kwargs.items():
		doc.set(key, value)
	for action in actions:
		doc.append("actions", action)
	return doc


def _default_action(document_type):
	if document_type:
		return {"action_type": "SetFieldValue", "params": '{"field": "priority", "value": "Low"}'}
	return {"action_type": "CreateDocument", "params": '{"doctype": "ToDo"}'}


class TestAutomationFlow(IntegrationTestCase):
	@classmethod
	def tearDownClass(cls):
		frappe.db.rollback()

	def test_valid_doc_created_automation_saves(self):
		doc = make_automation()
		doc.insert()
		self.assertTrue(doc.name)

	def test_action_param_error_reaches_the_user(self):
		"""An action's own validation must read like every other save error, not a bare raise."""
		doc = make_automation(actions=[set_field("not_a_todo_field", "Low")])
		frappe.clear_messages()

		self.assertRaises(frappe.ValidationError, doc.insert)

		messages = " ".join(str(message) for message in frappe.get_message_log())
		self.assertIn("not_a_todo_field", messages)

	def test_enable_requires_at_least_one_action(self):
		doc = make_automation(enabled=1, actions=[])
		self.assertRaises(frappe.ValidationError, doc.insert)

	def test_field_value_changed_requires_trigger_field(self):
		doc = make_automation(trigger_type="Field Value Changed", trigger_field=None)
		self.assertRaises(frappe.ValidationError, doc.insert)

	def test_trigger_field_must_exist_on_document_type(self):
		doc = make_automation(trigger_type="Field Value Changed", trigger_field="not_a_todo_field")
		self.assertRaises(frappe.ValidationError, doc.insert)

	def test_date_field_must_be_a_date_on_document_type(self):
		for date_field in ("not_a_todo_field", "status"):
			doc = make_automation(
				trigger_type="Date Based", date_field=date_field, date_offset=1, date_direction="Before"
			)
			self.assertRaises(frappe.ValidationError, doc.insert)

	def test_standard_datetime_field_is_a_valid_date_field(self):
		doc = make_automation(
			trigger_type="Date Based", date_field="creation", date_offset=1, date_direction="After"
		)
		doc.insert()
		self.assertTrue(doc.name)

	def test_scheduled_requires_valid_cron(self):
		doc = make_automation(trigger_type="Scheduled", document_type=None, cron_expression="not a cron")
		self.assertRaises(frappe.ValidationError, doc.insert)

	def test_scheduled_with_valid_cron_saves(self):
		doc = make_automation(trigger_type="Scheduled", document_type=None, cron_expression="0 0 * * *")
		doc.insert()
		self.assertTrue(doc.name)

	def test_child_table_document_type_blocked(self):
		doc = make_automation(document_type="Automation Action")
		self.assertRaises(frappe.ValidationError, doc.insert)

	def test_doc_trigger_requires_document_type(self):
		doc = make_automation(document_type=None)
		self.assertRaises(frappe.ValidationError, doc.insert)

	def test_custom_event_requires_event_name(self):
		doc = make_automation(trigger_type="Custom Event", document_type=None, custom_event=None)
		self.assertRaises(frappe.ValidationError, doc.insert)

	def test_else_step_type_rejected(self):
		"""Else is not a step — the two arms are the children's `branch` values."""
		doc = make_automation(actions=[{"step_type": "Else", "params": "{}"}])
		self.assertRaises(frappe.ValidationError, doc.insert)

	def test_if_step_requires_condition(self):
		doc = make_automation(actions=[{"step_type": "If", "params": "{}"}])
		self.assertRaises(frappe.ValidationError, doc.insert)

	def test_branch_requires_an_if_parent(self):
		doc = make_automation(
			actions=[
				set_field("priority", "Low"),
				{**set_field("priority", "High"), "parent_step": 1, "branch": "If"},
			]
		)
		self.assertRaises(frappe.ValidationError, doc.insert)

	def test_branch_parent_must_be_earlier(self):
		doc = make_automation(
			actions=[
				{**set_field("priority", "High"), "parent_step": 2, "branch": "If"},
				{"step_type": "If", "step_condition": "True"},
			]
		)
		self.assertRaises(frappe.ValidationError, doc.insert)

	def test_branch_without_parent_step_rejected(self):
		doc = make_automation(actions=[{**set_field("priority", "Low"), "branch": "If"}])
		self.assertRaises(frappe.ValidationError, doc.insert)

	def test_branching_flow_saves_and_enables(self):
		doc = make_automation(
			enabled=1,
			actions=[
				{"step_type": "If", "step_condition": "doc.priority == 'High'"},
				{**set_field("status", "Open"), "parent_step": 1, "branch": "If"},
				{**set_field("status", "Closed"), "parent_step": 1, "branch": "Else"},
			],
		)
		doc.insert()
		self.assertTrue(doc.name)

	def test_wait_step_requires_duration(self):
		doc = make_automation(actions=[{"step_type": "Wait", "params": "{}"}])
		self.assertRaises(frappe.ValidationError, doc.insert)

	def test_wait_step_rejects_unknown_unit(self):
		doc = make_automation(actions=[{"step_type": "Wait", "params": '{"value": 5, "unit": "weeks"}'}])
		self.assertRaises(frappe.ValidationError, doc.insert)

	def test_wait_step_with_duration_saves(self):
		doc = make_automation(actions=[{"step_type": "Wait", "params": '{"value": 5, "unit": "Seconds"}'}])
		doc.insert()
		self.assertTrue(doc.name)

	def test_enabling_wait_containing_flow_allowed(self):
		doc = make_automation(
			enabled=1,
			actions=[
				set_field("priority", "Low"),
				{"step_type": "Wait", "params": '{"value": 5, "unit": "Seconds"}'},
			],
		)
		doc.insert()
		self.assertTrue(doc.name)

	def test_custom_event_flow_saves_as_draft(self):
		doc = make_automation(trigger_type="Custom Event", document_type=None, custom_event="deal_won")
		doc.insert()
		self.assertTrue(doc.name)

	def test_date_based_flow_enables(self):
		doc = make_automation(
			trigger_type="Date Based", date_field="date", date_direction="Before", date_offset=3, enabled=1
		)
		doc.insert()
		self.assertTrue(doc.name)

	def test_date_based_requires_field_and_direction(self):
		doc = make_automation(trigger_type="Date Based", date_field=None, date_direction=None)
		self.assertRaises(frappe.ValidationError, doc.insert)
