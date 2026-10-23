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
	"ARS": ("Centavo", 100, "centavo", "Centavo"),
	"BOB": ("Centavo", 100, "centavo", "Centavo"),
	"BRL": ("Centavo", 100, "centavo", "Centavo"),
	"CVE": ("Centavo", 100, "centavo", "Centavo"),
	"COP": ("Centavo", 100, "centavo", "Centavo"),
	"CUP": ("Centavo", 100, "centavo", "Centavo"),
	"DOP": ("Centavo", 100, "centavo", "Centavo"),
	"GTQ": ("Centavo", 100, "centavo", "Centavo"),
	"HNL": ("Centavo", 100, "centavo", "Centavo"),
	"MXN": ("Centavo", 100, "centavo", "Centavo"),
	"MZN": ("Centavo", 100, "centavo", "Centavo"),
	"NIO": ("Centavo", 100, "centavo", "Centavo"),
	"PHP": ("Centavo", 100, "centavo", "Centavo"),
	"CHF": ("Rappen[K]", 100, "rappen", "Centime"),
	"CDF": ("Centime", 100, "centime", "Centime"),
	"HTG": ("Centime", 100, "centime", "Centime"),
	"MAD": ("Centime", 100, "centime", "Centime"),
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
	"Centavo": ("One centavo", "{0} centavos"),
	"Centime": ("One centime", "{0} centimes"),
}

SELECTED_CONFIGS = {
	"ARS": ("Centavo", 100, "centavo", "Centavo"),
	"BOB": ("Centavo", 100, "centavo", "Centavo"),
	"BRL": ("Centavo", 100, "centavo", "Centavo"),
	"CVE": ("Centavo", 100, "centavo", "Centavo"),
	"COP": ("Centavo", 100, "centavo", "Centavo"),
	"CUP": ("Centavo", 100, "centavo", "Centavo"),
	"DOP": ("Centavo", 100, "centavo", "Centavo"),
	"GTQ": ("Centavo", 100, "centavo", "Centavo"),
	"HNL": ("Centavo", 100, "centavo", "Centavo"),
	"MXN": ("Centavo", 100, "centavo", "Centavo"),
	"MZN": ("Centavo", 100, "centavo", "Centavo"),
	"NIO": ("Centavo", 100, "centavo", "Centavo"),
	"PHP": ("Centavo", 100, "centavo", "Centavo"),
	"CHF": ("Rappen[K]", 100, "rappen", "Centime"),
	"CDF": ("Centime", 100, "centime", "Centime"),
	"HTG": ("Centime", 100, "centime", "Centime"),
	"MAD": ("Centime", 100, "centime", "Centime"),
}

CARDINALS = {0: "Zero", 1: "Uno", 2: "Due", 21: "Ventuno", 31: "Trentuno", 101: "Centouno"}

POSITIVE_MESSAGES = {
	"and": "e",
	"Zero": "Zero",
	"Dinars:Currency": "Dinari",
	"{0} only.:Money in words": "{0}.",
	"{0}.:Money in words": "{0}.",
	"Centavo:Currency": "centavo",
	"Rappen[K]:Currency": "rappen",
	"Centime:Currency": "centime",
	"One centavo:Currency fraction wording": "Un centavo",
	"{0} centavos:Currency fraction wording": "{0} centavos",
	"One centime:Currency fraction wording": "Un centesimo",
	"{0} centimes:Currency fraction wording": "{0} centesimi",
	"One dinar:Currency major wording": "Un dinaro",
	"{0} dinars:Currency major wording": "{0} dinari",
	"{0} dinars:Currency major wording (whole millions)": "{0} di dinari",
}


class TestSelectedItalianCurrencyWords(UnitTestCase):
	def setUp(self):
		self.messages = dict(POSITIVE_MESSAGES)
		with patch.object(frappe, "get_doc", side_effect=lambda **fields: frappe._dict(fields)):
			countries, currencies = get_countries_and_currencies()
		self.assertGreater(len(countries), len(currencies))
		self.currencies = {row.name: deepcopy(dict(row)) for row in currencies}
		self.assertEqual(len(self.currencies), 144)
		self.default_currency = "BRL"
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

	def format(self, amount, code="BRL", fraction=None):
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

	def test_complete_registry_has_exact_89_factory_tuples_and_23_families(self):
		self.assertEqual(data._ITALIAN_MONEY_FRACTION_CONFIGS, EXPECTED_CONFIGS)
		self.assertEqual(data._ITALIAN_MONEY_FRACTION_FORMS, EXPECTED_FORMS)
		self.assertEqual(len(EXPECTED_CONFIGS), 89)
		self.assertEqual(len(EXPECTED_FORMS), 23)
		self.assertNotIn("DZD", data._ITALIAN_MONEY_FRACTION_CONFIGS)
		for code, (raw, units, label, _family) in SELECTED_CONFIGS.items():
			with self.subTest(code=code):
				self.assertEqual(
					(self.currencies[code]["fraction"], self.currencies[code]["fraction_units"]), (raw, units)
				)
				self.assertEqual(frappe._(raw, context="Currency"), label)

	def test_all_seventeen_minor_counts_preserve_scale_carry_and_ordered_reads(self):
		for code, (_raw, units, _label, family) in SELECTED_CONFIGS.items():
			one, plural = ("Un centavo", "centavos") if family == "Centavo" else ("Un centesimo", "centesimi")
			for count in (0, 1, 2, 21, 31, 100, 101):
				with self.subTest(code=code, count=count):
					result = self.format(Decimal(count) / units, code)
					major, minor = divmod(count, units)
					self.assertEqual(
						self.normalized,
						{
							"n": f"{major}.{minor:02d}",
							"main": str(major),
							"fraction": f"{minor:02d}",
							"fraction_units": units,
							"in_million": True,
						},
					)
					self.assert_default_reads(code)
					self.assertEqual(self.currency_mode_calls, [])
					if count == 0:
						expected = code + " Zero"
					elif minor == 0:
						expected = code + " Uno"
					elif major:
						expected = code + " Uno e " + one.lower()
					elif minor == 1:
						expected = one
					else:
						expected = CARDINALS[minor] + " " + plural
					self.assertEqual(result, expected + ".")

	def test_iso_major_and_mixed_amounts_keep_the_same_cardinal_and_raw_code(self):
		for code, (_raw, _units, _label, family) in SELECTED_CONFIGS.items():
			one = "un centavo" if family == "Centavo" else "un centesimo"
			for major in (0, 1, 2, 21, 31, 101):
				with self.subTest(code=code, major=major):
					self.assertEqual(self.format(major, code), code + " " + CARDINALS[major] + ".")
					self.assert_default_reads(code)
					expected = one.capitalize() if not major else code + " " + CARDINALS[major] + " e " + one
					self.assertEqual(self.format(Decimal(major) + Decimal("0.01"), code), expected + ".")
					self.assert_default_reads(code)
					self.assertEqual(self.currency_mode_calls, [])

	def test_dzd_whole_major_minor_and_million_frames_keep_original_numeric_values(self):
		for amount, expected in (
			("0", "DZD Zero."),
			("0.01", "Un centesimo."),
			("0.02", "Due centesimi."),
			("0.21", "Ventuno centesimi."),
			("0.31", "Trentuno centesimi."),
			("1", "Un dinaro."),
			("2", "Due dinari."),
			("21", "Ventuno dinari."),
			("31", "Trentuno dinari."),
			("101", "Centouno dinari."),
			("1.01", "Un dinaro e un centesimo."),
			("2.02", "Due dinari e due centesimi."),
			("21.21", "Ventuno dinari e ventuno centesimi."),
			("1000000", "Un milione di dinari."),
			("2000000", "Due milioni di dinari."),
			("21000000", "Ventuno milioni di dinari."),
			("1000000.01", "Un milione di dinari e un centesimo."),
			("1000001", "Un milione e uno dinari."),
		):
			with self.subTest(amount=amount):
				result = self.format(amount, "DZD")
				self.assertEqual(self.normalized["n"], f"{float(amount):.2f}")
				self.assertEqual(self.normalized["fraction_units"], 100)
				self.assert_default_reads("DZD")
				self.assertEqual(self.currency_mode_calls, [])
				self.assertEqual(result, expected)

	def test_explicit_fraction_arguments_keep_original_generic_assembly_and_reads(self):
		for code in (*SELECTED_CONFIGS, "DZD"):
			raw = self.currencies[code]["fraction"]
			label = "rappen" if code == "CHF" else "centime" if raw == "Centime" else "centavo"
			for explicit in ("", raw, "Authored unit"):
				with self.subTest(code=code, explicit=explicit):
					head = "Authored unit" if explicit == "Authored unit" else label
					self.assertEqual(self.format("0.01", code, explicit), "Uno " + head + ".")
					self.assertEqual(
						self.reads,
						[
							("defaults",),
							*([("Currency", code, "fraction")] if explicit == "" else []),
							("Language", "it"),
							("Currency", code, "fraction_units"),
						],
					)
					prefix = "Uno Dinari" if code == "DZD" else code + " Uno"
					self.assertEqual(self.format("1.01", code, explicit), prefix + " e Uno " + head + ".")

	def test_authored_units_scales_and_unknown_codes_decline_without_changing_factory_rows(self):
		for code in (*SELECTED_CONFIGS, "DZD"):
			with (
				self.subTest(code=code, unit=True),
				patch.dict(self.currencies[code], fraction="Authored unit"),
			):
				self.assertEqual(self.format("0.01", code), "Uno Authored unit.")
			label = frappe._(self.currencies[code]["fraction"], context="Currency")
			for scale, amount, normalized in ((5, "0.2", "0.2"), (1000, "0.001", "0.001")):
				with (
					self.subTest(code=code, scale=scale),
					patch.dict(self.currencies[code], fraction_units=scale),
				):
					self.assertEqual(self.format(amount, code), "Uno " + label + ".")
					self.assertEqual(self.normalized["n"], normalized)
					self.assert_default_reads(code)
			for scale in (0, None):
				with (
					self.subTest(code=code, scale=scale),
					patch.dict(self.currencies[code], fraction_units=scale),
				):
					self.assertEqual(self.format(1, code), "Uno Dinari." if code == "DZD" else code + " Uno.")
			with (
				self.subTest(code=code, scale=-5),
				patch.dict(self.currencies[code], fraction_units=-5),
				self.assertRaises(ValueError),
			):
				self.format(1, code)
		self.currencies["AUTHORED"] = {**self.currencies["DZD"], "name": "AUTHORED"}
		self.assertEqual(self.format("1.01", "AUTHORED"), "AUTHORED Uno e Uno centime.")

	def test_owned_frame_missing_empty_identity_and_custom_fallback_contracts(self):
		for code, (_raw, _units, label, family) in SELECTED_CONFIGS.items():
			one, many = EXPECTED_FORMS[family]
			for source in (one, many):
				for empty in (False, True):
					with self.subTest(code=code, source=source, empty=empty), patch.dict(self.messages):
						key = source + ":Currency fraction wording"
						if empty:
							self.messages[key] = ""
						else:
							self.messages.pop(key)
						if family == "Centavo" and source == many:
							self.assertEqual(self.format("0.01", code), "Un centavo.")
							self.assertEqual(self.format("0.02", code), "Due centavos.")
						else:
							self.assertEqual(self.format("0.01", code), "Uno " + label + ".")
							self.assertEqual(self.format("0.02", code), "Due " + label + ".")
		with patch.dict(
			self.messages,
			{
				"One centavo:Currency fraction wording": "Una frazione",
				"{0} centavos:Currency fraction wording": "{0} frazioni",
			},
		):
			self.assertEqual(self.format("1.01", "BRL"), "BRL Uno e una frazione.")
			self.assertEqual(self.format("0.02", "BRL"), "Due frazioni.")

	def test_dzd_requires_all_five_whole_frames_and_preserves_outer_frame(self):
		keys = (
			"One dinar:Currency major wording",
			"{0} dinars:Currency major wording",
			"{0} dinars:Currency major wording (whole millions)",
			"One centime:Currency fraction wording",
			"{0} centimes:Currency fraction wording",
		)
		for key in keys:
			for empty in (False, True):
				with self.subTest(key=key, empty=empty), patch.dict(self.messages):
					if empty:
						self.messages[key] = ""
					else:
						self.messages.pop(key)
					self.assertEqual(self.format("0.01", "DZD"), "Uno centime.")
					self.assertEqual(self.format("1.01", "DZD"), "Uno Dinari e Uno centime.")
					self.assertEqual(self.format("2", "DZD"), "Due Dinari.")
		with patch.dict(self.messages, {"{0}.:Money in words": "Importo: {0}"}):
			self.assertEqual(self.format("1.01", "DZD"), "Importo: Un dinaro e un centesimo")
		with patch.dict(self.messages, {"One dinar:Currency major wording": "Un dinaro speciale"}):
			self.assertEqual(self.format(1, "DZD"), "Un dinaro speciale.")

	def test_changed_currency_fraction_and_dinars_captions_keep_authored_identity(self):
		for code in (*SELECTED_CONFIGS, "DZD"):
			raw = self.currencies[code]["fraction"]
			with (
				self.subTest(code=code, fraction=True),
				patch.dict(self.messages, {raw + ":Currency": "My unit"}),
			):
				self.assertEqual(self.format("0.01", code), "Uno My unit.")
			with (
				self.subTest(code=code, currency=True),
				patch.dict(self.messages, {code + ":Currency": "My currency"}),
			):
				expected = (
					"Uno Dinari e Uno centime."
					if code == "DZD"
					else "My currency Uno e Uno " + frappe._(raw, context="Currency") + "."
				)
				self.assertEqual(self.format("1.01", code), expected)
		for label in ("Dinaro aziendale", "dinari"):
			with self.subTest(dinars=label), patch.dict(self.messages, {"Dinars:Currency": label}):
				self.assertEqual(self.format("1.01", "DZD"), "Uno " + label + " e Uno centime.")

	def test_language_alias_indian_and_english_paths_keep_existing_ownership(self):
		for code in (*SELECTED_CONFIGS, "DZD"):
			raw = self.currencies[code]["fraction"]
			for lang, number in (
				("en", "One"),
				("it-IT", "Uno"),
				("it_IT", "Uno"),
				("xx_UNSUPPORTED", "One"),
			):
				with self.subTest(code=code, lang=lang):
					frappe.local.lang = lang
					self.assertEqual(
						self.format("0.01", code), number + " " + raw + ("." if code == "DZD" else " only.")
					)
			frappe.local.lang = "it"
			self.indian = True
			with self.subTest(code=code, indian=True):
				self.assertEqual(self.format("0.01", code), "One " + frappe._(raw, context="Currency") + ".")
			self.indian = False

	def test_cold_job_and_print_language_preserve_read_timing_and_late_display(self):
		for code, expected in (
			("BRL", "Un centavo."),
			("CHF", "Un centesimo."),
			("DZD", "Un dinaro e un centesimo."),
		):
			with self.subTest(code=code):
				frappe.local.lang = "en"
				frappe.local.job = frappe._dict(user="translator@example.com", lang_resolved=False)
				self.assertEqual(self.format("1.01" if code == "DZD" else "0.01", code), expected)
				self.assertEqual(frappe.local.lang, "it")
				self.assertTrue(frappe.local.job.lang_resolved)
				self.assertEqual(
					self.reads,
					[
						("defaults",),
						("Currency", code, "fraction"),
						("Language", "en"),
						("Currency", code, "fraction_units"),
						("user_language", "translator@example.com"),
					],
				)
				frappe.local.job = None
		for print_lang, expected in (
			("it", "Un dinaro e un centesimo."),
			("en", "One Dinars and One Centime."),
		):
			frappe.local.lang = "en"
			with print_language(print_lang):
				self.assertEqual(self.format("1.01", "DZD"), expected)
			self.assertEqual(frappe.local.lang, "en")

	def test_normalization_invalid_inputs_default_currency_and_cash_rounding_are_unchanged(self):
		for amount, code, expected, normalized in (
			("0.005", "BRL", "Un centavo.", "0.01"),
			(Decimal("2.675"), "BRL", "BRL Due e sessantasette centavos.", "2.67"),
			("0.01", "CHF", "Un centesimo.", "0.01"),
			("0.005", "DZD", "Un centesimo.", "0.01"),
		):
			with self.subTest(amount=amount, code=code):
				self.assertEqual(self.format(amount, code), expected)
				self.assertEqual(self.normalized["n"], normalized)
				self.assertEqual(self.currency_mode_calls, [])
		for zero in (-0.0, "-0.00"):
			with self.subTest(signed_zero=zero):
				self.assertEqual(self.format(zero, "DZD"), "Zero Dinari.")
				self.assertEqual(self.normalized["n"], "-0.00")
				self.assert_default_reads("DZD")
		self.assertEqual(self.currencies["CHF"]["smallest_currency_fraction_value"], 0.05)
		for convert in (int, float, str, Decimal):
			self.assertEqual(self.format(convert(1), "DZD"), "Un dinaro.")
		self.assertEqual(self.format("0.01", None), "Un centavo.")
		self.assert_default_reads("BRL")
		for amount in (-1, "Fail", "1,01"):
			with self.subTest(amount=amount):
				self.assertEqual(self.format(amount), "")
				self.assertEqual(self.reads, [])
		for amount, error in (
			(None, TypeError),
			(float("nan"), ValueError),
			(float("inf"), ValueError),
			(10**400, OverflowError),
		):
			with self.subTest(amount=str(amount)), self.assertRaises(error):
				self.format(amount)
