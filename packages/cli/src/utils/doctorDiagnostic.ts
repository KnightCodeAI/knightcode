// TODO: environment "doctor" diagnostics (install type, ripgrep status, version
// locks) — not ported. The `claude doctor` screen reads many fields, so the
// shape is permissive; the array fields are typed so the display loops resolve.
export type DiagnosticInfo = {
  multipleInstallations: any[]
  warnings: any[]
  [key: string]: any
}

export async function getDoctorDiagnostic(..._args: any[]): Promise<DiagnosticInfo> {
  return { multipleInstallations: [], warnings: [] }
}
