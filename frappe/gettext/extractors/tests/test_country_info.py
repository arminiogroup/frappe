import json
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from babel.messages.extract import extract_from_dir
from babel.util import pathmatch
from frappe.geo.doctype.country.country import get_countries_and_currencies
from frappe.gettext.extractors.utils import get_line_number
from frappe.gettext.translate import PYTHON_KEYWORDS, get_method_map
from frappe.tests import UnitTestCase

import frappe


class TestCountryInfoExtraction(UnitTestCase):
	def setUp(self):
		local_state = dict(frappe.local)
		for key, value in {
			"session": frappe._dict(user="translator@example.com"),
			"lang": "it",
		}.items():
			if key in local_state:
				self.addCleanup(setattr, frappe.local, key, local_state[key])
			else:
				self.addCleanup(delattr, frappe.local, key)
			setattr(frappe.local, key, value)
		for name in ("sendmail", "enqueue", "delete_doc"):
			self.enterContext(patch("frappe." + name, side_effect=AssertionError("Forbidden " + name)))

	def configured_messages(self, payload, relative="frappe/geo/country_info.json"):
		before = deepcopy(payload)
		text = json.dumps(payload, indent=1)
		with TemporaryDirectory() as directory:
			path = Path(directory) / relative
			path.parent.mkdir(parents=True)
			path.write_text(text)
			messages = list(
				extract_from_dir(directory, method_map=get_method_map("frappe"), keywords=PYTHON_KEYWORDS)
			)
			self.assertEqual(path.read_text(), text)
		self.assertEqual(payload, before)
		return text, messages

	def test_exact_configured_path_uses_currency_context(self):
		text, messages = self.configured_messages(
			{
				"First country": {
					"currency": "RAW-CODE",
					"currency_name": "Authored title",
					"currency_fraction": "Minor unit",
					"currency_fraction_units": 100,
					"currency_symbol": "$",
					"number_format": "#.###,##",
				}
			}
		)
		self.assertEqual(
			messages,
			[
				(
					"frappe/geo/country_info.json",
					get_line_number(text, "currency_fraction", "Minor unit"),
					"Minor unit",
					["Currency fraction label for RAW-CODE"],
					"Currency",
				)
			],
		)

	def test_first_currency_wins_even_without_a_fraction(self):
		_, messages = self.configured_messages(
			{
				"First": {"currency": "RAW", "currency_fraction": None},
				"Second": {"currency": "RAW", "currency_fraction": "Later duplicate"},
				"Third": {"currency": "OTHER", "currency_fraction": "Retained unit"},
			}
		)
		self.assertEqual([message for _, _, message, _, _ in messages], ["Retained unit"])

	def test_shared_fraction_groups_only_retained_currency_codes(self):
		_, messages = self.configured_messages(
			{
				"First": {"currency": "ONE", "currency_fraction": "Shared unit"},
				"Second": {"currency": "TWO", "currency_fraction": "Shared unit"},
				"Third": {"currency": "ONE", "currency_fraction": "Ignored different unit"},
				"Fourth": {"currency": "", "currency_fraction": "Ignored empty code"},
			}
		)
		self.assertEqual(
			[(message, comments, context) for _, _, message, comments, context in messages],
			[("Shared unit", ["Currency fraction label for ONE, TWO"], "Currency")],
		)

	def test_invalid_empty_and_nonstring_shapes_are_not_messages(self):
		for payload in (
			None,
			[],
			0,
			"country",
			{"Empty": {}},
			{"Invalid": None},
			{"Missing code": {"currency_fraction": "Unused fraction"}},
			{"Non-string": {"currency": "CODE", "currency_fraction": 100}},
			{"Empty label": {"currency": "CODE", "currency_fraction": ""}},
		):
			with self.subTest(payload=payload):
				self.assertEqual(self.configured_messages(payload)[1], [])

	def test_unicode_markup_and_source_lines_are_preserved(self):
		label = 'Qindarkë "{0}" <span>unit</span>\nAnother line'
		text, messages = self.configured_messages(
			{"Country": {"currency": "RAW-CODE", "currency_fraction": label}}
		)
		self.assertEqual(
			[(line, message, context) for _, line, message, _, context in messages],
			[(get_line_number(text, "currency_fraction", label), label, "Currency")],
		)

	def test_real_factory_materialized_fractions_match_configured_output(self):
		path = Path(frappe.get_app_path("frappe", "geo", "country_info.json"))
		before = path.read_bytes()
		seed = json.loads(before)
		with patch.object(frappe, "get_doc", side_effect=lambda **fields: frappe._dict(fields)):
			countries, currencies = get_countries_and_currencies()
		expected = {row.fraction for row in currencies if isinstance(row.fraction, str) and row.fraction}
		_, messages = self.configured_messages(seed)
		self.assertEqual(len(countries), 250)
		self.assertEqual(len(currencies), 144)
		self.assertEqual(len(expected), 62)
		self.assertEqual({message for _, _, message, _, _ in messages}, expected)
		self.assertEqual(len(messages), 62)
		self.assertTrue(all(context == "Currency" for _, _, _, _, context in messages))
		self.assertEqual(path.read_bytes(), before)
		later_only = {
			row.get("currency_fraction") for row in seed.values() if row.get("currency_fraction")
		} - expected
		self.assertEqual(later_only, {"Diram", "Iraimbilanja", "Kapyeyka", "Qəpik", "Rappen", "Tetri"})

	def test_other_files_keep_existing_dispatch(self):
		for relative in ("other/geo/country_info.json", "frappe/geo/other.json"):
			with self.subTest(relative=relative):
				self.assertEqual(
					self.configured_messages(
						{"Country": {"currency": "RAW", "currency_fraction": "Unused"}}, relative
					)[1],
					[],
				)
		methods = get_method_map("frappe")
		for relative, suffix in (
			("frappe/geo/doctype/currency/currency.json", "doctype"),
			("frappe/desk/report/sample/sample.json", "report"),
			("frappe/utils/data.py", "python"),
		):
			with self.subTest(relative=relative):
				selected = next(method for pattern, method in methods if pathmatch(pattern, relative))
				self.assertEqual(selected, "frappe.gettext.extractors." + suffix + ".extract")
