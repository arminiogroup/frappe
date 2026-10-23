from unittest.mock import patch

from requests import HTTPError, Response

import frappe
from frappe.tests import UnitTestCase
from frappe.utils.csvutils import get_csv_content_from_google_sheets

DOWNLOAD_ERROR = "Could not download this Google Sheet as CSV. Check the URL and make sure the sheet is publicly accessible."
TRANSLATIONS = {
	DOWNLOAD_ERROR: "Impossibile scaricare questo foglio Google in formato CSV. Controlla l'URL e verifica che il foglio sia accessibile pubblicamente.",
	"Download Failed": "Download non riuscito",
}


class TestCSVDownloadLocalization(UnitTestCase):
	def setUp(self):
		super().setUp()
		self.addCleanup(frappe.set_user, frappe.session.user)
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.set_user("translator@example.com")
		frappe.local.lang = "it"
		self.enterContext(patch("frappe.translate.get_all_translations", return_value=TRANSLATIONS))

	def response(self, status, content=b"name\nProbe\n"):
		response = Response()
		response.status_code = status
		response._content = content
		response.url = "https://docs.google.com/spreadsheets/d/probe/export"
		return response

	def test_http_400_gives_a_complete_download_error_with_or_without_gid(self):
		for suffix in ("", "#gid=7"):
			with self.subTest(suffix=suffix), patch("requests.get", return_value=self.response(400)):
				with self.assertRaises(frappe.ValidationError) as caught:
					get_csv_content_from_google_sheets(
						"https://docs.google.com/spreadsheets/d/probe/edit" + suffix
					)
				self.assertEqual(str(caught.exception), TRANSLATIONS[DOWNLOAD_ERROR])
				self.assertEqual(frappe.local.message_log[-1]["title"], "Download non riuscito")

	def test_csv_urls_content_and_default_sheet_are_unchanged(self):
		for suffix, gid in (("", 0), ("#gid=7", 7)):
			with (
				self.subTest(suffix=suffix),
				patch("requests.get", return_value=self.response(200)) as request,
			):
				content = get_csv_content_from_google_sheets(
					"https://docs.google.com/spreadsheets/d/probe/edit" + suffix
				)
				self.assertEqual(content, b"name\nProbe\n")
				request.assert_called_once_with(
					f"https://docs.google.com/spreadsheets/d/probe/export?format=csv&gid={gid}",
					headers={"Accept": "text/csv"},
				)

	def test_html_response_and_other_http_errors_keep_their_existing_paths(self):
		with patch("requests.get", return_value=self.response(200, b"<html>private</html>")):
			with self.assertRaises(frappe.ValidationError) as caught:
				get_csv_content_from_google_sheets("https://docs.google.com/spreadsheets/d/probe/edit")
			self.assertEqual(
				str(caught.exception), "Google Sheets URL is invalid or not publicly accessible."
			)
		response = self.response(500)
		with patch("requests.get", return_value=response):
			with self.assertRaises(HTTPError) as caught:
				get_csv_content_from_google_sheets("https://docs.google.com/spreadsheets/d/probe/edit")
			self.assertIs(caught.exception.response, response)
		with patch("requests.get") as request:
			with self.assertRaises(frappe.ValidationError):
				get_csv_content_from_google_sheets("https://example.com/spreadsheets/d/probe/edit")
			request.assert_not_called()
