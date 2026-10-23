from unittest.mock import patch

import frappe
from frappe.desk.doctype_settings.settings_map import get_settings_map
from frappe.tests import UnitTestCase


class TestSettingsMapMessages(UnitTestCase):
	def test_denied_access_translates_the_template_and_document_name(self):
		self.addCleanup(frappe.set_user, frappe.session.user)
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.set_user("translator@example.com")
		frappe.local.lang = "it"
		translations = {
			"You are not permitted to access {0}.": "Non hai il permesso di accedere a {0}.",
			"Sales Order": "Ordine di vendita",
		}
		with (
			patch.object(frappe, "db", frappe._dict(exists=lambda *_args: True)),
			patch("frappe.has_permission", return_value=False) as permission,
			patch("frappe.translate.get_all_translations", return_value=translations),
		):
			with self.assertRaises(frappe.PermissionError) as error:
				get_settings_map("Sales Order")
		self.assertEqual(str(error.exception), "Non hai il permesso di accedere a Ordine di vendita.")
		permission.assert_called_once_with("Sales Order", "read")
