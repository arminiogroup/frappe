from types import SimpleNamespace
from unittest.mock import Mock, patch

import frappe
from frappe.email.doctype.notification.notification import Notification
from frappe.tests import UnitTestCase


class TestMobileDiagnosticLocalization(UnitTestCase):
	def setUp(self):
		super().setUp()
		self.addCleanup(frappe.set_user, frappe.session.user)
		frappe.set_user("translator@example.com")
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.local.lang = "it"
		self.enterContext(
			patch(
				"frappe.translate.get_all_translations",
				return_value={
					"Notification: document {0} has no {1} number set (field: {2})": "Notifica: nel documento {0} manca un numero di tipo {1} (campo: {2})",
					"Phone": "Telefono",
					"Mobile": "Cellulare",
				},
			)
		)

	def document(self, option, value=None):
		return SimpleNamespace(
			name="DOC-LOCALIZATION",
			meta=SimpleNamespace(get_field=lambda field: frappe._dict(options=option)),
			get=Mock(return_value=value),
			log_error=Mock(),
		)

	def test_missing_phone_identifies_the_document_number_type_and_field_in_the_right_slots(self):
		doc = self.document("Phone")
		self.assertIsNone(Notification.get_mobile_no(doc, "contact_number"))
		doc.log_error.assert_called_once_with(
			"Notifica: nel documento DOC-LOCALIZATION manca un numero di tipo Telefono (campo: contact_number)"
		)

	def test_missing_mobile_localizes_the_number_type_without_changing_the_field_identifier(self):
		doc = self.document("Mobile")
		self.assertIsNone(Notification.get_mobile_no(doc, "mobile_number"))
		doc.log_error.assert_called_once_with(
			"Notifica: nel documento DOC-LOCALIZATION manca un numero di tipo Cellulare (campo: mobile_number)"
		)

	def test_existing_number_is_returned_without_logging(self):
		doc = self.document("Phone", "+39 000 000 0000")
		self.assertEqual(Notification.get_mobile_no(doc, "contact_number"), "+39 000 000 0000")
		doc.log_error.assert_not_called()

	def test_user_and_customer_links_keep_the_existing_lookup_and_value(self):
		for option in ("User", "Customer"):
			with self.subTest(option=option):
				doc = self.document(option, "LINK-LOCALIZATION")
				with patch("frappe.get_value", return_value="+39 000 000 0000") as lookup:
					self.assertEqual(Notification.get_mobile_no(doc, "contact_link"), "+39 000 000 0000")
				lookup.assert_called_once_with(option, "LINK-LOCALIZATION", "mobile_no")
				doc.log_error.assert_not_called()

	def test_unsupported_field_type_keeps_its_existing_rejection(self):
		doc = self.document("Item", "ITEM-LOCALIZATION")
		with self.assertRaises(frappe.ValidationError):
			Notification.get_mobile_no(doc, "unsupported_link")
		doc.log_error.assert_not_called()
