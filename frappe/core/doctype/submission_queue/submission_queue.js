// Copyright (c) 2022, Frappe Technologies and contributors
// For license information, please see license.txt

frappe.ui.form.on("Submission Queue", {
	refresh: function (frm) {
		if (frm.doc.status === "Queued" && frappe.boot.user.roles.includes("System Manager")) {
			frm.add_custom_button(__("Unlock Reference Document"), () => {
				frappe.confirm(
					__(
						"Are you sure you want to unlock this document? Other queued submissions of the same document may also be unlocked, which can lead to unexpected behavior."
					),
					() => {
						frm.call("unlock_doc");
					}
				);
			});
		}
	},
});
