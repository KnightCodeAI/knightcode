---
"@knightcodeai/cli": minor
---

Changed the `azure-openai-responses` provider id to `azure`, which now also serves Azure Foundry Chat Completions deployments such as DeepSeek V4 Pro. Rename the `azure-openai-responses` key to `azure` in `auth.json`, `models.json`, and `settings.json`; `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` now applies to Chat Completions deployments too.
