from unittest.mock import patch

import frappe
from frappe.tests import UnitTestCase
from frappe.workflow.doctype.workflow.workflow import Workflow


class TestLocalizedWorkflowMessages(UnitTestCase):
	def setUp(self):
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		self.addCleanup(setattr, frappe.local, "response", frappe.local.response)
		self.addCleanup(setattr, frappe.local, "message_log", frappe.local.message_log)
		frappe.set_user("translator@example.com")
		self.addCleanup(frappe.set_user, "Administrator")
		frappe.local.lang = "it"
		frappe.local.response = frappe._dict()
		frappe.local.message_log = []
		self.peer = frappe._dict(
			name="Custom Sales Invoice approval",
			priority=1,
			workflow_state_field="approval_state",
			conditions=[],
		)
		self.workflow = frappe._dict(
			is_active=1,
			document_type="Sales Invoice",
			priority=1,
			workflow_state_field="state",
			conditions=[],
		)
		self.workflow.get_other_active_workflows = lambda fields: [self.peer]
		self.workflow.is_disjoint_from = lambda other: Workflow.is_disjoint_from(self.workflow, other)

	def test_conflicting_state_field_translates_type_without_translating_identifiers(self):
		with patch(
			"frappe.translate.get_all_translations", return_value={"Sales Invoice": "Fattura di vendita"}
		):
			with self.assertRaises(frappe.ValidationError) as error:
				Workflow.validate_shared_state_field(self.workflow)
		self.assertIn("<strong>Fattura di vendita</strong>", str(error.exception))
		self.assertIn("<strong>Custom Sales Invoice approval</strong>", str(error.exception))
		self.assertIn("<strong>approval_state</strong>", str(error.exception))
		self.assertEqual(self.workflow.document_type, "Sales Invoice")

	def test_ambiguous_priority_translates_type_without_changing_overlap_check(self):
		with patch(
			"frappe.translate.get_all_translations", return_value={"Sales Invoice": "Fattura di vendita"}
		):
			with patch("frappe.get_cached_doc", return_value=self.peer):
				with self.assertRaises(frappe.ValidationError) as error:
					Workflow.validate_no_ambiguous_peer(self.workflow)
		self.assertIn("<strong>Fattura di vendita</strong>", str(error.exception))
		self.assertIn("<strong>Custom Sales Invoice approval</strong>", str(error.exception))
		self.assertEqual(self.workflow.document_type, "Sales Invoice")
