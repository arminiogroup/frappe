import sys
from copy import deepcopy
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import frappe
from frappe.geo.country_info import get_all
from frappe.tests import UnitTestCase
from frappe.translate import print_language
from frappe.utils import data


class TestItalianCurrencyFractionWords(UnitTestCase):
	def setUp(self):
		self.messages = {
			"and": "e",
			"Zero": "Zero",
			"Dinars:Currency": "Dinari",
			"{0} only.:Money in words": "{0}.",
			"{0}.:Money in words": "{0}.",
			"Cent:Currency": "Cent",
			"Fils:Currency": "fils",
			"Paisa:Currency": "paisa",
			"Penny:Currency": "penny",
			"Piastre[F]:Currency": "piastra",
			"Piastre:Currency": "piastra",
			"Ban:Currency": "ban",
			"Bani:Currency": "ban",
			"Centimos:Currency": "céntimo",
			"One cent:Currency fraction wording": "Un cent",
			"{0} cent:Currency fraction wording": "{0} cent",
			"One fils:Currency fraction wording": "Un fils",
			"{0} fils:Currency fraction wording": "{0} fils",
			"One paisa:Currency fraction wording": "Una paisa",
			"{0} paise:Currency fraction wording": "{0} paisa",
			"One poisha:Currency fraction wording": "Un poisha",
			"{0} poisha:Currency fraction wording": "{0} poisha",
			"One penny:Currency fraction wording": "Un penny",
			"{0} pence:Currency fraction wording": "{0} pence",
			"One piastre:Currency fraction wording": "Una piastra",
			"{0} piastres:Currency fraction wording": "{0} piastre",
			"One ban:Currency fraction wording": "Un ban",
			"{0} bani:Currency fraction wording": "{0} bani",
			"One céntimo:Currency fraction wording": "Un céntimo",
			"{0} céntimos:Currency fraction wording": "{0} céntimos",
		}
		self.currencies = {}
		for country in get_all().values():
			if country.get("currency"):
				self.currencies.setdefault(
					country["currency"],
					{
						"fraction": country.get("currency_fraction"),
						"fraction_units": country.get("currency_fraction_units"),
					},
				)
		self.default_currency = "USD"
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
		self.enterContext(
			patch(
				"frappe.translate.get_all_translations",
				side_effect=lambda lang: self.messages if lang == "it" else {},
			)
		)
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

	def user_language(self, user):
		self.assertEqual(user, "translator@example.com")
		self.reads.append(("user_language", user))
		return self.job_language

	def format(self, amount, currency="USD", fraction=None):
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
					key: frame.f_locals.get(key) for key in ("n", "main", "fraction", "fraction_units")
				}

		previous = sys.getprofile()
		sys.setprofile(profile)
		try:
			return data.money_in_words(amount, currency, fraction)
		finally:
			sys.setprofile(previous)
			self.assertEqual(self.currencies, before)

	def test_every_finite_tuple_matches_the_actual_first_currency_factory(self):
		expected_labels = {
			"Cent": ("Cent", "Cent"),
			"Fils": ("fils", "Fils"),
			"Paisa": ("paisa", "Paisa"),
			"Penny": ("penny", "Penny"),
			"Piastre[F]": ("piastra", "Piastre"),
			"Piastre": ("piastra", "Piastre"),
			"Ban": ("ban", "Ban"),
			"Bani": ("ban", "Ban"),
			"Centimos": ("céntimo", "Centimo"),
		}
		expected = {
			code: (
				row["fraction"],
				row["fraction_units"],
				expected_labels[row["fraction"]][0],
				"Poisha" if code == "BDT" else expected_labels[row["fraction"]][1],
			)
			for code, row in self.currencies.items()
			if code != "EUR" and row["fraction"] in expected_labels
		}
		self.assertEqual(len(expected), 52)
		self.assertEqual({row[1] for row in expected.values()}, {100, 1000})
		self.assertEqual(
			{code: data._ITALIAN_MONEY_FRACTION_CONFIGS.get(code) for code in expected}, expected
		)
		self.assertEqual(
			{
				name: data._ITALIAN_MONEY_FRACTION_FORMS.get(name)
				for name in ("Cent", "Fils", "Paisa", "Poisha", "Penny", "Piastre", "Ban", "Centimo")
			},
			{
				"Cent": ("One cent", "{0} cent"),
				"Fils": ("One fils", "{0} fils"),
				"Paisa": ("One paisa", "{0} paise"),
				"Poisha": ("One poisha", "{0} poisha"),
				"Penny": ("One penny", "{0} pence"),
				"Piastre": ("One piastre", "{0} piastres"),
				"Ban": ("One ban", "{0} bani"),
				"Centimo": ("One céntimo", "{0} céntimos"),
			},
		)

	def test_all_52_standard_currencies_agree_with_one_and_multiple_minor_units(self):
		forms = {
			"Cent": ("Un cent", "Due cent"),
			"Fils": ("Un fils", "Due fils"),
			"Paisa": ("Una paisa", "Due paisa"),
			"Penny": ("Un penny", "Due pence"),
			"Piastre[F]": ("Una piastra", "Due piastre"),
			"Piastre": ("Una piastra", "Due piastre"),
			"Ban": ("Un ban", "Due bani"),
			"Bani": ("Un ban", "Due bani"),
			"Centimos": ("Un céntimo", "Due céntimos"),
		}
		codes = [code for code, row in self.currencies.items() if code != "EUR" and row["fraction"] in forms]
		self.assertEqual(len(codes), 52)
		for code in codes:
			row = self.currencies[code]
			words = ("Un poisha", "Due poisha") if code == "BDT" else forms[row["fraction"]]
			for count, expected in enumerate(words, 1):
				with self.subTest(currency=code, count=count):
					self.assertEqual(self.format(count / row["fraction_units"], code), expected + ".")
					self.assertEqual(self.currency_mode_calls, [])
					self.assertEqual(
						self.reads,
						[
							("defaults",),
							("Currency", code, "fraction"),
							("Language", "it"),
							("Currency", code, "fraction_units"),
						],
					)

	def test_whole_phrases_keep_major_currency_and_count_compounds(self):
		for code, amount, expected in (
			("USD", 1.01, "USD Uno e un cent."),
			("GBP", 1.02, "GBP Uno e due pence."),
			("EGP", 1.01, "EGP Uno e una piastra."),
			("BHD", 1.001, "BHD Uno e un fils."),
			("BDT", 0.01, "Un poisha."),
			("RON", 0.02, "Due bani."),
			("VEF", 0.02, "Due céntimos."),
		):
			with self.subTest(currency=code, amount=amount):
				self.assertEqual(self.format(amount, code), expected)
		for count, expected in ((21, "ventuno"), (31, "trentuno"), (101, "centouno")):
			for code, unit in (("GBP", "pence"), ("EGP", "piastre"), ("BHD", "fils")):
				with self.subTest(currency=code, count=count):
					units = self.currencies[code]["fraction_units"]
					amount = count / units if count < units else 1 + 1 / units
					words = (
						f"{expected.capitalize()} {unit}."
						if count < units
						else f"{code} Uno e un {'penny' if code == 'GBP' else 'piastra'}."
					)
					if count >= units and code == "EGP":
						words = "EGP Uno e una piastra."
					self.assertEqual(self.format(amount, code), words)
		self.assertEqual(self.format(0.101, "BHD"), "Centouno fils.")

	def test_implicit_default_currency_and_final_outer_frame_remain_public_contracts(self):
		self.assertEqual(self.format(0.01, currency=None), "Un cent.")
		with patch.dict(self.messages, {"{0} only.:Money in words": "Importo: {0}"}):
			self.assertEqual(self.format(0.01), "Importo: Un cent")
		for amount, expected in ((0, "USD Zero."), (1, "USD Uno."), (24, "USD Ventiquattro.")):
			with self.subTest(amount=amount):
				self.assertEqual(self.format(amount), expected)

	def test_explicit_fraction_arguments_and_authored_values_decline(self):
		for fraction in ("", "Cent", "Authored unit"):
			with self.subTest(fraction=fraction):
				label = fraction or "Cent"
				self.assertEqual(self.format(0.01, fraction=fraction), "Uno " + label + ".")
		for field, value, expected in (
			("fraction", "Authored unit", "Uno Authored unit."),
			("fraction_units", 1000, "Dieci Cent."),
			("fraction_units", 5, "USD Zero."),
			("fraction_units", 0, "USD Zero."),
		):
			with self.subTest(field=field), patch.dict(self.currencies["USD"], {field: value}):
				self.assertEqual(self.format(0.01), expected)
		self.currencies["AUTHORED"] = {"fraction": "Cent", "fraction_units": 100}
		self.assertEqual(self.format(0.01, "AUTHORED"), "Uno Cent.")

	def test_authored_display_translations_are_not_overwritten(self):
		for key, value, expected in (
			("Cent:Currency", "Custom unit", "Uno Custom unit."),
			("Cent:Currency", "cent", "Uno cent."),
			("USD:Currency", "Dollari personali", "Uno Cent."),
		):
			with self.subTest(key=key, value=value), patch.dict(self.messages, {key: value}):
				self.assertEqual(self.format(0.01), expected)
		with patch.dict(self.messages, {"USD:Currency": "Dollari personali"}):
			self.assertEqual(self.format(1.01), "Dollari personali Uno e Uno Cent.")

	def test_missing_and_empty_one_and_plural_frames_decline_for_inr_and_egp(self):
		for code, one, many, label in (
			("INR", "One paisa", "{0} paise", "paisa"),
			("EGP", "One piastre", "{0} piastres", "piastra"),
		):
			for source in (one, many):
				key = source + ":Currency fraction wording"
				for empty in (False, True):
					with self.subTest(currency=code, key=key, empty=empty), patch.dict(self.messages):
						if empty:
							self.messages[key] = ""
						else:
							self.messages.pop(key)
						self.assertEqual(self.format(0.01, code), "Uno " + label + ".")
						self.assertEqual(self.format(0.02, code), "Due " + label + ".")
			self.assertEqual(self.format(0.01, code), ("Una paisa." if code == "INR" else "Una piastra."))

	def test_cold_jobs_resolve_language_at_existing_translation_boundary(self):
		for code, expected in (("USD", "Un cent."), ("EGP", "Una piastra."), ("BHD", "Un fils.")):
			with self.subTest(currency=code):
				frappe.local.lang = "en"
				frappe.local.job = frappe._dict(user="translator@example.com", lang_resolved=False)
				self.assertEqual(self.format(1 / self.currencies[code]["fraction_units"], code), expected)
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

	def test_print_language_restores_lazy_job_language(self):
		for user_language, print_lang, expected in (
			("en", "it", "Un cent."),
			("it", "en", "One Cent only."),
		):
			with self.subTest(user=user_language, print_lang=print_lang):
				self.job_language = user_language
				frappe.local.lang = "en"
				frappe.local.job = frappe._dict(user="translator@example.com", lang_resolved=False)
				with print_language(print_lang):
					self.assertEqual(self.format(0.01), expected)
				self.assertEqual(frappe.local.lang, user_language)
				self.assertTrue(frappe.local.job.lang_resolved)

	def test_indian_unsupported_and_alias_locales_keep_legacy_output(self):
		self.indian = True
		self.assertEqual(self.format(0.01), "One Cent.")
		self.indian = False
		for language, expected in (
			("en", "One Cent only."),
			("xx_UNSUPPORTED", "One Cent only."),
			("it-IT", "Uno Cent only."),
			("it_IT", "Uno Cent only."),
		):
			with self.subTest(language=language):
				frappe.local.lang = language
				self.assertEqual(self.format(0.01), expected)

	def test_input_types_use_existing_normalization_without_new_currency_library_modes(self):
		for constructor in (int, float, str, Decimal):
			with self.subTest(type=constructor.__name__):
				self.assertEqual(self.format(constructor(1)), "USD Uno.")
		for amount, normalized, expected in (
			("0.005", "0.01", "Un cent."),
			(Decimal("2.675"), "2.67", "USD Due e sessantasette cent."),
			("24.50", "24.50", "USD Ventiquattro e cinquanta cent."),
			(0.001, "0.001", "Un fils."),
		):
			with self.subTest(amount=amount):
				self.assertEqual(self.format(amount, "BHD" if normalized == "0.001" else "USD"), expected)
				self.assertEqual(self.normalized["n"], normalized)
				self.assertEqual(self.currency_mode_calls, [])

	def test_existing_guards_unsupported_denominations_and_mro_math_are_unchanged(self):
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
		for code, amount, expected in (
			("DZD", 0.01, "Uno Centime."),
			("MRO", 0.5, "Due Khoums."),
			("VND", 24.5, "VND Ventiquattro."),
			("EUR", 1.01, "Un euro e un centesimo."),
		):
			with self.subTest(currency=code):
				self.assertEqual(self.format(amount, code), expected)
