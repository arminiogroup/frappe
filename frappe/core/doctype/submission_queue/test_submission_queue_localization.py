from types import SimpleNamespace
from unittest.mock import Mock, patch

import frappe
from frappe.core.doctype.submission_queue import submission_queue
from frappe.tests import UnitTestCase


class TestSubmissionQueueLocalization(UnitTestCase):
	def setUp(self):
		super().setUp()
		self.addCleanup(frappe.set_user, frappe.session.user)
		frappe.set_user("translator@example.com")
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.local.lang = "it"
		self.enterContext(patch.object(submission_queue, "now", return_value="2026-01-01 00:00:01"))
		self.db = Mock()
		self.enterContext(patch.object(frappe.local, "db", self.db, create=True))
		self.enterContext(
			patch(
				"frappe.translate.get_all_translations",
				return_value={
					"Submit": "Conferma",
					"Cancel": "Annulla",
					"Update": "Aggiorna",
					"here": "qui",
					"Sales Order": "Ordine di vendita",
					"Queued for {0}. You can track the progress over {1}.": "Operazione «{0}» accodata. Avanzamento: {1}.",
					"This document has already been queued for {0}. You can track the progress over {1}.": "Il documento è già in coda per «{0}». Avanzamento: {1}.",
					"Action {0} completed successfully on {1} {2}. View it {3}": "Operazione «{0}» completata su {1} {2}. Dettagli: {3}",
					"Action {0} failed on {1} {2}. View it {3}": "Operazione «{0}» non riuscita su {1} {2}. Dettagli: {3}",
				},
			)
		)
		self.doc = SimpleNamespace(doctype="Sales Order", name="ORDER-LOCALIZATION")
		self.queue = SimpleNamespace(
			doctype="Submission Queue",
			name="QUEUE-LOCALIZATION",
			ref_doctype=self.doc.doctype,
			ref_docname=self.doc.name,
			created_at="2026-01-01 00:00:00",
			enqueued_by="translator@example.com",
			insert=Mock(),
		)
		self.enterContext(patch.object(frappe, "new_doc", return_value=self.queue))
		self.msgprint = self.enterContext(patch.object(frappe, "msgprint"))
		self.publish = self.enterContext(patch.object(frappe, "publish_realtime"))
		self.enqueue = self.enterContext(patch.object(submission_queue, "enqueue_create_notification"))

	def test_new_and_existing_queue_translate_display_but_preserve_raw_action(self):
		for action, caption in (
			("Submit", "Conferma"),
			("Cancel", "Annulla"),
			("Update", "Aggiorna"),
			("submit", "Conferma"),
			("custom_action", "custom_action"),
		):
			for existing in (False, True):
				with self.subTest(action=action, existing=existing):
					self.queue.insert.reset_mock()
					self.db.get_value.return_value = self.queue.name if existing else None
					submission_queue.queue_submission(self.doc, action)
					message = self.msgprint.call_args.args[0]
					self.assertIn(f"«{caption}»", message)
					self.assertIn(
						"<a href='/desk/submission-queue/QUEUE-LOCALIZATION'><b>qui</b></a>", message
					)
					self.assertEqual(self.queue.ref_doctype, "Sales Order")
					self.assertEqual(self.queue.ref_docname, "ORDER-LOCALIZATION")
					if existing:
						self.queue.insert.assert_not_called()
					else:
						self.queue.insert.assert_called_once_with(self.doc, action)

	def test_suppressed_alert_still_inserts_the_original_action(self):
		self.db.get_value.return_value = None
		submission_queue.queue_submission(self.doc, "Update", alert=False)
		self.msgprint.assert_not_called()
		self.queue.insert.assert_called_once_with(self.doc, "Update")

	def test_notify_localizes_both_delivery_modes_and_preserves_notification_targets(self):
		for action, caption in (
			("Submit", "Conferma"),
			("Cancel", "Annulla"),
			("Update", "Aggiorna"),
			("submit", "Conferma"),
			("custom_action", "custom_action"),
		):
			for status in ("Finished", "Failed"):
				for delayed in (False, True):
					with self.subTest(status=status, delayed=delayed):
						self.publish.reset_mock()
						self.enqueue.reset_mock()
						self.db.get_value.return_value = "translator@example.com"
						with patch.object(
							submission_queue, "time_diff_in_seconds", return_value=61 if delayed else 60
						):
							submission_queue.SubmissionQueue.notify(self.queue, status, action)
						if delayed:
							self.publish.assert_not_called()
							users, notification = self.enqueue.call_args.args
							self.assertEqual(users, ["translator@example.com"])
							self.assertEqual(notification["type"], "Alert")
							message = notification["subject"]
							self.assertTrue(message.endswith("qui"))
							self.assertEqual(
								notification["document_type"],
								"Submission Queue" if status == "Failed" else "Sales Order",
							)
							self.assertEqual(
								notification["document_name"],
								"QUEUE-LOCALIZATION" if status == "Failed" else "ORDER-LOCALIZATION",
							)
						else:
							self.enqueue.assert_not_called()
							self.assertEqual(self.publish.call_args.args[0], "msgprint")
							payload = self.publish.call_args.args[1]
							message = payload["message"]
							self.assertEqual(payload["indicator"], "red" if status == "Failed" else "green")
							self.assertEqual(self.publish.call_args.kwargs["user"], "translator@example.com")
							path = (
								"submission-queue/QUEUE-LOCALIZATION"
								if status == "Failed"
								else "sales-order/ORDER-LOCALIZATION"
							)
							self.assertIn(f"<a href='/desk/{path}'><b>qui</b></a>", message)
						self.assertIn(f"<strong>{caption}</strong>", message)
						self.assertIn("<strong>Ordine di vendita</strong>", message)
						self.assertIn("<strong>ORDER-LOCALIZATION</strong>", message)

	def test_background_dispatch_and_update_mapping_remain_canonical(self):
		for action, method in (
			("Submit", "submit"),
			("submit", "submit"),
			("Cancel", "cancel"),
			("Update", "submit"),
			("custom_action", "custom_action"),
		):
			with self.subTest(action=action):
				doc = Mock(doctype="Sales Order", name="ORDER-LOCALIZATION")
				queue = SimpleNamespace(**vars(self.queue), update_job_id=Mock(), notify=Mock())
				with (
					patch.object(
						submission_queue, "get_current_job", return_value=SimpleNamespace(id="JOB-01")
					),
					patch.object(submission_queue, "add_data_to_monitor"),
				):
					submission_queue.SubmissionQueue.background_submission(queue, doc, action)
				getattr(doc, method).assert_called_once_with()
				queue.notify.assert_called_once_with("Finished", action)
