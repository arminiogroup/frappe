from datetime import date, datetime, time
from types import SimpleNamespace
from unittest.mock import patch

import frappe
from frappe.core.doctype.data_import.data_import import DataImport
from frappe.core.doctype.data_import.importer import Column
from frappe.tests import UnitTestCase

FORMAT_WARNING = "{0} format could not be determined from the values in this column. Defaulting to {1}."
TRANSLATIONS = {
	"Translation Probe": "Documento di prova",
	"DocType": "Tipo di documento",
	"Importing {0} is not allowed.": "L'importazione di {0} non è consentita.",
	"Data Import is not allowed for {0}. Enable 'Allow Import' in DocType settings.": "L'importazione dati non è consentita per {0}. Abilita «Consenti importazione» nelle impostazioni del tipo di documento.",
	"You do not have import permission for {0}": "Non hai il permesso di importazione per {0}",
	"Date": "Data",
	"Time": "Ora",
	"Datetime": "Data e ora",
	FORMAT_WARNING: "Impossibile determinare il formato del tipo {0} dai valori di questa colonna. Verrà usato {1}.",
}


class TestImportDiagnosticLocalization(UnitTestCase):
	def setUp(self):
		super().setUp()
		self.addCleanup(frappe.set_user, frappe.session.user)
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.set_user("translator@example.com")
		frappe.local.lang = "it"
		self.enterContext(patch("frappe.translate.get_all_translations", return_value=TRANSLATIONS))

	def test_blocked_doctype_uses_its_display_name_without_metadata_or_permission_lookup(self):
		doc = SimpleNamespace(reference_doctype="DocType")
		with patch("frappe.get_meta") as meta, patch("frappe.has_permission") as permission:
			with self.assertRaises(frappe.ValidationError) as caught:
				DataImport.validate_doctype(doc)
			self.assertEqual(str(caught.exception), "L'importazione di Tipo di documento non è consentita.")
			meta.assert_not_called()
			permission.assert_not_called()
		self.assertEqual(doc.reference_doctype, "DocType")

	def test_allow_import_error_translates_only_the_display_argument(self):
		doc = SimpleNamespace(reference_doctype="Translation Probe")
		with (
			patch("frappe.get_meta", return_value=SimpleNamespace(allow_import=0)) as meta,
			patch("frappe.has_permission") as permission,
		):
			with self.assertRaises(frappe.ValidationError) as caught:
				DataImport.validate_doctype(doc)
			self.assertEqual(
				str(caught.exception),
				"L'importazione dati non è consentita per Documento di prova. Abilita «Consenti importazione» nelle impostazioni del tipo di documento.",
			)
			meta.assert_called_once_with("Translation Probe")
			permission.assert_not_called()
		self.assertEqual(doc.reference_doctype, "Translation Probe")

	def test_permission_error_and_allowed_path_keep_the_canonical_permission_target(self):
		for allowed in (False, True):
			with self.subTest(allowed=allowed):
				doc = SimpleNamespace(reference_doctype="Translation Probe")
				with (
					patch("frappe.get_meta", return_value=SimpleNamespace(allow_import=1)) as meta,
					patch("frappe.has_permission", return_value=allowed) as permission,
				):
					if allowed:
						DataImport.validate_doctype(doc)
					else:
						with self.assertRaises(frappe.PermissionError) as caught:
							DataImport.validate_doctype(doc)
						self.assertEqual(
							str(caught.exception),
							"Non hai il permesso di importazione per Documento di prova",
						)
					meta.assert_called_once_with("Translation Probe")
					permission.assert_called_once_with("Translation Probe", "import")
				self.assertEqual(doc.reference_doctype, "Translation Probe")

	def column(self, fieldtype, values, override=None):
		column = Column.__new__(Column)
		column.df = frappe._dict(fieldtype=fieldtype)
		column.skip_import = False
		column.column_values = values
		column.column_number = 1
		column.date_format_override = override
		column.warnings = []
		return column

	def test_date_time_fallback_names_are_translated_without_changing_defaults(self):
		for fieldtype, label, stored_format, shown_format in (
			("Date", "Data", "%Y-%m-%d", "yyyy-mm-dd"),
			("Time", "Ora", "%H:%M:%S", "HH:mm:ss"),
			("Datetime", "Data e ora", "%Y-%m-%d", "yyyy-mm-dd"),
		):
			with self.subTest(fieldtype=fieldtype):
				column = self.column(fieldtype, [123456789])
				column.validate_values()
				self.assertEqual(
					column.warnings,
					[
						{
							"col": 1,
							"message": f"Impossibile determinare il formato del tipo {label} dai valori di questa colonna. Verrà usato {shown_format}.",
							"type": "info",
						}
					],
				)
				self.assertEqual(column.date_format, stored_format)
				self.assertEqual(column.df.fieldtype, fieldtype)

	def test_known_formats_overrides_empty_values_and_skipped_columns_are_unchanged(self):
		for fieldtype, value, expected in (
			("Date", date(2026, 10, 21), "%Y-%m-%d"),
			("Time", time(9, 30), "%H:%M:%S"),
			("Datetime", datetime(2026, 10, 21, 9, 30), "%Y-%m-%d %H:%M:%S"),
		):
			with self.subTest(fieldtype=fieldtype):
				column = self.column(fieldtype, [value])
				column.validate_values()
				self.assertEqual(column.date_format, expected)
				self.assertEqual(column.warnings, [])
		column = self.column("Date", [123], override="%d/%m/%Y")
		column.validate_values()
		self.assertEqual(column.date_format, "%d/%m/%Y")
		self.assertEqual(column.warnings, [])
		for values, skip in (([], False), ([None], False), ([123], True)):
			column = self.column("Date", values)
			column.skip_import = skip
			column.validate_values()
			self.assertEqual(column.warnings, [])
			self.assertIsNone(getattr(column, "date_format", None))
