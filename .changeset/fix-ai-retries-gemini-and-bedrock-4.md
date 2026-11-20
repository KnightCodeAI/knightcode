---
"@knightcodeai/cli": patch
---

Fixed Bedrock requests that sign in with AWS SSO so the credential request uses the same HTTPS proxy as the model call.
