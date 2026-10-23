import poplib
import ssl
from unittest.mock import Mock, patch

import frappe
from frappe.email import receive
from frappe.tests import UnitTestCase

MESSAGE = "Could not complete the POP3 connection. Check the email account settings and try again."
TARGET = "Impossibile completare la connessione POP3. Controlla le impostazioni dell'account email e riprova."


class TestPOPErrorLocalization(UnitTestCase):
	def setUp(self):
		self.addCleanup(frappe.set_user, frappe.session.user)
		self.addCleanup(setattr, frappe.local, "lang", frappe.local.lang)
		frappe.set_user("translator@example.com")
		frappe.local.lang = "it"
		self.enterContext(patch("frappe.translate.get_all_translations", return_value={MESSAGE: TARGET}))
		self.messages = self.enterContext(patch("frappe.msgprint"))
		self.logs = self.enterContext(patch("frappe.log_error"))

	def server(self, **values):
		settings = frappe._dict(
			host="mail.example.com",
			incoming_port=110,
			timeout=12,
			use_imap=0,
			use_ssl=0,
			use_oauth=0,
			username="translator@example.com",
			password="memory-only-placeholder",
			email_account="ACCOUNT-RAW",
			access_token="memory-only-token",
		)
		settings.update(values)
		return receive.EmailServer(settings)

	def test_non_temporary_protocol_errors_do_not_assert_a_specific_credential_is_invalid(self):
		for stage in ("greeting", "user", "pass_"):
			with self.subTest(stage=stage):
				self.messages.reset_mock()
				error = poplib.error_proto("-ERR unrecognized server response")
				connection = Mock()
				if stage != "greeting":
					getattr(connection, stage).side_effect = error
				with patch.object(
					receive.poplib,
					"POP3",
					return_value=connection,
					side_effect=error if stage == "greeting" else None,
				):
					with self.assertRaises(poplib.error_proto) as caught:
						self.server().connect()
				self.assertIs(caught.exception, error)
				self.messages.assert_called_once_with(TARGET)

	def test_real_oauth_protocol_failure_uses_same_generic_connection_message(self):
		connection = poplib.POP3.__new__(poplib.POP3)
		error = poplib.error_proto("-ERR authentication command rejected")
		connection._shortcmd = Mock(side_effect=error)
		with patch.object(receive.poplib, "POP3", return_value=connection):
			with self.assertRaises(poplib.error_proto) as caught:
				self.server(use_oauth=1).connect_pop()
		self.assertIs(caught.exception, error)
		self.messages.assert_called_once_with(TARGET)
		self.assertTrue(connection._shortcmd.call_args.args[0].startswith("AUTH XOAUTH2 "))
		self.logs.assert_called_once()

	def test_temporary_protocol_errors_still_return_false_without_message(self):
		for text in (
			"-ERR [SYS/TEMP] Temporary system problem. Please try again later.",
			"Connection timed out",
		):
			connection = Mock()
			connection.user.side_effect = poplib.error_proto(text)
			with patch.object(receive.poplib, "POP3", return_value=connection):
				self.assertIs(self.server().connect_pop(), False)
		self.messages.assert_not_called()

	def test_success_preserves_credentials_transport_timeout_and_ssl_verification(self):
		for secured in (False, True):
			with self.subTest(secured=secured):
				connection = Mock()
				port = 995 if secured else 110
				with patch.object(
					receive.poplib, "POP3_SSL" if secured else "POP3", return_value=connection
				) as transport:
					self.assertIs(self.server(use_ssl=int(secured), incoming_port=port).connect_pop(), True)
				connection.user.assert_called_once_with("translator@example.com")
				connection.pass_.assert_called_once_with("memory-only-placeholder")
				self.assertEqual(transport.call_args.args, ("mail.example.com", port))
				self.assertEqual(transport.call_args.kwargs["timeout"], 12)
				if secured:
					self.assertEqual(transport.call_args.kwargs["context"].verify_mode, ssl.CERT_REQUIRED)
		self.messages.assert_not_called()

	def test_socket_error_keeps_the_original_exception_and_mail_server_message(self):
		error = OSError("Transport unavailable")
		with patch.object(receive.poplib, "POP3", side_effect=error):
			with self.assertRaises(OSError) as caught:
				self.server().connect_pop()
		self.assertIs(caught.exception, error)
		self.messages.assert_called_once_with("Invalid Mail Server. Please rectify and try again.")
		self.logs.assert_called_once_with("POP: Unable to connect")
