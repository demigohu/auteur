import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: "Privacy · Auteur" };

export default function Page() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        Auteur is a video editor with an AI agent, built for the Meta AI Developer Hackathon. This page says what it keeps about you, where your
        footage goes, and how to remove it.
      </p>

      <section>
        <h2>Your account</h2>
        <p>
          Sign-in is handled by Clerk. When you sign in with Google, Auteur receives your name, email address and profile picture. When you sign up
          with email, it receives your email address. Auteur uses these only to sign you in and to keep your projects private to your account.
        </p>
      </section>

      <section>
        <h2>Your footage and projects</h2>
        <p>
          The videos, music and pictures you upload, the edits you and the agent make, and the videos you export are stored on Auteur&apos;s server
          so you can keep editing. Only your account can open your projects.
        </p>
      </section>

      <section>
        <h2>What is sent to Meta</h2>
        <p>To edit, the agent sends parts of your project to Meta&apos;s models through the Meta Model API:</p>
        <ul>
          <li>sampled frames and your instructions to Muse Spark, which plans the edit and describes what is on screen;</li>
          <li>a low-resolution copy of your video to SAM 3.1, to track people and objects and to cut out backgrounds;</li>
          <li>the sound of your clips to Muse Voice Transcribe, for subtitles and editing by words;</li>
          <li>your descriptions to Muse Wonder and Muse Image, for videos made in code and generated pictures.</li>
        </ul>
        <p>Voices for voice-overs and dubbing are generated on Auteur&apos;s own server.</p>
      </section>

      <section>
        <h2>What Auteur does not do</h2>
        <p>Auteur does not sell your data, show ads, or use analytics or tracking cookies. The only cookies are the ones Clerk needs to keep you signed in.</p>
      </section>

      <section>
        <h2>Deleting your data</h2>
        <p>
          Deleting a project removes its footage, renders and history from the server. To delete your account and everything in it, email the
          address below and it will be removed.
        </p>
      </section>
    </LegalPage>
  );
}
