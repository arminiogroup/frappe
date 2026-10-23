import sys
from copy import deepcopy
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import frappe
from frappe.geo.doctype.country.country import get_countries_and_currencies
from frappe.tests import UnitTestCase
from frappe.translate import print_language
from frappe.utils import data

EXPECTED_CONFIGS = {
	"XCD": ("Cent", 100, "Cent", "Cent"),
	"AWG": ("Cent", 100, "Cent", "Cent"),
	"AUD": ("Cent", 100, "Cent", "Cent"),
	"BSD": ("Cent", 100, "Cent", "Cent"),
	"BHD": ("Fils", 1000, "fils", "Fils"),
	"BDT": ("Paisa", 100, "paisa", "Poisha"),
	"BBD": ("Cent", 100, "Cent", "Cent"),
	"BZD": ("Cent", 100, "Cent", "Cent"),
	"BMD": ("Cent", 100, "Cent", "Cent"),
	"CAD": ("Cent", 100, "Cent", "Cent"),
	"KYD": ("Cent", 100, "Cent", "Cent"),
	"EGP": ("Piastre[F]", 100, "piastra", "Piastre"),
	"USD": ("Cent", 100, "Cent", "Cent"),
	"ERN": ("Cent", 100, "Cent", "Cent"),
	"FKP": ("Penny", 100, "penny", "Penny"),
	"FJD": ("Cent", 100, "Cent", "Cent"),
	"GIP": ("Penny", 100, "penny", "Penny"),
	"GYD": ("Cent", 100, "Cent", "Cent"),
	"HKD": ("Cent", 100, "Cent", "Cent"),
	"INR": ("Paisa", 100, "paisa", "Paisa"),
	"IQD": ("Fils", 1000, "fils", "Fils"),
	"JMD": ("Cent", 100, "Cent", "Cent"),
	"JOD": ("Fils", 1000, "fils", "Fils"),
	"KES": ("Cent", 100, "Cent", "Cent"),
	"KWD": ("Fils", 1000, "fils", "Fils"),
	"LBP": ("Piastre", 100, "piastra", "Piastre"),
	"LRD": ("Cent", 100, "Cent", "Cent"),
	"MUR": ("Cent", 100, "Cent", "Cent"),
	"MDL": ("Ban", 100, "ban", "Ban"),
	"NAD": ("Cent", 100, "Cent", "Cent"),
	"NPR": ("Paisa", 100, "paisa", "Paisa"),
	"NZD": ("Cent", 100, "Cent", "Cent"),
	"PKR": ("Paisa", 100, "paisa", "Paisa"),
	"RON": ("Bani", 100, "ban", "Ban"),
	"SHP": ("Penny", 100, "penny", "Penny"),
	"SCR": ("Cent", 100, "Cent", "Cent"),
	"SLL": ("Cent", 100, "Cent", "Cent"),
	"SGD": ("Cent", 100, "Cent", "Cent"),
	"SBD": ("Cent", 100, "Cent", "Cent"),
	"SOS": ("Cent", 100, "Cent", "Cent"),
	"ZAR": ("Cent", 100, "Cent", "Cent"),
	"LKR": ("Cent", 100, "Cent", "Cent"),
	"SDG": ("Piastre", 100, "piastra", "Piastre"),
	"SRD": ("Cent", 100, "Cent", "Cent"),
	"SZL": ("Cent", 100, "Cent", "Cent"),
	"SYP": ("Piastre", 100, "piastra", "Piastre"),
	"TTD": ("Cent", 100, "Cent", "Cent"),
	"AED": ("Fils", 100, "fils", "Fils"),
	"GBP": ("Penny", 100, "penny", "Penny"),
	"VEF": ("Centimos", 100, "céntimo", "Centimo"),
	"YER": ("Fils", 100, "fils", "Fils"),
	"ZWL": ("Cent", 100, "Cent", "Cent"),
	"AMD": ("Luma", 100, "luma", "Luma"),
	"BTN": ("Chetrum", 100, "chhetrum", "Chetrum"),
	"BWP": ("Thebe", 100, "thebe", "Thebe"),
	"BND": ("Sen", 100, "sen", "Sen"),
	"KHR": ("Sen", 100, "sen", "Sen"),
	"IDR": ("Sen", 100, "sen", "Sen"),
	"MYR": ("Sen", 100, "sen", "Sen"),
	"CNY": ("Fen", 100, "fen", "Fen"),
	"TWD": ("Fen", 100, "fen", "Fen"),
	"HUF": ("Fillér", 100, "fillér", "Fillér"),
	"IRR": ("Dinar", 100, "dinar", "Dinar"),
	"KPW": ("Chon", 100, "chon", "Chon"),
	"LYD": ("Dirham", 1000, "dirham", "Dirham"),
	"PLN": ("Grosz", 100, "grosz", "Grosz"),
	"QAR": ("Dirham", 100, "dirham", "Dirham"),
	"RSD": ("Para", 100, "para", "Para"),
	"SEK": ("Öre", 100, "öre", "Öre"),
	"TMT": ("Tenge", 100, "tenge", "Tenge"),
	"CRC": ("Céntimo", 100, "céntimo", "Centimo"),
	"PEN": ("Céntimo", 100, "céntimo", "Centimo"),
}

EXPECTED_FORMS = {
	"Cent": ("One cent", "{0} cent"),
	"Fils": ("One fils", "{0} fils"),
	"Paisa": ("One paisa", "{0} paise"),
	"Poisha": ("One poisha", "{0} poisha"),
	"Penny": ("One penny", "{0} pence"),
	"Piastre": ("One piastre", "{0} piastres"),
	"Ban": ("One ban", "{0} bani"),
	"Centimo": ("One céntimo", "{0} céntimos"),
	"Luma": ("One luma", "{0} luma"),
	"Chetrum": ("One chhetrum", "{0} chhetrum"),
	"Thebe": ("One thebe", "{0} thebe"),
	"Sen": ("One sen", "{0} sen"),
	"Fen": ("One fen", "{0} fen"),
	"Fillér": ("One fillér", "{0} fillér"),
	"Dinar": ("One dinar", "{0} dinar"),
	"Chon": ("One chon", "{0} chon"),
	"Dirham": ("One dirham", "{0} dirham"),
	"Grosz": ("One grosz", "{0} grosz"),
	"Para": ("One para", "{0} para"),
	"Öre": ("One öre", "{0} öre"),
	"Tenge": ("One tenge", "{0} tenge"),
}

ADDED_CONFIGS = {
	"AMD": ("Luma", 100, "luma", "Luma"),
	"BTN": ("Chetrum", 100, "chhetrum", "Chetrum"),
	"BWP": ("Thebe", 100, "thebe", "Thebe"),
	"BND": ("Sen", 100, "sen", "Sen"),
	"KHR": ("Sen", 100, "sen", "Sen"),
	"IDR": ("Sen", 100, "sen", "Sen"),
	"MYR": ("Sen", 100, "sen", "Sen"),
	"CNY": ("Fen", 100, "fen", "Fen"),
	"TWD": ("Fen", 100, "fen", "Fen"),
	"HUF": ("Fillér", 100, "fillér", "Fillér"),
	"IRR": ("Dinar", 100, "dinar", "Dinar"),
	"KPW": ("Chon", 100, "chon", "Chon"),
	"LYD": ("Dirham", 1000, "dirham", "Dirham"),
	"PLN": ("Grosz", 100, "grosz", "Grosz"),
	"QAR": ("Dirham", 100, "dirham", "Dirham"),
	"RSD": ("Para", 100, "para", "Para"),
	"SEK": ("Öre", 100, "öre", "Öre"),
	"TMT": ("Tenge", 100, "tenge", "Tenge"),
	"CRC": ("Céntimo", 100, "céntimo", "Centimo"),
	"PEN": ("Céntimo", 100, "céntimo", "Centimo"),
}

WORDS = {
	"AMD": ("Un luma", "luma"),
	"BTN": ("Un chhetrum", "chhetrum"),
	"BWP": ("Un thebe", "thebe"),
	"BND": ("Un sen", "sen"),
	"KHR": ("Un sen", "sen"),
	"IDR": ("Un sen", "sen"),
	"MYR": ("Un sen", "sen"),
	"CNY": ("Un fen", "fen"),
	"TWD": ("Un fen", "fen"),
	"HUF": ("Un fillér", "fillér"),
	"IRR": ("Un dinar", "dinar"),
	"KPW": ("Un chon", "chon"),
	"LYD": ("Un dirham", "dirham"),
	"PLN": ("Un grosz", "grosz"),
	"QAR": ("Un dirham", "dirham"),
	"RSD": ("Una para", "para"),
	"SEK": ("Un öre", "öre"),
	"TMT": ("Un tenge", "tenge"),
	"CRC": ("Un céntimo", "céntimos"),
	"PEN": ("Un céntimo", "céntimos"),
}

CARDINALS = {0: "Zero", 1: "Uno", 2: "Due", 21: "Ventuno", 31: "Trentuno", 101: "Centouno"}

POSITIVE_MESSAGES = {
	"and": "e",
	"Zero": "Zero",
	"Dinars:Currency": "Dinari",
	"{0} only.:Money in words": "{0}.",
	"{0}.:Money in words": "{0}.",
	"Cent:Currency": "Cent",
	"Satang:Currency": "satang",
	"Rappen[K]:Currency": "rappen",
	"Centime:Currency": "centime",
	"Centavo:Currency": "centavo",
	"Khoums:Currency": "khoums",
	"Luma:Currency": "luma",
	"One luma:Currency fraction wording": "Un luma",
	"{0} luma:Currency fraction wording": "{0} luma",
	"Chetrum:Currency": "chhetrum",
	"One chhetrum:Currency fraction wording": "Un chhetrum",
	"{0} chhetrum:Currency fraction wording": "{0} chhetrum",
	"Thebe:Currency": "thebe",
	"One thebe:Currency fraction wording": "Un thebe",
	"{0} thebe:Currency fraction wording": "{0} thebe",
	"Sen:Currency": "sen",
	"One sen:Currency fraction wording": "Un sen",
	"{0} sen:Currency fraction wording": "{0} sen",
	"Fen:Currency": "fen",
	"One fen:Currency fraction wording": "Un fen",
	"{0} fen:Currency fraction wording": "{0} fen",
	"Fillér:Currency": "fillér",
	"One fillér:Currency fraction wording": "Un fillér",
	"{0} fillér:Currency fraction wording": "{0} fillér",
	"Dinar:Currency": "dinar",
	"One dinar:Currency fraction wording": "Un dinar",
	"{0} dinar:Currency fraction wording": "{0} dinar",
	"Chon:Currency": "chon",
	"One chon:Currency fraction wording": "Un chon",
	"{0} chon:Currency fraction wording": "{0} chon",
	"Dirham:Currency": "dirham",
	"One dirham:Currency fraction wording": "Un dirham",
	"{0} dirham:Currency fraction wording": "{0} dirham",
	"Grosz:Currency": "grosz",
	"One grosz:Currency fraction wording": "Un grosz",
	"{0} grosz:Currency fraction wording": "{0} grosz",
	"Para:Currency": "para",
	"One para:Currency fraction wording": "Una para",
	"{0} para:Currency fraction wording": "{0} para",
	"Öre:Currency": "öre",
	"One öre:Currency fraction wording": "Un öre",
	"{0} öre:Currency fraction wording": "{0} öre",
	"Tenge:Currency": "tenge",
	"One tenge:Currency fraction wording": "Un tenge",
	"{0} tenge:Currency fraction wording": "{0} tenge",
	"Céntimo:Currency": "céntimo",
	"One céntimo:Currency fraction wording": "Un céntimo",
	"{0} céntimos:Currency fraction wording": "{0} céntimos",
}


class TestRemainingItalianCurrencyWords(UnitTestCase):
	def setUp(self):
		self.messages = dict(POSITIVE_MESSAGES)
		with patch.object(frappe, "get_doc", side_effect=lambda **fields: frappe._dict(fields)):
			countries, currencies = get_countries_and_currencies()
		self.assertGreater(len(countries), len(currencies))
		self.currencies = {row.name: deepcopy(dict(row)) for row in currencies}
		self.assertEqual(len(self.currencies), 144)
		self.default_currency = "AMD"
		self.indian = False
		self.job_language = "it"
		self.reads = []
		local_state = dict(frappe.local)
		for key, value in {
			"session": frappe._dict(user="translator@example.com", data=frappe._dict()),
			"lang": "it",
			"job": None,
			"response": frappe._dict(),
		}.items():
			if key in local_state:
				self.addCleanup(setattr, frappe.local, key, local_state[key])
			else:
				self.addCleanup(delattr, frappe.local, key)
			setattr(frappe.local, key, value)
		self.enterContext(patch.object(frappe, "db", SimpleNamespace(get_value=self.value)))
		self.enterContext(patch.object(frappe, "client_cache", SimpleNamespace(get_doc=self.language)))
		self.enterContext(patch("frappe.utils.get_defaults", side_effect=self.defaults))
		self.enterContext(patch("frappe.translate.get_all_translations", side_effect=self.translations))
		self.enterContext(patch("frappe.translate.get_user_lang", side_effect=self.user_language))
		for name in ("sendmail", "enqueue", "delete_doc", "get_doc", "new_doc"):
			self.enterContext(patch("frappe." + name, side_effect=AssertionError("Forbidden " + name)))

	def defaults(self):
		self.reads.append(("defaults",))
		return {"currency": self.default_currency}

	def value(self, doctype, name, field, **kwargs):
		self.assertEqual((doctype, kwargs), ("Currency", {"cache": True}))
		self.reads.append((doctype, name, field))
		return self.currencies[name][field]

	def language(self, doctype, name):
		self.assertEqual(doctype, "Language")
		self.reads.append((doctype, name))
		return frappe._dict(number_format="#,##,###.##" if self.indian else "#.###,##")

	def translations(self, language):
		return self.messages if language == "it" else {}

	def user_language(self, user):
		self.assertEqual(user, "translator@example.com")
		self.reads.append(("user_language", user))
		return self.job_language

	def format(self, amount, code="AMD", fraction=None):
		self.reads = []
		self.normalized = {}
		self.currency_mode_calls = []
		before = deepcopy(self.currencies)

		def profile(frame, event, _value):
			if (
				event == "call"
				and frame.f_code.co_name == "num2words"
				and frame.f_globals.get("__name__") == "num2words"
				and frame.f_locals.get("to") == "currency"
			):
				self.currency_mode_calls.append(frame.f_locals["kwargs"]["currency"])
			if event == "return" and frame.f_code is data.money_in_words.__code__:
				self.normalized = {
					key: frame.f_locals.get(key)
					for key in ("n", "main", "fraction", "fraction_units", "in_million")
				}

		previous = sys.getprofile()
		sys.setprofile(profile)
		try:
			return data.money_in_words(amount, code, fraction)
		finally:
			sys.setprofile(previous)
			self.assertEqual(self.currencies, before)

	def assert_default_reads(self, code, language="it"):
		self.assertEqual(
			self.reads,
			[
				("defaults",),
				("Currency", code, "fraction"),
				("Language", language),
				("Currency", code, "fraction_units"),
			],
		)

	def test_original_72_factory_tuples_and_21_families_remain_exact(self):
		self.assertEqual(
			{key: data._ITALIAN_MONEY_FRACTION_CONFIGS[key] for key in EXPECTED_CONFIGS}, EXPECTED_CONFIGS
		)
		self.assertEqual(
			{key: data._ITALIAN_MONEY_FRACTION_FORMS[key] for key in EXPECTED_FORMS}, EXPECTED_FORMS
		)
		self.assertEqual(len(EXPECTED_CONFIGS), 72)
		self.assertEqual(len(EXPECTED_FORMS), 21)
		for code, (raw, units, target, _family) in ADDED_CONFIGS.items():
			with self.subTest(code=code):
				self.assertEqual(
					(self.currencies[code]["fraction"], self.currencies[code]["fraction_units"]),
					(raw, units),
				)
				self.assertEqual(frappe._(raw, context="Currency"), target)

	def test_every_new_tuple_counts_zero_one_two_21_31_101_without_changing_carry(self):
		for code, (_raw, units, _target, _family) in ADDED_CONFIGS.items():
			one, plural = WORDS[code]
			for count in (0, 1, 2, 21, 31, 101):
				with self.subTest(code=code, count=count):
					major, minor = divmod(count, units)
					if count == 0:
						expected = code + " Zero."
					elif major:
						expected = code + " Uno e " + one[0].lower() + one[1:] + "."
					elif minor == 1:
						expected = one + "."
					else:
						expected = CARDINALS[minor] + " " + plural + "."
					self.assertEqual(self.format(Decimal(count) / units, code), expected)
					digits = 3 if units == 1000 else 2
					self.assertEqual(
						self.normalized,
						{
							"n": f"{major}.{minor:0{digits}d}",
							"main": str(major),
							"fraction": f"{minor:0{digits}d}",
							"fraction_units": units,
							"in_million": True,
						},
					)
					self.assert_default_reads(code)
					self.assertEqual(self.currency_mode_calls, [])

	def test_major_and_mixed_values_preserve_iso_and_compound_cardinals(self):
		for code, (_raw, units, _target, _family) in ADDED_CONFIGS.items():
			one, _plural = WORDS[code]
			for major in (0, 1, 2, 21, 31, 101):
				with self.subTest(code=code, major=major):
					self.assertEqual(self.format(major, code), code + " " + CARDINALS[major] + ".")
					expected = one if major == 0 else code + " " + CARDINALS[major] + " e " + one.lower()
					self.assertEqual(self.format(Decimal(major) + Decimal(1) / units, code), expected + ".")
					self.assert_default_reads(code)
					self.assertEqual(self.currency_mode_calls, [])

	def test_explicit_empty_canonical_and_authored_fraction_arguments_remain_generic(self):
		for code, (raw, units, target, _family) in ADDED_CONFIGS.items():
			for explicit in ("", raw, "Authored unit"):
				with self.subTest(code=code, explicit=explicit):
					expected = "Authored unit" if explicit == "Authored unit" else target
					self.assertEqual(self.format(Decimal(1) / units, code, explicit), "Uno " + expected + ".")
					fraction_read = [("Currency", code, "fraction")] if explicit == "" else []
					self.assertEqual(
						self.reads,
						[
							("defaults",),
							*fraction_read,
							("Language", "it"),
							("Currency", code, "fraction_units"),
						],
					)

	def test_authored_unit_and_nonstandard_scale_keep_original_configuration(self):
		for code, (_raw, units, target, _family) in ADDED_CONFIGS.items():
			with self.subTest(code=code), patch.dict(self.currencies[code], fraction="Authored unit"):
				self.assertEqual(self.format(Decimal(1) / units, code), "Uno Authored unit.")
			with self.subTest(code=code, units=5), patch.dict(self.currencies[code], fraction_units=5):
				self.assertEqual(self.format("0.2", code), "Uno " + target + ".")
				self.assertEqual(self.normalized["n"], "0.2")
				self.assertEqual(self.normalized["fraction_units"], 5)

	def test_custom_unit_and_currency_translations_decline_without_rewriting_names(self):
		for code, (raw, units, _target, _family) in ADDED_CONFIGS.items():
			with self.subTest(code=code), patch.dict(self.messages, {raw + ":Currency": "My unit"}):
				self.assertEqual(self.format(Decimal(1) / units, code), "Uno My unit.")
			with (
				self.subTest(code=code, currency=True),
				patch.dict(self.messages, {code + ":Currency": "My currency"}),
			):
				self.assertEqual(self.format(1, code), "My currency Uno.")
				self.assertEqual(
					self.format(Decimal(1) + Decimal(1) / units, code),
					"My currency Uno e Uno " + self.messages[raw + ":Currency"] + ".",
				)

	def test_missing_or_empty_frames_preserve_existing_identity_fallback_contract(self):
		for code, (_raw, units, label, family) in ADDED_CONFIGS.items():
			one, many = EXPECTED_FORMS[family]
			for empty in (False, True):
				with self.subTest(code=code, empty=empty), patch.dict(self.messages):
					if empty:
						self.messages[one + ":Currency fraction wording"] = ""
					else:
						self.messages.pop(one + ":Currency fraction wording")
					self.assertEqual(self.format(Decimal(1) / units, code), "Uno " + label + ".")
					self.assertEqual(self.format(Decimal(2) / units, code), "Due " + label + ".")
				with self.subTest(code=code, empty_plural=empty), patch.dict(self.messages):
					if empty:
						self.messages[many + ":Currency fraction wording"] = ""
					else:
						self.messages.pop(many + ":Currency fraction wording")
					self.assertEqual(self.format(Decimal(1) / units, code), WORDS[code][0] + ".")
					self.assertEqual(self.format(Decimal(2) / units, code), "Due " + WORDS[code][1] + ".")
		with patch.dict(self.messages, clear=True):
			self.assertEqual(self.format("0.01"), "Uno Luma only.")

	def test_indian_alias_unsupported_and_english_paths_remain_generic(self):
		for code, (raw, units, target, _family) in ADDED_CONFIGS.items():
			with self.subTest(code=code, indian=True):
				self.indian = True
				self.assertEqual(self.format(Decimal(1) / units, code), "One " + target + ".")
				self.assertFalse(self.normalized["in_million"])
				self.indian = False
			for language, number in (
				("en", "One"),
				("it-IT", "Uno"),
				("it_IT", "Uno"),
				("xx_UNSUPPORTED", "One"),
			):
				with self.subTest(code=code, language=language):
					frappe.local.lang = language
					self.assertEqual(self.format(Decimal(1) / units, code), number + " " + raw + " only.")
			frappe.local.lang = "it"

	def test_cold_job_and_print_language_keep_existing_language_ownership(self):
		for code, (_raw, units, _target, _family) in ADDED_CONFIGS.items():
			with self.subTest(code=code):
				frappe.local.lang = "en"
				frappe.local.job = frappe._dict(user="translator@example.com", lang_resolved=False)
				self.assertEqual(self.format(Decimal(1) / units, code), WORDS[code][0] + ".")
				self.assertEqual(frappe.local.lang, "it")
				self.assertTrue(frappe.local.job.lang_resolved)
				self.assertEqual(self.reads[-1], ("user_language", "translator@example.com"))
				self.assertEqual(
					self.reads[:4],
					[
						("defaults",),
						("Currency", code, "fraction"),
						("Language", "en"),
						("Currency", code, "fraction_units"),
					],
				)
				frappe.local.job = None
		for user_language, print_lang, expected in (("en", "it", "Un luma."), ("it", "en", "One Luma only.")):
			self.job_language = user_language
			frappe.local.lang = "en"
			frappe.local.job = frappe._dict(user="translator@example.com", lang_resolved=False)
			with print_language(print_lang):
				self.assertEqual(self.format("0.01"), expected)
			self.assertEqual(frappe.local.lang, user_language)
			self.assertTrue(frappe.local.job.lang_resolved)

	def test_types_normalization_precision_and_default_currency_are_preserved(self):
		for convert in (int, float, str, Decimal):
			with self.subTest(type=convert.__name__):
				self.assertEqual(self.format(convert(1)), "AMD Uno.")
		for amount, code, expected, normalized in (
			("0.005", "AMD", "Un luma.", "0.01"),
			(Decimal("2.675"), "AMD", "AMD Due e sessantasette luma.", "2.67"),
			("24.50", "RSD", "RSD Ventiquattro e cinquanta para.", "24.50"),
			("0.001", "LYD", "Un dirham.", "0.001"),
		):
			with self.subTest(amount=amount, code=code):
				self.assertEqual(self.format(amount, code), expected)
				self.assertEqual(self.normalized["n"], normalized)
				self.assertEqual(self.currency_mode_calls, [])
		self.assertEqual(self.format("0.01", code=None), "Un luma.")
		self.assert_default_reads("AMD")
		with patch.dict(self.messages, {"{0} only.:Money in words": "Importo: {0}"}):
			self.assertEqual(self.format("0.01"), "Importo: Un luma")

	def test_unapproved_units_satang_and_no_fraction_currencies_remain_unchanged(self):
		for code, amount, expected in (
			("THB", "0.01", "Uno satang."),
			("CHF", "0.01", "Uno rappen."),
			("CDF", "0.01", "Uno centime."),
			("DZD", "1.01", "Uno Dinari e Uno centime."),
			("BRL", "0.01", "Uno centavo."),
			("MRO", "0.9", "Quattro khoums."),
			("EUR", "1.01", "Un euro e un centesimo."),
		):
			with self.subTest(code=code):
				self.assertEqual(self.format(amount, code), expected)
		for code, row in self.currencies.items():
			if not row["fraction_units"]:
				with self.subTest(code=code, units=0):
					self.assertEqual(self.format(1, code), code + " Uno.")

	def test_invalid_inputs_preserve_exceptions_and_do_not_read_currency(self):
		for amount in (-1, "Fail", "1,01"):
			with self.subTest(amount=amount):
				self.assertEqual(self.format(amount), "")
				self.assertEqual(self.reads, [])
		for amount, exception in (
			(None, TypeError),
			(float("nan"), ValueError),
			(float("inf"), ValueError),
			(10**400, OverflowError),
		):
			with self.subTest(amount=str(amount)), self.assertRaises(exception):
				self.format(amount)
