import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Section, SectionEyebrow, SectionHeading, SectionLead } from "./section"

const faqs = [
  {
    q: "Is KnightCode free?",
    a: "Yes. KnightCode is open source and free to use during alpha. You bring your own model key, so model/provider usage is paid directly through the provider you configure.",
  },
  {
    q: "Do I need an account or sign-up?",
    a: "No KnightCode account is required. Install the CLI, run it in a repository, and complete the terminal onboarding with your own API key.",
  },
  {
    q: "Which models are supported right now?",
    a: "The current CLI is OpenRouter-first, so you can choose from the models exposed through that route once your key is configured. More provider wiring can be added as the alpha matures.",
  },
  {
    q: "What does BYOK mean here?",
    a: "Bring your own key means KnightCode does not bundle model usage. You configure your provider credentials locally, and requests go through the provider path you choose.",
  },
  {
    q: "Is my code sent anywhere?",
    a: "Your prompts, code snippets, and tool context are sent only as needed for the model requests you initiate. KnightCode does not add a hosted account layer around that workflow.",
  },
  {
    q: "Which OSes are supported?",
    a: "The npm CLI is intended to run anywhere the required runtime works, including macOS, Linux, and Windows.",
  },
  {
    q: "Where do I report bugs or request features?",
    a: "Open an issue on GitHub at github.com/KnightCodeAI/knightcode - we read everything.",
  },
]

export function FAQ() {
  return (
    <Section id="faq">
      <div className="mx-auto max-w-3xl text-center">
        <SectionEyebrow>FAQ</SectionEyebrow>
        <SectionHeading>Questions, answered.</SectionHeading>
        <SectionLead className="mx-auto">
          Still curious? Open an issue on GitHub and include your OS, command,
          and model configuration.
        </SectionLead>
      </div>

      <div className="mx-auto mt-12 max-w-3xl">
        <Accordion
          type="single"
          collapsible
          className="rounded-2xl border-border/60 bg-background/85 shadow-sm backdrop-blur-md"
        >
          {faqs.map((f, i) => (
            <AccordionItem key={i} value={`item-${i}`}>
              <AccordionTrigger>{f.q}</AccordionTrigger>
              <AccordionContent className="text-foreground/75">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </Section>
  )
}
