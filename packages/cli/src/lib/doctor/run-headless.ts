import { VERSION } from "../version";
import { runDoctorChecks } from "./checks";
import { doctorExitCode, formatDoctorReport } from "./format";

/** Run diagnostics, print the report to stdout, and return the process exit code. */
export function runDoctorHeadless(): number {
  const checks = runDoctorChecks();
  process.stdout.write(formatDoctorReport(VERSION, checks) + "\n");
  return doctorExitCode(checks);
}
