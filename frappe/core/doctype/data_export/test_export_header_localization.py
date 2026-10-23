import csv
import io
from unittest.mock import patch

import frappe
from frappe.core.doctype.data_export.exporter import DataExporter, get_data_keys
from frappe.tests import UnitTestCase
from frappe.utils.csvutils import UnicodeWriter

TRANSLATIONS = {
	"Data Import Template": "Modello di importazione dati",
	"Table": "Tabella",
	"Parent Table": "Tabella padre",
	"Notes:": "Note:",
	"Please do not change the template headings.": "Non modificare le intestazioni del modello.",
	"First data column must be blank.": "La prima colonna dei dati deve essere vuota.",
	'If you are uploading new records, leave the "name" (ID) column blank.': 'Per caricare nuovi record, lascia vuota la colonna "name" (ID).',
	'If you are uploading new records, "Naming Series" becomes mandatory, if present.': 'Per caricare nuovi record, "Serie di numerazione" è obbligatoria, se presente.',
	"Only mandatory fields are necessary for new records. You can delete non-mandatory columns if you wish.": "Per i nuovi record servono solo i campi obbligatori. Puoi eliminare le colonne facoltative.",
	"For updating, you can update only selective columns.": "Per aggiornare i record, puoi selezionare solo le colonne da modificare.",
	'"Parent" signifies the parent table in which this row must be added': '"Parent" indica la tabella padre a cui aggiungere questa riga',
	'If you are updating, please select "Overwrite" else existing rows will not be deleted.': 'Per aggiornare i record, seleziona "Sovrascrivi" per eliminare le righe esistenti.',
	"Start entering data below this line": "Inserisci i dati sotto questa riga",
}


class TestExportHeaderLocalization(UnitTestCase):
	def setUp(self):
		super().setUp()
		self.addCleanup(frappe.set_user, frappe.session.user)
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.set_user("translator@example.com")
		frappe.local.lang = "it"
		self.enterContext(patch("frappe.translate.get_all_translations", return_value=TRANSLATIONS))

	def test_header_has_accurate_notes_and_preserves_canonical_schema(self):
		for child in (False, True):
			with self.subTest(child=child):
				exporter = DataExporter.__new__(DataExporter)
				exporter.doctype = 'Translation, "Probe"'
				exporter.parent_doctype = "Translation Parent" if child else exporter.doctype
				exporter.name_field = "parent" if child else "name"
				exporter.writer = UnicodeWriter()
				exporter.data_keys = get_data_keys()
				exporter.add_main_header()
				expected = [
					["Modello di importazione dati"],
					["Tabella:", 'Translation, "Probe"'],
					["Tabella padre:", "Translation Parent"] if child else [""],
					[""],
					["Note:"],
					["Non modificare le intestazioni del modello."],
					["La prima colonna dei dati deve essere vuota."],
					['Per caricare nuovi record, lascia vuota la colonna "name" (ID).'],
					['Per caricare nuovi record, "Serie di numerazione" è obbligatoria, se presente.'],
					[
						"Per i nuovi record servono solo i campi obbligatori. Puoi eliminare le colonne facoltative."
					],
					["Per aggiornare i record, puoi selezionare solo le colonne da modificare."],
				]
				if child:
					expected.extend(
						[
							['"Parent" indica la tabella padre a cui aggiungere questa riga'],
							[
								'Per aggiornare i record, seleziona "Sovrascrivi" per eliminare le righe esistenti.'
							],
						]
					)
				self.assertEqual(list(csv.reader(io.StringIO(exporter.writer.getvalue()))), expected)
				exporter.export_without_column_meta = False
				exporter.template = True
				metadata_rows = [
					["DocType:", exporter.doctype],
					["Column Labels:", "Nome"],
					["Column Name:", "name"],
					["Mandatory:", "Yes"],
					["Type:", "Data"],
					["Info:", ""],
				]
				(
					exporter.tablerow,
					exporter.labelrow,
					exporter.fieldrow,
					exporter.mandatoryrow,
					exporter.typerow,
					exporter.inforow,
				) = metadata_rows
				exporter.add_field_headings()
				exporter.writer.writerow(["", "canonical-record-name"])
				rows = list(csv.reader(io.StringIO(exporter.writer.getvalue())))
				self.assertEqual(
					rows,
					expected
					+ metadata_rows
					+ [["Inserisci i dati sotto questa riga"], ["", "canonical-record-name"]],
				)
