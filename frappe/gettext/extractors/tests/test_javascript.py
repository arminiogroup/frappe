import csv
from io import BytesIO
from pathlib import Path

from babel.messages.extract import extract
from babel.util import pathmatch

from frappe.gettext.extractors.javascript import extract_javascript
from frappe.tests import UnitTestCase
from frappe.translate import extract_messages_from_javascript_code


class TestJavaScript(UnitTestCase):
	def test_framework_typescript_mapping_is_runtime_only(self):
		path = Path(__file__).parents[4] / "babel_extractors.csv"
		with path.open() as file:
			methods = list(csv.reader(file))
		for filename, expected in {
			"ui/src/components/ActivityTimeline/liveUpdates.ts": "frappe.gettext.extractors.javascript.extract_typescript",
			"ui/src/components/DataImport/importProgress.ts": "frappe.gettext.extractors.javascript.extract_typescript",
			"ui/src/components/Filter/tests/operators.test.ts": "ignore",
			"ui/src/telemetry/telemetry.test.ts": "ignore",
			"ui/src/components/ConditionBuilder/stories/fields.ts": "ignore",
			"ui/src/generated.d.ts": "ignore",
			"other/package.ts": None,
		}.items():
			with self.subTest(filename=filename):
				method = next((method for pattern, method in methods if pathmatch(pattern, filename)), None)
				self.assertEqual(method, expected)

	def test_typescript_mapping_ignores_examples_and_preserves_regex_following_calls(self):
		path = Path(__file__).parents[4] / "babel_extractors.csv"
		with path.open() as file:
			method = next(
				method for pattern, method in csv.reader(file) if pathmatch(pattern, "ui/src/audit.ts")
			)
		code = r"""/** Example: { label: __("JSDoc sample") } */
const sample = '__("String sample")';
function escapeHtml(text: string) { return text.replace(/"/g, "&quot;"); }
const labels: Array<{label: string}> = [{label: __("ID")}];
const label = __("Typed {0}", [escapeHtml(name)], "Field");
// __("Comment sample")
"""
		self.assertEqual(
			list(extract(method, BytesIO(code.encode()))),
			[(4, "ID", [], None), (5, "Typed {0}", [], "Field")],
		)

	def test_extract_typescript_canonical_binding(self):
		code = """import { t as __ } from './translate';
type Row = { name: string };
function label(row: Row): string {
  return __('Typed {0}', [format<Row>(row)], 'Row context');
}
t('Unrelated function');
translate('Another unrelated function');"""
		self.assertEqual(list(extract_javascript(code)), [(4, "__", ("Typed {0}", None, "Row context"))])

	def test_dynamic_template_messages_are_not_static_catalog_keys(self):
		for code in (
			"__(`{0} ${type}`, [target]);",
			'__(`{0} ${skip_list ? "" : type}`, [target]);',
			'__(`Dynamic ${value}`, null, "Context");',
			'__(`Dynamic ${value}` + " suffix");',
			'__("prefix " + `Dynamic ${value}`);',
			"__`Dynamic ${value}`;",
		):
			with self.subTest(code=code):
				self.assertEqual(list(extract_javascript(code)), [])

		self.assertEqual(
			list(extract_javascript('__(`Outer ${__("Inner")}`);')),
			[(1, "__", "Inner")],
		)
		self.assertEqual(
			list(extract_javascript(r"__(`Literal \${value}`);")), [(1, "__", "Literal ${value}")]
		)
		self.assertEqual(list(extract_javascript("__(`Static message`);")), [(1, "__", "Static message")])
		self.assertEqual(
			list(extract_javascript('__("Static", null, `Dynamic ${context}`);')),
			[(1, "__", ("Static", None))],
		)
		self.assertEqual(
			list(extract_javascript('__("Outer {0}", [`${__("Inner")}`], "Context");')),
			[(1, "__", "Inner"), (1, "__", ("Outer {0}", None, "Context"))],
		)

	def test_extract_javascript(self):
		code = "let test = `<p>${__('Test')}</p>`;"
		self.assertEqual(
			next(extract_javascript(code)),
			(1, "__", "Test"),
		)

		code = "let test = `<p>${__('Test', null, 'Context')}</p>`;"
		self.assertEqual(
			next(extract_javascript(code)),
			(1, "__", ("Test", None, "Context")),
		)

	def test_extract_javascript_from_template_literal_attribute(self):
		code = "let test = `<button title=\"${__('In attribute')}\">${__('In text')}</button>`;"
		self.assertEqual(
			list(extract_javascript(code)),
			[(1, "__", "In attribute"), (1, "__", "In text")],
		)

	def test_extract_javascript_template_literal_multiline_line_numbers(self):
		code = "let test = `\n<button title=\"${__('In attribute')}\">\n  ${__('In text')}\n</button>\n`;"
		self.assertEqual(
			list(extract_javascript(code)),
			[(2, "__", "In attribute"), (3, "__", "In text")],
		)

	def test_extract_javascript_nested_calls(self):
		code = "__('Open {0}', [__('Email Inbox')]);"
		self.assertEqual(
			list(extract_javascript(code)),
			[(1, "__", "Email Inbox"), (1, "__", "Open {0}")],
		)

		code = "__('{0} of {1}', [__('Sales Invoice'), __('Customer')], 'Breadcrumb');"
		self.assertEqual(
			list(extract_javascript(code)),
			[
				(1, "__", "Sales Invoice"),
				(1, "__", "Customer"),
				(1, "__", ("{0} of {1}", None, "Breadcrumb")),
			],
		)

		code = "__('{0}: Other permission rules may also apply', [frappe.bold(__('Note'))]);"
		self.assertEqual(
			list(extract_javascript(code)),
			[(1, "__", "Note"), (1, "__", "{0}: Other permission rules may also apply")],
		)

	def test_extract_javascript_nested_replacement_containers(self):
		message = "Quantity for Item {0} must be greater than zero and cannot exceed {1}"
		replacements = [
			"[item_link(invalid_qty), `<b>${pending_qty}</b>`]",
			"{item: item_link(invalid_qty), quantity: `<b>${pending_qty}</b>`}",
			'[format({values: nested([invalid_qty])}), ["ignored", {value: "also ignored"}]]',
			'[item_link(invalid_qty), format(pending_qty), "ignored"]',
		]
		for replacement in replacements:
			with self.subTest(replacement=replacement):
				code = f'__("{message}", {replacement});'
				self.assertEqual(list(extract_javascript(code)), [(1, "__", message)])

			with self.subTest(replacement=replacement, context=True):
				code = f'__("{message}", {replacement}, "Quantity validation");'
				self.assertEqual(
					list(extract_javascript(code)),
					[(1, "__", (message, None, "Quantity validation"))],
				)

	def test_extract_javascript_nested_translation_in_replacement_call(self):
		code = '__ ("Outer {0} {1}", [format(__("Inner")), "ignored"], "Outer context");'
		self.assertEqual(
			list(extract_javascript(code)),
			[(1, "__", "Inner"), (1, "__", ("Outer {0} {1}", None, "Outer context"))],
		)

		code = (
			'__("Outer {0} {1}", [format(__("Inner", null, "Inner context")), "ignored"], "Outer context");'
		)
		self.assertEqual(
			list(extract_javascript(code)),
			[
				(1, "__", ("Inner", None, "Inner context")),
				(1, "__", ("Outer {0} {1}", None, "Outer context")),
			],
		)

	def test_replacement_values_are_not_message_context(self):
		message = "Quantity for Item {0} must be greater than zero and cannot exceed {1}"
		code = f'__("{message}", [item_link(invalid_qty), `<b>${{pending_qty}}</b>`]);'
		self.assertEqual(
			list(extract("frappe.gettext.extractors.javascript.extract", BytesIO(code.encode()))),
			[(1, message, [], None)],
		)
		self.assertEqual(extract_messages_from_javascript_code(code), [(1, message, None)])

	def test_explicit_context_after_replacement_call(self):
		code = '__("Quantity {0}", [format(value), "ignored"], "Stock quantity");'
		self.assertEqual(
			list(extract("frappe.gettext.extractors.javascript.extract", BytesIO(code.encode()))),
			[(1, "Quantity {0}", [], "Stock quantity")],
		)
		self.assertEqual(
			extract_messages_from_javascript_code(code),
			[(1, "Quantity {0}", "Stock quantity")],
		)
