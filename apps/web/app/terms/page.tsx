import type { Metadata } from "next"
import Link from "next/link"

import { PageHero, PageShell, Prose } from "@/components/site/page-shell"
import { INSTALL_COMMAND, SITE } from "@/lib/site"

export const metadata: Metadata = {
  title: "Terms",
  description: `The terms that apply when you install and use ${SITE.name}.`,
  alternates: { canonical: `${SITE.url}/terms` },
}

const updated = "May 2026"

export default function TermsPage() {
  return (
    <PageShell>
      <PageHero
        eyebrow="Terms"
        title="Terms of Use"
        lead="Plain-language terms for installing and using KnightCode. The source is governed by Apache-2.0; your model/provider usage is governed by the providers you configure."
        meta={<span>Last updated - {updated}</span>}
      />

      <Prose>
        <h2>The short version</h2>
        <ul>
          <li>KnightCode is alpha software, open source, and provided as-is.</li>
          <li>You are responsible for what you ask the agent to do.</li>
          <li>
            Provider keys, model requests, search requests, and related costs
            are handled through the services you choose.
          </li>
          <li>
            No warranty, no liability beyond what the Apache-2.0 license allows.
          </li>
        </ul>

        <h2>1. The software</h2>
        <p>
          The KnightCode source code is licensed under{" "}
          <Link
            href="https://www.apache.org/licenses/LICENSE-2.0"
            target="_blank"
            rel="noreferrer"
          >
            Apache License 2.0
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
          The intended alpha install path is <code>{INSTALL_COMMAND}</code>.
          Package availability, versioning, and installation behavior may change
          before a stable release.
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

        <h2>5. Alpha status</h2>
        <p>
          KnightCode is early software. Features may change, break, or disappear
          before <code>1.0.0</code>. Use it with source control and review agent
          actions before approval.
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
          KnightCode. The Apache-2.0 license&apos;s limitation of liability
          applies in full.
        </p>

        <h2>8. Trademarks</h2>
        <p>
          &ldquo;KnightCode&rdquo; and the KnightCode logo are unregistered trademarks of
          the project maintainers. The Apache-2.0 license does not grant
          trademark rights; if you fork the project, use a different name and
          logo.
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
