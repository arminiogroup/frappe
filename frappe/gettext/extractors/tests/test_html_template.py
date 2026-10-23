from io import BytesIO

from babel.messages.extract import extract

from frappe.gettext.extractors.utils import extract_messages_from_code
from frappe.tests import UnitTestCase


class TestHTMLTemplate(UnitTestCase):
	def test_extract_typescript_after_quoted_regular_expression(self):
		code = """import { t as __ } from "./translate";
export function escapeHtml(text: string): string {
  return text.replace(/"/g, "&quot;");
}
export const columns: Array<{label: string}> = [{label: __("ID")}];"""
		self.assertEqual(
			list(extract("frappe.gettext.extractors.html_template.extract", BytesIO(code.encode()))),
			[(5, "ID", [], None)],
		)

	def test_extract_multiline_vue_replacements(self):
		code = """<template>
	<span>{{ __("{0} made {1} changes over {2}", [
		authorName,
		changes.length,
		sessionSpan,
	]) }}</span>
</template>"""
		self.assertEqual(
			list(extract("frappe.gettext.extractors.html_template.extract", BytesIO(code.encode()))),
			[(2, "{0} made {1} changes over {2}", [], None)],
		)

	def test_extract_vue_replacements_without_false_context(self):
		for replacements in (
			"[item_link(item), `<b>${quantity}</b>`]",
			'{item: item_link(item), value: "display"}',
			'[format({items: [item]}), "display"]',
		):
			for context in ("", ', "Stock quantity"'):
				with self.subTest(replacements=replacements, context=context):
					code = f"<p :title=\"__('Quantity {{0}}', {replacements}{context})\" />"
					self.assertEqual(
						extract_messages_from_code(code),
						[[1, "Quantity {0}", "Stock quantity" if context else None]],
					)

	def test_extract_vue_literal_templates_and_nested_calls(self):
		code = """<p>{{ __(`Static template`) }}</p>
<p>{{ __("Outer {0}", [__("Inner")], "Outer context") }}</p>
<p>{{ __(`Dynamic ${value}`) }}</p>
<p>{{ __("After") }}</p>"""
		self.assertEqual(
			extract_messages_from_code(code),
			[
				[1, "Static template", None],
				[2, "Inner", None],
				[2, "Outer {0}", "Outer context"],
				[4, "After", None],
			],
		)

	def test_extract_escaped_unicode_from_vue_attribute(self):
		code = r"""<template>
	<div :title="__('Field \u201c{0}\u201d no longer exists on {1}', [field.fieldname, meta.name])"></div>
</template>"""
		self.assertEqual(
			list(extract("frappe.gettext.extractors.html_template.extract", BytesIO(code.encode()))),
			[(2, "Field “{0}” no longer exists on {1}", [], None)],
		)

	def test_extract_literal_escapes(self):
		cases = [
			(r"""<p>{{ __("Caff\u00e8 gi\u00e0") }}</p>""", "Caffè già"),
			("""<p>{{ __("Caffè già") }}</p>""", "Caffè già"),
			(
				r"""<p>{{ __("Keep literal \\u201c and C:\\new\\file") }}</p>""",
				r"Keep literal \u201c and C:\new\file",
			),
			(r"""<p>{{ __("He said \"Hello\"") }}</p>""", 'He said "Hello"'),
			(r"""<p>{{ __('It\'s ready') }}</p>""", "It's ready"),
			(r"""<p>{{ __("Line one\nLine two\tend") }}</p>""", "Line one\nLine two\tend"),
			(r'''<p>{{ _("""Triple \u201cquote\u201d""") }}</p>''', "Triple “quote”"),
		]
		for code, message in cases:
			with self.subTest(code=code):
				self.assertEqual(extract_messages_from_code(code), [[1, message, None]])

	def test_extract_escaped_context(self):
		cases = [
			(r"""<p>{{ __('State', null, 'Caf\u00e8') }}</p>""", "Cafè"),
			(r"""<p>{{ _('State', context='Caf\u00e8') }}</p>""", "Cafè"),
			(r"""<p>{{ __('State', null, 'A \'quoted\' context') }}</p>""", "A 'quoted' context"),
		]
		for code, context in cases:
			with self.subTest(code=code):
				self.assertEqual(
					list(extract("frappe.gettext.extractors.html_template.extract", BytesIO(code.encode()))),
					[(1, "State", [], context)],
				)
