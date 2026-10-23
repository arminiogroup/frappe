import io
from types import SimpleNamespace
from unittest.mock import patch

import frappe
from frappe import handler
from frappe.tests import UnitTestCase

UPLOAD_ERROR = "This file type is not allowed for this upload."
TRANSLATIONS = {UPLOAD_ERROR: "Questo tipo di file non è consentito per questo caricamento."}


class MemoryPath:
	def __init__(self, path):
		self.stream = io.BytesIO()

	def open(self, mode):
		return self

	def __enter__(self):
		return self.stream

	def __exit__(self, *args):
		return False

	def read_bytes(self):
		return self.stream.getvalue()

	def unlink(self):
		pass


class TestUploadTypeLocalization(UnitTestCase):
	def setUp(self):
		super().setUp()
		self.addCleanup(frappe.set_user, frappe.session.user)
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		self.addCleanup(setattr, frappe.local, "form_dict", frappe.local.form_dict)
		self.addCleanup(setattr, frappe.local, "request", getattr(frappe.local, "request", None))
		frappe.set_user("translator@example.com")
		frappe.local.lang = "it"
		self.saved = []
		self.desk_access = False
		self.enterContext(patch("frappe.translate.get_all_translations", return_value=TRANSLATIONS))
		self.enterContext(patch.object(handler, "Path", MemoryPath))
		self.enterContext(patch.object(handler, "get_files_path", return_value="/memory/probe"))
		self.enterContext(patch("frappe.get_hooks", return_value=[]))
		self.enterContext(patch("frappe.get_doc", side_effect=self.make_file))
		self.permission = self.enterContext(patch("frappe.has_permission", return_value=True))
		self.enterContext(
			patch(
				"frappe.get_lazy_doc", return_value=SimpleNamespace(has_desk_access=lambda: self.desk_access)
			)
		)

	def make_file(self, data):
		return SimpleNamespace(save=lambda **kwargs: self.saved.append((data, kwargs)) or data)

	def upload(self, extension):
		frappe.local.form_dict = frappe._dict(doctype="Translation Probe")
		frappe.local.request = SimpleNamespace(
			files={"file": SimpleNamespace(filename="probe." + extension, stream=io.BytesIO(b"probe bytes"))}
		)
		return handler.upload_file()

	def test_disallowed_types_have_a_truthful_localized_error(self):
		for extension in ("exe", "unknownextension"):
			with self.subTest(extension=extension):
				with self.assertRaises(frappe.ValidationError) as caught:
					self.upload(extension)
				self.assertEqual(str(caught.exception), TRANSLATIONS[UPLOAD_ERROR])
		self.assertEqual(self.saved, [])

	def test_all_existing_mime_types_preserve_content_and_write_permission(self):
		for extension in (
			"jpg",
			"png",
			"gif",
			"pdf",
			"doc",
			"docx",
			"xls",
			"xlsx",
			"odt",
			"ods",
			"txt",
			"mov",
			"mp4",
			"csv",
		):
			with self.subTest(extension=extension):
				doc = self.upload(extension)
				self.assertEqual(doc["content"], b"probe bytes")
				self.assertEqual(doc["file_name"], "probe." + extension)
				self.assertEqual(doc["attached_to_doctype"], "Translation Probe")
				self.assertEqual(self.saved[-1][1], {"ignore_permissions": False})
				self.permission.assert_called_with("Translation Probe", "write", throw=True)
		self.assertEqual(len(self.saved), 14)

	def test_guest_and_desk_checks_preserve_their_existing_scope(self):
		self.desk_access = True
		self.assertEqual(self.upload("exe")["file_name"], "probe.exe")
		frappe.set_user("Guest")
		with patch(
			"frappe.get_system_settings", side_effect=lambda key: key == "allow_guests_to_upload_files"
		):
			self.assertEqual(self.upload("mp4")["file_name"], "probe.mp4")
			self.assertEqual(self.saved[-1][1], {"ignore_permissions": True})
			with self.assertRaises(frappe.ValidationError) as caught:
				self.upload("exe")
			self.assertEqual(str(caught.exception), TRANSLATIONS[UPLOAD_ERROR])
		with patch("frappe.get_system_settings", return_value=False):
			with self.assertRaises(frappe.PermissionError):
				self.upload("mp4")

	def test_file_url_without_uploaded_content_does_not_enter_the_type_check(self):
		frappe.local.form_dict = frappe._dict(doctype="Translation Probe", file_url="/files/probe.exe")
		frappe.local.request = SimpleNamespace(files={})
		with patch.object(handler, "guess_type") as guess:
			doc = handler.upload_file()
			guess.assert_not_called()
		self.assertEqual(doc["file_url"], "/files/probe.exe")
		self.assertIsNone(doc["content"])
