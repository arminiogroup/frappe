import json
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from bs4 import BeautifulSoup
from jinja2 import FileSystemLoader

import frappe
from frappe.model.document import Document
from frappe.model.meta import Meta
from frappe.translate import print_language
from frappe.utils import jinja as jinja_module
from frappe.utils.print_format_generator import PrintFormatGenerator
from frappe.www.printview import get_print_filename


class TestPrintDocumentTitleLocalization(unittest.TestCase):
	def setUp(self):
		for key, value in {
			"session": frappe._dict(user="translator@example.com"),
			"lang": "en",
			"response": frappe._dict(),
			"form_dict": frappe._dict(),
			"message_log": [],
			"flags": frappe._dict(),
		}.items():
			previous = getattr(frappe.local, key, None)
			setattr(frappe.local, key, value)
			self.addCleanup(setattr, frappe.local, key, previous)
		self.source = Path(__file__).resolve().parents[1]
		metadata = json.loads((self.source / "core/doctype/user/user.json").read_text())
		self.meta = Meta.__new__(Meta)
		self.meta.__dict__.update(metadata)
		self.meta.fields = [frappe._dict(field) for field in metadata["fields"]]
		print_format_metadata = json.loads(
			(self.source / "printing/doctype/print_format/print_format.json").read_text()
		)
		self.print_format_meta = Meta.__new__(Meta)
		self.print_format_meta.__dict__.update(print_format_metadata)
		self.print_format_meta.fields = [frappe._dict(field) for field in print_format_metadata["fields"]]

	def render(self, *, language="it", messages=None, doctype="User", name="QA-0001", preview=False):
		doc = Document.__new__(Document)
		doc.__dict__.update(
			doctype=doctype,
			name=name,
			docstatus=0,
			meta=self.meta,
			first_name="RAW BUSINESS VALUE",
			flags=frappe._dict(),
		)
		field = frappe._dict(
			fieldname="first_name",
			fieldtype="Data",
			renderer="Data",
			label="First Name",
			section=frappe._dict(),
		)
		layout = frappe._dict(sections=[frappe._dict(columns=[frappe._dict(fields=[field])])])
		print_format = frappe._dict(
			name="RAW-PRINT-FORMAT",
			page_number="",
			pdf_generator="chrome",
			margin_top=10,
			margin_bottom=11,
			margin_left=12,
			margin_right=13,
			flags=frappe._dict(),
		)
		generator = PrintFormatGenerator.__new__(PrintFormatGenerator)
		generator.doc = doc
		generator.print_format = print_format
		generator.layout = layout
		generator.print_settings = frappe._dict(repeat_header_footer=0, pdf_page_size="A4")
		generator.letterhead = None
		generator.context = frappe._dict(
			doc=doc,
			print_format=print_format,
			print_settings=generator.print_settings,
			layout=layout,
			lang=language,
			content_fieldtypes=[],
			is_default_layout=False,
		)
		with patch.object(jinja_module, "get_jloader", return_value=FileSystemLoader(self.source)):
			environment = jinja_module._get_jenv.__wrapped__()
		environment.globals.update(
			_=frappe._,
			frappe=frappe,
			include_style=lambda *args: "",
			include_script=lambda *args: "",
			resolve_class=lambda *args: "",
			field_attributes=lambda *args: "",
		)
		dictionary = {"User": "Utente"} if messages is None else messages
		original = deepcopy({key: value for key, value in doc.__dict__.items() if key != "meta"})
		captured = []

		def deliver(**kwargs):
			captured.append(kwargs)
			return b"MEMORY-PDF"

		with (
			print_language(language),
			patch(
				"frappe.translate.get_all_translations",
				side_effect=lambda lang: dictionary if lang == "it" else {},
			),
			patch.object(frappe.local, "jenv_restricted", environment, create=True),
			patch.object(frappe.local, "jenv_unrestricted", environment, create=True),
			patch.object(
				frappe,
				"get_meta",
				side_effect=lambda doctype: {"Print Format": self.print_format_meta}[doctype],
			),
			patch("frappe.utils.pdf.get_chrome_pdf", side_effect=deliver),
		):
			if preview:
				html = generator.get_html_preview()
				self.assertEqual(captured, [])
			else:
				self.assertEqual(generator.render_pdf(), b"MEMORY-PDF")
				self.assertEqual(len(captured), 1)
				self.assertEqual(captured[0]["print_format"], "RAW-PRINT-FORMAT")
				self.assertEqual(captured[0]["pdf_generator"], "chrome")
				self.assertIsNone(captured[0]["output"])
				self.assertEqual(
					captured[0]["options"],
					{
						"margin-top": "10mm",
						"margin-bottom": "11mm",
						"margin-left": "12mm",
						"margin-right": "13mm",
						"page-size": "A4",
					},
				)
				html = captured[0]["html"]
		self.assertEqual({key: doc.__dict__[key] for key in original}, original)
		self.assertEqual(frappe.local.lang, "en")
		soup = BeautifulSoup(html, "html5lib")
		self.assertEqual(soup.select_one(".value").get_text(), "RAW BUSINESS VALUE")
		self.assertEqual(soup.html["lang"], language)
		self.assertEqual(len(soup.select("title")), 1)
		return soup, html, get_print_filename(doc)

	def test_italian_title_translates_only_the_doctype(self):
		soup, _, filename = self.render()
		self.assertEqual(soup.title.get_text(), "Utente: QA-0001")
		self.assertEqual(filename, "QA-0001")

	def test_preview_and_pdf_use_the_same_current_language_caption(self):
		for preview in [True, False]:
			with self.subTest(preview=preview):
				soup, _, _ = self.render(preview=preview)
				self.assertEqual(soup.title.get_text(), "Utente: QA-0001")

	def test_english_empty_and_unknown_targets_keep_source_fallback(self):
		for options in [
			{"language": "en"},
			{"messages": {}},
			{"messages": {"User": ""}},
			{"doctype": "QA Custom Kind"},
		]:
			with self.subTest(options=options):
				soup, _, _ = self.render(**options)
				self.assertEqual(soup.title.get_text(), options.get("doctype", "User") + ": QA-0001")

	def test_document_name_is_never_looked_up_as_a_display_label(self):
		soup, _, filename = self.render(name="User", messages={"User": "Utente"})
		self.assertEqual(soup.title.get_text(), "Utente: User")
		self.assertEqual(filename, "User")

	def test_translated_caption_and_hostile_name_are_literal_title_text(self):
		caption = 'Utente & <em>nome</em> "testo"'
		for name in ['RAW & <tag> "value"', "RAW </title><img src=x><title>tail"]:
			with self.subTest(name=name):
				soup, html, _ = self.render(name=name, messages={"User": caption})
				self.assertEqual(soup.title.get_text(), caption + ": " + name)
				self.assertIsNone(soup.find("img"))
				self.assertIn("&lt;em&gt;", html)
				self.assertIn("&amp;", html)

	def test_canonical_filename_rules_remain_separate_from_the_title(self):
		soup, _, filename = self.render(name="RAW/ID #24?", messages={"User": "Utente"})
		self.assertEqual(soup.title.get_text(), "Utente: RAW/ID #24?")
		self.assertEqual(filename, "RAW_ID _24_")
