from unittest.mock import Mock, patch

import requests

import frappe
from frappe.integrations.frappe_providers.frappecloud_billing import api
from frappe.tests import UnitTestCase


class TestFrappeCloudBillingLocalization(UnitTestCase):
	def setUp(self):
		super().setUp()
		self.addCleanup(frappe.set_user, frappe.session.user)
		frappe.set_user("translator@example.com")
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.local.lang = "it"
		self.enterContext(
			patch(
				"frappe.translate.get_all_translations",
				return_value={"Failed while calling API {0}": "Errore durante la chiamata dell'API {0}"},
			)
		)
		self.enterContext(patch.dict(frappe.conf, {"fc_communication_secret": "unit-test-only"}))
		self.roles = self.enterContext(patch("frappe.get_roles", return_value=["System Manager"]))
		self.request = self.enterContext(patch("requests.post"))

	def test_api_failure_formats_the_method_in_the_current_language(self):
		self.request.return_value.status_code = 500
		with self.assertRaises(frappe.ValidationError) as caught:
			api("site.info")
		self.assertEqual(str(caught.exception), "Errore durante la chiamata dell'API site.info")

	def test_success_preserves_the_response_payload_and_request_arguments(self):
		payload = {"message": {"name": "unit-site.example.com", "plan": "Trial"}}
		self.request.return_value = Mock(status_code=200, json=Mock(return_value=payload))
		data = {"plan": "Trial"}
		self.assertEqual(api("site.info", data), payload["message"])
		call = self.request.call_args
		self.assertEqual(call.args, ("https://frappecloud.com/api/method/press.saas.api.site.info",))
		self.assertEqual(call.kwargs["json"], data)
		self.assertEqual(call.kwargs["timeout"], (5, 10))

	def test_default_data_remains_an_empty_mapping(self):
		self.request.return_value = Mock(status_code=200, json=Mock(return_value={"message": None}))
		self.assertIsNone(api("site.info"))
		self.assertEqual(self.request.call_args.kwargs["json"], {})

	def test_network_errors_keep_their_existing_propagation(self):
		self.request.side_effect = requests.Timeout("unit timeout")
		with self.assertRaises(requests.Timeout):
			api("site.info")

	def test_resource_access_check_still_precedes_the_request(self):
		self.roles.return_value = []
		with self.assertRaises(frappe.ValidationError):
			api("site.info")
		self.request.assert_not_called()

	def test_missing_communication_secret_still_prevents_the_request(self):
		with patch.dict(frappe.conf, {"fc_communication_secret": None}):
			with self.assertRaises(frappe.ValidationError):
				api("site.info")
		self.request.assert_not_called()
