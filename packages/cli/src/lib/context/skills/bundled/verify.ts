import type { Skill } from "../../skills";

const VERIFY_BODY = `# Verify: Code Validation and Verification

Verify that your changes work correctly and do not introduce regressions by running the project's test suite and verifying its behavior.

## Steps

1. **Locate Tests:** Find the test files or verification scripts. Look for common names like \`tests/\`, \`__tests__/\`, \`*.test.ts\`, \`*.spec.ts\`, or package/config scripts like \`npm test\`, \`bun test\`, \`pytest\`, \`go test\`, or a \`Makefile\` target.
2. **Run the Tests:** Execute the relevant test command using the Bash tool. If any test fails, analyze the failure, correct the code, and re-run the tests.
3. **Verify End-to-End:** If applicable, verify the changes end-to-end (e.g. start the dev server and test manually or curl the endpoints).
4. **Report:** Provide a summary of the test results to the user.
`;

export const verifySkill: Skill = {
  name: "verify",
  description: "Verify code changes by running tests and verifying output.",
  userInvocable: true,
  disableModelInvocation: false,
  source: "bundled",
  dirPath: "",
  body: VERIFY_BODY,
};
