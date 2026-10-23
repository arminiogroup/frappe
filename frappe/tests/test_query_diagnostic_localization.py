from collections.abc import Sequence
from types import SimpleNamespace
from unittest.mock import patch

from pypika.terms import ValueWrapper

import frappe
from frappe.database.query import Engine, SQLFunctionParser
from frappe.model.db_query import DatabaseQuery
from frappe.query_builder.builder import MariaDB
from frappe.query_builder.functions import Count
from frappe.tests import UnitTestCase

TRANSLATIONS = {
	"Fields must be a string, list, tuple, set, or pypika Term": "I campi devono essere una stringa, una lista, una tupla, un insieme o un oggetto pypika Term",
	"Child query fields for '{0}' must be a list, tuple, or set.": "I campi della query figlia per '{0}' devono essere una lista, una tupla o un insieme.",
	"When as_list is enabled and multiple fields are requested, fields must be an ordered sequence, such as a list, tuple, or string.": "Quando as_list è attivo e si richiedono più campi, i campi devono essere una sequenza ordinata, ad esempio una lista, una tupla o una stringa.",
	"Invalid SQL function dictionary format": "Formato del dizionario della funzione SQL non valido",
	"Unsupported SQL function or invalid field name: {0}": "Funzione SQL non supportata o nome di campo non valido: {0}",
	"Invalid SQL operator dictionary format": "Formato del dizionario dell'operatore SQL non valido",
	"Unsupported SQL operator: {0}": "Operatore SQL non supportato: {0}",
	"Unsupported filters type: {0}": "Tipo di filtri non supportato: {0}",
	"Invalid item type in filter list: {0}. Expected list, tuple, dict, or Criterion.": "Tipo di elemento non valido nell'elenco dei filtri: {0}. È richiesta una lista, una tupla, un dizionario o un oggetto Criterion.",
	"Unknown filter format: {0}": "Formato del filtro sconosciuto: {0}",
}


class FieldSequence(Sequence):
	def __len__(self):
		return 2

	def __getitem__(self, index):
		return ("name", "description")[index]


class TestQueryDiagnosticLocalization(UnitTestCase):
	def setUp(self):
		super().setUp()
		self.addCleanup(frappe.set_user, frappe.session.user)
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.set_user("translator@example.com")
		frappe.local.lang = "it"
		self.db = SimpleNamespace(db_type="mariadb", qb=MariaDB)
		self.enterContext(patch.object(frappe, "db", self.db))
		self.enterContext(patch("frappe.translate.get_all_translations", return_value=TRANSLATIONS))
		self.enterContext(patch("frappe.database.query.get_additional_filters_from_hooks", return_value={}))

	def test_main_fields_error_describes_all_accepted_types(self):
		for fields in (17, {"COUNT": "name"}):
			with self.subTest(fields=fields):
				with self.assertRaises(frappe.ValidationError) as caught:
					Engine(db=self.db).get_query("DocType", fields=fields)
				self.assertEqual(
					str(caught.exception),
					"I campi devono essere una stringa, una lista, una tupla, un insieme o un oggetto pypika Term",
				)

	def test_child_fields_error_and_accepted_collections(self):
		meta = SimpleNamespace(
			get_field=lambda name: frappe._dict(fieldtype="Table", options="Translation Child")
		)
		with patch("frappe.get_meta", return_value=meta):
			with self.assertRaises(frappe.ValidationError) as caught:
				Engine(db=self.db).get_query("DocType", fields=[{"children": "name"}])
			self.assertEqual(
				str(caught.exception),
				"I campi della query figlia per 'children' devono essere una lista, una tupla o un insieme.",
			)
			for fields in (["name"], ("name",), {"name"}):
				with self.subTest(fields=fields):
					query = Engine(db=self.db).get_query("DocType", fields=[{"children": fields}])
					self.assertEqual(query._child_queries[0].fields, ["name"])
					self.assertEqual(query._child_queries[0].parent_doctype, "DocType")
					self.assertEqual(query._child_queries[0].doctype, "Translation Child")

	def test_main_fields_preserve_collections_terms_and_empty_default(self):
		for fields in (
			"name,description",
			["name", "description"],
			("name", "description"),
			{"name", "description"},
		):
			with self.subTest(fields=fields):
				engine = Engine(db=self.db)
				engine.get_query("DocType", fields=fields)
				self.assertEqual({field.name for field in engine.fields}, {"name", "description"})
		table = MariaDB.DocType("DocType")
		for term in (table.name, Count(table.name), table.name == "Probe", table.idx + 1, ValueWrapper(7)):
			with self.subTest(term=type(term).__name__):
				engine = Engine(db=self.db)
				engine.get_query("DocType", fields=term)
				self.assertIs(engine.fields[0], term)
		for fields in (None, 0, [], (), set()):
			with self.subTest(empty=fields):
				engine = Engine(db=self.db)
				engine.get_query("DocType", fields=fields)
				self.assertEqual([field.name for field in engine.fields], ["name"])

	def test_legacy_order_error_preserves_guard_and_permission_arguments(self):
		query = DatabaseQuery("Translation Probe")
		with (
			patch("frappe.has_permission", return_value=True) as permission,
			patch("frappe.only_has_select_perm", return_value=False),
		):
			with self.assertRaises(frappe.ValidationError) as caught:
				query.execute(fields={"name", "description"}, as_list=True)
		self.assertEqual(
			str(caught.exception),
			"Quando as_list è attivo e si richiedono più campi, i campi devono essere una sequenza ordinata, ad esempio una lista, una tupla o una stringa.",
		)
		permission.assert_called_once_with(
			"Translation Probe",
			ptype="read",
			parent_doctype="Translation Probe",
			throw=True,
			user="translator@example.com",
		)

	def test_legacy_acceptance_and_normalization_are_unchanged(self):
		for fields, expected, as_list in (
			(["name", "description"], ["name", "description"], True),
			(("name", "description"), ["name", "description"], True),
			(FieldSequence(), ["name", "description"], True),
			("name,description", ["name", "description"], True),
			('["name","description"]', ["name", "description"], True),
			({"name"}, ["name"], True),
			({"name", "description"}, ["name", "description"], False),
		):
			with self.subTest(fields=fields, as_list=as_list):
				query = DatabaseQuery("Translation Probe")
				with (
					patch("frappe.has_permission", return_value=True),
					patch("frappe.only_has_select_perm", return_value=False),
					patch("frappe.model.db_query.is_virtual_doctype", return_value=False),
					patch.object(query, "get_table_columns", return_value=[]),
				):
					query.execute(fields=fields, as_list=as_list)
				query.parse_args()
				self.assertEqual(sorted(query.fields), sorted(expected))

	def test_sql_parser_errors_are_complete_sentences_with_raw_identifiers(self):
		engine = Engine(db=self.db)
		engine.get_query("DocType", fields="name")
		parser = SQLFunctionParser(engine)
		for method, value, expected in (
			(parser.parse_function, {}, "Formato del dizionario della funzione SQL non valido"),
			(
				parser.parse_function,
				{"INVALID_SQL_FN": "name"},
				"Funzione SQL non supportata o nome di campo non valido: INVALID_SQL_FN",
			),
			(parser.parse_operator, {}, "Formato del dizionario dell'operatore SQL non valido"),
			(
				parser.parse_operator,
				{"INVALID_SQL_OP": [1, 2]},
				"Operatore SQL non supportato: INVALID_SQL_OP",
			),
		):
			with self.subTest(value=value, method=method.__name__):
				with self.assertRaises(frappe.ValidationError) as caught:
					method(value)
				self.assertEqual(str(caught.exception), expected)
		self.assertEqual(parser.parse_function({"ABS": -2}).get_sql(), "ABS(-2)")
		nested = parser.parse_operator({"ADD": [1, {"ABS": -2}], "as": "total"})
		self.assertEqual(nested.alias, "total")
		self.assertEqual(nested.get_sql(), "1+ABS(-2)")
		with self.assertRaises(frappe.ValidationError):
			parser.parse_operator({"ADD": (1, 2)})
		with self.assertRaises(frappe.ValidationError):
			parser.parse_function({"ABS": -2, "as": "invalid-alias"})

	def test_direct_filter_errors_are_localized_and_keep_value_error(self):
		for filters, expected in (
			(object(), "Tipo di filtri non supportato: object"),
			(
				[object()],
				"Tipo di elemento non valido nell'elenco dei filtri: object. È richiesta una lista, una tupla, un dizionario o un oggetto Criterion.",
			),
		):
			with self.subTest(expected=expected):
				with self.assertRaises(ValueError) as caught:
					Engine(db=self.db).get_query("DocType", fields="name", filters=filters)
				self.assertEqual(str(caught.exception), expected)
		filters = ["name", "=", "Probe", "extra", "extra2", "extra3"]
		with self.assertRaises(ValueError) as caught:
			Engine(db=self.db).apply_list_filters(filters)
		self.assertEqual(str(caught.exception), f"Formato del filtro sconosciuto: {filters}")

	def test_filter_data_and_five_item_compatibility_slot_are_unchanged(self):
		queries = [
			Engine(db=self.db).get_query("DocType", fields="name", filters=filters)
			for filters in (
				{"name": "Probe"},
				[["name", "=", "Probe"]],
				[["DocType", "name", "=", "Probe"]],
				[["DocType", "name", "=", "Probe", "ignored compatibility value"]],
			)
		]
		self.assertEqual(
			{query.get_sql() for query in queries}, {"SELECT `name` FROM `tabDocType` WHERE `name`='Probe'"}
		)
