from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from babel.messages.extract import extract
from jinja2 import Environment, nodes

import frappe
from frappe.gettext.translate import PYTHON_KEYWORDS
from frappe.tests import UnitTestCase


class TestWebFormTranslationLabels(UnitTestCase):
	def setUp(self):
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.local.lang = "it"
		self.source = Path(
			frappe.get_app_path("frappe", "website", "doctype", "web_form", "templates", "web_form.html")
		).read_text()

	def test_receipt_title_has_web_form_context(self):
		messages = extract(
			"frappe.gettext.extractors.html_template.extract",
			BytesIO(self.source.encode()),
			keywords=PYTHON_KEYWORDS,
		)
		self.assertIn(
			("Submitted", "Web Form"), [(message, context) for line, message, comments, context in messages]
		)

	def test_default_receipt_is_distinct_from_document_confirmation(self):
		env = Environment()
		tree = env.parse(self.source)
		expression = next(
			node
			for node in tree.find_all(nodes.Or)
			if isinstance(node.right, nodes.Call)
			and node.right.args
			and isinstance(node.right.args[0], nodes.Const)
			and node.right.args[0].value == "Submitted"
		)
		template = env.from_string(nodes.Template([nodes.Output([expression])]))
		translations = {"Submitted": "Confermato", "Submitted:Web Form": "Modulo inviato"}
		with patch("frappe.translate.get_all_translations", return_value=translations):
			self.assertEqual(template.render(success_title="", _=frappe._), "Modulo inviato")
			self.assertEqual(
				template.render(success_title="Richiesta ricevuta", _=frappe._), "Richiesta ricevuta"
			)
			self.assertEqual(frappe._("Submitted"), "Confermato")
