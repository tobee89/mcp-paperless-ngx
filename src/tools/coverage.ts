/**
 * Endpoints this server reaches through a computed path (the generated CRUD
 * tools build "/api/tags/" + id), plus the ones deliberately left out.
 *
 * Keeping both lists explicit means the coverage test can assert that every
 * documented endpoint is either exposed or consciously excluded — a new
 * Paperless release adding an endpoint fails the test instead of going unnoticed.
 */

/** Reached at runtime, but not visible as a literal in the source. */
export const COMPUTED_ENDPOINTS: string[] = [
  "/api/tags/{id}/",
  "/api/correspondents/{id}/",
  "/api/document_types/{id}/",
  "/api/storage_paths/{id}/",
];

/** Intentionally not exposed, with the reason. */
export const EXCLUDED_ENDPOINTS: Record<string, string> = {
  "/api/token/": "Issues API tokens from a username and password; this server authenticates with a token the operator already holds.",
  "/api/profile/generate_auth_token/": "Credential management belongs in the Paperless UI, not in an LLM tool.",
  "/api/profile/totp/": "Two-factor enrolment must not be automatable.",
  "/api/profile/disconnect_social_account/": "Account security operation; UI only.",
  "/api/profile/social_account_providers/": "Only meaningful inside the web login flow.",
  "/api/users/{id}/deactivate_totp/": "Disabling someone's second factor is not an assistant's job.",
  "/api/oauth/callback/": "Part of the browser OAuth redirect flow.",
  "/api/config/{id}/": "Writing global instance configuration is out of scope; get_configuration reads it.",
  "/api/ui_settings/": "Per-user web UI state; irrelevant to an API client.",
  "/api/documents/chat/": "Streaming LLM chat endpoint — the MCP client already is the language model.",
  "/api/documents/{id}/root/": "Internal helper for versioned documents; get_document reports versions.",
  "/api/documents/{id}/update_version/": "Version replacement is a UI upload flow; use upload_document.",
  "/api/documents/{id}/versions/{version_id}/": "Version editing is exposed through get_document's version list only.",
  "/api/documents/{id}/preview/": "Inline file rendering; download_document and get_document_thumbnail cover the useful cases.",
  "/api/documents/{id}/email/": "Superseded by the multi-document email endpoint used by email_documents.",
  "/api/mail_accounts/test/": "Tests unsaved IMAP credentials, which would mean handling passwords in tool arguments.",
  "/api/processed_mail/{id}/": "Single-record detail adds nothing over list_processed_mail.",
  "/api/processed_mail/bulk_delete/": "Destructive housekeeping with no read-back; UI only.",
  "/api/share_link_bundles/{id}/rebuild/": "Rebuilds a bundle archive; rarely needed outside the UI.",
  "/api/tasks/run/": "Triggers arbitrary scheduled jobs by name — too blunt to expose safely.",
  "/api/tasks/status_counts/": "Aggregate covered by list_tasks and get_active_tasks.",
  "/api/tasks/summary/": "Aggregate covered by list_tasks and get_active_tasks.",
  "/api/groups/{id}/": "Group detail adds nothing over list_groups.",
  "/api/workflow_triggers/{id}/": "Triggers are managed through their parent workflow.",
  "/api/workflow_actions/{id}/": "Actions are managed through their parent workflow.",
};
