import csv
import json
from io import StringIO
from unittest.mock import Mock, patch

import frappe
from frappe.core.doctype.prepared_report.prepared_report import convert_json_to_csv, notify_report_status
from frappe.tests import UnitTestCase
from frappe.utils import escape_html


class TestLocalizedPreparedReportNotifications(UnitTestCase):
	def setUp(self):
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.local.lang = "it"
		self.messages = {
			"Stock Balance": "Giacenze di magazzino",
			"Sales": "Vendite",
			"Report {0} is ready.": "Il report {0} è pronto.",
			"Report {0} failed to generate.": "Impossibile generare il report {0}.",
			"Your CSV file is ready for download": "Il file CSV è pronto per il download",
			'Click <a href="{0}" target="_blank">here</a> to download the file.': 'Per scaricare il file, fai clic <a href="{0}" target="_blank">qui</a>.',
		}

	def test_standard_report_display_name_does_not_change_notification_target(self):
		for status, expected in [
			("Completed", "Il report <strong>Giacenze di magazzino</strong> è pronto."),
			("Error", "Impossibile generare il report <strong>Giacenze di magazzino</strong>."),
		]:
			with self.subTest(status=status):
				instance = frappe._dict(
					status=status,
					report_name="Stock Balance",
					name="prepared-1",
					owner="recipient@example.com",
					error_message="",
				)
				notification = Mock()
				with (
					patch("frappe.translate.get_all_translations", return_value=self.messages),
					patch("frappe.get_cached_value", return_value="Yes"),
					patch("frappe.get_doc", return_value=notification) as get_doc,
					patch("frappe.publish_realtime") as publish,
					patch("frappe.utils.data.get_url", side_effect=lambda uri: "https://example.com" + uri),
				):
					notify_report_status(instance)
				payload = get_doc.call_args.args[0]
				self.assertEqual(payload["subject"], expected)
				self.assertEqual(payload["document_name"], "Stock Balance")
				self.assertEqual(payload["for_user"], "recipient@example.com")
				self.assertIn("/Stock%20Balance?prepared_report_name=prepared-1", payload["link"])
				self.assertEqual(
					publish.call_args.args[1],
					{
						"report_name": "Stock Balance",
						"name": "prepared-1",
						"status": status,
						"is_standard": True,
					},
				)
				self.assertEqual(instance.report_name, "Stock Balance")

	def test_custom_report_name_is_not_translated_as_a_standard_label(self):
		instance = frappe._dict(
			status="Completed", report_name="Sales", name="prepared-2", owner="recipient@example.com"
		)
		with (
			patch("frappe.translate.get_all_translations", return_value=self.messages),
			patch("frappe.get_cached_value", return_value="No"),
			patch("frappe.get_doc", return_value=Mock()) as get_doc,
			patch("frappe.publish_realtime"),
			patch("frappe.utils.data.get_url", side_effect=lambda uri: "https://example.com" + uri),
		):
			notify_report_status(instance)
		self.assertEqual(get_doc.call_args.args[0]["subject"], "Il report <strong>Sales</strong> è pronto.")

	def test_csv_notification_is_localized_without_changing_export_or_file_identifiers(self):
		rows = [{"code": "Caffè", "qty": 2}]
		prepared = frappe._dict(
			get_prepared_data=lambda **kwargs: (
				json.dumps({"columns": [{"fieldname": "code"}, {"fieldname": "qty"}], "result": rows}),
				"Stock Balance.json.gz",
			)
		)
		file_url = '/private/files/caffè.csv?download=1&name="demo"'
		payloads = []

		def get_doc(data, *args):
			if data == "Prepared Report":
				return prepared
			payloads.append(data)
			return frappe._dict(name="file-1", file_url=file_url, save=Mock(), insert=Mock())

		with (
			patch("frappe.translate.get_all_translations", return_value=self.messages),
			patch("frappe.get_doc", side_effect=get_doc),
		):
			convert_json_to_csv("prepared-1")
		file, notification = payloads
		self.assertEqual(file["file_name"], "csv_Stock Balance.csv")
		self.assertEqual(file["is_private"], 1)
		self.assertEqual(file["attached_to_name"], "prepared-1")
		self.assertEqual(
			list(csv.DictReader(StringIO(file["content"].decode()))), [{"code": "Caffè", "qty": "2"}]
		)
		self.assertEqual(notification["subject"], "Il file CSV è pronto per il download")
		self.assertEqual(
			notification["email_content"],
			self.messages['Click <a href="{0}" target="_blank">here</a> to download the file.'].format(
				escape_html(file_url)
			),
		)
		self.assertEqual(notification["document_name"], "file-1")
		self.assertEqual(notification["link"], file_url)
		self.assertEqual(notification["for_user"], frappe.session.user)
