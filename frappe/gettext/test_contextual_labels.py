import json
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from babel.messages.extract import extract

import frappe
from frappe.desk.doctype.sidebar.sidebar import validate_item_route
from frappe.gettext.translate import PYTHON_KEYWORDS
from frappe.model.meta import Meta
from frappe.tests import UnitTestCase


class TestContextualLabels(UnitTestCase):
	def setUp(self):
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		self.addCleanup(setattr, frappe.local, "response", frappe.local.response)
		self.addCleanup(setattr, frappe.local, "message_log", frappe.local.message_log)
		frappe.set_user("translator@example.com")
		frappe.local.lang = "it"
		frappe.local.response = frappe._dict()
		frappe.local.message_log = []
		self.addCleanup(frappe.set_user, "Administrator")

	def test_metadata_labels_keep_their_context_in_the_catalog(self):
		path = Path(frappe.get_app_path("frappe", "gettext", "contextual_messages.py"))
		code = path.read_bytes() if path.exists() else b""
		messages = extract(
			"frappe.gettext.extractors.python.extract", BytesIO(code), keywords=PYTHON_KEYWORDS
		)
		italian = {("Run", "Automation Event Subscription"): "Esecuzione", ("Pinned", "User"): "Fisso"}
		translations = {"Run": "Esegui", "Pinned": "In evidenza"}
		for _line, message, _comments, context in messages:
			if (message, context) in italian:
				translations[f"{message}:{context}"] = italian[(message, context)]
		with patch("frappe.translate.get_all_translations", return_value=translations):
			metadata = json.loads(
				Path(
					frappe.get_app_path(
						"frappe",
						"automation",
						"doctype",
						"automation_event_subscription",
						"automation_event_subscription.json",
					)
				).read_text()
			)
			fields = {field["fieldname"]: field for field in metadata["fields"]}
			meta = frappe._dict(name=metadata["name"], get_label=lambda fieldname: fields[fieldname]["label"])
			self.assertEqual(Meta.get_translated_label(meta, "run"), "Esecuzione")
			for (message, context), expected in {
				("Run", None): "Esegui",
				("Pinned", "User"): "Fisso",
				("Pinned", None): "In evidenza",
			}.items():
				self.assertEqual(frappe._(message, context=context), expected)

	def test_sidebar_route_error_translates_only_the_link_type(self):
		message = "Only a Page item has a route inside it. {0} links a {1}."
		translations = {
			message: "Solo una voce Pagina può avere un percorso interno. {0} rimanda a {1}.",
			"DocType": "Tipo di documento",
			"Workspace": "Area di lavoro",
			"Route Not Allowed": "Percorso non consentito",
		}
		for link_type in ("DocType", "Workspace"):
			with self.subTest(link_type=link_type):
				item = frappe._dict(
					label="Contatti del team", link_to="My custom target", link_type=link_type, route="inside"
				)
				with patch("frappe.translate.get_all_translations", return_value=translations):
					with self.assertRaises(frappe.ValidationError) as error:
						validate_item_route(item)
				self.assertEqual(
					str(error.exception),
					translations[message].format(frappe.bold(item.label), translations[link_type]),
				)
				self.assertEqual(item.label, "Contatti del team")
				self.assertEqual(item.link_to, "My custom target")
				self.assertEqual(item.link_type, link_type)
				self.assertEqual(item.route, "inside")
