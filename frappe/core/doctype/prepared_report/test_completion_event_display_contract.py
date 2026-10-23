# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# License: MIT. See LICENSE

from copy import deepcopy
from unittest.mock import Mock, patch

import frappe
from frappe.core.doctype.prepared_report.prepared_report import notify_report_status
from frappe.tests import UnitTestCase


class TestPreparedReportCompletionEventDisplayContract(UnitTestCase):
	def setUp(self):
		for key in ("session", "lang", "response", "message_log"):
			self.addCleanup(setattr, frappe.local, key, getattr(frappe.local, key, None))
		frappe.local.session = frappe._dict(user="translator@example.com", data=frappe._dict())
		frappe.local.lang = "it"
		frappe.local.response = frappe._dict()
		frappe.local.message_log = []
		self.messages = {
			"Stock Balance": "Giacenze di magazzino",
			"Sales": "Vendite",
			"Report {0} is ready.": "Il report {0} è pronto.",
			"Report {0} failed to generate.": "Impossibile generare il report {0}.",
			"{0} Error: {1}:Prepared Report Notification": "{0} Errore: {1}",
		}

	def invoke(self, instance, flag="Yes", messages=None):
		before = deepcopy(instance)
		deliveries = []
		notification = Mock()
		notification.insert.side_effect = lambda **kwargs: deliveries.append(("insert", kwargs))
		with (
			patch(
				"frappe.translate.get_all_translations",
				return_value=self.messages if messages is None else messages,
			),
			patch("frappe.get_cached_value", return_value=flag) as cache,
			patch("frappe.get_doc", return_value=notification) as get_doc,
			patch(
				"frappe.publish_realtime",
				side_effect=lambda *args, **kwargs: deliveries.append(("publish", args, kwargs)),
			) as publish,
			patch("frappe.utils.data.get_url", side_effect=lambda uri: "https://example.com" + uri),
		):
			notify_report_status(instance)
		self.assertEqual(instance, before)
		self.assertEqual(frappe.session.user, "translator@example.com")
		return cache, get_doc, publish, deliveries

	def test_terminal_outcomes_carry_boolean_provenance_and_canonical_identity(self):
		for status in ("Completed", "Error"):
			for flag in ("Yes", "No", None, "yes", 1):
				with self.subTest(status=status, flag=flag):
					name = "Stock Balance" if flag == "Yes" else "Sales"
					instance = frappe._dict(
						status=status,
						report_name=name,
						name="PR-RAW",
						owner="recipient@example.com",
						error_message="",
					)
					cache, get_doc, publish, deliveries = self.invoke(instance, flag)
					cache.assert_called_once_with("Report", name, "is_standard")
					publish.assert_called_once_with(
						"report_processed",
						{
							"report_name": name,
							"name": "PR-RAW",
							"status": status,
							"is_standard": flag == "Yes",
						},
						user="recipient@example.com",
						after_commit=True,
					)
					label = "Giacenze di magazzino" if flag == "Yes" else "Sales"
					subject = (
						f"Il report <strong>{label}</strong> è pronto."
						if status == "Completed"
						else f"Impossibile generare il report <strong>{label}</strong>."
					)
					self.assertEqual(
						get_doc.call_args.args,
						(
							{
								"doctype": "Notification Log",
								"subject": subject,
								"for_user": "recipient@example.com",
								"document_type": "Report",
								"document_name": name,
								"link": "https://example.com/desk/query-report/"
								+ name.replace(" ", "%20")
								+ "?prepared_report_name=PR-RAW",
							},
						),
					)
					self.assertEqual(deliveries[0], ("insert", {"ignore_permissions": True}))
					self.assertEqual(deliveries[1][0], "publish")
					self.assertEqual(len(deliveries), 2)

	def test_nonterminal_states_do_not_read_metadata_or_deliver_notifications(self):
		for status in ("Queued", "Started", "Cancelled"):
			with self.subTest(status=status):
				instance = frappe._dict(
					status=status, report_name="Stock Balance", name="PR-RAW", owner="recipient@example.com"
				)
				cache, get_doc, publish, deliveries = self.invoke(instance)
				cache.assert_not_called()
				get_doc.assert_not_called()
				publish.assert_not_called()
				self.assertEqual(deliveries, [])

	def test_failure_uses_the_actual_user_facing_error_without_changing_the_event(self):
		instance = frappe._dict(
			status="Error",
			report_name="Stock Balance",
			name="PR-ERROR",
			owner="recipient@example.com",
			error_message='Traceback (most recent call last):\n  File "memory.py", line 1\nValueError: <b>Bad &amp; data</b>\n',
		)
		cache, get_doc, publish, deliveries = self.invoke(instance)
		self.assertEqual(
			get_doc.call_args.args[0]["subject"],
			"Impossibile generare il report <strong>Giacenze di magazzino</strong>. Errore: Bad & data",
		)
		self.assertEqual(
			publish.call_args.args[1],
			{
				"report_name": "Stock Balance",
				"name": "PR-ERROR",
				"status": "Error",
				"is_standard": True,
			},
		)
		self.assertEqual(cache.call_count, 1)
		self.assertEqual([item[0] for item in deliveries], ["insert", "publish"])

	def test_custom_hostile_name_preserves_raw_targets_and_the_existing_subject(self):
		name = 'Sales <b> & "quoted"/Caffè'
		instance = frappe._dict(
			status="Completed",
			report_name=name,
			name="PR + raw",
			owner="recipient@example.com",
		)
		cache, get_doc, publish, _ = self.invoke(instance, "No")
		self.assertEqual(get_doc.call_args.args[0]["document_name"], name)
		self.assertEqual(
			get_doc.call_args.args[0]["subject"],
			'Il report <strong>Sales <b> & "quoted"/Caffè</strong> è pronto.',
		)
		self.assertEqual(
			publish.call_args.args[1],
			{"report_name": name, "name": "PR + raw", "status": "Completed", "is_standard": False},
		)
		cache.assert_called_once_with("Report", name, "is_standard")

	def test_empty_dictionary_preserves_complete_english_notification_fallbacks(self):
		for status, expected in (
			("Completed", "Report <strong>Stock Balance</strong> is ready."),
			("Error", "Report <strong>Stock Balance</strong> failed to generate."),
		):
			with self.subTest(status=status):
				instance = frappe._dict(
					status=status,
					report_name="Stock Balance",
					name="PR-ENGLISH",
					owner="recipient@example.com",
					error_message="",
				)
				cache, get_doc, publish, _ = self.invoke(instance, messages={})
				self.assertEqual(get_doc.call_args.args[0]["subject"], expected)
				self.assertEqual(
					publish.call_args.args[1],
					{
						"report_name": "Stock Balance",
						"name": "PR-ENGLISH",
						"status": status,
						"is_standard": True,
					},
				)
				self.assertEqual(cache.call_count, 1)
