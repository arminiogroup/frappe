from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock, patch

from googleapiclient.errors import HttpError
from httplib2 import Response

import frappe
from frappe.integrations.doctype.google_contacts import google_contacts
from frappe.tests import UnitTestCase

MESSAGE = "Could not create the contact in Google Contacts account {0}. Error code: {1}."
TARGET = "Impossibile creare il contatto nell'account Contatti Google {0}. Codice di errore: {1}."


class TestCreateContactErrorLocalization(UnitTestCase):
	def setUp(self):
		self.addCleanup(frappe.set_user, frappe.session.user)
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.set_user("translator@example.com")
		frappe.local.lang = "it"
		self.enterContext(
			patch(
				"frappe.translate.get_all_translations",
				return_value={MESSAGE: TARGET, "Reference": "Riferimento"},
			)
		)
		self.db = SimpleNamespace(exists=Mock(return_value=True), set_value=Mock())
		self.enterContext(patch("frappe.db", self.db))
		self.client = Mock()
		self.account = frappe._dict(name="Reference", push_to_google_contacts=1)
		self.factory = self.enterContext(
			patch.object(
				google_contacts, "get_google_contacts_object", return_value=(self.client, self.account)
			)
		)
		self.messages = self.enterContext(patch("frappe.msgprint"))
		self.doc = frappe._dict(
			name="CONTACT-RAW",
			google_contacts="GOOGLE-CONTACTS-RAW",
			pulled_from_google_contacts=0,
			sync_with_google_contacts=1,
			first_name="First",
			middle_name="Middle",
			last_name="Last",
			phone_nos=[frappe._dict(phone="+390000000")],
			email_ids=[frappe._dict(email_id="contact@example.com")],
			google_contacts_id=None,
			modified="2026-10-21",
			creation="2026-10-20",
		)

	def test_create_errors_name_the_actual_integration_and_preserve_account_status_and_request(self):
		for status in (400, 403, 500):
			with self.subTest(status=status):
				self.client.reset_mock()
				self.messages.reset_mock()
				self.client.people.return_value.createContact.return_value.execute.side_effect = HttpError(
					Response({"status": status}), b'{"error":{"message":"Server detail"}}'
				)
				before = deepcopy(self.doc)
				google_contacts.insert_contacts_to_google_contacts(self.doc)
				self.messages.assert_called_once_with(TARGET.format("Reference", status))
				self.client.people.return_value.createContact.assert_called_once_with(
					body={
						"names": [{"givenName": "First", "middleName": "Middle", "familyName": "Last"}],
						"phoneNumbers": [{"value": "+390000000"}],
						"emailAddresses": [{"value": "contact@example.com"}],
					}
				)
				self.db.set_value.assert_not_called()
				self.assertEqual(self.doc, before)

	def test_success_keeps_the_canonical_contact_resource_write_and_no_error(self):
		self.client.people.return_value.createContact.return_value.execute.return_value = {
			"resourceName": "people/RESOURCE-RAW"
		}
		google_contacts.insert_contacts_to_google_contacts(self.doc)
		self.db.set_value.assert_called_once_with(
			"Contact", "CONTACT-RAW", "google_contacts_id", "people/RESOURCE-RAW"
		)
		self.factory.assert_called_once_with("GOOGLE-CONTACTS-RAW")
		self.db.exists.assert_called_once_with("Google Contacts", {"name": "GOOGLE-CONTACTS-RAW"})
		self.messages.assert_not_called()

	def test_existing_guard_and_push_disabled_paths_do_not_create_any_contact(self):
		for values, exists, push in [
			({}, False, 1),
			({"pulled_from_google_contacts": 1}, True, 1),
			({"sync_with_google_contacts": 0}, True, 1),
			({}, True, 0),
		]:
			with self.subTest(values=values, exists=exists, push=push):
				self.doc.update({"pulled_from_google_contacts": 0, "sync_with_google_contacts": 1, **values})
				self.db.exists.return_value = exists
				self.account.push_to_google_contacts = push
				google_contacts.insert_contacts_to_google_contacts(self.doc)
		self.client.people.assert_not_called()
		self.db.set_value.assert_not_called()
		self.messages.assert_not_called()

	def test_update_without_resource_reaches_actual_create_error(self):
		self.client.people.return_value.createContact.return_value.execute.side_effect = HttpError(
			Response({"status": 403}), b"{}"
		)
		google_contacts.update_contacts_to_google_contacts(self.doc)
		self.messages.assert_called_once_with(TARGET.format("Reference", 403))
		self.client.people.return_value.updateContact.assert_not_called()
		self.db.set_value.assert_not_called()
