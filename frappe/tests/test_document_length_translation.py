# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# License: MIT. See LICENSE

import json
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from babel.messages.extract import extract

import frappe
from frappe.database.mariadb.database import MariaDBDatabase
from frappe.database.postgres.database import PostgresDatabase
from frappe.gettext.translate import PYTHON_KEYWORDS
from frappe.model import document
from frappe.model.document import Document
from frappe.model.meta import Meta
from frappe.tests import UnitTestCase

CHARACTER_MESSAGE = "{0}: '{1}' ({3}) exceeds the maximum length of {2} characters."
INTEGER_MESSAGE = "{0}: '{1}' ({3}) must be between -{2} and {2}."
OLD_MESSAGE = "{0}: '{1}' ({3}) will get truncated, as max characters allowed is {2}"
TARGETS = {
	CHARACTER_MESSAGE: "{0}: il valore di '{1}' ({3}) supera la lunghezza massima di {2} caratteri.",
	INTEGER_MESSAGE: "{0}: il valore di '{1}' ({3}) deve essere compreso tra -{2} e {2}.",
	"Value too big": "Valore troppo grande",
	"{0}, Row {1}": "{0}, riga {1}",
	"Note": "Nota",
	"Workspace Shortcut": "Collegamento rapido dell\u2019area di lavoro",
	"Automation Action": "Azione di automazione",
	"Title": "Titolo",
	"Label": "Etichetta",
	"Length": "Lunghezza",
	"Target": "Destinazione",
	"Target:Automation Action": "Alias del record di destinazione",
}
METADATA = {
	"Note": ("desk", "note"),
	"Workspace": ("desk", "workspace"),
	"Workspace Shortcut": ("desk", "workspace_shortcut"),
	"Automation Action": ("automation", "automation_action"),
	"DocField": ("core", "docfield"),
}


def metadata_path(name):
	module, slug = METADATA[name]
	return Path(frappe.get_app_path("frappe", module, "doctype", slug, f"{slug}.json"))


def extracted_keys():
	paths = [(Path(document.__file__), "python")]
	paths.append((Path(frappe.get_app_path("frappe", "gettext", "contextual_messages.py")), "python"))
	paths.extend((metadata_path(name), "doctype") for name in METADATA)
	keys = set()
	for path, kind in paths:
		with path.open("rb") as stream:
			keys.update(
				message + (":" + context if context else "")
				for _, message, _, context in extract(
					f"frappe.gettext.extractors.{kind}.extract", stream, keywords=PYTHON_KEYWORDS
				)
			)
	return keys


def make_meta(name, fields, **values):
	meta = Meta.__new__(Meta)
	fields = [frappe._dict({"parent": name, "is_virtual": 0, **field}) for field in fields]
	meta.__dict__.update(
		name=name,
		fields=fields,
		_fields={field.fieldname: field for field in fields},
		issingle=0,
		istable=0,
		autoname="",
		make_attachments_public=0,
	)
	meta.__dict__.update(values)
	return meta


def read_meta(name):
	data = json.loads(metadata_path(name).read_text())
	return make_meta(
		name,
		data["fields"],
		issingle=data.get("issingle", 0),
		istable=data.get("istable", 0),
		autoname=data.get("autoname", ""),
	)


def make_doc(meta, **values):
	doc = Document.__new__(Document)
	doc.__dict__.update(
		doctype=meta.name,
		name="EXACT-RAW-DOC",
		meta=meta,
		flags=frappe._dict(),
		idx=0,
		docstatus=0,
		__islocal=1,
	)
	doc.__dict__.update(values)
	return doc


class TestDocumentLengthTranslation(UnitTestCase):
	def setUp(self):
		self.addCleanup(frappe.set_user, frappe.session.user)
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		self.addCleanup(setattr, frappe.local, "message_log", frappe.local.message_log)
		frappe.set_user("translator@example.com")
		frappe.local.lang = "it"
		frappe.local.message_log = []
		keys = extracted_keys()
		self.translations = self.enterContext(
			patch(
				"frappe.translate.get_all_translations",
				return_value={key: value for key, value in TARGETS.items() if key in keys},
			)
		)
		self.enterContext(
			patch.dict(frappe.flags, {"in_install": False, "mute_messages": False, "print_messages": False})
		)
		self.metas = {name: read_meta(name) for name in METADATA}
		self.enterContext(patch("frappe.get_meta", side_effect=self.metas.__getitem__))
		self.enterContext(patch("frappe.model.meta.get_workflow_name", return_value=None))
		self.use_backend(MariaDBDatabase)

	def use_backend(self, backend):
		db = backend.__new__(backend)
		db.setup_type_map()
		self.db = SimpleNamespace(type_map=db.type_map)
		self.enterContext(patch("frappe.db", new=self.db))

	def integer_meta(self, fieldtype, length=None):
		return make_meta(
			"Length Probe",
			[{"fieldname": "quantity", "fieldtype": fieldtype, "label": "Length", "length": length}],
		)

	def assert_rejected(self, doc, expected, method="_validate_length"):
		with self.assertRaises(frappe.CharacterLengthExceededError) as raised:
			getattr(doc, method)()
		self.assertEqual(str(raised.exception), expected)
		self.assertEqual(frappe.local.message_log[-1].title, "Valore troppo grande")
		self.assertEqual(frappe.local.message_log[-1].indicator, "red")
		self.assertEqual(frappe.local.message_log[-1].raise_exception, 1)

	def test_configured_extractor_distinguishes_character_and_integer_messages(self):
		keys = extracted_keys()
		for message in (CHARACTER_MESSAGE, INTEGER_MESSAGE):
			with self.subTest(message=message):
				self.assertIn(message, keys)
		self.assertNotIn(OLD_MESSAGE, keys)

	def test_actual_metadata_context_and_raw_document_identity(self):
		meta = self.metas["Automation Action"]
		meta.get_field("target").length = 5
		doc = make_doc(meta, target="abcdef")
		self.assertEqual(meta.get_translated_label("target"), "Alias del record di destinazione")
		self.assert_rejected(
			doc,
			"Azione di automazione EXACT-RAW-DOC: il valore di '<strong>Alias del record di destinazione</strong>' (abcdef) supera la lunghezza massima di 5 caratteri.",
		)
		self.assertEqual(
			(doc.doctype, doc.name, doc.target), ("Automation Action", "EXACT-RAW-DOC", "abcdef")
		)

	def test_parent_character_limit_uses_characters_and_rejects_without_truncation(self):
		meta = self.metas["Note"]
		meta.get_field("title").length = 5
		for value in ("abcdef", "èèèèèè"):
			with self.subTest(value=value):
				doc = make_doc(meta, title=value)
				self.assert_rejected(
					doc,
					f"Nota EXACT-RAW-DOC: il valore di '<strong>Titolo</strong>' ({value}) supera la lunghezza massima di 5 caratteri.",
				)
				self.assertEqual(doc.title, value)

	def test_child_character_limit_keeps_row_reference(self):
		meta = self.metas["Workspace Shortcut"]
		meta.get_field("label").length = 5
		doc = make_doc(
			meta,
			label="abcdef",
			type="URL",
			parent="PARENT-RAW",
			parenttype="Workspace",
			parentfield="shortcuts",
			idx=3,
		)
		self.assert_rejected(
			doc,
			"Collegamento rapido dell\u2019area di lavoro, riga 3: il valore di '<strong>Etichetta</strong>' (abcdef) supera la lunghezza massima di 5 caratteri.",
		)
		self.assertEqual(
			(doc.parent, doc.parenttype, doc.parentfield, doc.idx),
			("PARENT-RAW", "Workspace", "shortcuts", 3),
		)
		self.assertEqual(doc.label, "abcdef")

	def test_integer_range_messages_match_actual_backend_limits(self):
		for backend in (MariaDBDatabase, PostgresDatabase):
			self.use_backend(backend)
			for fieldtype, length, maximum in (
				("Int", None, 2**31 - 1),
				("Int", 11, 2**31 - 1),
				("Int", 12, 2**63 - 1),
				("Long Int", None, 2**63 - 1),
			):
				for value in (maximum + 1, -maximum - 1):
					with self.subTest(
						backend=backend.__name__, fieldtype=fieldtype, length=length, value=value
					):
						doc = make_doc(self.integer_meta(fieldtype, length), quantity=value)
						self.assert_rejected(
							doc,
							f"Length Probe EXACT-RAW-DOC: il valore di '<strong>Lunghezza</strong>' ({value}) deve essere compreso tra -{maximum} e {maximum}.",
						)
						self.assertEqual(doc.quantity, value)

	def test_integer_signed_boundaries_zero_and_none_keep_existing_acceptance(self):
		for backend in (MariaDBDatabase, PostgresDatabase):
			self.use_backend(backend)
			for fieldtype, length, maximum in (
				("Int", None, 2**31 - 1),
				("Int", 11, 2**31 - 1),
				("Int", 12, 2**63 - 1),
				("Long Int", None, 2**63 - 1),
			):
				for value in (None, 0, "0", "", maximum, -maximum):
					with self.subTest(
						backend=backend.__name__, fieldtype=fieldtype, length=length, value=value
					):
						doc = make_doc(self.integer_meta(fieldtype, length), quantity=value)
						doc._validate_length()
						self.assertEqual(doc.quantity, value)

	def test_get_valid_dict_keeps_current_integer_conversion_contract(self):
		for fieldtype, value, expected in (
			("Int", "23", 23),
			("Int", None, 0),
			("Long Int", "23", "23"),
			("Long Int", None, None),
		):
			with self.subTest(fieldtype=fieldtype, value=value):
				doc = make_doc(self.integer_meta(fieldtype), quantity=value)
				self.assertEqual(doc.get_valid_dict(ignore_virtual=True).quantity, expected)
				self.assertEqual(doc.quantity, value)

	def test_valid_varchar_values_and_default_length_stay_accepted(self):
		meta = self.metas["Note"]
		for backend in (MariaDBDatabase, PostgresDatabase):
			self.use_backend(backend)
			for length, values in ((5, (None, 0, "", "abcde", "èèèèè")), (None, ("X" * 140,))):
				meta.get_field("title").length = length
				for value in values:
					with self.subTest(backend=backend.__name__, length=length, value=value):
						doc = make_doc(meta, title=value)
						doc._validate_length()
						self.assertEqual(doc.title, value)

	def test_default_varchar_limit_and_integer_child_reference(self):
		doc = make_doc(self.metas["Note"], title="X" * 141)
		self.assert_rejected(
			doc,
			f"Nota EXACT-RAW-DOC: il valore di '<strong>Titolo</strong>' ({'X' * 141}) supera la lunghezza massima di 140 caratteri.",
		)
		doc = make_doc(
			self.integer_meta("Int"),
			quantity=2**31,
			parentfield="rows",
			parent="PARENT-RAW",
			parenttype="Parent Probe",
			idx=2,
		)
		self.assert_rejected(
			doc,
			"Length Probe, riga 2: il valore di '<strong>Lunghezza</strong>' (2147483648) deve essere compreso tra -2147483647 e 2147483647.",
		)

	def test_existing_install_single_check_and_virtual_guards_skip(self):
		for guard in ("in_install", "issingle", "Check", "virtual"):
			with self.subTest(guard=guard):
				meta = self.integer_meta("Check" if guard == "Check" else "Int")
				meta.issingle = int(guard == "issingle")
				meta.get_field("quantity").is_virtual = int(guard == "virtual")
				doc = make_doc(meta, quantity=2**70)
				with patch.dict(frappe.flags, {"in_install": guard == "in_install"}):
					doc._validate_length()
				self.assertEqual(doc.quantity, 2**70)

	def test_whole_validate_parent_length_runs_after_real_sanitization(self):
		value = "X" * (140 - len("<strong>")) + "<strong>"
		doc = make_doc(self.metas["Note"], title=value)
		with self.assertRaises(frappe.CharacterLengthExceededError) as raised:
			doc._validate()
		self.assertEqual(doc.title, "X" * 132 + "<strong></strong>")
		self.assertEqual(
			str(raised.exception),
			f"Nota EXACT-RAW-DOC: il valore di '<strong>Titolo</strong>' ({doc.title}) supera la lunghezza massima di 140 caratteri.",
		)
		doc = make_doc(self.metas["Note"], title="X" * 130 + "<script>1</script>")
		doc._validate()
		self.assertEqual(doc.title, "X" * 130)

	def test_whole_validate_child_length_runs_after_real_sanitization(self):
		for value, rejected in (("X" * 132 + "<strong>", True), ("X" * 130 + "<script>1</script>", False)):
			with self.subTest(rejected=rejected):
				child = make_doc(
					self.metas["Workspace Shortcut"],
					type="URL",
					label=value,
					parent="PARENT-RAW",
					parenttype="Workspace",
					parentfield="shortcuts",
					idx=3,
				)
				parent = make_doc(
					self.metas["Workspace"],
					label="Test Workspace",
					module="Core",
					title="Test Workspace",
					type="Workspace",
					shortcuts=[child],
				)
				if rejected:
					with self.assertRaises(frappe.CharacterLengthExceededError) as raised:
						parent._validate()
					self.assertEqual(child.label, "X" * 132 + "<strong></strong>")
					self.assertEqual(
						str(raised.exception),
						f"Collegamento rapido dell\u2019area di lavoro, riga 3: il valore di '<strong>Etichetta</strong>' ({child.label}) supera la lunghezza massima di 140 caratteri.",
					)
				else:
					parent._validate()
					self.assertEqual(child.label, "X" * 130)
				self.assertEqual(
					(child.parent, child.parenttype, child.parentfield, child.idx),
					("PARENT-RAW", "Workspace", "shortcuts", 3),
				)

	def test_english_fallback_keeps_both_truthful_templates(self):
		self.translations.return_value = {}
		for meta, fieldname, value, expected in (
			(
				self.metas["Note"],
				"title",
				"X" * 141,
				f"Note EXACT-RAW-DOC: '<strong>Title</strong>' ({'X' * 141}) exceeds the maximum length of 140 characters.",
			),
			(
				self.integer_meta("Long Int"),
				"quantity",
				2**63,
				"Length Probe EXACT-RAW-DOC: '<strong>Length</strong>' (9223372036854775808) must be between -9223372036854775807 and 9223372036854775807.",
			),
		):
			with self.subTest(fieldname=fieldname):
				doc = make_doc(meta, **{fieldname: value})
				before = deepcopy(doc.get_valid_dict(ignore_virtual=True))
				with self.assertRaises(frappe.CharacterLengthExceededError) as raised:
					doc._validate_length()
				self.assertEqual(str(raised.exception), expected)
				self.assertEqual(frappe.local.message_log[-1].title, "Value too big")
				self.assertEqual(doc.get_valid_dict(ignore_virtual=True), before)
