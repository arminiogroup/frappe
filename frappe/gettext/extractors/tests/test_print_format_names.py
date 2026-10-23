import json
from pathlib import Path
from tempfile import TemporaryDirectory

from babel.messages.extract import extract_from_file
from babel.util import pathmatch
from frappe.gettext.translate import PYTHON_KEYWORDS, get_method_map
from frappe.tests import UnitTestCase

import frappe


class TestPrintFormatNames(UnitTestCase):
	def setUp(self):
		self.addCleanup(frappe.set_user, frappe.session.user)
		frappe.set_user("translator@example.com")

	def messages(self, document):
		text = json.dumps(document, indent=1)
		filename = "frappe/printing/print_format/example/example.json"
		method = next(
			(method for pattern, method in get_method_map("frappe") if pathmatch(pattern, filename)),
			"ignore",
		)
		self.assertEqual(method, "frappe.gettext.extractors.print_format.extract")
		with TemporaryDirectory() as directory:
			path = Path(directory) / "example.json"
			path.write_text(text)
			messages = list(extract_from_file(method, str(path), keywords=PYTHON_KEYWORDS))
			self.assertEqual(path.read_text(), text)
		return text, messages

	def document(self, **values):
		return {"doctype": "Print Format", "name": "Example standard format", "standard": "Yes", **values}

	def test_standard_name_has_its_own_context_and_physical_line(self):
		text, messages = self.messages(self.document())
		line = next(i for i, source in enumerate(text.splitlines(), 1) if '"name":' in source)
		self.assertEqual(messages, [(line, "Example standard format", [], "Print Format Name")])

	def test_custom_renderer_does_not_mean_an_authored_format(self):
		for custom_format in (0, 1):
			with self.subTest(custom_format=custom_format):
				_, messages = self.messages(self.document(custom_format=custom_format))
				self.assertEqual(
					[(message, context) for _, message, _, context in messages],
					[("Example standard format", "Print Format Name")],
				)

	def test_authored_and_unspecified_standard_names_are_not_extracted(self):
		for standard in ("No", "", None):
			with self.subTest(standard=standard):
				_, messages = self.messages(self.document(standard=standard))
				self.assertEqual(messages, [])
		document = self.document()
		del document["standard"]
		self.assertEqual(self.messages(document)[1], [])

	def test_missing_or_empty_name_does_not_create_a_context_key(self):
		for name in ("", None):
			with self.subTest(name=name):
				self.assertEqual(self.messages(self.document(name=name))[1], [])
		document = self.document()
		del document["name"]
		self.assertEqual(self.messages(document)[1], [])

	def test_only_print_format_objects_are_accepted(self):
		for document in ([], [self.document()], {}, self.document(doctype="DocType")):
			with self.subTest(document=document):
				self.assertEqual(self.messages(document)[1], [])

	def test_quoted_unicode_names_are_canonical_and_keep_their_location(self):
		name = 'Caffè <&"> "name"'
		text, messages = self.messages(self.document(name=name, html="name"))
		line = next(i for i, source in enumerate(text.splitlines(), 1) if '"name":' in source)
		self.assertEqual(messages, [(line, name, [], "Print Format Name")])

	def test_existing_caption_and_template_messages_keep_their_contexts(self):
		layout = [{"fieldname": "total", "label": "Example subtotal", "fieldtype": "Currency"}]
		values = {
			"html": '<p>{{ _("Example heading", context="Example body") }}</p>',
			"format_data": json.dumps(layout),
		}
		_, standard = self.messages(self.document(**values))
		_, authored = self.messages(self.document(standard="No", **values))
		self.assertEqual(
			[(message, context) for _, message, _, context in standard],
			[
				("Example standard format", "Print Format Name"),
				("Example heading", "Example body"),
				("Example subtotal", None),
			],
		)
		self.assertEqual(standard[1:], authored)
