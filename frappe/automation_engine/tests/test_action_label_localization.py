from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from typing import ClassVar
from unittest.mock import Mock, patch

from babel.messages.extract import extract

import frappe
from frappe.automation.doctype.automation_flow.automation_flow import AutomationFlow
from frappe.automation_engine.actions import core
from frappe.automation_engine.actions.base import AutomationParamError, get_action_registry
from frappe.automation_engine.api import get_automation_capabilities
from frappe.gettext.translate import PYTHON_KEYWORDS
from frappe.tests import UnitTestCase


class TestActionLabelLocalization(UnitTestCase):
	labels: ClassVar[dict[str, tuple[str, str]]] = {
		"SetFieldValue": ("Set Field Value", "Imposta il valore di un campo"),
		"CreateDocument": ("Create Document", "Crea documento"),
		"IncrementFieldValue": ("Increment Field Value", "Incrementa il valore di un campo"),
		"SendNotification": ("Send Notification", "Invia notifica"),
		"AssignToUser": ("Assign to User", "Assegna a un utente"),
		"CallWebhook": ("Call Webhook", "Chiama webhook"),
		"RunScript": ("Run Script", "Esegui script"),
	}

	def setUp(self):
		super().setUp()
		self.addCleanup(frappe.set_user, frappe.session.user)
		frappe.set_user("translator@example.com")
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.local.lang = "it"
		self.enterContext(patch.object(frappe.local, "automation_actions", None, create=True))
		self.enterContext(
			patch.object(
				frappe,
				"get_hooks",
				side_effect=lambda hook, **kwargs: ["Frappe"] if hook == "app_title" else [],
			)
		)
		translations = dict(self.labels.values())
		translations.update(
			{
				"{0} requires a target document": "{0}: serve un documento di destinazione",
				"{0} requires a Document Type": "{0}: serve un tipo di documento",
				"{0} does not support {1} triggers": "{0} non supporta gli eventi di tipo {1}",
				"Manual": "Manuale",
			}
		)
		self.enterContext(patch("frappe.translate.get_all_translations", return_value=translations))

	def test_all_visible_labels_are_extracted_without_translating_canonical_class_values(self):
		messages = extract(
			"frappe.gettext.extractors.python.extract",
			BytesIO(Path(core.__file__).read_bytes()),
			keywords=PYTHON_KEYWORDS,
		)
		extracted = {message for _line, message, _comments, _context in messages}
		for action in core.CORE_ACTIONS:
			with self.subTest(action=action.action_type):
				english, italian = self.labels[action.action_type]
				self.assertIn(english, extracted)
				self.assertEqual(action.label, english)
				self.assertEqual(frappe._(action.label), italian)

	def test_registry_capabilities_keep_api_labels_action_ids_and_schemas_unchanged(self):
		registry = get_action_registry()
		with (
			patch.object(frappe, "has_permission", return_value=True) as permission,
			patch("frappe.automation_engine.api.registered_events", return_value=[]),
			patch("frappe.automation_engine.api._doc_fields", return_value=[]),
			patch("frappe.automation_engine.api.get_relationship_definitions", return_value=[]),
		):
			capabilities = get_automation_capabilities("Customer", "Manual")
		permission.assert_any_call("Automation Flow", "create", throw=True)
		permission.assert_any_call("Customer", throw=True)
		self.assertEqual({action["action_type"] for action in capabilities["actions"]}, set(self.labels))
		for action in capabilities["actions"]:
			self.assertEqual(action["label"], self.labels[action["action_type"]][0])
			self.assertEqual(action["params_schema"], registry[action["action_type"]].params_schema)
			self.assertEqual(action["output_schema"], registry[action["action_type"]].output_schema)

	def test_all_four_missing_document_paths_localize_the_action_and_keep_error_type(self):
		calls = [
			(core.SetFieldValue(), lambda action: action.execute(None, {}, {})),
			(core.IncrementFieldValue(), lambda action: action.execute(None, {}, {})),
			(
				core.SendNotification(),
				lambda action: action._notify_system(None, ["recipient@example.com"], "Subject", "Message"),
			),
			(core.AssignToUser(), lambda action: action.execute(None, {}, {})),
		]
		for action, call in calls:
			with self.subTest(action=action.action_type):
				with self.assertRaises(AutomationParamError) as caught:
					call(action)
				self.assertEqual(
					str(caught.exception),
					f"{self.labels[action.action_type][1]}: serve un documento di destinazione",
				)
				self.assertIsNone(caught.exception.fieldname)

	def test_valid_target_still_updates_saves_and_uses_the_same_parameters(self):
		doc = Mock()
		core.SetFieldValue().execute(doc, {"field": "subject", "value": "Untranslated user text"}, {})
		doc.set.assert_called_once_with("subject", "Untranslated user text")
		doc.save.assert_called_once_with()

	def test_existing_flow_validation_consumes_the_same_translatable_label(self):
		for action_type in ("SetFieldValue", "IncrementFieldValue", "AssignToUser"):
			action = get_action_registry()[action_type]
			with (
				self.subTest(action=action_type),
				patch.object(frappe, "throw", side_effect=frappe.ValidationError) as throw,
			):
				with self.assertRaises(frappe.ValidationError):
					AutomationFlow.validate_action_context(SimpleNamespace(document_type=None), action)
				throw.assert_called_once_with(f"{self.labels[action_type][1]}: serve un tipo di documento")
