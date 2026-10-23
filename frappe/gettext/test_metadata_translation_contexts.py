import json
from pathlib import Path
from unittest.mock import patch

from babel.messages.extract import extract
from jinja2 import Environment

import frappe
from frappe.gettext.translate import PYTHON_KEYWORDS
from frappe.model.document import Document
from frappe.model.meta import Meta
from frappe.tests import UnitTestCase
from frappe.utils.formatters import format_value


class TestMetadataTranslationContexts(UnitTestCase):
	def setUp(self):
		self.addCleanup(frappe.set_user, frappe.session.user)
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.set_user("translator@example.com")
		frappe.local.lang = "it"

	def test_reply_and_medium_labels_keep_metadata_meaning(self):
		with Path(__file__).with_name("contextual_messages.py").open("rb") as file:
			messages = {
				(message, context)
				for _line, message, _comments, context in extract(
					"frappe.gettext.extractors.python.extract", file, keywords=PYTHON_KEYWORDS
				)
			}
		translations = {"Reply": "Rispondi", "Medium": "Media"}
		for module, doctype, fieldname, target in [
			("website", "discussion_reply", "reply", "Risposta"),
			("website", "web_page_view", "medium", "Canale"),
		]:
			with self.subTest(doctype=doctype):
				metadata = json.loads(
					Path(
						frappe.get_app_path("frappe", module, "doctype", doctype, f"{doctype}.json")
					).read_text()
				)
				fields = {field["fieldname"]: frappe._dict(field) for field in metadata["fields"]}
				meta = Meta.__new__(Meta)
				meta.__dict__.update(name=metadata["name"], _fields=fields)
				source = fields[fieldname].label
				if (source, meta.name) in messages:
					translations[f"{source}:{meta.name}"] = target
				with patch("frappe.translate.get_all_translations", return_value=translations):
					self.assertEqual(meta.get_translated_label(fieldname), target)
					self.assertEqual(meta.get_label(fieldname), source)
					self.assertEqual(frappe._(source), translations[source])
		priority = json.loads(
			Path(frappe.get_app_path("frappe", "desk", "doctype", "todo", "todo.json")).read_text()
		)
		field = next(field for field in priority["fields"] if field["fieldname"] == "priority")
		options = field["options"]
		with patch("frappe.translate.get_all_translations", return_value=translations):
			self.assertEqual(format_value("Medium", frappe._dict(field, parent="ToDo")), "Media")
			self.assertEqual(frappe.N_("Medium"), "Medium")
		self.assertEqual(field["options"], options)

	def test_website_comment_action_keeps_comment_data_and_guest_branches(self):
		source = Path(
			frappe.get_app_path("frappe", "templates", "includes", "comments", "comments.html")
		).read_text()
		template = Environment(autoescape=True).from_string(source)
		context = {
			"comment_list": [],
			"comment_count": 0,
			"pathname": "example-discussion",
			"doctype": "Blog Post",
			"name": "Example discussion",
			"reference_doctype": "Blog Post",
			"reference_name": "Example discussion",
		}
		translations = {"Comment": "Commento", "Comment:Comment Action": "Commenta"}
		with patch("frappe.translate.get_all_translations", return_value=translations):
			for guest_allowed in (0, 1):
				with self.subTest(guest_allowed=guest_allowed):
					rendered = template.render(
						**context, guest_allowed=guest_allowed, is_communication=False, _=frappe._
					)
					self.assertIn('id="submit-comment">Commenta</button>', rendered)
					self.assertIn('comment_type: "Comment"', rendered)
					self.assertIn('reference_doctype: "Blog Post"', rendered)
					self.assertIn('reference_name: "Example discussion"', rendered)
					self.assertIn('route: "example-discussion"', rendered)
					self.assertIn('let guest_allowed = parseInt("' + str(guest_allowed) + '")', rendered)
					without_context = dict(translations)
					without_context.pop("Comment:Comment Action")
					with patch("frappe.translate.get_all_translations", return_value=without_context):
						control = template.render(
							**context, guest_allowed=guest_allowed, is_communication=False, _=frappe._
						)
					self.assertEqual(rendered.split("<script>")[1], control.split("<script>")[1])
			self.assertNotIn(
				'id="submit-comment"',
				template.render(**context, guest_allowed=0, is_communication=True, _=frappe._),
			)
			self.assertEqual(frappe._("Comment"), "Commento")

	def test_metadata_labels_and_select_values_have_distinct_contexts(self):
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.local.lang = "it"
		cases = [
			("core", "communication", "delivery_status", "Read", "Letto"),
			("desk", "notification_log", "read", None, "Letta"),
			("email", "email_flag_queue", "action", "Read", "Segna come letto"),
			("email", "email_flag_queue", "action", "Unread", "Segna come non letto"),
			("core", "docfield", "mask", None, "Oscura"),
			("custom", "custom_field", "mask", None, "Oscura"),
			("custom", "customize_form_field", "mask", None, "Oscura"),
			("core", "docperm", "mask", None, "Visualizza dati non oscurati"),
			("core", "custom_docperm", "mask", None, "Visualizza dati non oscurati"),
			("desk", "form_tour", "reference_doctype", None, "Tipo di documento di riferimento"),
			("desk", "onboarding_step", "reference_document", None, "Tipo di documento di riferimento"),
			("core", "permission_log", "status", "Reset", "Reimpostato"),
			("desk", "form_tour", "view_name", None, "Vista"),
		]
		for module, doctype in [
			("core", "data_import_value_mapping"),
			("core", "docfield"),
			("core", "report_column"),
			("core", "report_filter"),
			("custom", "custom_field"),
			("custom", "customize_form_field"),
			("website", "web_form_field"),
			("website", "web_template_field"),
		]:
			cases.append((module, doctype, "fieldtype", "Select", "Selezione"))
		with Path(__file__).with_name("contextual_messages.py").open("rb") as file:
			messages = {
				(message, context)
				for _line, message, _comments, context in extract(
					"frappe.gettext.extractors.python.extract", file, keywords=PYTHON_KEYWORDS
				)
			}
		translations = {
			"Read": "Lettura",
			"Reference Document": "Documento di riferimento",
			"Reset": "Reimposta",
			"View": "Visualizza",
			"Unread": "Non letto",
			"Select": "Seleziona",
			"Mask": "Visualizza dati non oscurati",
		}
		for module, doctype, fieldname, value, target in cases:
			with self.subTest(doctype=doctype, fieldname=fieldname, value=value):
				metadata = json.loads(
					Path(
						frappe.get_app_path("frappe", module, "doctype", doctype, f"{doctype}.json")
					).read_text()
				)
				fields = {field["fieldname"]: field for field in metadata["fields"]}
				field = fields[fieldname]
				source = value or field["label"]
				context = metadata["name"]
				self.assertIn((source, context), messages)
				translations[f"{source}:{context}"] = target
				with patch("frappe.translate.get_all_translations", return_value=translations):
					if value:
						self.assertIn(value, field["options"].split("\n"))
						self.assertEqual(format_value(value, frappe._dict(field, parent=context)), target)
					else:
						meta = frappe._dict(name=context, get_label=lambda name: fields[name]["label"])
						self.assertEqual(Meta.get_translated_label(meta, fieldname), target)

	def test_overloaded_metadata_terms_use_extracted_contexts(self):
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.local.lang = "it"
		cases = [
			("email", "email_account", "account_section", None, "Account email"),
			("automation", "automation_action", "target", None, "Alias del record di destinazione"),
			("website", "portal_menu_item", "target", None, "Finestra di destinazione"),
			("website", "website_route_redirect", "target", None, "URL di destinazione"),
			("core", "user_permission", "allow", None, "Tipo di documento consentito"),
			("core", "scheduled_job_log", "status", "Complete", "Completato"),
			("email", "email_queue", "retry", None, "Tentativi di reinvio"),
			("core", "activity_log", "operation", "Login", "Accesso"),
			("core", "activity_log", "operation", "Logout", "Disconnessione"),
			("core", "activity_log", "operation", "Impersonate", "Accesso come altro utente"),
			("core", "system_settings", "security_tab", None, "Accesso"),
			("printing", "print_settings", "pdf_page_size", "Ledger", "Ledger"),
			("core", "navbar_item", "item_type", None, "Tipo di voce"),
		]
		with Path(__file__).with_name("contextual_messages.py").open("rb") as file:
			messages = {
				(message, context)
				for _line, message, _comments, context in extract(
					"frappe.gettext.extractors.python.extract", file, keywords=PYTHON_KEYWORDS
				)
			}
		generic_translations = {
			"Account": "Conto",
			"Target": "Destinazione",
			"Used": "Utilizzata",
			"Changes": "Modifiche",
			"Allow": "Consenti",
			"Complete": "Completa",
			"Retry": "Riprova",
			"Login": "Accedi",
			"Logout": "Esci",
			"Impersonate": "Accedi come altro utente",
			"Ledger": "Libro mastro",
			"Item Type": "Tipo di articolo",
		}
		for module, doctype, fieldname, value, target in cases:
			with self.subTest(doctype=doctype, fieldname=fieldname, value=value):
				metadata = json.loads(
					Path(
						frappe.get_app_path("frappe", module, "doctype", doctype, f"{doctype}.json")
					).read_text()
				)
				fields = {field["fieldname"]: field for field in metadata["fields"]}
				field = fields[fieldname]
				source = value or field["label"]
				context = metadata["name"]
				translations = dict(generic_translations)
				if (source, context) in messages:
					translations[f"{source}:{context}"] = target
				with patch("frappe.translate.get_all_translations", return_value=translations):
					self.assertEqual(frappe._(source), generic_translations[source])
					if value:
						options = field["options"]
						self.assertIn(value, options.split("\n"))
						self.assertEqual(format_value(value, frappe._dict(field, parent=context)), target)
						self.assertEqual(field["options"], options)
					else:
						meta = Meta.__new__(Meta)
						meta.__dict__.update(name=context, _fields={fieldname: frappe._dict(field)})
						self.assertEqual(meta.get_translated_label(fieldname), target)
						self.assertEqual(meta.get_label(fieldname), source)

	def test_selector_states_keep_context_and_canonical_options(self):
		self.assertEqual(frappe.session.user, "translator@example.com")
		cases = [
			(
				"integrations",
				"oauth_client",
				"token_endpoint_auth_method",
				"None",
				"Nessuna autenticazione del client",
			),
			("desk", "todo", "status", "Open", "Da svolgere"),
		]
		with Path(__file__).with_name("contextual_messages.py").open("rb") as file:
			messages = {
				(message, context)
				for _line, message, _comments, context in extract(
					"frappe.gettext.extractors.python.extract", file, keywords=PYTHON_KEYWORDS
				)
			}
		for module, doctype, fieldname, source, target in cases:
			with self.subTest(doctype=doctype, fieldname=fieldname):
				metadata = json.loads(
					Path(
						frappe.get_app_path("frappe", module, "doctype", doctype, f"{doctype}.json")
					).read_text()
				)
				field_data = next(field for field in metadata["fields"] if field["fieldname"] == fieldname)
				meta = Meta.__new__(Meta)
				meta.__dict__.update(name=metadata["name"], doctype="DocType")
				field = Document.__new__(Document)
				field.__dict__.update(field_data, doctype="DocField")
				field = meta._init_child(field, "fields")
				self.assertEqual(field.parent, metadata["name"])
				options = field.options
				self.assertIn(source, options.split("\n"))
				translations = {"None": "Nessuna", "Open": "Apri"}
				if (source, metadata["name"]) in messages:
					translations[f"{source}:{metadata['name']}"] = target
				with patch("frappe.translate.get_all_translations", return_value=translations):
					self.assertEqual(format_value(source, field), target)
					self.assertEqual(frappe._(source), translations[source])
					self.assertEqual(frappe._(source, context="Unrelated settings"), translations[source])
				self.assertEqual(field.options, options)
