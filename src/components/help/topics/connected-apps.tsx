import { Lead, H2, P, UL, LI, Steps, Callout, UI } from "@/components/help/prose";

export default function ConnectedApps() {
  return (
    <>
      <Lead>
        Connect CourseForge, the course-authoring app, so your team signs in to it with their Tavoro account. Once it&rsquo;s
        connected, <UI>CourseForge</UI> appears under <UI>Apps</UI> in the sidebar and opens it already signed in.
      </Lead>

      <Callout tone="note">Admin-only. Everything here lives in <UI>Settings → Connected apps</UI>.</Callout>

      <H2>Connect CourseForge</H2>
      <Steps>
        <>
          In Tavoro, open <UI>Settings → Connected apps</UI>, enter CourseForge&rsquo;s web address (like
          https://courseforge.example.com) and click <UI>Connect</UI>.
        </>
        <>Copy the connection key Tavoro shows. It&rsquo;s shown only once.</>
        <>
          In CourseForge, as an owner, open <UI>Admin → Settings → Sign in with Tavoro</UI>, paste the key and click{" "}
          <UI>Save</UI>. CourseForge checks the key with Tavoro before saving it.
        </>
      </Steps>
      <P>From then on, the CourseForge sign-in page has a <UI>Sign in with Tavoro</UI> button.</P>

      <H2>Who can sign in</H2>
      <UL>
        <LI>Members of this workspace. Anyone else signed in to Tavoro is told they don&rsquo;t have access.</LI>
        <LI>
          If the workspace requires single sign-on, people need to have signed in to Tavoro with SSO. A password session
          isn&rsquo;t enough.
        </LI>
        <LI>
          The first time someone signs in, CourseForge links their existing account with the same email, or creates one
          (an owner there can turn that off, or choose Viewer as the role for new accounts).
        </LI>
      </UL>

      <H2>Suspending and removing people</H2>
      <P>
        CourseForge checks Tavoro&rsquo;s member list every five minutes. Anyone you suspend or remove here, by hand or
        through SCIM, is suspended there and signed out, and reactivated there when you reactivate them here. CourseForge
        owners are never suspended this way, so someone can always get in.
      </P>

      <H2>Disconnecting</H2>
      <P>
        <UI>Disconnect</UI> stops the key working at once. People keep their CourseForge accounts and work, but can&rsquo;t
        sign in with Tavoro until you connect again and paste the new key. Backups don&rsquo;t include connected apps, so
        a restored copy of the workspace needs connecting again too.
      </P>
    </>
  );
}
