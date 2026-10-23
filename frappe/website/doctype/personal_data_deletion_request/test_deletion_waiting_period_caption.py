# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# License: MIT. See LICENSE

from copy import deepcopy
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, call, patch

from babel.messages.extract import extract_from_file

import frappe
from frappe.gettext.translate import PYTHON_KEYWORDS, get_method_map
from frappe.tests import UnitTestCase
from frappe.website.doctype.personal_data_deletion_request import personal_data_deletion_request as deletion
from frappe.website.doctype.website_settings import website_settings

MESSAGE = "If you confirm your deletion request and it remains pending, automatic processing can start {0} hours after the request was created."
COMMENT = "The User record for this request has been auto-deleted due to inactivity by system admins."
NOW = datetime(2026, 10, 21, 12)


class TestDeletionWaitingPeriodCaption(UnitTestCase):
	def setUp(self):
		self.addCleanup(frappe.set_user, frappe.session.user)
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.set_user("translator@example.com")
		frappe.local.lang = "it"
		self.enterContext(patch("frappe.translate.get_all_translations", return_value={}))
		for name in ("sendmail", "enqueue", "enqueue_doc", "delete_doc", "rename_doc"):
			self.enterContext(
				patch.object(frappe, name, side_effect=AssertionError("Unexpected mutation boundary"))
			)

	def test_actual_configured_extractor_registers_the_complete_waiting_period_caption(self):
		relative = "frappe/website/web_form/request_to_delete_data/request_to_delete_data.js"
		method = next(method for pattern, method in get_method_map("frappe") if pattern == "**.js")
		messages = {
			(message, context)
			for _, message, _, context in extract_from_file(
				method,
				str(Path(frappe.get_app_path("frappe")) / relative.removeprefix("frappe/")),
				keywords=PYTHON_KEYWORDS,
			)
		}
		self.assertIn((MESSAGE, None), messages)

	def test_read_only_getter_preserves_the_singleton_value_and_lookup(self):
		for value in (1, 72, 0, -1, None):
			with self.subTest(value=value):
				reader = Mock(return_value=value)
				with patch.object(frappe, "db", SimpleNamespace(get_single_value=reader)):
					self.assertEqual(website_settings.get_auto_account_deletion(), value)
				reader.assert_called_once_with("Website Settings", "auto_account_deletion")

	def test_disabled_processor_does_not_select_or_load_requests(self):
		for hours in (0, -1, -72):
			with self.subTest(hours=hours):
				reader = Mock(return_value=hours)
				with (
					patch.object(frappe, "db", SimpleNamespace(get_single_value=reader)),
					patch("frappe.get_all") as select,
					patch("frappe.get_doc") as load,
					patch.object(deletion, "get_datetime") as clock,
				):
					deletion.process_data_deletion_request()
				reader.assert_called_once_with("Website Settings", "auto_account_deletion")
				select.assert_not_called()
				load.assert_not_called()
				clock.assert_not_called()

	def test_actual_processor_uses_creation_age_boundary_and_only_pending_approval_selection(self):
		for hours in (1, 72):
			with self.subTest(hours=hours):
				trace = Mock()
				documents = {}
				for name, status, age_offset in (
					("BEFORE-RAW", "Pending Approval", -1),
					("EQUAL-RAW", "Pending Approval", 0),
					("AFTER-RAW", "Pending Approval", 1),
					("UNVERIFIED-RAW", "Pending Verification", 1),
					("HELD-RAW", "On Hold", 1),
					("DELETED-RAW", "Deleted", 1),
				):
					documents[name] = SimpleNamespace(
						name=name,
						status=status,
						creation=NOW - timedelta(hours=hours, seconds=age_offset),
						confirmed_on=NOW,
						add_comment=lambda *args, name=name: trace.comment(name, *args),
						trigger_data_deletion=lambda name=name: trace.trigger(name),
					)
				before = deepcopy(
					{name: (doc.status, doc.creation, doc.confirmed_on) for name, doc in documents.items()}
				)
				trace.read_setting.return_value = hours
				trace.select.side_effect = lambda doctype, filters, pluck: [
					name for name, doc in documents.items() if doc.status == filters["status"]
				]
				trace.load.side_effect = lambda doctype, name: documents[name]
				trace.clock.return_value = NOW
				with (
					patch.object(frappe, "db", SimpleNamespace(get_single_value=trace.read_setting)),
					patch("frappe.get_all", trace.select),
					patch("frappe.get_doc", trace.load),
					patch.object(deletion, "get_datetime", trace.clock),
				):
					deletion.process_data_deletion_request()
				self.assertEqual(
					trace.mock_calls,
					[
						call.read_setting("Website Settings", "auto_account_deletion"),
						call.select(
							"Personal Data Deletion Request",
							filters={"status": "Pending Approval"},
							pluck="name",
						),
						call.load("Personal Data Deletion Request", "BEFORE-RAW"),
						call.clock(),
						call.load("Personal Data Deletion Request", "EQUAL-RAW"),
						call.clock(),
						call.comment("EQUAL-RAW", "Comment", COMMENT),
						call.trigger("EQUAL-RAW"),
						call.load("Personal Data Deletion Request", "AFTER-RAW"),
						call.clock(),
						call.comment("AFTER-RAW", "Comment", COMMENT),
						call.trigger("AFTER-RAW"),
					],
				)
				self.assertEqual(
					{name: (doc.status, doc.creation, doc.confirmed_on) for name, doc in documents.items()},
					before,
				)
