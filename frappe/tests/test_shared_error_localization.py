from unittest.mock import Mock, patch

import frappe
from frappe.core.doctype.log_settings.log_settings import has_unseen_error_log
from frappe.share import check_share_permission
from frappe.tests import UnitTestCase


class TestSharedErrorLocalization(UnitTestCase):
	def setUp(self):
		super().setUp()
		self.addCleanup(frappe.set_user, frappe.session.user)
		frappe.set_user("translator@example.com")
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.local.lang = "it"
		self.enterContext(patch.object(frappe.local, "db", Mock(), create=True))
		self.enterContext(
			patch(
				"frappe.translate.get_all_translations",
				return_value={
					"No permission to share {0} {1}": "Non hai il permesso di condividere {0} {1}",
					"Sales Order": "Ordine di vendita",
					"You have unseen {0}": "Sono presenti {0} non ancora visualizzati",
					"Error Logs": "Registri degli errori",
				},
			)
		)

	def test_share_denial_keeps_the_permission_error_and_document_identifier(self):
		with patch.object(frappe, "has_permission", return_value=False) as permission:
			with self.assertRaisesRegex(
				frappe.PermissionError,
				"Non hai il permesso di condividere Ordine di vendita ORDER-LOCALIZATION",
			):
				check_share_permission("Sales Order", "ORDER-LOCALIZATION")
		permission.assert_called_once_with("Sales Order", ptype="share", doc="ORDER-LOCALIZATION")

	def test_share_allowed_control_is_unchanged(self):
		with patch.object(frappe, "has_permission", return_value=True) as permission:
			self.assertIsNone(check_share_permission("Sales Order", "ORDER-LOCALIZATION"))
		permission.assert_called_once_with("Sales Order", ptype="share", doc="ORDER-LOCALIZATION")

	def test_error_log_link_translates_only_its_caption(self):
		with patch.object(frappe, "get_all", return_value=[{"name": "ERROR-LOCALIZATION"}]) as query:
			result = has_unseen_error_log()
		self.assertTrue(result["show_alert"])
		self.assertEqual(
			result["message"],
			'Sono presenti <a href="/desk/List/Error%20Log/List"> Registri degli errori </a> non ancora visualizzati',
		)
		query.assert_called_once_with("Error Log", filters={"seen": 0}, limit=1)

	def test_no_unseen_log_does_not_show_an_alert(self):
		with patch.object(frappe, "get_all", return_value=[]):
			self.assertIsNone(has_unseen_error_log())
