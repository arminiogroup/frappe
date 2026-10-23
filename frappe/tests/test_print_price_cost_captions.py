# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# License: MIT. See LICENSE

import hashlib
import json
import re
from copy import deepcopy
from pathlib import Path
from unittest.mock import Mock, patch

from jinja2 import ChoiceLoader, DictLoader, Environment, FileSystemLoader
from jinja2.sandbox import SandboxedEnvironment

import frappe
from frappe.core.doctype.docfield.docfield import DocField
from frappe.model.document import Document
from frappe.model.meta import Meta
from frappe.printing.doctype.print_format.classic_converter import (
	convert_table_columns,
	create_default_layout,
)
from frappe.tests import UnitTestCase
from frappe.utils.print_format_generator import PrintFormatGenerator
from frappe.utils.safe_exec import SafeDoc, safer_get_meta, safer_get_visible_columns
from frappe.www.printview import get_visible_columns

LEGACY = "templates/print_formats/standard_macros.html"
BUILDER = "templates/print_format/macros.html"
TRANSLATIONS = {
	"Rate": "Prezzo unitario",
	"Rate:Cost Detail": "Costo unitario",
	"Rate:Sale Detail": "Prezzo unitario",
	"My Rate": "Prezzo personalizzato",
	"My Rate:Cost Detail": "CONTEXT MUST NOT REPLACE AN AUTHORED CAPTION",
	"<b>Rate & tax</b>": "<i>Prezzo & imposta</i>",
	"<b>Rate & tax</b>:Cost Detail": "<strong>Costo & imposta</strong>",
	"Sr": "N.",
}


class Field(frappe._dict):
	def as_dict(self):
		return frappe._dict(self)


class PrintRow(Document):
	def get_formatted(self, fieldname, *args, **kwargs):
		return str(self.get(fieldname, ""))


class NoDatabase:
	def __bool__(self):
		return False

	def __getattr__(self, name):
		def blocked(*args, **kwargs):
			raise AssertionError(f"Unexpected database operation: {name}")

		return blocked


def metadata(name, fields, **values):
	meta = Meta.__new__(Meta)
	fields = [Field(parent=name, **field) for field in fields]
	meta.__dict__.update(
		doctype="DocType",
		name=name,
		fields=fields,
		_fields={field.fieldname: field for field in fields},
		**values,
	)
	return meta


def fields_in(layout):
	return [
		field for section in layout["sections"] for column in section["columns"] for field in column["fields"]
	]


def headers(html):
	return [re.sub(r"<[^>]+>", "", text).strip() for text in re.findall(r"<th\b[^>]*>(.*?)</th>", html, re.S)]


def without_headings(html):
	html = re.sub(r"(<th\b[^>]*>).*?(</th>)", r"\1CAPTION\2", html, flags=re.S)
	return re.sub(r">\s+<", "><", html).strip()


class TestPrintPriceCostCaptions(UnitTestCase):
	def setUp(self):
		self.addCleanup(frappe.set_user, frappe.session.user)
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.set_user("translator@example.com")
		frappe.local.lang = "it"
		self.enterContext(
			patch(
				"frappe.translate.get_all_translations",
				side_effect=lambda lang: TRANSLATIONS if lang == "it" else {},
			)
		)
		self.enterContext(patch("frappe.get_roles", return_value=["Translator"]))
		self.metas = {}
		self.meta_reads = Mock(side_effect=lambda name, cached=True: self.metas[name])
		self.meta_provider = self.get_meta
		self.enterContext(patch("frappe.get_meta", new=self.meta_provider))
		self.env = Environment(loader=FileSystemLoader(Path(frappe.__file__).parent), autoescape=False)
		self.env.globals.update(frappe=frappe, _=frappe._, get_visible_columns=get_visible_columns)

	def get_meta(self, name, cached=True):
		return self.meta_reads(name, cached=cached)

	def documents(self, child="Cost Detail", label="Rate", rows=2):
		self.metas[child] = metadata(
			child,
			[
				{
					"fieldname": "rate",
					"fieldtype": "Currency",
					"label": label,
					"options": "currency",
					"in_list_view": 1,
				},
				{"fieldname": "hidden", "fieldtype": "Data", "label": "Hidden", "print_hide": 1},
				{"fieldname": "secret", "fieldtype": "Data", "label": "Secret", "permlevel": 1},
			],
			istable=1,
		)
		self.metas["Caption Parent"] = metadata(
			"Caption Parent",
			[{"fieldname": "items", "fieldtype": "Table", "options": child, "label": "Items"}],
			permissions=[Field(role="Translator", permlevel=0, read=1)],
		)
		doc = PrintRow.__new__(PrintRow)
		doc.__dict__.update(
			doctype="Caption Parent",
			name="Rate",
			meta=self.metas["Caption Parent"],
			flags=frappe._dict(),
			items=[],
			print_templates=None,
			child_print_templates=None,
		)
		for index in range(1, rows + 1):
			row = PrintRow.__new__(PrintRow)
			row.__dict__.update(
				doctype=child,
				name=f"ROW-{index}",
				parent="Rate",
				parenttype="Caption Parent",
				meta=self.metas[child],
				flags=frappe._dict(),
				idx=index,
				rate=12.5 * index,
				hidden="HIDDEN-VALUE",
				secret="SECRET-VALUE",
			)
			doc.items.append(row)
		df = Field(
			fieldname="items",
			fieldtype="Table",
			options=child,
			visible_columns=[Field(fieldname="rate")],
			start=0,
			end=None,
		)
		return doc, df

	def builder_field(self, doc, df):
		columns = convert_table_columns(df, doc.meta.get_field("items"), [])
		self.assertTrue(all("parent" not in column for column in columns))
		return Field(
			fieldname="items",
			fieldtype="Table",
			options=df.options,
			table_columns=[Field(column) for column in columns],
			renderer="Table",
		)

	def render(self, kind, df, doc):
		before = deepcopy(
			{
				"field": df,
				"rows": [
					{key: value for key, value in row.__dict__.items() if key not in ("meta", "flags")}
					for row in doc.items
				],
			}
		)
		self.meta_reads.reset_mock()
		if kind == "legacy":
			html = str(self.env.get_template(LEGACY).module.render_table(df, doc))
		else:
			html = str(self.env.get_template(BUILDER).module.render_field(df, doc))
		after = {
			"field": df,
			"rows": [
				{key: value for key, value in row.__dict__.items() if key not in ("meta", "flags")}
				for row in doc.items
			],
		}
		self.assertEqual(before, after)
		child_reads = [call for call in self.meta_reads.call_args_list if call.args[0] != "Caption Parent"]
		self.assertLessEqual(len(child_reads), 1)
		return html

	def test_real_converter_and_templates_use_the_defining_child_context(self):
		for child, expected in (("Cost Detail", "Costo unitario"), ("Sale Detail", "Prezzo unitario")):
			for kind in ("legacy", "builder"):
				with self.subTest(child=child, kind=kind):
					doc, df = self.documents(child)
					if kind == "builder":
						df = self.builder_field(doc, df)
					self.assertEqual(headers(self.render(kind, df, doc)), ["N.", expected])

	def test_default_layout_and_real_permission_filter_keep_rows_and_columns(self):
		doc = self.documents(rows=12)[0]
		layout = create_default_layout(doc.meta)
		before = deepcopy(layout)
		generator = PrintFormatGenerator.__new__(PrintFormatGenerator)
		generator.doc, generator.print_settings = doc, None
		layout = generator.apply_permlevel_access(layout)
		layout = generator.prune_table_columns(layout)
		table = next(field for field in fields_in(layout) if field["fieldtype"] == "Table")
		self.assertEqual([column["fieldname"] for column in table["table_columns"]], ["idx", "rate"])
		self.assertEqual(
			[column["fieldname"] for column in fields_in(before)[0]["table_columns"]],
			["idx", "rate", "secret"],
		)
		table = Field(
			table, table_columns=[Field(column) for column in table["table_columns"]], renderer="Table"
		)
		html = self.render("builder", table, doc)
		self.assertEqual(headers(html), ["N.", "Costo unitario"])
		self.assertNotIn("SECRET-VALUE", html)
		self.assertNotIn("HIDDEN-VALUE", html)
		self.assertIn("150.0", html)

	def test_distinct_authored_caption_and_global_fallback_are_preserved(self):
		for caption in ("My Rate", "Unknown supplied caption", "", None):
			for kind in ("legacy", "builder"):
				with self.subTest(caption=caption, kind=kind):
					doc, df = self.documents()
					if kind == "legacy":
						df.visible_columns = [Field(fieldname="rate", label=caption, parent="Sale Detail")]
					else:
						df = self.builder_field(doc, df)
						df.table_columns[1].label = caption
					expected = caption if kind == "legacy" else caption or "rate"
					self.assertEqual(
						headers(self.render(kind, df, doc))[1], str(TRANSLATIONS.get(expected, expected))
					)

	def test_equal_authored_caption_and_forged_parent_use_authoritative_metadata(self):
		for kind in ("legacy", "builder"):
			with self.subTest(kind=kind):
				doc, df = self.documents()
				if kind == "legacy":
					df.visible_columns = [Field(fieldname="rate", label="Rate", parent="Sale Detail")]
				else:
					df = self.builder_field(doc, df)
					df.options = "Sale Detail"
				self.assertEqual(headers(self.render(kind, df, doc)), ["N.", "Costo unitario"])

	def test_markup_caption_retains_each_renderers_existing_escape_contract(self):
		for kind in ("legacy", "builder"):
			with self.subTest(kind=kind):
				doc, df = self.documents(label="<b>Rate & tax</b>")
				if kind == "builder":
					df = self.builder_field(doc, df)
				html = self.render(kind, df, doc)
				if kind == "builder":
					self.assertIn("&lt;strong&gt;Costo &amp; imposta&lt;/strong&gt;", html)
					self.assertNotIn("<strong>Costo", html)
				else:
					self.assertIn("<strong>Costo & imposta</strong>", html)

	def test_builder_unknown_non_table_and_missing_metadata_keep_global_fallback(self):
		for case in (
			"missing-parent-field",
			"non-table",
			"missing-options",
			"unknown-child-field",
			"no-doc-meta",
		):
			with self.subTest(case=case):
				doc, df = self.documents()
				df = self.builder_field(doc, df)
				field = doc.meta.get_field("items")
				if case == "missing-parent-field":
					doc.meta._fields.pop("items")
					doc.meta.fields.clear()
				elif case == "non-table":
					field.fieldtype = "Data"
				elif case == "missing-options":
					field.options = None
				elif case == "unknown-child-field":
					df.table_columns[1].fieldname = "custom_rate"
				else:
					doc.meta = None
				self.assertEqual(headers(self.render("builder", df, doc)), ["N.", "Prezzo unitario"])

	def test_existing_no_header_empty_rows_and_custom_table_override_are_preserved(self):
		doc, df = self.documents()
		builder = self.builder_field(doc, df)
		builder.table_header = "none"
		self.assertEqual(headers(self.render("builder", builder, doc)), [])
		self.assertFalse(self.meta_reads.called)
		for kind, field in (("legacy", df), ("builder", builder)):
			with self.subTest(kind=kind):
				doc.items = []
				self.assertEqual(self.render(kind, field, doc).strip(), "")
				if kind == "builder":
					self.assertFalse(self.meta_reads.called)
				doc, df = self.documents()
		self.env.loader = ChoiceLoader(
			[DictLoader({"custom_table.html": "<p>CUSTOM-TABLE-12.5</p>"}), self.env.loader]
		)
		doc.print_templates = {"items": "custom_table.html"}
		self.assertEqual(self.render("legacy", df, doc).strip(), "<p>CUSTOM-TABLE-12.5</p>")

	def test_english_and_missing_child_context_keep_existing_fallback(self):
		for child, lang, expected in (
			("Other Detail", "it", "Prezzo unitario"),
			("Cost Detail", "en", "Rate"),
		):
			for kind in ("legacy", "builder"):
				with self.subTest(child=child, lang=lang, kind=kind):
					frappe.local.lang = lang
					doc, df = self.documents(child)
					if kind == "builder":
						df = self.builder_field(doc, df)
					self.assertEqual(
						headers(self.render(kind, df, doc)), ["Sr" if lang == "en" else "N.", expected]
					)

	def test_distinct_markup_caption_keeps_global_translation_and_escaping(self):
		for kind in ("legacy", "builder"):
			with self.subTest(kind=kind):
				doc, df = self.documents()
				caption = "<b>Rate & tax</b>"
				if kind == "legacy":
					df.visible_columns = [Field(fieldname="rate", label=caption)]
				else:
					df = self.builder_field(doc, df)
					df.table_columns[1].label = caption
				html = self.render(kind, df, doc)
				self.assertIn(
					"&lt;i&gt;Prezzo &amp; imposta&lt;/i&gt;"
					if kind == "builder"
					else "<i>Prezzo & imposta</i>",
					html,
				)

	def test_blank_canonical_labels_keep_each_original_renderer_fallback(self):
		for label in (None, ""):
			for kind in ("legacy", "builder"):
				with self.subTest(label=label, kind=kind):
					doc, df = self.documents(label=label)
					if kind == "builder":
						df = self.builder_field(doc, df)
						self.assertEqual(headers(self.render(kind, df, doc))[1], "rate")
					else:
						self.assertEqual(headers(self.render(kind, df, doc))[1], str(label))

	def test_missing_legacy_options_keeps_its_prior_metadata_error(self):
		doc, df = self.documents()
		df.options = "Deleted Child Type"
		with self.assertRaises(KeyError):
			self.render("legacy", df, doc)

	def test_canonical_layout_and_row_html_parity(self):
		cases = []
		for child in ("Cost Detail", "Sale Detail"):
			for caption in ("Rate", "My Rate", "", None, "<b>Rate & tax</b>"):
				for kind in ("legacy", "builder"):
					doc, df = self.documents(child)
					if kind == "legacy":
						df.visible_columns = [Field(fieldname="rate", label=caption)]
					else:
						df = self.builder_field(doc, df)
						df.table_columns[1].label = caption
					html = self.render(kind, df, doc)
					cases.append(
						(
							child,
							caption,
							kind,
							df,
							without_headings(html),
							[(row.idx, row.rate, row.name) for row in doc.items],
						)
					)
		self.parity_evidence = {
			"cases": cases,
			"sha256": hashlib.sha256(json.dumps(cases, sort_keys=True).encode()).hexdigest(),
		}

	def factory_environment(self, restricted):
		self.addCleanup(setattr, frappe.local, "db", getattr(frappe.local, "db", None))
		frappe.local.db = NoDatabase()
		for key in ("jenv_restricted", "jenv_unrestricted"):
			self.addCleanup(setattr, frappe.local, key, getattr(frappe.local, key, None))
			setattr(frappe.local, key, None)
		self.enterContext(patch("frappe.get_hooks", return_value=[]))
		self.enterContext(patch("frappe.get_active_apps", return_value=["frappe"]))
		env = frappe.get_jenv(restrict_globals=restricted)
		self.assertIsInstance(env, SandboxedEnvironment)
		self.assertIs(
			env.globals["get_visible_columns"],
			safer_get_visible_columns if restricted else get_visible_columns,
		)
		self.assertIs(env.globals["frappe"].get_meta, safer_get_meta if restricted else self.meta_provider)
		return env

	def serializable_metadata(self):
		data = json.loads(
			Path(frappe.get_app_path("frappe", "core/doctype/docfield/docfield.json")).read_text()
		)
		field_meta = metadata("DocField", data["fields"], istable=1)
		for meta in self.metas.values():
			meta.__dict__.setdefault("istable", 0)
			fields = []
			for source in meta.fields:
				field = DocField.__new__(DocField)
				field.__dict__.update(source, doctype="DocField", meta=field_meta, flags=frappe._dict())
				fields.append(field)
			meta.fields = fields
			meta._fields = {field.fieldname: field for field in fields}
			self.assertEqual(len(meta.as_dict().fields), len(fields))

	def test_actual_restricted_and_unrestricted_factories_render_canonical_and_authored_captions(self):
		for restricted in (True, False):
			for safe_document in (False, True):
				for authored in (False, True):
					for kind in ("legacy", "builder"):
						with self.subTest(
							restricted=restricted, safe_document=safe_document, authored=authored, kind=kind
						):
							doc, df = self.documents(rows=1)
							self.serializable_metadata()
							if kind == "builder":
								df = self.builder_field(doc, df)
							if authored:
								if kind == "legacy":
									df.visible_columns[0].label = "My Rate"
								else:
									df.table_columns[1].label = "My Rate"
							if safe_document:
								doc = SafeDoc(doc.as_dict())
								self.assertIsInstance(doc.meta, dict)
							self.env = self.factory_environment(restricted)
							with patch(
								"frappe.utils.formatters.format_value",
								side_effect=lambda value, *args, **kwargs: str(value),
							):
								html = str(
									self.env.get_template(LEGACY).module.render_table(df, doc)
									if kind == "legacy"
									else self.env.get_template(BUILDER).module.render_field(df, doc)
								)
							self.assertEqual(
								headers(html),
								["N.", "Prezzo personalizzato" if authored else "Costo unitario"],
							)
							self.assertIn("12.5", html)
							self.assertNotIn("SECRET-VALUE", html)

	def test_real_factory_helpers_keep_forged_contexts_fallback_and_header_lookup_controls(self):
		for restricted in (True, False):
			with self.subTest(restricted=restricted):
				doc, df = self.documents(rows=12)
				self.serializable_metadata()
				self.env = self.factory_environment(restricted)
				builder = self.builder_field(doc, df)
				builder.options = "Sale Detail"
				self.assertEqual(headers(self.render("builder", builder, doc)), ["N.", "Costo unitario"])
				self.assertEqual(self.meta_reads.call_count, 1)
				builder.table_columns[1].label = "My Rate"
				self.assertEqual(
					headers(self.render("builder", builder, doc)), ["N.", "Prezzo personalizzato"]
				)
				doc.meta.fields.clear()
				doc.meta._fields.clear()
				builder.table_columns[1].label = "Rate"
				self.assertEqual(headers(self.render("builder", builder, doc)), ["N.", "Prezzo unitario"])
				self.assertFalse(self.meta_reads.called)
				builder.table_header = "none"
				self.assertEqual(headers(self.render("builder", builder, doc)), [])
				self.assertFalse(self.meta_reads.called)
				doc.items = []
				self.assertEqual(self.render("builder", builder, doc).strip(), "")
				self.assertFalse(self.meta_reads.called)
