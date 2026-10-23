# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# License: MIT. See LICENSE

import json
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import frappe
import frappe.permissions
from frappe.database.query import Engine
from frappe.model.meta import Meta
from frappe.query_builder.builder import MariaDB
from frappe.tests import UnitTestCase

FRAME = "Insufficient Permission for {0}"
TARGETS = {
	FRAME: "Permessi insufficienti per {0}",
	"Permission Error": "Errore di autorizzazione",
	"DocType": "Tipo di documento",
	"Accounting Dimension": "Dimensione contabile",
}


class TestQueryPermissionLabelTranslation(UnitTestCase):
	def setUp(self):
		super().setUp()
		self.addCleanup(frappe.set_user, frappe.session.user)
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.set_user("translator@example.com")
		frappe.local.lang = "it"
		self.enterContext(patch.object(frappe.local, "message_log", []))
		self.enterContext(patch.object(frappe.local, "role_permissions", {}))
		self.enterContext(patch.object(frappe, "flags", frappe._dict()))
		self.enterContext(
			patch(
				"frappe.translate.get_all_translations",
				side_effect=lambda lang: TARGETS if lang == "it" else {},
			)
		)
		path = Path(frappe.__file__).parent / "core/doctype/doctype/doctype.json"
		self.metadata = json.loads(path.read_text())
		self.meta = Meta.__new__(Meta)
		self.meta.__dict__.update(
			name=self.metadata["name"],
			module=self.metadata["module"],
			issingle=0,
			istable=0,
			is_virtual=0,
			permissions=[frappe._dict(row) for row in self.metadata["permissions"]],
		)
		self.roles = ["Desk User"]
		self.shares = []
		self.events = []
		self.db = SimpleNamespace(db_type="mariadb", qb=MariaDB)
		self.enterContext(patch.object(frappe, "db", self.db))
		self.enterContext(patch("frappe.get_meta", side_effect=self.get_meta))
		self.enterContext(patch("frappe.get_roles", side_effect=self.get_roles))
		self.enterContext(patch("frappe.share.get_shared", side_effect=self.get_shared))
		self.enterContext(patch("frappe.get_disabled_apps", return_value=[]))
		self.enterContext(patch("frappe.permissions.get_doctype_ptype_map", return_value={}))
		self.enterContext(
			patch.object(frappe, "client_cache", SimpleNamespace(get_value=self.get_cache_value))
		)
		for boundary in (
			"get_doc",
			"get_lazy_doc",
			"get_cached_doc",
			"get_all",
			"sendmail",
			"enqueue",
			"new_doc",
			"get_cached_value",
			"publish_realtime",
		):
			self.enterContext(
				patch("frappe." + boundary, side_effect=AssertionError("Unexpected I/O: " + boundary))
			)

	def get_meta(self, doctype):
		self.events.append(("get_meta", doctype))
		self.assertEqual(doctype, "DocType")
		return self.meta

	def get_roles(self, user):
		self.events.append(("get_roles", user))
		return self.roles[:]

	def get_shared(self, *args, **kwargs):
		self.events.append(("get_shared", args, kwargs))
		return self.shares[:]

	def get_cache_value(self, key):
		self.events.append(("existing_cache_value", key))
		self.assertEqual(key, "is_table")
		return []

	def engine(self):
		engine = Engine(db=self.db)
		engine.doctype = "DocType"
		engine.user = "translator@example.com"
		engine.parent_doctype = "Company"
		return engine

	def test_real_permission_denial_translates_type_before_query_construction(self):
		engine = Engine(db=self.db)
		before = deepcopy(self.meta.permissions)
		with self.assertRaises(frappe.PermissionError) as caught:
			engine.get_query(
				"DocType",
				fields="name",
				ignore_permissions=False,
				user="translator@example.com",
				parent_doctype="Company",
			)
		self.assertEqual(
			str(caught.exception), "Permessi insufficienti per <strong>Tipo di documento</strong>"
		)
		self.assertEqual(engine.doctype, "DocType")
		self.assertEqual(engine.user, "translator@example.com")
		self.assertEqual(engine.parent_doctype, "Company")
		self.assertFalse(hasattr(engine, "query"))
		self.assertEqual(self.meta.permissions, before)
		self.assertEqual(
			self.events,
			[
				("existing_cache_value", "is_table"),
				("get_meta", "DocType"),
				("get_roles", "translator@example.com"),
				("existing_cache_value", "is_table"),
				("get_meta", "DocType"),
				("get_shared", ("DocType", "translator@example.com"), {"rights": ["read"], "limit": 1}),
			],
		)
		message = frappe.local.message_log[-1]
		self.assertEqual(message.title, TARGETS["Permission Error"])
		self.assertEqual(message.message, str(caught.exception))
		self.assertEqual(message.indicator, "red")
		self.assertEqual(message.raise_exception, 1)

	def test_joined_type_denial_uses_explicit_type_and_same_actual_policy(self):
		engine = self.engine()
		engine.doctype = "Company"
		with self.assertRaises(frappe.PermissionError) as caught:
			engine.get_permission_conditions("DocType", MariaDB.DocType("DocType"))
		self.assertEqual(
			str(caught.exception), "Permessi insufficienti per <strong>Tipo di documento</strong>"
		)
		self.assertEqual(engine.doctype, "Company")
		self.assertEqual(
			self.events,
			[
				("get_meta", "DocType"),
				("get_roles", "translator@example.com"),
				("get_shared", ("DocType", "translator@example.com"), {}),
			],
		)

	def test_share_only_condition_keeps_raw_record_names_and_canonical_type(self):
		self.shares[:] = ["DocType", "Accounting Dimension"]
		engine = self.engine()
		condition = engine.get_permission_conditions("DocType", MariaDB.DocType("DocType"))
		self.assertEqual(str(condition), "\"name\" IN ('DocType','Accounting Dimension')")
		self.assertEqual(
			self.events,
			[
				("get_meta", "DocType"),
				("get_roles", "translator@example.com"),
				("get_shared", ("DocType", "translator@example.com"), {}),
			],
		)
		self.assertEqual(self.shares, ["DocType", "Accounting Dimension"])
		self.assertEqual(engine.doctype, "DocType")
		self.assertEqual(frappe.local.message_log, [])

	def test_actual_metadata_role_read_permission_still_implies_select(self):
		self.roles[:] = ["System Manager"]
		engine = self.engine()
		self.assertIsNone(engine.check_select_permission())
		permissions = frappe.permissions.get_role_permissions(self.meta, user=engine.user)
		self.assertEqual(permissions.read, 1)
		self.assertEqual(permissions.select, 0)
		self.assertEqual(self.meta.permissions, [frappe._dict(row) for row in self.metadata["permissions"]])
		self.assertFalse(any(event[0] == "get_shared" for event in self.events))
		self.assertEqual(frappe.local.message_log, [])

	def test_helper_fallback_translates_known_labels_without_metadata_or_query_reads(self):
		engine = self.engine()
		engine.doctype = "Accounting Dimension"
		before = deepcopy(engine.__dict__)
		for value, display in (
			(None, "Dimensione contabile"),
			("", "Dimensione contabile"),
			("DocType", "Tipo di documento"),
			("Custom Unknown Type", "Custom Unknown Type"),
		):
			with self.subTest(value=value), self.assertRaises(frappe.PermissionError) as caught:
				engine._raise_permission_error(value)
			self.assertEqual(str(caught.exception), TARGETS[FRAME].format("<strong>" + display + "</strong>"))
			self.assertEqual(engine.__dict__, before)
		self.assertEqual(self.events, [])

	def test_english_fallback_keeps_raw_type_and_existing_error_title(self):
		frappe.local.lang = "en"
		engine = self.engine()
		for value in (None, "", "Accounting Dimension", "Custom Unknown Type"):
			with self.subTest(value=value), self.assertRaises(frappe.PermissionError) as caught:
				engine._raise_permission_error(value)
			self.assertEqual(
				str(caught.exception), FRAME.format("<strong>" + (value or "DocType") + "</strong>")
			)
			self.assertEqual(frappe.local.message_log[-1].title, "Permission Error")
		self.assertEqual(self.events, [])
