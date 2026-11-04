import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: "Terms · Auteur" };

export default function Page() {
  return (
    <LegalPage title="Terms of service">
      <p>
        Auteur is a demo built for the Meta AI Developer Hackathon. By using it you agree to the terms below. If you don&apos;t agree, please
        don&apos;t use it.
      </p>

      <section>
        <h2>A demo, as is</h2>
        <p>
          Auteur is offered free of charge and as is, without guarantees. It may change, slow down, lose data or stop at any time. Keep your own
          copies of anything you care about.
        </p>
      </section>

      <section>
        <h2>What you upload</h2>
        <ul>
          <li>Upload only footage, music and pictures you have the right to use.</li>
          <li>Get consent from the people who appear in your footage, or blur them.</li>
          <li>Don&apos;t upload anything illegal, hateful, sexual involving minors, or meant to harass or deceive.</li>
        </ul>
        <p>Projects that break these rules may be removed.</p>
      </section>

      <section>
        <h2>What you make</h2>
        <p>
          The videos you export are yours, subject to the rights in the material you put in. AI output can be wrong: check the result before you
          publish it.
        </p>
      </section>

      <section>
        <h2>Fair use of the service</h2>
        <p>
          Each account has a spending limit on the AI models, and runs may be limited per visitor. Don&apos;t try to get around these limits or
          disrupt the service for others.
        </p>
      </section>

      <section>
        <h2>Your data</h2>
        <p>
          How your account and footage are handled is described in the <a href="/privacy" className="underline">privacy policy</a>.
        </p>
      </section>
    </LegalPage>
  );
}
