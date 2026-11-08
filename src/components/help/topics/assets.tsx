import { Lead, H2, P, UL, LI, Callout, DefList, Def, Steps, UI, Screenshot } from "@/components/help/prose";

export default function Assets() {
  return (
    <>
      <Lead>
        <strong>Assets</strong> is your team&rsquo;s shared shelf of reusable files: the photos,
        video clips, voice-over, icons, Storyline and PowerPoint sources, and brand templates that
        every project ends up hunting for again. Upload them once, or link to where they live, tag
        them with labels, and see which content uses each one.
      </Lead>

      <P>
        The library holds files and pointers to them. It isn&rsquo;t where you build a course;
        you still do that in your authoring tool. Like the content inventory, it belongs to the
        whole workspace: everyone in it can find and reuse every asset.
      </P>

      <Screenshot
        name="assets-library"
        alt="The Assets page: Upload files and Add a link buttons, filters for type, label, use and archived, and a grid of asset cards with image thumbnails, types, sizes and labels"
        caption="The asset library."
      />

      <H2>Add assets</H2>
      <Steps>
        <>
          Open <UI>Assets</UI> in the sidebar and choose <UI>Upload files</UI>, or drop files
          anywhere on the page. You can upload several at once, up to 95&nbsp;MB each.
        </>
        <>
          Each upload is named after its file and given a type (<UI>Image</UI>, <UI>Video</UI>,{" "}
          <UI>Audio</UI>, <UI>Document</UI>, <UI>Template file</UI> or <UI>Other</UI>). Upload one
          file and its page opens so you can rename it and describe it straight away.
        </>
        <>
          For something that lives elsewhere, such as a Drive folder, a Figma file or a stock
          library, choose <UI>Add a link</UI> instead. The library keeps the link, not a copy.
        </>
      </Steps>

      <H2>An asset&rsquo;s page</H2>
      <P>
        Images, video and audio play right on the page, and PDFs open in a new tab. Everything else,
        such as Office files, zips, SVGs and authoring-tool sources, downloads with{" "}
        <UI>Download</UI>. Tavoro decides what can be shown by reading the file itself, not its
        name, so a file can&rsquo;t pass itself off as a picture.
      </P>
      <DefList>
        <Def term="Description">
          What it is, where it came from, and any licence or usage terms. For an image it&rsquo;s
          also the alt text.
        </Def>
        <Def term="Labels">The workspace&rsquo;s labels, the same ones cards and content use.</Def>
        <Def term="Used in">The content in the inventory that uses this asset.</Def>
      </DefList>

      <Screenshot
        name="asset-item"
        alt="An asset's page: the image preview with Download and Replace file buttons, its details, labels, and the content items that use it"
        caption="An asset, with the courses that use it."
      />

      <H2>Replace a file</H2>
      <P>
        When a photo is reshot or a template is updated, open the asset and choose{" "}
        <UI>Replace file</UI>. The asset keeps its name, labels and links to content; only the file
        changes, and the old one is deleted. A link asset has <UI>Upload a file instead</UI>, which
        turns it into an uploaded file.
      </P>

      <H2>Record where assets are used</H2>
      <P>
        On a content item&rsquo;s page, choose <UI>Add from library</UI> under <UI>Assets</UI>, or on
        an asset&rsquo;s page choose <UI>Add to content</UI>. Then, when the photographer&rsquo;s
        licence runs out or the logo changes, the asset&rsquo;s <UI>Used in</UI> list shows every
        course to update. Removing an asset from content leaves it in the library.
      </P>

      <H2>Find assets</H2>
      <P>
        Search by name, file name or description, and filter by type, label, or{" "}
        <UI>Not used in any content</UI> to find what&rsquo;s sitting unused. Filters are kept in the
        address, so you can share a filtered view. Search (<UI>Ctrl K</UI>) finds assets by name too.
      </P>

      <H2>Archiving and deleting</H2>
      <P>
        When an asset shouldn&rsquo;t be reused any more, choose <UI>Archive</UI>. It leaves the
        library&rsquo;s default view (choose <UI>Archived</UI> in the filter to see it) but keeps its
        file and its links to content. <UI>Restore</UI> puts it back.
      </P>
      <Callout tone="note">
        Anyone in the workspace can add, edit, label and archive assets. Deleting removes the file
        for good, so only the person who added the asset, or an admin or manager, can delete it.
      </Callout>

      <H2>Elsewhere in Tavoro</H2>
      <UL>
        <LI>
          AI assistants connected over MCP can find and describe assets, add links, label and
          archive them, and record which content uses them. Files themselves are uploaded in the
          app.
        </LI>
        <LI>Workspace backups include the library, with every uploaded file.</LI>
      </UL>
    </>
  );
}
