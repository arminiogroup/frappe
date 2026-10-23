import textwrap
from io import BytesIO

from babel.messages.extract import extract, extract_python

from frappe.gettext.translate import PYTHON_KEYWORDS
from frappe.tests import UnitTestCase


class TestPython(UnitTestCase):
	def test_dynamic_messages_do_not_extract_subscript_keys_or_fragments(self):
		code = textwrap.dedent(
			"""
			_(app_detail["setup_wizard_text"])
			_(entry["title"])
			_(name or "fallback")
			_("Prefix " + name)
			_(entry["title"], context="Dock")
			_(entry["title"]) + _("Visible", context="Label")
			_("Static " + "message")
			_("Adjacent " "literals")
			"""
		)
		messages = extract(
			"frappe.gettext.extractors.python.extract", BytesIO(code.encode()), keywords=PYTHON_KEYWORDS
		)
		self.assertEqual(
			[(line, message, context) for line, message, _comments, context in messages],
			[
				(4, "fallback", None),
				(7, "Visible", "Label"),
				(8, "Static message", None),
				(9, "Adjacent literals", None),
			],
		)

	def test_extract_noop_context(self):
		code = textwrap.dedent(
			"""
			N_("Plain")
			N_("Keyword", context="keywordctx")
			N_("Positional", "positionalctx")
			N_("No context", None)
			N_("Dynamic", context=variable)
			N_("Dup") if flag else N_("Dup", context="dupctx")
			_("Mixed", "de") + N_("Mixed", "noopctx") + _lt("Mixed", "de", "lazyctx")
			N_(
				"Multi line",
				context="multictx",
			)
		"""
		)
		messages = extract(
			"frappe.gettext.extractors.python.extract", BytesIO(code.encode()), keywords=PYTHON_KEYWORDS
		)

		self.assertEqual(
			[(line, message, context) for line, message, _comments, context in messages],
			[
				(2, "Plain", None),
				(3, "Keyword", "keywordctx"),
				(4, "Positional", "positionalctx"),
				(5, "No context", None),
				(6, "Dynamic", None),
				(7, "Dup", None),
				(7, "Dup", "dupctx"),
				(8, "Mixed", None),
				(8, "Mixed", "noopctx"),
				(8, "Mixed", "lazyctx"),
				(10, "Multi line", "multictx"),
			],
		)

	def test_extract_noop(self):
		messages = list(
			extract_python(
				BytesIO(b'N_("Created On")\n_lt("Last Updated On")'),
				keywords=PYTHON_KEYWORDS,
				comment_tags=(),
				options={},
			)
		)

		self.assertEqual(
			[(line, function, message) for line, function, message, _comments in messages],
			[(1, "N_", "Created On"), (2, "_lt", "Last Updated On")],
		)

	def test_extract_context(self):
		code = textwrap.dedent(
			"""
			_("Anxious Anaximander", lang="de")
			_("With context", context="ctx")
			_("Positional", "de", "greeting")
			_lt("Lazy", context="lazyctx")
			_(
				"Multi line",
				context="multictx",
			)
			_("Dup") if flag else _("Dup", context="dupctx")
			_("First", context="firstctx") + _("Second")
			_("A", "de") if flag else _("B", context="ctx")
			_("Both keywords", context="bothctx", lang="de")
		"""
		)
		messages = extract(
			"frappe.gettext.extractors.python.extract", BytesIO(code.encode()), keywords=PYTHON_KEYWORDS
		)

		self.assertEqual(
			[(line, message, context) for line, message, _comments, context in messages],
			[
				(2, "Anxious Anaximander", None),
				(3, "With context", "ctx"),
				(4, "Positional", "greeting"),
				(5, "Lazy", "lazyctx"),
				(7, "Multi line", "multictx"),
				(10, "Dup", None),
				(10, "Dup", "dupctx"),
				(11, "First", "firstctx"),
				(11, "Second", None),
				(12, "A", None),
				(12, "B", "ctx"),
				(13, "Both keywords", "bothctx"),
			],
		)
