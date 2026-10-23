import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from babel.messages.extract import extract_from_dir

import frappe
from frappe.gettext.translate import PYTHON_KEYWORDS, get_method_map
from frappe.tests import UnitTestCase


class TestNavbar(UnitTestCase):
	def setUp(self):
		self.addCleanup(frappe.set_user, frappe.session.user)
		frappe.set_user("translator@example.com")

	def extract_hooks(self, source, module):
		with tempfile.TemporaryDirectory() as directory:
			hooks = Path(directory) / "example" / "hooks.py"
			hooks.parent.mkdir()
			hooks.write_text(source)
			with patch("frappe.gettext.extractors.navbar.get_module", return_value=module):
				return list(extract_from_dir(directory, get_method_map("frappe"), keywords=PYTHON_KEYWORDS))

	def test_configured_hooks_dispatch_extracts_explicit_python_messages_and_contexts(self):
		messages = self.extract_hooks(
			'N_("Intro")\nN_("Event", context="Activity")\n_("Visible")\n'
			'_(record["name"])\ncaption = "Unmarked"\n',
			SimpleNamespace(),
		)
		self.assertEqual(
			[(filename, line, message, context) for filename, line, message, comments, context in messages],
			[
				("example/hooks.py", 1, "Intro", None),
				("example/hooks.py", 2, "Event", "Activity"),
				("example/hooks.py", 3, "Visible", None),
			],
		)

	def test_existing_navbar_and_help_labels_comments_and_empty_filter_are_preserved(self):
		module = SimpleNamespace(
			standard_navbar_items=[
				{"item_label": "Existing navbar", "item_type": "Route"},
				{"item_label": "", "item_type": "Route"},
			],
			standard_help_items=[{"item_label": "Existing help", "item_type": "Action"}],
		)
		messages = self.extract_hooks('caption = "Unmarked"\n', module)
		self.assertEqual(
			[(message, comments, context) for filename, line, message, comments, context in messages],
			[
				("Existing navbar", ["Label of a standard navbar item", "Type: Route"], None),
				("Existing help", ["Label of a standard help item", "Type: Action"], None),
			],
		)
