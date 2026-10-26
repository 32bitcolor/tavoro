import { Lead, H2, H3, P, UL, LI, Steps, Callout, DefList, Def, UI, Screenshot } from "@/components/help/prose";

export default function AccountThemes() {
  return (
    <>
      <Lead>
        Two things every user controls for themselves, no admin required: your <strong>password</strong>{" "}
        and how Tavoro <strong>looks</strong>. This guide covers changing your own password from
        Account settings and switching among the built-in themes.
      </Lead>

      <H2>Changing your password</H2>
      <P>
        Anyone signed in can update their own password — you don&rsquo;t need an admin to do it. Head
        to <UI>Settings → Account</UI>, where the <UI>Profile</UI> card shows your name and email and
        a <UI>Change password</UI> form sits below.
      </P>
      <Steps>
        <>
          Enter your <UI>Current password</UI>. This proves it&rsquo;s really you and is required —
          the change is rejected if it&rsquo;s wrong.
        </>
        <>
          Type your <UI>New password</UI>, then repeat it in <UI>Confirm new password</UI>. The two
          must match.
        </>
        <>
          Click <UI>Update password</UI>. On success the fields clear and you&rsquo;ll see a
          confirmation. Your new password takes effect immediately.
        </>
      </Steps>

      <Callout tone="note">
        Locked out and can&rsquo;t sign in to reach this page? A workspace admin can set a new
        password for you from <UI>Settings → Members</UI> — an admin reset doesn&rsquo;t need your
        current one. Once you&rsquo;re back in, change it to something only you know. Changing your
        password signs you out on every other device.
      </Callout>

      <Callout tone="note">
        Sign in with <UI>Sign in with SSO</UI>? Then your password lives with your company&rsquo;s identity
        provider — change it there. A Tavoro password only matters if your workspace still allows password
        sign-in.
      </Callout>

      <Callout tone="tip">
        Because the current password is mandatory, pick a strong, unique passphrase — the flow is
        built so a walk-by can&rsquo;t change your password even at an unlocked screen without knowing
        the old one.
      </Callout>

      <H2>Theming Tavoro</H2>
      <Screenshot name="account" alt="Settings, Account: the Appearance theme swatches, the profile, and the change-password form" caption="Settings → Account." />
      <P>
        Tavoro ships with a big library of hand-tuned themes, and the entire interface re-colors
        instantly when you pick one — sidebar, cards, buttons, charts, and all. Find the theme picker
        in <UI>Settings → Account</UI>, under <UI>Appearance</UI> — a grid of swatches, each showing
        a preview of that theme&rsquo;s background and accent color. Click one to apply it.
      </P>

      <H3>How it behaves</H3>
      <DefList>
        <Def term="Applied instantly">
          The switch is live — no save button, no reload. The whole UI re-themes the moment you
          select.
        </Def>
        <Def term="Remembered per device">
          Your choice is stored on the device you&rsquo;re using, so this machine keeps your theme
          between visits. A different computer or browser has its own independent setting.
        </Def>
        <Def term="System option">
          Pick <UI>System</UI> and Tavoro follows your operating system&rsquo;s light/dark
          preference instead of pinning a specific palette.
        </Def>
      </DefList>

      <H3>The range on offer</H3>
      <P>
        Beyond <UI>System</UI>, there are seventeen named themes spanning clean neutrals to bold
        retro looks — plenty to find one that&rsquo;s easy on your eyes for a long design session. A
        taste of what&rsquo;s there:
      </P>
      <UL>
        <LI>
          <strong>Clean &amp; neutral</strong> — <UI>Light</UI>, <UI>Dark</UI>,{" "}
          <UI>GitHub Light</UI>, <UI>Solarized Light</UI>.
        </LI>
        <LI>
          <strong>Cool &amp; muted</strong> — <UI>Nord</UI>, <UI>Tokyo Night</UI>,{" "}
          <UI>One Dark</UI>, <UI>Ayu Mirage</UI>, <UI>Kanagawa</UI>.
        </LI>
        <LI>
          <strong>Warm &amp; earthy</strong> — <UI>Everforest</UI>, <UI>Gruvbox</UI>,{" "}
          <UI>Rosé Pine</UI>.
        </LI>
        <LI>
          <strong>Rich &amp; vivid</strong> — <UI>Dracula</UI>, <UI>Catppuccin Latte</UI> and{" "}
          <UI>Catppuccin Mocha</UI>, <UI>Monokai</UI>, <UI>Synthwave</UI>.
        </LI>
      </UL>

      <Callout tone="tip">
        Every theme is designed as a complete, accessible set, so text stays readable and status
        colors keep their meaning no matter which you land on. Try a few — since the choice only
        affects your own device, you can experiment freely without touching anyone else&rsquo;s view.
      </Callout>
    </>
  );
}
