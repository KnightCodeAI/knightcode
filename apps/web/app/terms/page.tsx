import type { Metadata } from "next"
import Link from "next/link"

import { PageHero, PageShell, Prose } from "@/components/site/page-shell"
import { INSTALL_COMMAND, SITE } from "@/lib/site"

export const metadata: Metadata = {
  title: "Terms",
  description: `The terms that apply when you install and use ${SITE.name}.`,
  alternates: { canonical: `${SITE.url}/terms` },
}

const updated = "September 2026"

export default function TermsPage() {
  return (
    <PageShell>
      <PageHero
        eyebrow="Terms"
        title="Terms of Use"
        lead="Plain-language terms for installing and using KnightCode. The source is MIT-licensed. Your model and provider usage is governed by the providers you configure."
        meta={<span>Last updated - {updated}</span>}
      />

      <Prose>
        <h2>The short version</h2>
        <ul>
          <li>KnightCode is open source and provided as-is.</li>
          <li>You are responsible for what you ask the agent to do.</li>
          <li>
            Provider keys, model requests, search requests, and related costs
            are handled through the services you choose.
          </li>
          <li>
            No warranty. The MIT license limits liability as far as the law allows.
          </li>
        </ul>

        <h2>1. The software</h2>
        <p>
          The KnightCode source code is licensed under the{" "}
          <Link
            href="https://opensource.org/licenses/MIT"
            target="_blank"
            rel="noreferrer"
          >
            MIT License
          </Link>
          . The license text in the{" "}
          <Link
            href={`${SITE.github}/blob/main/LICENSE`}
            target="_blank"
            rel="noreferrer"
          >
            repository
          </Link>{" "}
          governs your use of the code. These terms cover the website and the
          general use of the published CLI.
        </p>

        <h2>2. Installing KnightCode</h2>
        <p>
          The install command is <code>{INSTALL_COMMAND}</code>. It needs
          Node.js 22 or newer. <code>--ignore-scripts</code> is safe for a
          normal install: the package ships its platform binary and does not
          need a dependency lifecycle script.
        </p>

        <h2>3. Your use of KnightCode</h2>
        <p>
          KnightCode can read files, write files, run shell commands, fetch web
          pages, and send context to AI providers you configure. You are solely
          responsible for what you run, what you send, and the consequences of
          those actions.
        </p>
        <p>Don&apos;t use KnightCode to:</p>
        <ul>
          <li>
            Break the law where you live or where the affected systems live.
          </li>
          <li>Access systems you aren&apos;t authorized to access.</li>
          <li>Send content to providers in violation of their terms.</li>
        </ul>

        <h2>4. Third-party services</h2>
        <p>
          KnightCode is BYOK. Provider accounts, billing, retention, rate
          limits, availability, and terms are controlled by the providers you
          configure. We are not a party to that relationship and cannot make
          promises on their behalf.
        </p>

        <h2>5. What the agent can do</h2>
        <p>
          Tools run with the permissions of the process that started KnightCode.
          KnightCode does not ask before every tool call. Use source control,
          read the transcript, and isolate untrusted or unattended work.
          Releases can change behavior. Read the changelog for the version you
          install.
        </p>

        <h2>6. No warranty</h2>
        <p>
          KnightCode is provided &ldquo;AS IS&rdquo;, without warranty of any kind,
          express or implied. We do not warrant that KnightCode will be
          error-free, secure, uninterrupted, or fit for any particular purpose.
        </p>

        <h2>7. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, in no event will KnightCode or
          its maintainers be liable for any indirect, incidental, special,
          consequential, or punitive damages arising out of your use of
          KnightCode. The MIT license&apos;s limitation of liability applies
          to the software.
        </p>

        <h2>8. Trademarks</h2>
        <p>
          &ldquo;KnightCode&rdquo; and the KnightCode logo are unregistered trademarks of
          the project maintainers. The MIT license covers the code. It does
          not grant rights in the KnightCode name or logo. If you fork the
          project, use a different name and logo.
        </p>

        <h2>9. Changes</h2>
        <p>
          We may update these terms. Material changes will be reflected in the
          &ldquo;Last updated&rdquo; date at the top of this page. Continued use
          of KnightCode after a change means you accept the new terms.
        </p>

        <h2>10. Contact</h2>
        <p>
          For questions or support, please open an issue in the{" "}
          <Link href={SITE.github} target="_blank" rel="noreferrer">
            GitHub repository
          </Link>
          . For security reports, please see our{" "}
          <Link href="/security">
            Security Policy
          </Link>
          .
        </p>
      </Prose>

      <div className="h-24 sm:h-32" />
    </PageShell>
  )
}
