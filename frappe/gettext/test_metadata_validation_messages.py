from types import SimpleNamespace
from unittest.mock import patch

import frappe
from frappe.core.doctype.doctype.doctype import DocType, validate_fields
from frappe.custom.doctype.customize_form.customize_form import CustomizeForm
from frappe.model.document import Document
from frappe.tests import UnitTestCase

TRANSLATIONS = {
	"Translation Document": "Documento di prova",
	"Action:Translation Document": "Azione",
	"Description:Translation Document": "Descrizione specifica",
	"Reference:Translation Document": "Riferimento",
	"Field {0} in {1} conflicts with controller method {2}.": "Il campo {0} in {1} è in conflitto con il metodo del controller {2}.",
	"Field {0} in {1} conflicts with class property {2}.": "Il campo {0} in {1} è in conflitto con la proprietà della classe {2}.",
	"Options for Dynamic Link field {0} must reference a Select field or a Link field whose options are DocType.": "Le opzioni del campo Collegamento dinamico {0} devono indicare un campo Selezione oppure un campo Collegamento le cui opzioni siano DocType.",
	"Value for field {0} is too long in {1}. The maximum length is {2} characters.": "Il valore del campo {0} è troppo lungo in {1}. La lunghezza massima è di {2} caratteri.",
}


class TestMetadataValidationMessages(UnitTestCase):
	def setUp(self):
		super().setUp()
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.local.lang = "it"
		self.enterContext(patch("frappe.translate.get_all_translations", return_value=TRANSLATIONS))
		self.enterContext(
			patch.object(frappe, "db", SimpleNamespace(MAX_COLUMN_LENGTH=64, db_type="mariadb"))
		)

	def test_controller_conflicts_use_complete_messages_and_display_labels(self):
		for fieldname, expected in [
			(
				"save",
				"Il campo Azione in Documento di prova è in conflitto con il metodo del controller save.",
			),
			(
				"meta",
				"Il campo Azione in Documento di prova è in conflitto con la proprietà della classe meta.",
			),
		]:
			with self.subTest(fieldname=fieldname):
				meta = frappe._dict(
					name="Translation Document",
					fields=[frappe._dict(fieldname=fieldname, label="Action", fieldtype="Data")],
				)
				with patch("frappe.core.doctype.doctype.doctype.get_controller", return_value=Document):
					with self.assertRaises(frappe.ValidationError) as caught:
						DocType.validate_field_name_conflicts(meta)
				self.assertEqual(str(caught.exception), expected)

	def test_virtual_properties_and_unrelated_names_keep_their_existing_acceptance(self):
		meta = frappe._dict(
			name="Translation Document",
			fields=[
				frappe._dict(fieldname="meta", label="Action", fieldtype="Data", is_virtual=1),
				frappe._dict(fieldname="custom_value", label="Custom", fieldtype="Data"),
			],
		)
		with patch("frappe.core.doctype.doctype.doctype.get_controller", return_value=Document):
			DocType.validate_field_name_conflicts(meta)

	def test_invalid_dynamic_link_message_describes_both_supported_pointer_types(self):
		meta = frappe._dict(
			name="Translation Document",
			fields=[
				frappe._dict(
					fieldname="reference",
					label="Reference",
					fieldtype="Dynamic Link",
					parent="Translation Document",
					options="missing_type",
					idx=1,
				)
			],
		)
		with self.assertRaises(frappe.ValidationError) as caught:
			validate_fields(meta)
		self.assertEqual(
			str(caught.exception),
			"Le opzioni del campo Collegamento dinamico <strong>Riferimento</strong> devono indicare un campo Selezione oppure un campo Collegamento le cui opzioni siano DocType.",
		)

	def test_valid_select_pointer_and_unconstrained_currency_keep_existing_values(self):
		meta = frappe._dict(
			name="Translation Document",
			fields=[
				frappe._dict(fieldname="reference_type", fieldtype="Select", options="ToDo\nUser", idx=1),
				frappe._dict(
					fieldname="reference", fieldtype="Dynamic Link", options="reference_type", idx=2
				),
				frappe._dict(fieldname="amount", fieldtype="Currency", width=50, precision=0, idx=3),
			],
		)
		validate_fields(meta)
		self.assertEqual(meta.fields[0].options, "ToDo\nUser")
		self.assertEqual(meta.fields[1].options, "reference_type")
		self.assertEqual((meta.fields[2].width, meta.fields[2].precision), (50, 0))

	def test_length_error_uses_maximum_and_original_doctype_label_context(self):
		field = frappe._dict(fieldname="description", fieldtype="Data", label="Description")
		form = frappe._dict(
			doc_type="Translation Document", check_length_for_fieldtypes=[{"df": field}], flags=frappe._dict()
		)
		db = SimpleNamespace(
			type_map={"Data": ("varchar", 3)},
			sql=lambda *args, **kwargs: [frappe._dict(name="DOC-001", description="four", len=4)],
		)
		with (
			patch.object(frappe, "db", db),
			patch("frappe.utils.data.get_url_to_form", return_value="/desk/translation-document/DOC-001"),
		):
			with self.assertRaises(frappe.ValidationError) as caught:
				CustomizeForm.validate_fieldtype_length(form)
		self.assertEqual(
			str(caught.exception),
			'Il valore del campo <strong>Descrizione specifica</strong> è troppo lungo in <a href="/desk/translation-document/DOC-001">DOC-001</a>. La lunghezza massima è di <strong>3</strong> caratteri.',
		)

	def test_length_validation_with_no_oversized_rows_keeps_database_update_enabled(self):
		form = frappe._dict(
			doc_type="Translation Document",
			check_length_for_fieldtypes=[
				{"df": frappe._dict(fieldname="description", fieldtype="Data", label="Description")}
			],
			flags=frappe._dict(),
		)
		db = SimpleNamespace(type_map={"Data": ("varchar", 3)}, sql=lambda *args, **kwargs: [])
		with patch.object(frappe, "db", db):
			CustomizeForm.validate_fieldtype_length(form)
		self.assertTrue(form.flags.update_db)
