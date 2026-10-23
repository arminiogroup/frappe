# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# License: MIT. See LICENSE

from copy import deepcopy
from pathlib import Path
from unittest.mock import Mock, call, patch

from babel.messages.extract import extract

import frappe
from frappe.gettext.translate import PYTHON_KEYWORDS
from frappe.tests import UnitTestCase
from frappe.utils import change_log

MESSAGE = "New {} releases for the following apps are available"
TARGETS = {
	MESSAGE: "Per le seguenti app sono disponibili nuove versioni {}",
	"major:Release Type": "principali",
	"minor:Release Type": "secondarie",
	"patch:Release Type": "correttive",
	"major": "Maggioranza",
	"minor": "Minore",
	"patch": "Patch",
	"hotfix": "correttive urgenti",
	"Reference": "Riferimento",
	"New updates are available": "Sono disponibili nuovi aggiornamenti",
	"Update from Frappe Cloud": "Aggiorna da Frappe Cloud",
	"Contains {0} security fixes": "Contiene {0} correzioni di sicurezza",
	"Contains {0} security fix": "Contiene {0} correzione di sicurezza",
}


def extracted_keys():
	with Path(change_log.__file__).open("rb") as stream:
		return {
			message + (":" + context if context else "")
			for _, message, _, context in extract(
				"frappe.gettext.extractors.python.extract", stream, keywords=PYTHON_KEYWORDS
			)
		}


class TestChangelogReleaseTypeTranslation(UnitTestCase):
	def setUp(self):
		self.addCleanup(frappe.set_user, frappe.session.user)
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.set_user("translator@example.com")
		frappe.local.lang = "it"
		keys = extracted_keys()
		self.enterContext(
			patch(
				"frappe.translate.get_all_translations",
				return_value={key: value for key, value in TARGETS.items() if ":" not in key or key in keys},
			)
		)
		self.settings = self.enterContext(patch("frappe.get_system_settings", return_value=0))
		self.cloud = self.enterContext(patch.object(change_log, "on_frappecloud", return_value=False))
		self.cache = Mock()
		self.cache.get_value.side_effect = lambda _key: change_log.json.dumps(self.updates)
		self.cache.sismember.return_value = True
		self.enterContext(patch.object(frappe, "cache", self.cache))
		self.messages = self.enterContext(patch("frappe.msgprint"))
		self.updates = {kind: [] for kind in ("major", "minor", "patch")}

	def app(self, **values):
		return {
			"title": "Reference",
			"org_name": "ORG-RAW",
			"app_name": "APP-RAW",
			"available_version": "2.0.0",
			"security_issues": 0,
			**values,
		}

	def test_configured_extractor_registers_release_type_contexts(self):
		keys = extracted_keys()
		for kind in ("major", "minor", "patch"):
			with self.subTest(kind=kind):
				self.assertIn(kind + ":Release Type", keys)

	def test_actual_popup_uses_release_categories_instead_of_global_meanings_or_counts(self):
		for kind, label in (("major", "principali"), ("minor", "secondarie"), ("patch", "correttive")):
			for count in (1, 2):
				with self.subTest(kind=kind, count=count):
					self.messages.reset_mock()
					self.updates = {value: [] for value in ("major", "minor", "patch")}
					self.updates[kind] = [self.app() for _ in range(count)]
					before = deepcopy(self.updates)
					change_log.show_update_popup()
					self.messages.assert_called_once()
					message = self.messages.call_args.args[0]
					self.assertIn(f"Per le seguenti app sono disponibili nuove versioni {label}", message)
					self.assertEqual(message.count("<b>Reference</b>"), count)
					self.assertEqual(
						message.count("https://github.com/ORG-RAW/APP-RAW/releases/tag/v2.0.0"), count
					)
					self.assertNotIn("Riferimento", message)
					self.assertEqual(self.updates, before)
					self.assertEqual(
						self.messages.call_args.kwargs,
						{
							"title": "Sono disponibili nuovi aggiornamenti",
							"indicator": "green",
							"primary_action": None,
						},
					)
					self.cache.srem.assert_called_with("changelog-update-user-set", "translator@example.com")

	def test_multiple_categories_keep_order_links_and_security_advisory_counts(self):
		for index, kind in enumerate(self.updates):
			self.updates[kind] = [self.app(security_issues=index)]
		change_log.show_update_popup()
		message = self.messages.call_args.args[0]
		for label in ("principali", "secondarie", "correttive"):
			self.assertIn("versioni " + label, message)
		self.assertLess(message.index("versioni principali"), message.index("versioni secondarie"))
		self.assertLess(message.index("versioni secondarie"), message.index("versioni correttive"))
		self.assertIn("Contiene <strong>1</strong> correzione di sicurezza", message)
		self.assertIn("Contiene <strong>2</strong> correzioni di sicurezza", message)
		self.assertEqual(message.count("https://github.com/ORG-RAW/APP-RAW/security/advisories"), 2)

	def test_unknown_cached_category_keeps_global_fallback(self):
		self.updates = {"hotfix": [self.app()]}
		change_log.show_update_popup()
		self.assertIn("nuove versioni correttive urgenti", self.messages.call_args.args[0])

	def test_disabled_missing_membership_and_empty_categories_keep_existing_gates(self):
		self.settings.return_value = 1
		change_log.show_update_popup()
		self.cache.get_value.assert_not_called()
		self.settings.return_value = 0
		self.cache.sismember.return_value = False
		change_log.show_update_popup()
		self.cache.sismember.return_value = True
		change_log.show_update_popup()
		self.cache.get_value.side_effect = None
		self.cache.get_value.return_value = None
		change_log.show_update_popup()
		self.messages.assert_not_called()
		self.cache.srem.assert_not_called()

	def test_cloud_primary_action_and_cache_identity_remain_unchanged(self):
		self.updates["patch"] = [self.app()]
		self.cloud.return_value = True
		with patch.object(frappe.local, "site", "memory.example.test", create=True):
			change_log.show_update_popup()
		self.assertEqual(
			self.messages.call_args.kwargs["primary_action"],
			{
				"label": "Aggiorna da Frappe Cloud",
				"client_action": "window.open",
				"args": "https://frappecloud.com/dashboard/sites/memory.example.test",
			},
		)
		self.assertEqual(self.cache.get_value.call_args, call("changelog-update-info"))
		self.assertEqual(
			self.cache.sismember.call_args, call("changelog-update-user-set", "translator@example.com")
		)
		self.cache.set_value.assert_not_called()
		self.cache.sadd.assert_not_called()
