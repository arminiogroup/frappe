# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# License: MIT. See LICENSE

import inspect
import json
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

import frappe
from frappe.printing.page.print.print import get_print_styles
from frappe.tests import UnitTestCase

TARGETS = {
	"Redesign:Print Style": "Rinnovato",
	"Modern:Print Style": "Moderno",
	"Classic:Print Style": "Classico",
	"Striped:Print Style": "Righe alternate",
	"Monochrome:Print Style": "Monocromatico",
}
STANDARD_NAMES = ("Redesign", "Modern", "Classic", "Striped", "Monochrome")


class NoDatabase:
	def __bool__(self):
		return False

	def __getattr__(self, name):
		def blocked(*args, **kwargs):
			raise AssertionError(f"Unexpected database operation: {name}")

		return blocked


class TestPrintStyleNames(UnitTestCase):
	def setUp(self):
		self.enterContext(patch.object(frappe, "in_test", True))
		self.addCleanup(frappe.set_user, frappe.session.user)
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.set_user("translator@example.com")
		frappe.local.lang = "it"
		self.messages = dict(TARGETS)
		self.calls = []
		self.rows = []
		for name in STANDARD_NAMES:
			path = Path(
				frappe.get_app_path("frappe", "printing", "print_style", name.lower(), name.lower() + ".json")
			)
			row = json.loads(path.read_text())
			self.assertEqual(row["name"], name)
			self.assertEqual(row["standard"], 1)
			self.assertEqual(row["disabled"], 0)
			self.rows.append(row)
		self.enterContext(patch.object(frappe, "db", NoDatabase()))
		self.enterContext(patch.object(frappe, "get_all", side_effect=self.get_all))
		self.enterContext(
			patch(
				"frappe.translate.get_all_translations",
				side_effect=lambda lang: self.messages if lang == "it" else {},
			)
		)

	def get_all(self, doctype, **kwargs):
		self.calls.append((doctype, deepcopy(kwargs)))
		self.assertEqual(doctype, "Print Style")
		filters = kwargs["filters"]
		names = None
		if "name" in filters:
			self.assertEqual(set(filters), {"disabled", "name"})
			self.assertEqual(filters["disabled"], 0)
			operator, names = filters["name"]
			self.assertEqual(operator, "in")
			self.assertLessEqual(len(names), 10)
			self.assertEqual(kwargs["limit_page_length"], len(names))
		else:
			self.assertEqual(filters, {"disabled": 0})
			self.assertNotIn("limit_page_length", kwargs)
		self.assertEqual(kwargs["order_by"], "creation asc")
		rows = sorted(
			(row for row in self.rows if not row["disabled"] and (names is None or row["name"] in names)),
			key=lambda row: row["creation"],
		)
		if names is not None:
			rows = rows[: kwargs["limit_page_length"]]
		expected = {"filters", "order_by"} | ({"limit_page_length"} if names is not None else set())
		if "pluck" in kwargs:
			self.assertEqual(set(kwargs), expected | {"pluck"})
			self.assertEqual(kwargs["pluck"], "name")
			return [row["name"] for row in rows]
		self.assertEqual(set(kwargs), expected | {"fields"})
		self.assertEqual(kwargs["fields"], ["name", "standard"])
		return [frappe._dict({field: row[field] for field in kwargs["fields"]}) for row in rows]

	def labelled(self, value=True):
		try:
			return get_print_styles(with_labels=value)
		except TypeError as error:
			if "with_labels" not in inspect.signature(
				get_print_styles
			).parameters and "unexpected keyword argument 'with_labels'" in str(error):
				self.fail("The endpoint does not yet accept the optional labelled-response argument")
			raise

	def ordered_names(self):
		return [
			row["name"] for row in sorted(self.rows, key=lambda row: row["creation"]) if not row["disabled"]
		]

	def test_default_no_argument_query_and_string_response_are_unchanged(self):
		before = deepcopy(self.rows)
		self.assertEqual(get_print_styles(), self.ordered_names())
		self.assertEqual(
			self.calls,
			[("Print Style", {"filters": {"disabled": 0}, "pluck": "name", "order_by": "creation asc"})],
		)
		self.assertEqual(self.rows, before)

	def test_explicit_false_preserves_the_default_query_and_string_result(self):
		self.assertEqual(self.labelled(False), self.ordered_names())
		self.assertEqual(
			self.calls,
			[("Print Style", {"filters": {"disabled": 0}, "pluck": "name", "order_by": "creation asc"})],
		)

	def test_opt_in_labels_only_the_five_actual_standard_records(self):
		before = deepcopy(self.rows)
		result = self.labelled()
		self.assertEqual(
			result, [{"name": name, "label": TARGETS[name + ":Print Style"]} for name in self.ordered_names()]
		)
		self.assertEqual(self.rows, before)
		self.assertEqual(
			self.calls,
			[
				(
					"Print Style",
					{"filters": {"disabled": 0}, "fields": ["name", "standard"], "order_by": "creation asc"},
				)
			],
		)

	def test_nonstandard_canonical_name_is_not_translated(self):
		row = next(row for row in self.rows if row["name"] == "Classic")
		row["standard"] = 0
		self.messages["Classic"] = "Wrong global custom-name translation"
		result = {row["name"]: row["label"] for row in self.labelled()}
		self.assertEqual(result["Classic"], "Classic")
		self.assertEqual(result["Modern"], "Moderno")

	def test_custom_unknown_and_markup_names_remain_exact_even_with_dictionary_collisions(self):
		custom = ["Authored <style> & title", "Unknown standard style"]
		for index, name in enumerate(custom):
			self.rows.append(
				{"name": name, "standard": index, "disabled": 0, "creation": f"2026-10-2{index} 00:00:00"}
			)
			self.messages[name] = "Wrong global name"
			self.messages[name + ":Print Style"] = "Wrong contextual name"
		before = deepcopy(self.rows)
		result = {row["name"]: row["label"] for row in self.labelled()}
		for name in custom:
			self.assertEqual(result[name], name)
		self.assertEqual(self.rows, before)

	def test_disabled_filter_and_creation_order_apply_equally_to_both_response_modes(self):
		self.rows[0]["disabled"] = 1
		self.rows.append(
			{"name": "First custom style", "standard": 0, "disabled": 0, "creation": "2000-01-01 00:00:00"}
		)
		self.rows.append(
			{"name": "Disabled custom style", "standard": 0, "disabled": 1, "creation": "1999-01-01 00:00:00"}
		)
		before = deepcopy(self.rows)
		plain = get_print_styles()
		labelled = self.labelled()
		self.assertEqual([row["name"] for row in labelled], plain)
		self.assertEqual(plain[0], "First custom style")
		self.assertNotIn("Redesign", plain)
		self.assertNotIn("Disabled custom style", plain)
		self.assertEqual(self.rows, before)

	def test_context_overrides_global_only_for_owned_standard_labels(self):
		for name in STANDARD_NAMES:
			self.messages[name] = "Wrong global interpretation"
		self.assertEqual(
			{row["name"]: row["label"] for row in self.labelled()},
			{name: TARGETS[name + ":Print Style"] for name in STANDARD_NAMES},
		)

	def test_english_and_missing_or_empty_translations_keep_canonical_name_fallback(self):
		for lang, messages in (("en", TARGETS), ("it", {}), ("it", {key: "" for key in TARGETS})):
			with self.subTest(lang=lang, messages=messages):
				frappe.local.lang = lang
				self.messages = messages
				self.assertEqual(
					self.labelled(), [{"name": name, "label": name} for name in self.ordered_names()]
				)

	def test_existing_global_fallback_is_retained_when_the_new_context_is_absent(self):
		self.messages = {"Striped": "Righe alternate"}
		self.assertEqual(
			{row["name"]: row["label"] for row in self.labelled()},
			{name: "Righe alternate" if name == "Striped" else name for name in STANDARD_NAMES},
		)

	def bounded(self, names, with_labels=True):
		self.assertIn(
			"names",
			inspect.signature(get_print_styles).parameters,
			"The endpoint does not yet accept a bounded list of style names",
		)
		return get_print_styles(with_labels=with_labels, names=names)

	def test_bounded_names_keep_creation_order_and_limit_the_exact_query_without_mutating_input(self):
		names = ["Modern", "Classic", "Classic"]
		before = deepcopy(names)
		result = self.bounded(names)
		self.assertEqual(names, before)
		self.assertEqual(
			[row["name"] for row in result], [name for name in self.ordered_names() if name in names]
		)
		self.assertEqual(
			self.calls,
			[
				(
					"Print Style",
					{
						"filters": {"disabled": 0, "name": ["in", ["Modern", "Classic"]]},
						"fields": ["name", "standard"],
						"order_by": "creation asc",
						"limit_page_length": 2,
					},
				)
			],
		)
		self.assertEqual(
			{row["name"]: row["label"] for row in result}, {"Modern": "Moderno", "Classic": "Classico"}
		)

	def test_bounded_collision_names_remain_raw_and_disabled_or_nonstandard_records_are_not_translated(self):
		for row in self.rows:
			if row["name"] == "Classic":
				row["standard"] = 0
			if row["name"] == "Monochrome":
				row["disabled"] = 1
		self.rows.extend(
			[
				{"name": "Classico", "standard": 0, "disabled": 0, "creation": "2000-01-01"},
				{"name": "Unrelated custom", "standard": 0, "disabled": 0, "creation": "2000-01-02"},
				{"name": "Moderno", "standard": 0, "disabled": 1, "creation": "2000-01-03"},
			]
		)
		names = [*STANDARD_NAMES, *(TARGETS[name + ":Print Style"] for name in STANDARD_NAMES)]
		before = deepcopy(self.rows)
		result = {row["name"]: row["label"] for row in self.bounded(names)}
		self.assertEqual(result["Classic"], "Classic")
		self.assertEqual(result["Classico"], "Classico")
		self.assertEqual(result["Modern"], "Moderno")
		self.assertNotIn("Monochrome", result)
		self.assertNotIn("Moderno", result)
		self.assertNotIn("Unrelated custom", result)
		self.assertEqual(self.rows, before)

	def test_bounded_json_list_and_plain_response_keep_raw_canonical_identity(self):
		self.assertEqual(
			self.bounded('["Classic", "Modern"]', with_labels=False),
			[name for name in self.ordered_names() if name in ("Classic", "Modern")],
		)
		self.assertEqual(self.calls[0][1]["limit_page_length"], 2)
		self.assertEqual(self.calls[0][1]["pluck"], "name")

	def test_bounded_empty_list_reads_nothing_in_either_response_mode(self):
		self.assertEqual(self.bounded([]), [])
		self.assertEqual(self.bounded("[]", with_labels=False), [])
		self.assertEqual(self.calls, [])

	def test_bounded_ten_names_return_at_most_ten_despite_unrelated_custom_population(self):
		captions = [TARGETS[name + ":Print Style"] for name in STANDARD_NAMES]
		for index, name in enumerate([*captions, *(f"Authored {n}" for n in range(100))]):
			self.rows.append({"name": name, "standard": 0, "disabled": 0, "creation": str(index)})
		result = self.bounded([*STANDARD_NAMES, *captions])
		self.assertEqual(len(result), 10)
		self.assertEqual({row["name"] for row in result}, {*STANDARD_NAMES, *captions})
		self.assertEqual(self.calls[0][1]["limit_page_length"], 10)

	def test_bounded_whitelist_rejects_wrong_raw_types_before_query(self):
		for names in ({}, 1, True, ["Classic", None], ["Classic", 1], [["Classic"]]):
			with self.subTest(names=names):
				with self.assertRaises(frappe.FrappeTypeError):
					self.bounded(names)
				self.assertEqual(self.calls, [])
		self.assertEqual(self.calls, [])

	def test_bounded_body_rejects_decoded_shapes_members_and_overlong_lists_before_query(self):
		for names in (
			"{}",
			"not json",
			'"Classic"',
			"null",
			"1",
			"true",
			'["Classic", null]',
			'["Classic", 1]',
			'[["Classic"]]',
			["Classic"] * 11,
			json.dumps(["Classic"] * 11),
		):
			with self.subTest(names=names):
				with self.assertRaises(frappe.ValidationError):
					self.bounded(names)
				self.assertEqual(self.calls, [])
		self.assertEqual(self.calls, [])
