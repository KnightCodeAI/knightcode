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
    a: "The CLI is MIT-licensed and free to install. Model use is billed by the provider you connect. KnightCode does not sell a subscription or take a cut of that bill.",
  },
  {
    q: "Do I need an account or sign-up?",
    a: "No KnightCode account. Install the CLI, run it in a folder, and sign in with /login or set a provider API key in the environment.",
  },
  {
    q: "Which models are supported?",
    a: "Built-in providers include OpenRouter, Anthropic, OpenAI, Google, xAI, Groq, GitHub Copilot, Amazon Bedrock, and others, plus local servers such as llama.cpp, Ollama, and any OpenAI-compatible endpoint. /model lists the models your credentials can reach.",
  },
  {
    q: "What does BYOK mean here?",
    a: "Bring your own key. Credentials stay on your machine, in auth.json or in an environment variable, and each request goes to the provider you selected.",
  },
  {
    q: "Is my code sent anywhere?",
    a: "A turn sends the prompt, the relevant tool context, and the model's reply to the provider you chose. KnightCode does not host an account or a model proxy in front of that.",
  },
  {
    q: "Which OSes are supported?",
    a: "macOS, Linux, and Windows. The npm install needs Node.js 22 or newer and pulls the matching platform binary.",
  },
  {
    q: "Where do I report bugs or request features?",
    a: "Open an issue on GitHub at github.com/KnightCodeAI/knightcode.",
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
