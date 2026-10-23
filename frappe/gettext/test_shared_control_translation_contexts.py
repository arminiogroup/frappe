from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from unittest.mock import patch

from babel.messages.extract import extract
from jinja2 import FileSystemLoader
from jinja2.sandbox import SandboxedEnvironment

import frappe
from frappe.gettext.translate import PYTHON_KEYWORDS
from frappe.tests import UnitTestCase


class Buttons(HTMLParser):
	def __init__(self, html):
		super().__init__()
		self.buttons = []
		self.current = None
		self.feed(html)

	def handle_starttag(self, tag, attrs):
		if tag == "button":
			self.current = {"attrs": dict(attrs), "text": ""}

	def handle_data(self, data):
		if self.current is not None:
			self.current["text"] += data

	def handle_endtag(self, tag):
		if tag == "button" and self.current is not None:
			self.buttons.append(self.current)
			self.current = None


class TestSharedControlTranslationContexts(UnitTestCase):
	paths = (
		"public/js/frappe/form/link_selector.js",
		"public/js/frappe/form/multi_select_dialog.js",
		"public/js/frappe/ui/toolbar/search.js",
		"public/js/frappe/widgets/chart_widget.js",
		"templates/includes/list/list.html",
		"templates/includes/search_template.html",
	)

	def setUp(self):
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.local.lang = "it"

	def extracted_messages(self):
		messages = Counter()
		for path in self.paths:
			method = "html_template" if path.endswith(".html") else "javascript"
			with Path(frappe.get_app_path("frappe", path)).open("rb") as file:
				messages.update(
					(message, context)
					for _line, message, _comments, context in extract(
						f"frappe.gettext.extractors.{method}.extract", file, keywords=PYTHON_KEYWORDS
					)
				)
		return messages

	def test_shared_control_contexts_are_extracted_without_metadata_markers(self):
		messages = self.extracted_messages()
		self.assertEqual(messages["More", "Pagination"], 8)
		self.assertEqual(messages["More", "Heatmap legend"], 1)
		self.assertEqual(messages["Get Items", "MultiSelectDialog"], 1)
		self.assertEqual(messages["More", None], 1)

	def test_public_pagination_templates_render_contextual_captions(self):
		messages = self.extracted_messages()
		translations = {"More": "Altro"}
		if messages["More", "Pagination"]:
			translations["More:Pagination"] = "Altri risultati"
		environment = SandboxedEnvironment(loader=FileSystemLoader(frappe.get_app_path("frappe")))
		environment.globals.update(_=frappe._, frappe=frappe._dict(form_dict=frappe._dict()))
		with patch("frappe.translate.get_all_translations", return_value=translations):
			for show_more in (False, True):
				with self.subTest(template="list", show_more=show_more):
					html = environment.get_template("templates/includes/list/list.html").render(
						result=["<div>Indirizzo originale</div>"],
						doctype="Address",
						txt='Caffè "Centro"',
						hide_filters=True,
						show_more=show_more,
					)
					buttons = Buttons(html).buttons
					self.assertEqual(buttons[0]["text"], "Altri risultati")
					self.assertEqual(buttons[0]["attrs"]["class"], "btn btn-light btn-more btn-sm")
					self.assertIn('data-doctype="Address"', html)
					self.assertIn('data-txt="Caffè &#34;Centro&#34;"', html)
					self.assertIn("Indirizzo originale", html)
					self.assertEqual("py-6 d-none" in html, not show_more)
			for has_more in (False, True):
				with self.subTest(template="search", has_more=has_more):
					html = environment.get_template("templates/includes/search_template.html").render(
						title="Titolo originale",
						results=[
							frappe._dict(
								route="/original-route", title="Risultato originale", preview="Testo"
							)
						],
						has_more=has_more,
					)
					buttons = [b for b in Buttons(html).buttons if "btn-more" in b["attrs"].get("class", "")]
					self.assertEqual(len(buttons), int(has_more))
					if has_more:
						self.assertEqual(buttons[0]["text"], "Altri risultati")
					self.assertIn('href="/original-route"', html)
					self.assertIn("Risultato originale", html)
			self.assertEqual(frappe._("More"), "Altro")

	def test_search_sections_without_has_more_keep_the_button_omitted(self):
		environment = SandboxedEnvironment(loader=FileSystemLoader(frappe.get_app_path("frappe")))
		environment.globals.update(_=frappe._, frappe=frappe._dict(form_dict=frappe._dict()))
		with patch("frappe.translate.get_all_translations", return_value={"More": "Altro"}):
			html = environment.get_template("templates/includes/search_template.html").render(
				title="Titolo originale",
				results_sections=[frappe._dict(title="Sezione originale", results=[])],
			)
		self.assertFalse(any("btn-more" in b["attrs"].get("class", "") for b in Buttons(html).buttons))
