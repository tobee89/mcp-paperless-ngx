/**
 * Enum values that must match the Paperless schema exactly.
 *
 * These are the values the API validates against — get one wrong and every call
 * using it fails with an HTTP 400 that says nothing useful. The path-coverage
 * test cannot catch that: the endpoint exists, only the value is rejected. So
 * each list below names the schema component it mirrors, and a test asserts
 * they are still identical.
 */

export const SCHEMA_ENUMS = {
  TaskSerializerV10StatusEnum: ["pending", "started", "success", "failure", "revoked"],
  FileVersionEnum: ["archive", "original"],
  ContentEnum: ["archive", "originals", "both"],
  CompressionEnum: ["none", "deflated", "bzip2", "lzma"],
  DataTypeEnum: [
    "string",
    "url",
    "date",
    "boolean",
    "integer",
    "float",
    "monetary",
    "documentlink",
    "select",
    "longtext",
  ],
  MethodEnum: [
    "set_correspondent",
    "set_document_type",
    "set_storage_path",
    "add_tag",
    "remove_tag",
    "modify_tags",
    "modify_custom_fields",
    "set_permissions",
    "delete",
    "reprocess",
    "rotate",
    "merge",
    "edit_pdf",
    "remove_password",
    "split",
    "delete_pages",
  ],
  MatchingAlgorithm: [0, 1, 2, 3, 4, 5, 6],
} as const;

export type TaskStatus = (typeof SCHEMA_ENUMS.TaskSerializerV10StatusEnum)[number];
export type FileVersion = (typeof SCHEMA_ENUMS.FileVersionEnum)[number];
export type BulkEditMethod = (typeof SCHEMA_ENUMS.MethodEnum)[number];
