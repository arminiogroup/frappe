import json
from pathlib import Path
from unittest.mock import patch

from babel.messages.extract import extract

import frappe
from frappe.gettext.translate import PYTHON_KEYWORDS
from frappe.model.meta import Meta
from frappe.tests import UnitTestCase
from frappe.website.doctype.web_form.web_form import WebForm


class TestRequestDataContext(UnitTestCase):
	def setUp(self):
		self.addCleanup(frappe.set_user, frappe.session.user)
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.set_user("translator@example.com")
		frappe.local.lang = "it"
		with Path(__file__).with_name("contextual_messages.py").open("rb") as stream:
			self.messages = {
				(message, context)
				for _, message, _, context in extract(
					"frappe.gettext.extractors.python.extract", stream, keywords=PYTHON_KEYWORDS
				)
			}
		self.translations = {"Request Data": "Richiedi i dati"}
		if ("Request Data", "Integration Request") in self.messages:
			self.translations["Request Data:Integration Request"] = "Dati della richiesta"
		self.enterContext(patch("frappe.translate.get_all_translations", return_value=self.translations))

	def test_actual_extractor_registers_the_payload_label_context(self):
		self.assertIn(("Request Data", "Integration Request"), self.messages)

	def metadata(self):
		data = json.loads(
			Path(
				frappe.get_app_path(
					"frappe", "integrations", "doctype", "integration_request", "integration_request.json"
				)
			).read_text()
		)
		meta = Meta.__new__(Meta)
		meta.__dict__.update(
			name=data["name"], _fields={field["fieldname"]: frappe._dict(field) for field in data["fields"]}
		)
		return meta

	def test_real_meta_uses_the_noun_for_the_read_only_request_payload(self):
		meta = self.metadata()
		field = meta.get_field("data")
		before = dict(field)
		self.assertEqual(meta.get_translated_label("data"), "Dati della richiesta")
		self.assertEqual(field, before)
		self.assertEqual((field.label, field.fieldtype, field.read_only), ("Request Data", "Code", 1))

	def test_actual_web_form_translation_payload_keeps_the_request_action(self):
		data = json.loads(
			Path(
				frappe.get_app_path("frappe", "website", "web_form", "request_data", "request_data.json")
			).read_text()
		)
		form = WebForm.__new__(WebForm)
		form.__dict__.update(success_title=None, list_title=None, meta_title=None, meta_description=None)
		form.__dict__.update(data)
		form.web_form_fields = [frappe._dict(field) for field in data["web_form_fields"]]
		context = frappe._dict()
		form.load_translations(context)
		self.assertEqual(json.loads(context.translated_messages)["Request Data"], "Richiedi i dati")
		self.assertEqual(
			(form.title, form.button_label, form.route, form.doc_type),
			("Request Data", "Request Data", "request-data", "Personal Data Download Request"),
		)
		self.assertEqual(form.web_form_fields[0].fieldname, "user")
		self.assertEqual(frappe.session.user, "translator@example.com")

	def test_parent_context_keeps_existing_global_and_source_fallbacks(self):
		meta = self.metadata()
		with patch("frappe.translate.get_all_translations", return_value={"Request Data": "Richiedi i dati"}):
			self.assertEqual(meta.get_translated_label("data"), "Richiedi i dati")
		with patch("frappe.translate.get_all_translations", return_value={}):
			self.assertEqual(meta.get_translated_label("data"), "Request Data")
