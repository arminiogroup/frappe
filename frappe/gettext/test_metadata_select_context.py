import json
from pathlib import Path
from unittest.mock import patch

from babel.messages.extract import extract

import frappe
from frappe.core.doctype.docfield.docfield import DocField
from frappe.gettext.translate import PYTHON_KEYWORDS
from frappe.model.meta import Meta
from frappe.tests import UnitTestCase
from frappe.utils.formatters import format_value


class TestMetadataSelectContext(UnitTestCase):
	def setUp(self):
		self.addCleanup(frappe.set_user, frappe.session.user)
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.set_user("translator@example.com")
		frappe.local.lang = "it"
		self.translations = {
			"Open": "Aperto",
			"Open:Communication.email_status": "Normale",
			"Failed": "Non riuscito",
			"Failed:Select Option: agreement_status": "Non rispettato",
		}
		self.enterContext(patch("frappe.translate.get_all_translations", return_value=self.translations))

	def metadata(self):
		data = json.loads(
			Path(
				frappe.get_app_path("frappe", "core", "doctype", "communication", "communication.json")
			).read_text()
		)
		meta = Meta.__new__(Meta)
		meta.__dict__.update(name=data["name"], doctype="DocType", fields=[])
		for index, field in enumerate(data["fields"]):
			child = DocField.__new__(DocField)
			child.__dict__.update(field, doctype="DocField", name=f"memory-field-{index}")
			meta.append("fields", child)
		return meta

	def test_marker_is_registered_by_the_actual_configured_extractor(self):
		with Path(__file__).with_name("contextual_messages.py").open("rb") as stream:
			messages = {
				(message, context)
				for _, message, _, context in extract(
					"frappe.gettext.extractors.python.extract", stream, keywords=PYTHON_KEYWORDS
				)
			}
		self.assertIn(("Open", "Communication.email_status"), messages)

	def test_actual_meta_and_formatter_distinguish_same_parent_fields_and_raw_translated_input(self):
		meta = self.metadata()
		status, bucket = meta.get_field("status"), meta.get_field("email_status")
		before = dict(bucket.__dict__)
		for translated in (False, True):
			with self.subTest(translated=translated):
				self.assertEqual(format_value("Open", status, translated=translated), "Aperto")
				self.assertEqual(format_value("Open", bucket, translated=translated), "Normale")
		self.assertEqual(bucket.parent, "Communication")
		self.assertEqual(bucket.options, "Open\nSpam\nTrash")
		self.assertEqual(bucket.__dict__, before)
		self.assertEqual(frappe.session.user, "translator@example.com")

	def test_specific_parent_shared_global_and_identity_precedence(self):
		field = frappe._dict(parent="Task", fieldname="agreement_status", fieldtype="Select")
		self.assertEqual(format_value("Failed", field), "Non rispettato")
		self.translations["Failed:Task"] = "Esito del progetto"
		self.assertEqual(format_value("Failed", field, translated=True), "Esito del progetto")
		self.assertEqual(
			format_value("Failed", frappe._dict(parent="Task", fieldtype="Select"), translated=True),
			"Esito del progetto",
		)
		self.translations["Failed:Task.agreement_status"] = "Failed"
		self.assertEqual(format_value("Failed", field), "Failed")
		self.translations["Failed:Task.agreement_status"] = ""
		self.assertEqual(format_value("Failed", field), "Esito del progetto")
		self.translations["Failed:Task"] = ""
		self.assertEqual(format_value("Failed", field), "Non rispettato")
		self.translations["Failed:Select Option: agreement_status"] = ""
		self.assertEqual(format_value("Failed", field), "Non riuscito")
		self.assertEqual(format_value("  Failed  ", field), "Non riuscito")

	def test_non_select_none_nonstring_and_existing_server_explicit_context_contracts(self):
		field = frappe._dict(
			parent="Communication", fieldname="email_status", fieldtype="Select", context="Override"
		)
		self.translations["Open:Override"] = "Esplicito"
		self.assertEqual(format_value("Open", field), "Normale")
		for value, expected in ((None, ""), (0, 0), (False, False), (["Open"], ["Open"])):
			for translated in (False, True):
				with self.subTest(value=value, translated=translated):
					self.assertEqual(format_value(value, field, translated=translated), expected)
		self.assertEqual(format_value("Open", "Data"), "Open")
		self.assertEqual(format_value("Open", "Data", translated=True), "Aperto")
		self.assertEqual(format_value("Open", frappe._dict(fieldtype="Link")), "Open")
		self.assertEqual(format_value("Unknown", field), "Unknown")

	def test_background_user_language_is_resolved_before_dictionary_inspection(self):
		job = frappe._dict(user="translator@example.com", lang_resolved=False)
		with (
			patch.object(frappe.local, "job", job, create=True),
			patch(
				"frappe.utils.translations.set_user_lang",
				side_effect=lambda user: setattr(frappe.local, "lang", "it"),
			) as resolve,
			patch(
				"frappe.translate.get_all_translations",
				side_effect=lambda lang: self.translations if lang == "it" else {},
			),
		):
			frappe.local.lang = "en"
			field = frappe._dict(parent="Task", fieldname="agreement_status", fieldtype="Select")
			self.assertEqual(format_value("Failed", field), "Non rispettato")
			resolve.assert_called_once_with("translator@example.com")
			self.assertTrue(job.lang_resolved)
