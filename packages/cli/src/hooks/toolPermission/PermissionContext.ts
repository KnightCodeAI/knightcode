// TODO: the interactive permission-request context (the React-backed prompt
// queue and its resolution machinery) lands with the permission UI layer. The
// decision-source unions below are the only pieces the permission decision
// logger needs, so they are defined here standalone until then.

export type PermissionApprovalSource =
  | { type: 'hook'; permanent?: boolean }
  | { type: 'user'; permanent: boolean }
  | { type: 'classifier' }

export type PermissionRejectionSource =
  | { type: 'hook' }
  | { type: 'user_abort' }
  | { type: 'user_reject'; hasFeedback: boolean }
