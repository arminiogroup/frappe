import inspect
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, call, patch

from babel.messages.extract import extract
from jinja2 import DictLoader

import frappe
from frappe.gettext.translate import PYTHON_KEYWORDS
from frappe.tests import UnitTestCase
from frappe.utils.jinja import _get_jenv
from frappe.www import third_party_apps

WARNING = "This will revoke existing access tokens for {0} on your account."
TARGETS = {
	WARNING: "Verranno revocati i token di accesso già emessi a {0} per il tuo account.",
	"Apps linked to your account": "App collegate al tuo account",
	"Access token created": "Token di accesso creato",
	"No linked apps": "Nessuna app collegata",
	"Cancel": "Annulla",
	"Revoke": "Revoca",
	"Third Party Apps": "App di terze parti",
	"Location": "Sede",
}


class TestThirdPartyAppLocalization(UnitTestCase):
	def setUp(self):
		self.addCleanup(frappe.set_user, frappe.session.user)
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		self.addCleanup(setattr, frappe.local, "form_dict", frappe.local.form_dict)
		frappe.set_user("translator@example.com")
		frappe.local.lang = "it"
		frappe.local.form_dict = frappe._dict()
		self.template = Path(frappe.get_app_path("frappe", "www", "third_party_apps.html"))
		with self.template.open("rb") as stream:
			self.keys = {
				message
				for _, message, _, context in extract(
					"frappe.gettext.extractors.html_template.extract", stream, keywords=PYTHON_KEYWORDS
				)
				if context is None
			}
		self.enterContext(patch("frappe.translate.get_all_translations", return_value={**TARGETS}))
		loader = DictLoader(
			{
				"templates/web.html": "{% block page_content %}{% endblock %}",
				"www/third_party_apps.html": self.template.read_text(),
				"templates/includes/integrations/third_party_apps.js": Path(
					frappe.get_app_path(
						"frappe", "templates", "includes", "integrations", "third_party_apps.js"
					)
				).read_text(),
			}
		)
		with patch("frappe.utils.jinja.get_jloader", return_value=loader):
			self.environment = inspect.unwrap(_get_jenv)()
		self.environment.globals["_"] = frappe._
		self.pretty_dates = []

		def pretty_date(value):
			self.pretty_dates.append(value)
			return "2 giorni fa"

		self.pretty_date = pretty_date

	def render(self, **values):
		return self.environment.get_template("www/third_party_apps.html").render(
			app=None,
			apps=[],
			frappe=SimpleNamespace(utils=SimpleNamespace(pretty_date=self.pretty_date)),
			**values,
		)

	def test_detail_uses_truthful_warning_and_localized_buttons_with_raw_client_identity(self):
		app = frappe._dict(app_name="Location", client_id="CLIENT-RAW")
		html = self.environment.get_template("www/third_party_apps.html").render(app=app, apps=[])
		self.assertIn(TARGETS[WARNING].format("Location"), html)
		self.assertIn(">Annulla</button>", html)
		self.assertIn(">Revoca</button>", html)
		self.assertIn('data-client_id="CLIENT-RAW"', html)
		self.assertIn("location.href = '/third_party_apps';", html)
		self.assertIn("frappe.www.third_party_apps.delete_client", html)
		self.assertIn("<h4>Location</h4>", html)
		self.assertNotIn("Sede", html)

	def test_list_heading_and_date_describe_token_records_without_changing_links(self):
		apps = [frappe._dict(name="CLIENT-RAW", app_name="Location", creation="2026-10-19")]
		html = self.environment.get_template("www/third_party_apps.html").render(
			app=None,
			apps=apps,
			frappe=SimpleNamespace(utils=SimpleNamespace(pretty_date=self.pretty_date)),
		)
		self.assertIn("<h4>App collegate al tuo account</h4>", html)
		self.assertIn("Token di accesso creato&nbsp;2 giorni fa", html)
		self.assertIn('href="/third_party_apps?app=CLIENT-RAW">Revoca</a>', html)
		self.assertEqual(self.pretty_dates, ["2026-10-19"])
		self.assertNotIn("Sede", html)

	def test_empty_state_uses_linked_apps_instead_of_device_sessions(self):
		html = self.render()
		self.assertIn("Nessuna app collegata", html)
		self.assertNotIn("btn-delete-app", html.split("<script>")[0])
		self.assertEqual(self.pretty_dates, [])

	def test_real_context_keeps_user_client_filters_and_first_remaining_token_date(self):
		context = frappe._dict()
		with (
			patch(
				"frappe.get_all",
				side_effect=[[frappe._dict(client="CLIENT-RAW")], [frappe._dict(creation="2026-10-19")]],
			) as reads,
			patch.object(frappe, "db", new=SimpleNamespace(get_value=Mock(return_value="Location"))) as db,
		):
			third_party_apps.get_context(context)
			self.assertEqual(db.get_value.call_args, call("OAuth Client", "CLIENT-RAW", "app_name"))
		self.assertEqual(context.apps, [dict(name="CLIENT-RAW", app_name="Location", creation="2026-10-19")])
		self.assertEqual(
			reads.call_args_list,
			[
				call(
					"OAuth Bearer Token",
					filters=[["user", "=", "translator@example.com"]],
					fields=["client"],
					distinct=True,
					order_by="creation",
				),
				call(
					"OAuth Bearer Token",
					filters=[["user", "=", "translator@example.com"], ["client", "=", "CLIENT-RAW"]],
					fields=["creation"],
					order_by="creation",
					limit=1,
				),
			],
		)
		self.assertEqual(frappe.session.user, "translator@example.com")

	def test_guest_still_cannot_read_the_page_and_no_tokens_are_queried(self):
		frappe.set_user("Guest")
		with patch("frappe.get_all") as read:
			with self.assertRaises(frappe.PermissionError):
				third_party_apps.get_context(frappe._dict())
		read.assert_not_called()

	def test_configured_template_extraction_registers_all_complete_captions(self):
		for source in (
			WARNING,
			"Apps linked to your account",
			"Access token created",
			"No linked apps",
			"Cancel",
			"Revoke",
		):
			self.assertIn(source, self.keys)
