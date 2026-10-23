import sys
from copy import deepcopy
from decimal import Decimal, localcontext
from types import SimpleNamespace
from unittest.mock import patch

import frappe
from frappe.tests import UnitTestCase
from frappe.translate import print_language
from frappe.utils import data


class TestItalianMoneyInWords(UnitTestCase):
	def setUp(self):
		self.messages = {
			"and": "e",
			"Zero": "Zero",
			"Dinars:Currency": "Dinari",
			"{0} only.:Money in words": "{0}.",
			"{0}.:Money in words": "{0}.",
		}
		self.currencies = {
			"EUR": {"fraction": "Cent", "fraction_units": 100},
			"USD": {"fraction": "Cent", "fraction_units": 100},
			"BHD": {"fraction": "Fils", "fraction_units": 1000},
			"MRO": {"fraction": "Khoums", "fraction_units": 5},
			"VND": {"fraction": None, "fraction_units": 0},
			"DZD": {"fraction": "Centime", "fraction_units": 100},
			"CUSTOM-CODE": {"fraction": "Authored unit", "fraction_units": 100},
		}
		self.reads = []
		self.default_currency = "EUR"
		self.indian = False
		self.job_language = "it"
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

	def format(self, amount, currency="EUR", fraction=None):
		self.reads = []
		self.native_calls = []
		self.normalized = {}
		before = deepcopy(self.currencies)

		def profile(frame, event, _value):
			if (
				event == "call"
				and frame.f_code.co_name == "num2words"
				and frame.f_globals.get("__name__") == "num2words"
				and frame.f_locals.get("to") == "currency"
			):
				self.native_calls.append(
					{
						"number": frame.f_locals["number"],
						"lang": frame.f_locals["lang"],
						"currency": frame.f_locals["kwargs"]["currency"],
					}
				)
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

	def assert_native(self, amount, expected, normalized):
		self.assertEqual(self.format(amount), expected)
		self.assertEqual(self.normalized["n"], normalized)
		self.assertEqual(self.native_calls, [{"number": normalized, "lang": "it", "currency": "EUR"}])
		self.assertEqual(
			self.reads,
			[
				("defaults",),
				("Currency", "EUR", "fraction"),
				("Language", "it"),
				("Currency", "EUR", "fraction_units"),
			],
		)

	def test_euro_and_cent_agreement(self):
		for amount, words, normalized in (
			(0, "Zero euro e zero centesimi.", "0.00"),
			(1, "Un euro e zero centesimi.", "1.00"),
			(0.01, "Zero euro e un centesimo.", "0.01"),
			(0.02, "Zero euro e due centesimi.", "0.02"),
			(0.21, "Zero euro e ventun centesimi.", "0.21"),
			(0.5, "Zero euro e cinquanta centesimi.", "0.50"),
			(1.01, "Un euro e un centesimo.", "1.01"),
			(21.21, "Ventun euro e ventun centesimi.", "21.21"),
			(24, "Ventiquattro euro e zero centesimi.", "24.00"),
			(24.5, "Ventiquattro euro e cinquanta centesimi.", "24.50"),
		):
			with self.subTest(amount=amount):
				self.assert_native(amount, words, normalized)

	def test_all_supported_input_types_use_existing_normalized_decimal_string(self):
		for convert in (int, float, str, Decimal):
			with self.subTest(type=convert.__name__):
				self.assert_native(convert(1), "Un euro e zero centesimi.", "1.00")
		for amount, normalized, expected in (
			("0.005", "0.01", "Zero euro e un centesimo."),
			(Decimal("2.675"), "2.67", "Due euro e sessantasette centesimi."),
			("24.50", "24.50", "Ventiquattro euro e cinquanta centesimi."),
		):
			with self.subTest(amount=amount):
				self.assert_native(amount, expected, normalized)

	def test_exact_million_noun_join_and_remainder(self):
		for amount, expected in (
			(1000000, "Un milione di euro e zero centesimi."),
			(1000000.01, "Un milione di euro e un centesimo."),
			(2000000, "Due milioni di euro e zero centesimi."),
			(1000000000, "Un miliardo di euro e zero centesimi."),
			(1200000, "Un milione e duecentomila euro e zero centesimi."),
		):
			with self.subTest(amount=amount):
				self.assert_native(amount, expected, f"{amount:.2f}")

	def test_explicit_and_authored_fraction_labels_retain_existing_output(self):
		for fraction, expected in (
			("Cent", "EUR Uno e Uno Cent."),
			("", "EUR Uno e Uno Cent."),
			("Authored unit", "EUR Uno e Uno Authored unit."),
		):
			with self.subTest(fraction=fraction):
				self.assertEqual(self.format(1.01, fraction=fraction), expected)
				self.assertEqual(self.native_calls, [])
		self.currencies["EUR"]["fraction"] = "Authored unit"
		self.assertEqual(self.format(1.01), "EUR Uno e Uno Authored unit.")
		self.assertEqual(self.native_calls, [])

	def test_custom_translations_are_respected(self):
		for key, target, expected in (
			("Cent:Currency", "cent", "EUR Uno e Uno cent."),
			("Cent:Currency", "Custom unit", "EUR Uno e Uno Custom unit."),
			("EUR:Currency", "Euro personali", "Euro personali Uno e Uno Cent."),
		):
			with self.subTest(key=key, target=target), patch.dict(self.messages, {key: target}):
				self.assertEqual(self.format(1.01), expected)
				self.assertEqual(self.native_calls, [])
		with patch.dict(self.messages, {"Cent:Currency": "Cent", "EUR:Currency": "EUR"}):
			self.assert_native(1.01, "Un euro e un centesimo.", "1.01")

	def test_nonstandard_units_and_foreign_currencies_retain_existing_output(self):
		for units, expected in ((1000, "EUR Uno e Dieci Cent."), (5, "EUR Uno."), (0, "EUR Uno.")):
			with self.subTest(units=units):
				self.currencies["EUR"]["fraction_units"] = units
				self.assertEqual(self.format(1.01), expected)
				self.assertEqual(self.native_calls, [])
		for amount, currency, expected in (
			(0.001, "BHD", "Uno Fils."),
			(0.2, "MRO", "Uno Khoums."),
			(42.01, "VND", "VND Quarantadue."),
			(24.5, "DZD", "Ventiquattro Dinari e Cinquanta Centime."),
			(24.5, "USD", "USD Ventiquattro e Cinquanta Cent."),
			(1.01, "CUSTOM-CODE", "CUSTOM-CODE Uno e Uno Authored unit."),
		):
			with self.subTest(currency=currency):
				self.assertEqual(self.format(amount, currency), expected)
				self.assertEqual(self.native_calls, [])

	def test_indian_format_and_noncanonical_italian_locales_are_unchanged(self):
		self.indian = True
		self.assertEqual(self.format(1.01), "EUR One e One Cent.")
		self.assertEqual(self.native_calls, [])
		self.indian = False
		for language, expected in (
			("en", "EUR One and One Cent only."),
			("xx_UNSUPPORTED", "EUR One and One Cent only."),
			("it-IT", "EUR Uno and Uno Cent only."),
			("it_IT", "EUR Uno and Uno Cent only."),
		):
			with self.subTest(language=language):
				frappe.local.lang = language
				self.assertEqual(self.format(1.01), expected)
				self.assertEqual(self.native_calls, [])

	def test_existing_input_guards_and_exception_types(self):
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

	def test_native_precision_limit_retains_existing_result(self):
		with localcontext() as context:
			context.prec = 3
			self.assertEqual(self.format(24.5), "EUR Ventiquattro e Cinquanta Cent.")
		self.assertEqual(self.native_calls, [{"number": "24.50", "lang": "it", "currency": "EUR"}])
		self.assertEqual(self.normalized["n"], "24.50")
		for amount in (10**26, 10**30):
			with self.subTest(amount=amount):
				words = self.format(amount)
				self.assertEqual(words, "EUR " + data.in_words(self.normalized["main"]).title() + ".")
				self.assertEqual(self.native_calls[0]["number"], self.normalized["n"])

	def test_lazy_job_resolves_language_without_reordering_configuration_reads(self):
		frappe.local.lang = "en"
		frappe.local.job = frappe._dict(user="translator@example.com", lang_resolved=False)
		self.assertEqual(self.format(0.01), "Zero euro e un centesimo.")
		self.assertEqual(frappe.local.lang, "it")
		self.assertTrue(frappe.local.job.lang_resolved)
		self.assertEqual(
			self.reads,
			[
				("defaults",),
				("Currency", "EUR", "fraction"),
				("Language", "en"),
				("Currency", "EUR", "fraction_units"),
				("user_language", "translator@example.com"),
			],
		)

	def test_lazy_job_custom_and_indian_paths_keep_prior_timing(self):
		for indian, fraction, expected in (
			(False, "Authored unit", "One Authored unit."),
			(True, None, "One Cent."),
		):
			with self.subTest(indian=indian, fraction=fraction):
				frappe.local.lang = "en"
				frappe.local.job = frappe._dict(user="translator@example.com", lang_resolved=False)
				self.indian = indian
				self.assertEqual(self.format(0.01, fraction=fraction), expected)
				self.assertEqual(self.native_calls, [])
				self.assertEqual(frappe.local.lang, "it")

	def test_print_language_owns_render_time_language_and_restores_it(self):
		for user_language, print_lang, expected in (
			("en", "it", "Zero euro e un centesimo."),
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
		frappe.local.lang = "en"
		frappe.local.job = None
		with self.assertRaisesRegex(ValueError, "memory failure"), print_language("it"):
			self.assertEqual(self.format(1), "Un euro e zero centesimi.")
			raise ValueError("memory failure")
		self.assertEqual(frappe.local.lang, "en")

	def test_default_currency_and_final_frame_remain_existing_contracts(self):
		self.assertEqual(self.format(1, currency=None), "Un euro e zero centesimi.")
		self.assertEqual(self.native_calls[0]["number"], "1.00")
		with patch.dict(self.messages, {"{0} only.:Money in words": "Importo: {0}"}):
			self.assertEqual(self.format(1), "Importo: Un euro e zero centesimi")
