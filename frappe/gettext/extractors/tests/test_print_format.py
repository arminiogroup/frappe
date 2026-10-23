import json
import logging
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from babel.messages.extract import extract_from_file
from babel.util import pathmatch
from frappe.gettext.translate import PYTHON_KEYWORDS, get_method_map
from frappe.tests import UnitTestCase

import frappe


class NoDatabase:
	def __bool__(self):
		return False

	def __getattr__(self, name):
		def blocked(*args, **kwargs):
			raise AssertionError(f"Unexpected database operation: {name}")

		return blocked


class PrintDocument(frappe._dict):
	def get_formatted(self, fieldname):
		return str(self.get(fieldname))


class TestPrintFormatExtraction(UnitTestCase):
	def setUp(self):
		self.addCleanup(frappe.set_user, frappe.session.user)
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.set_user("translator@example.com")
		frappe.local.lang = "it"

	def configured_messages(self, payload):
		text = json.dumps(payload, ensure_ascii=False, indent=1)
		filename = "example/selling/print_format/example/example.json"
		method = next(
			(method for pattern, method in get_method_map("frappe") if pathmatch(pattern, filename)),
			"ignore",
		)
		with TemporaryDirectory() as folder:
			path = Path(folder) / "example.json"
			path.write_text(text)
			messages = list(extract_from_file(method, str(path), keywords=PYTHON_KEYWORDS))
			self.assertEqual(path.read_text(), text)
		return text, method, messages

	def format(self, layout=None, **values):
		return {
			"doctype": "Print Format",
			"name": "Canonical format identity",
			"format_data": json.dumps(layout) if layout is not None else "",
			**values,
		}

	def test_configured_nested_captions_have_physical_source_locations(self):
		layout = {
			"header": {"label": "Unused zone label", "columns": []},
			"sections": [
				{
					"label": "Résumé des lignes",
					"columns": [
						{
							"label": "Unused column label",
							"fields": [
								{"label": "Montant café", "fieldname": "amount", "fieldtype": "Currency"},
								{
									"label": "Lines",
									"fieldname": "items",
									"fieldtype": "Table",
									"table_columns": [{"label": "Row number", "fieldname": "idx"}],
								},
							],
						}
					],
				}
			],
		}
		text, method, messages = self.configured_messages(self.format(layout))
		self.assertEqual(method, "frappe.gettext.extractors.print_format.extract")
		line = next(i for i, source in enumerate(text.splitlines(), 1) if '"format_data":' in source)
		self.assertEqual(
			[(lineno, message, context) for lineno, message, _comments, context in messages],
			[
				(line, message, None)
				for message in ("Résumé des lignes", "Montant café", "Lines", "Row number")
			],
		)
		self.assertTrue(all("Canonical format identity" in comments[0] for _, _, comments, _ in messages))
		self.assertIn("table_columns[0].label", messages[-1][2][0])

	def test_property_values_do_not_redirect_physical_source_lines(self):
		for key, values in (
			("html", {"html": '<p>{{ _("Visible heading") }}</p>'}),
			("format_data", {"format_data": '[{"label": "Visible heading"}]'}),
		):
			with self.subTest(key=key):
				text, _, messages = self.configured_messages(self.format(name=key, **values))
				line = next(i for i, source in enumerate(text.splitlines(), 1) if f'"{key}":' in source)
				self.assertEqual(
					[(lineno, message) for lineno, message, _, _ in messages], [(line, "Visible heading")]
				)

	def test_classic_layout_overrides_and_marked_options_are_extracted(self):
		layout = [
			{
				"fieldname": "print_heading_template",
				"options": '<h2>{{ _("Order heading {0}").format(doc.name) }}</h2>',
			},
			{"fieldtype": "Section Break", "label": "Totals"},
			{"fieldname": "total", "label": "Subtotal"},
			{"fieldtype": "HTML", "options": '<p>{{ _("State", context="Print status") }}</p>'},
		]
		_, _, messages = self.configured_messages(self.format(layout))
		self.assertEqual(
			[(message, context) for _, message, _, context in messages],
			[("Order heading {0}", None), ("Totals", None), ("Subtotal", None), ("State", "Print status")],
		)

	def test_custom_and_report_html_reuse_real_template_context_extraction(self):
		for renderer, html in (
			("Jinja", '<p>{{ _("Receipt {0}").format(doc.name) }}</p>'),
			("JS", '<p>{%= __("Receipt {0}", [data.name], "Report receipt") %}</p>'),
		):
			with self.subTest(renderer=renderer):
				text, _, messages = self.configured_messages(
					self.format(custom_format=1, print_format_type=renderer, html=html)
				)
				line = next(i for i, source in enumerate(text.splitlines(), 1) if '"html":' in source)
				self.assertEqual(
					[(lineno, message, context) for lineno, message, _, context in messages],
					[(line, "Receipt {0}", "Report receipt" if renderer == "JS" else None)],
				)

	def test_static_text_lines_and_marked_header_footer_preserve_line_boundaries(self):
		layout = {
			"header": '<h1>{{ _("Header title") }}</h1>',
			"sections": [
				{
					"columns": [
						{
							"fields": [
								{
									"fieldtype": "Static Text",
									"label": "Unused text label",
									"text": "First line\n\nSecond line",
								}
							]
						}
					]
				}
			],
			"footer": {
				"columns": [{"fields": [{"fieldtype": "HTML", "html": '<p>{{ _("Footer text") }}</p>'}]}]
			},
		}
		_, _, messages = self.configured_messages(self.format(layout))
		self.assertEqual(
			[message for _, message, _, _ in messages],
			["Header title", "First line", "Second line", "Footer text"],
		)

	def test_machine_values_unmarked_html_and_inactive_backups_are_not_messages(self):
		layout = {
			"sections": [
				{
					"visible_if": '_("Do not execute conditions")',
					"columns": [
						{
							"fields": [
								{
									"fieldtype": "HTML",
									"label": "Unused HTML label",
									"html": "<p>Authored business prose</p>",
								},
								{
									"fieldtype": "Link",
									"fieldname": "canonical_field",
									"options": "Canonical DocType",
								},
								{"fieldtype": "Divider", "label": "Unused divider label"},
								{
									"fieldtype": "Repeater",
									"source": "taxes",
									"repeater_columns": [
										{
											"template": [
												{"t": "s", "v": "Authored repeater text"},
												{"t": "f", "v": "canonical_field"},
											]
										}
									],
								},
							]
						}
					],
				}
			]
		}
		_, _, messages = self.configured_messages(
			self.format(
				layout, classic_format_data='[{"label":"Inactive backup"}]', css='_("Do not execute styles")'
			)
		)
		self.assertEqual(messages, [])
		for payload in (
			[self.format()],
			{"doctype": "DocType", "html": '{{ _("Not a Print Format") }}'},
			self.format(42),
		):
			with self.subTest(payload=payload):
				self.assertEqual(self.configured_messages(payload)[2], [])

	def test_only_extracted_keys_translate_real_caption_and_marked_html_renderers(self):
		layout = {
			"sections": [
				{
					"columns": [
						{
							"fields": [
								{"fieldtype": "Currency", "label": "Print subtotal", "fieldname": "amount"},
								{"fieldtype": "HTML", "html": '<p>{{ _("Print bill to") }}</p>'},
							]
						}
					]
				}
			]
		}
		_, _, messages = self.configured_messages(self.format(layout))
		targets = {"Print subtotal": "Subtotale di stampa", "Print bill to": "Dati di fatturazione di stampa"}
		dictionary = {message: targets[message] for _, message, _, _ in messages}
		doc = PrintDocument(amount=12.5)
		self.addCleanup(setattr, frappe.local, "db", getattr(frappe.local, "db", None))
		frappe.local.db = NoDatabase()
		with (
			patch("frappe.get_hooks", return_value=[]),
			patch("frappe.get_active_apps", return_value=["frappe"]),
			patch("frappe.get_roles", return_value=["Translator"]),
			patch("frappe.translate.get_all_translations", return_value=dictionary),
			patch(
				"frappe.utils.logger.get_logger",
				return_value=logging.getLogger("print-format-extraction-test"),
			),
		):
			for restricted in (True, False):
				for key in ("jenv_restricted", "jenv_unrestricted"):
					self.addCleanup(setattr, frappe.local, key, getattr(frappe.local, key, None))
					setattr(frappe.local, key, None)
				env = frappe.get_jenv(restrict_globals=restricted)
				for field in layout["sections"][0]["columns"][0]["fields"]:
					df = frappe._dict(field, renderer=field["fieldtype"].replace("Currency", "Data"))
					html = str(
						env.get_template("templates/print_format/macros.html").module.render_field(df, doc)
					)
					self.assertIn(
						targets["Print subtotal" if field["fieldtype"] == "Currency" else "Print bill to"],
						html,
					)
					if field["fieldtype"] == "Currency":
						self.assertIn("12.5", html)
		self.assertEqual(doc, {"amount": 12.5})
