from unittest.mock import call, patch

import frappe
from frappe.studio import api
from frappe.tests import UnitTestCase


class TestFileExtensionMessages(UnitTestCase):
	def setUp(self):
		super().setUp()
		self.enterContext(self.set_user("translator@example.com"))
		self.enterContext(patch.object(frappe.local, "lang", "it"))
		self.enterContext(patch.dict(frappe.conf, {"developer_mode": 1}))
		self.dictionary = self.enterContext(
			patch(
				"frappe.translate.get_all_translations",
				return_value={
					"Editing files without an extension is not allowed.": "Non è consentito modificare file senza estensione.",
					"Editing {0} files is not allowed.": "Modifica dei file non consentita: {0}.",
				},
			)
		)
		self.permission = self.enterContext(patch("frappe.has_permission", return_value=True))

	def test_extensionless_requests_use_a_complete_localized_message(self):
		for file_path in ("README", "scripts/build", "scripts/.config"):
			with self.subTest(file_path=file_path):
				with self.assertRaises(frappe.ValidationError) as caught:
					api.read_studio_file("frappe", "translation-app", file_path)
				self.assertEqual(str(caught.exception), "Non è consentito modificare file senza estensione.")
		self.assertEqual(
			self.permission.call_args_list,
			[call("Studio App", ptype="read", throw=True)] * 3,
		)

	def test_extension_errors_and_supported_extensions_keep_their_existing_behavior(self):
		for file_path, extension in (("server.py", ".py"), ("server.PY", ".py"), ("app.wasm", ".wasm")):
			with self.subTest(file_path=file_path):
				with self.assertRaises(frappe.ValidationError) as caught:
					api.read_studio_file("frappe", "translation-app", file_path)
				self.assertEqual(str(caught.exception), f"Modifica dei file non consentita: {extension}.")
		for extension in (".ts", ".js", ".vue", ".json", ".css"):
			for suffix in (extension, extension.upper()):
				with self.subTest(suffix=suffix):
					self.assertIsNone(api._validate_allowed_extension("component" + suffix))

	def test_developer_and_read_permission_checks_still_precede_extension_validation(self):
		with patch.dict(frappe.conf, {"developer_mode": 0}):
			with self.assertRaises(frappe.ValidationError) as caught:
				api.read_studio_file("frappe", "translation-app", "README")
			self.assertEqual(
				str(caught.exception), "Editing Studio code files is only allowed in developer mode."
			)
		self.permission.assert_not_called()
		self.permission.side_effect = frappe.PermissionError
		with self.assertRaises(frappe.PermissionError):
			api.read_studio_file("frappe", "translation-app", "README")
		self.permission.assert_called_once_with("Studio App", ptype="read", throw=True)

	def test_missing_translation_keeps_a_complete_english_fallback(self):
		self.dictionary.return_value = {}
		with self.assertRaises(frappe.ValidationError) as caught:
			api.read_studio_file("frappe", "translation-app", "README")
		self.assertEqual(str(caught.exception), "Editing files without an extension is not allowed.")
