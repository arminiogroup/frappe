<template>
	<div class="flex flex-col gap-4">
		<section class="flex flex-col gap-4">
			<h2 class="text-base-semibold text-ink-gray-8">{{ __("Import settings") }}</h2>
			<Alert
				v-if="pendingCount"
				theme="blue"
				:title="pendingMessage"
				:primaryAction="{
					label: __('Review pending imports'),
					variant: 'outline',
					size: 'xs',
					iconRight: 'lucide-arrow-right',
					onClick: () => emit('openImports', doc.reference_doctype),
				}"
			/>
			<div class="grid w-full items-start gap-5 sm:grid-cols-2">
				<div class="flex min-w-0 flex-col gap-4">
					<Link
						v-model="doc.reference_doctype"
						doctype="DocType"
						:filters="{ allow_import: 1 }"
						:label="__('Document Type')"
						required
						:disabled="!isNew"
						:error="
							showErrors && !doc.reference_doctype
								? __('Select a Document Type')
								: undefined
						"
					/>
					<Select
						v-model="doc.import_type"
						:label="__('Import Type')"
						:options="importTypeOptions"
						required
						:disabled="!isNew"
						:error="
							showErrors && !doc.import_type
								? __('Select an Import Type')
								: undefined
						"
					/>
				</div>
				<div class="flex min-w-0 flex-col gap-4">
					<Checkbox
						data-fieldname="mute_emails"
						:label="__(`Don't Send Emails`)"
						:disabled="!isNew"
						:modelValue="!!doc.mute_emails"
						@update:modelValue="(value) => setCheck('mute_emails', value)"
					/>
					<Checkbox
						v-if="isSubmittable"
						data-fieldname="submit_after_import"
						:label="__('Submit After Import')"
						:disabled="!isNew"
						:modelValue="!!doc.submit_after_import"
						@update:modelValue="(value) => setCheck('submit_after_import', value)"
					/>
					<template v-if="showCsvOptions">
						<Checkbox
							data-fieldname="custom_delimiters"
							:label="__('Custom Delimiters')"
							:disabled="importFinished"
							:modelValue="!!doc.custom_delimiters"
							@update:modelValue="(value) => setCheck('custom_delimiters', value)"
						/>
						<TextInput
							v-if="doc.custom_delimiters"
							data-fieldname="delimiter_options"
							:modelValue="doc.delimiter_options || ''"
							:label="__('Delimiter Options')"
							:description="
								__(
									'If your CSV uses a different delimiter, add that character here, ensuring no spaces or additional characters are included.'
								)
							"
							:disabled="importFinished"
							@update:modelValue="(value) => (doc.delimiter_options = String(value))"
						/>
						<Checkbox
							data-fieldname="use_csv_sniffer"
							:label="__('Detect CSV type')"
							:description="
								__(
									`Use if the default settings don't seem to detect your data correctly`
								)
							"
							:disabled="importFinished"
							:modelValue="!!doc.use_csv_sniffer"
							@update:modelValue="(value) => setCheck('use_csv_sniffer', value)"
						/>
					</template>
				</div>
			</div>
		</section>

		<section class="flex flex-col gap-4 border-t border-outline-gray-2 pt-4">
			<div class="flex items-center justify-between gap-4">
				<h2 class="text-base-semibold text-ink-gray-8">{{ __("Upload file") }}</h2>
				<Button
					v-if="hasSettings"
					variant="outline"
					:label="__('Download Template')"
					@click="showTemplate = true"
				/>
			</div>

			<Tabs v-if="showTabs" v-model="source">
				<TabList>
					<TabTrigger
						value="file_upload"
						:label="__('File upload')"
						icon-left="lucide-upload"
					/>
					<TabTrigger
						value="google_sheet"
						:label="__('Google Sheet')"
						icon-left="lucide-link"
					/>
				</TabList>
			</Tabs>

			<template v-if="pane === 'file_upload'">
				<div
					v-if="doc.import_file"
					data-slot="file-card"
					class="flex w-full items-center justify-between gap-3 rounded-6 border border-outline-gray-2 bg-surface-base px-4 py-3 text-base"
				>
					<div class="flex min-w-0 flex-1 items-center gap-2">
						<div
							class="flex size-10 shrink-0 items-center justify-center rounded-4 bg-surface-gray-2 text-ink-gray-7"
						>
							<span class="lucide-file-spreadsheet size-5" />
						</div>
						<div class="min-w-0">
							<a
								class="block truncate text-base-semibold text-ink-gray-9 hover:underline"
								:href="doc.import_file"
								target="_blank"
								rel="noopener noreferrer"
								:title="fileName"
							>
								{{ fileName }}
							</a>
							<div class="text-base text-ink-gray-6">{{ fileMeta }}</div>
						</div>
					</div>
					<Button
						v-if="!importFinished"
						variant="outline"
						:label="__('Clear')"
						@click="confirmingClear = true"
					/>
				</div>
				<div
					v-else
					data-slot="dropzone"
					class="flex min-h-48 flex-col items-center justify-center gap-1 rounded-6 border border-dashed p-5 text-center"
					:class="
						uploadLocked
							? 'border-outline-gray-2'
							: fileMissing
							? 'cursor-pointer border-outline-red-3 bg-surface-base hover:bg-surface-gray-2'
							: dragging
							? 'cursor-pointer border-outline-gray-4 bg-surface-gray-2'
							: 'cursor-pointer border-outline-gray-2 bg-surface-base hover:border-outline-gray-4 hover:bg-surface-gray-2'
					"
					@click="browse"
					@dragover.prevent="dragging = !uploadLocked"
					@dragleave="dragging = false"
					@drop.prevent="onDrop"
				>
					<input
						ref="fileInput"
						type="file"
						class="hidden"
						:accept="ALLOWED_FILE_TYPES.join(',')"
						@change="onPick"
					/>
					<Progress
						v-if="uploader.state.uploading"
						data-slot="upload-progress"
						class="w-full max-w-sm text-start"
						:value="uploader.state.progress"
						:label="uploadingFile"
					>
						<template #hint>
							<span class="shrink-0 text-base text-ink-gray-5">
								{{ `${__("Uploading")} ${uploader.state.progress}%` }}
							</span>
						</template>
					</Progress>
					<template v-else>
						<span
							class="lucide-cloud-upload size-5"
							:class="hasSettings ? 'text-ink-gray-6' : 'text-ink-gray-4'"
						/>
						<div
							class="max-w-sm text-base"
							:class="hasSettings ? 'text-ink-gray-6' : 'text-ink-gray-4'"
						>
							{{
								hasSettings
									? __("Drag a CSV or Excel file here, or click to browse")
									: __("Select a Document Type to upload a file")
							}}
						</div>
						<div v-if="hasSettings && maxFileSizeMb" class="text-sm text-ink-gray-5">
							{{ __(".csv, .xlsx up to {0} MB", [maxFileSizeMb]) }}
						</div>
					</template>
				</div>
				<p v-if="fileMissing" data-slot="file-error" class="text-p-sm text-ink-red-5">
					{{ __("Attach a CSV or Excel file to continue") }}
				</p>
			</template>

			<div v-else class="flex flex-col gap-3">
				<div
					v-if="sheetLocked"
					data-slot="sheet-card"
					class="flex w-full items-center justify-between gap-2 rounded-4 bg-surface-gray-2 p-2 text-base"
				>
					<div class="flex min-w-0 flex-1 items-center gap-2">
						<span class="lucide-link size-4 shrink-0 text-ink-gray-6" />
						<a
							class="min-w-0 truncate text-ink-gray-8 hover:underline"
							:href="doc.google_sheets_url!"
							target="_blank"
							rel="noopener noreferrer"
							:title="doc.google_sheets_url!"
						>
							{{ doc.google_sheets_url }}
						</a>
					</div>
					<Button
						v-if="!importFinished"
						size="xs"
						variant="outline"
						:label="__('Clear')"
						@click="clearGoogleSheet"
					/>
				</div>
				<TextInput
					v-else
					data-fieldname="google_sheets_url"
					:modelValue="doc.google_sheets_url || ''"
					:label="__('Import from Google Sheets')"
					:description="__('Must be a publicly accessible Google Sheets URL')"
					:disabled="uploadLocked"
					:error="fileMissing ? __('Enter a Google Sheets URL to continue') : undefined"
					@update:modelValue="(value) => (doc.google_sheets_url = String(value))"
				/>
				<Button
					v-if="doc.google_sheets_url && !dirty"
					class="self-start"
					:label="__('Refresh Google Sheet')"
					@click="dataImport.refreshGoogleSheet()"
				/>
			</div>
		</section>

		<TemplateModal
			v-if="hasSettings"
			v-model:open="showTemplate"
			:doctype="doc.reference_doctype"
			:importType="doc.import_type"
			:providerSchema="providerSchema"
			:doctypeMeta="doctypeMeta"
		/>
		<Dialog
			v-model:open="confirmingClear"
			:title="__('Confirm')"
			:message="__('Are you sure you want to delete the attachment?')"
			:actions="[
				{ label: __('Yes'), variant: 'solid', onClick: clearFile },
				{ label: __('No'), onClick: ({ close }) => close() },
			]"
		/>
	</div>
</template>

<script setup lang="ts">
import {
	Alert,
	Button,
	Checkbox,
	Dialog,
	Progress,
	Select,
	TabList,
	TabTrigger,
	Tabs,
	TextInput,
	call,
	getConfig,
	toast,
	useFileUpload,
} from "frappe-ui";
import { computed, ref, watch } from "vue";
import { Link } from "../../Link";
import { isImportComplete } from "../dataImport";
import { t as __ } from "../translate";
import type { DataImportDoc } from "../types";
import type { UseDataImport } from "../useDataImport";
import TemplateModal from "./TemplateModal.vue";

const ALLOWED_FILE_TYPES = [".csv", ".xls", ".xlsx"];

type CheckField = "mute_emails" | "submit_after_import" | "custom_delimiters" | "use_csv_sniffer";

const props = defineProps<{ dataImport: UseDataImport; showErrors?: boolean }>();
const emit = defineEmits<{ openImports: [doctype: string] }>();

const { doc, isNew, dirty, saving, preview, providerSchema, doctypeMeta, hasImportFile } =
	props.dataImport;

const initialSource = () => (doc.value.google_sheets_url ? "google_sheet" : "file_upload");
const source = ref<"file_upload" | "google_sheet">(initialSource());
const showTemplate = ref(false);
const confirmingClear = ref(false);
const pendingCount = ref(0);
const fileInput = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
const uploader = useFileUpload();
const uploadingFile = ref("");

const importTypeOptions = computed(() =>
	(["Insert New Records", "Update Existing Records", "Insert or Update Records"] as const).map(
		(value) => ({ label: __(value), value })
	)
);

const hasSettings = computed(() => !!(doc.value.reference_doctype && doc.value.import_type));
const importFinished = computed(() => isImportComplete(doc.value.status));
const uploadLocked = computed(() => importFinished.value || !hasSettings.value);
const fileMissing = computed(
	() => !!props.showErrors && hasSettings.value && !hasImportFile.value
);
const isSubmittable = computed(
	() =>
		!!doctypeMeta.value?.find((meta) => meta.name === doc.value.reference_doctype)
			?.is_submittable
);
const isCsvFile = computed(() => doc.value.import_file?.split(".").pop()?.toLowerCase() === "csv");
const showCsvOptions = computed(() => !!doc.value.google_sheets_url || isCsvFile.value);
// Only while the source is still undecided.
const showTabs = computed(
	() => !doc.value.import_file && !(doc.value.google_sheets_url && !dirty.value)
);
const pane = computed(() => {
	if (showTabs.value) return source.value;
	return doc.value.google_sheets_url && !doc.value.import_file ? "google_sheet" : "file_upload";
});
const sheetLocked = computed(
	() => !!doc.value.google_sheets_url && (importFinished.value || !dirty.value)
);

// Synchronous, so `saving` still tells a first save (same import) from another import being opened.
watch(
	() => doc.value.name,
	() => {
		if (saving.value) return;
		source.value = initialSource();
		confirmingClear.value = false;
		dragging.value = false;
	},
	{ flush: "sync" }
);

function setCheck(field: CheckField, value: boolean | 0 | 1 | undefined) {
	doc.value[field] = value ? 1 : 0;
}

const pendingMessage = computed(() =>
	pendingCount.value === 1
		? __("You have 1 pending {0} import with a file attached.", [
				__(doc.value.reference_doctype),
		  ])
		: __("You have {0} pending {1} imports with files attached.", [
				pendingCount.value,
				__(doc.value.reference_doctype),
		  ])
);

let pendingRequest = 0;
watch(
	() => [isNew.value, doc.value.reference_doctype] as const,
	async ([stillNew, doctype]) => {
		const request = ++pendingRequest;
		pendingCount.value = 0;
		if (!stillNew || !doctype) return;
		const count = await call<number>("frappe.client.get_count", {
			doctype: "Data Import",
			filters: { reference_doctype: doctype, status: "Pending", import_file: ["is", "set"] },
		}).catch(() => 0);
		if (request === pendingRequest) pendingCount.value = Number(count) || 0;
	},
	{ immediate: true }
);

const fileName = computed(() => {
	const segment = doc.value.import_file?.split("/").pop() || doc.value.import_file || "";
	return decodeURIComponent(segment.split("?")[0]);
});

const fileMeta = computed(() => {
	const ext = (fileName.value.split(".").pop() || "").toLowerCase();
	const typeLabel = ext ? ext.toUpperCase() : __("File");
	const count =
		doc.value.payload_count ||
		preview.value?.total_number_of_rows ||
		preview.value?.data?.length;
	if (!count) return typeLabel;
	return `${typeLabel} · ${count === 1 ? __("1 row") : __("{0} rows", [count])}`;
});

const maxFileSizeMb = computed(() => {
	const bytes = Number(getConfig("maxFileSize"));
	return bytes > 0 ? Math.round(bytes / (1024 * 1024)) : null;
});

function isAllowedType(file: File) {
	const name = file.name.toLowerCase();
	return ALLOWED_FILE_TYPES.some((type) => name.endsWith(type));
}

async function uploadFile(file: File | undefined) {
	if (!file) return;
	if (!isAllowedType(file)) {
		toast.warning(__('File "{0}" was skipped because of invalid file type', [file.name]));
		return;
	}
	const attachTo: Partial<Record<"doctype" | "docname" | "fieldname", string>> = isNew.value
		? {}
		: { doctype: "Data Import", docname: doc.value.name, fieldname: "import_file" };
	uploadingFile.value = file.name;
	let fileUrl: string;
	try {
		({ file_url: fileUrl } = await uploader.upload(file, {
			private: true,
			folder: "Home/Attachments",
			...attachTo,
		}));
	} catch (error) {
		toast.error((error as Error).message);
		return;
	}
	doc.value.import_file = fileUrl;
	await props.dataImport.save().catch(() => {});
}

function browse() {
	if (uploadLocked.value || uploader.state.uploading) return;
	fileInput.value?.click();
}

function onDrop(event: DragEvent) {
	dragging.value = false;
	if (uploadLocked.value || uploader.state.uploading) return;
	uploadFile(event.dataTransfer?.files?.[0]);
}

function onPick(event: Event) {
	const input = event.target as HTMLInputElement;
	uploadFile(input.files?.[0]);
	input.value = "";
}

async function clearFile({ close }: { close: () => void }) {
	close();
	const fileUrl = doc.value.import_file;
	doc.value.import_file = null;
	if (isNew.value) return;
	const saved = await props.dataImport.save().catch(() => null);
	if (saved && !dirty.value && fileUrl) await removeAttachment(fileUrl, doc.value);
}

async function removeAttachment(fileUrl: string, saved: DataImportDoc) {
	const file = await call<{ name: string } | undefined>("frappe.client.get_value", {
		doctype: "File",
		filters: {
			file_url: fileUrl,
			attached_to_doctype: "Data Import",
			attached_to_name: saved.name,
		},
		fieldname: "name",
	}).catch(() => undefined);
	if (!file?.name) return;
	await call("frappe.desk.form.utils.remove_attach", {
		fid: file.name,
		dt: "Data Import",
		dn: saved.name,
	}).catch(() => {});
}

async function clearGoogleSheet() {
	doc.value.google_sheets_url = "";
	if (dirty.value) await props.dataImport.save().catch(() => {});
}
</script>
