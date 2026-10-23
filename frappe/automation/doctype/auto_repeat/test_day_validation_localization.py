from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from babel.messages.extract import extract

import frappe
from frappe.automation.doctype.assignment_rule.assignment_rule import get_repeated
from frappe.automation.doctype.auto_repeat import auto_repeat
from frappe.gettext.translate import PYTHON_KEYWORDS
from frappe.tests import UnitTestCase

MESSAGE = "Auto repeat has duplicate days: {0}."
WEEKDAYS = {
	"Monday": "Lunedì",
	"Tuesday": "Martedì",
	"Wednesday": "Mercoledì",
	"Thursday": "Giovedì",
	"Friday": "Venerdì",
	"Saturday": "Sabato",
	"Sunday": "Domenica",
}


class TestDayValidationLocalization(UnitTestCase):
	def setUp(self):
		self.addCleanup(frappe.set_user, frappe.session.user)
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.set_user("translator@example.com")
		frappe.local.lang = "it"
		self.enterContext(patch.dict(frappe.flags, mute_messages=True))
		self.keys = set()
		for method, path in [
			("python", Path(auto_repeat.__file__)),
			(
				"doctype",
				Path(
					frappe.get_app_path(
						"frappe", "automation", "doctype", "auto_repeat_day", "auto_repeat_day.json"
					)
				),
			),
		]:
			with path.open("rb") as source:
				self.keys.update(
					message
					for _, message, _, context in extract(
						f"frappe.gettext.extractors.{method}.extract", source, keywords=PYTHON_KEYWORDS
					)
					if context is None
				)
		dictionary = {**WEEKDAYS, MESSAGE: "La ripetizione automatica contiene giorni duplicati: {0}."}
		self.enterContext(
			patch(
				"frappe.translate.get_all_translations",
				return_value={key: value for key, value in dictionary.items() if key in self.keys},
			)
		)

	@staticmethod
	def make_repeat(days):
		doc = auto_repeat.AutoRepeat.__new__(auto_repeat.AutoRepeat)
		doc.__dict__.update(frequency="Weekly", repeat_on_days=[frappe._dict(day=day) for day in days])
		return doc

	def test_single_duplicate_uses_complete_message_and_translated_weekday(self):
		doc = self.make_repeat(["Monday", "Tuesday", "Monday"])
		before = deepcopy(doc.repeat_on_days)
		with self.assertRaises(frappe.ValidationError) as error:
			doc.validate_auto_repeat_days()
		self.assertEqual(
			str(error.exception),
			"La ripetizione automatica contiene giorni duplicati: <strong>Lunedì</strong>.",
		)
		self.assertEqual(doc.repeat_on_days, before)
		self.assertEqual(frappe.session.user, "translator@example.com")

	def test_multiple_duplicates_preserve_helper_order_emphasis_and_canonical_rows(self):
		days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Monday", "Tuesday", "Monday", "Wednesday"]
		doc = self.make_repeat(days)
		before = deepcopy(doc.repeat_on_days)
		with self.assertRaises(frappe.ValidationError) as error:
			doc.validate_auto_repeat_days()
		expected_days = ", ".join(WEEKDAYS[day] for day in get_repeated(days))
		self.assertEqual(
			str(error.exception),
			f"La ripetizione automatica contiene giorni duplicati: <strong>{expected_days}</strong>.",
		)
		self.assertEqual(doc.get_auto_repeat_days(), days)
		self.assertEqual(doc.repeat_on_days, before)

	def test_empty_single_and_unique_weekdays_are_still_valid(self):
		for days in [[], ["Monday"], list(WEEKDAYS)]:
			with self.subTest(days=days):
				doc = self.make_repeat(days)
				self.assertIsNone(doc.validate_auto_repeat_days())
				self.assertEqual(doc.get_auto_repeat_days(), days)

	def test_weekly_offset_uses_canonical_weekdays_after_validation(self):
		doc = self.make_repeat(["Tuesday", "Friday"])
		doc.validate_auto_repeat_days()
		self.assertEqual(doc.get_offset_for_weekly_frequency("2026-10-19"), 1)
		self.assertEqual(doc.get_auto_repeat_days(), ["Tuesday", "Friday"])

	def test_configured_extraction_registers_whole_message_and_weekdays(self):
		self.assertIn(MESSAGE, self.keys)
		self.assertTrue(set(WEEKDAYS) <= self.keys)
		self.assertNotIn("Auto Repeat Day{0} {1} has been repeated.", self.keys)
