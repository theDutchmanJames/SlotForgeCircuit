<p align="left">
  <img src="app/icon.svg" alt="SlotForge Circuit icon" width="96" align="right">
  <img src="docs/images/slotforge-brand.png" alt="SlotForge — Slotcar App Collection" width="400">
</p>
<br clear="both">

# SlotForge Circuit

**Design it. Build it. Race it.**

SlotForge Circuit is a slotcar track designer for planning your next circuit before building it for real. Snap together branded track pieces, create your own pieces with matching artwork, design routed wood sections, or draw a complete circuit with FreeForm.

Check the space you need, count your pieces, compare lane lengths and watch cars follow your design. Save your tracks and custom packs, export plans for the workshop, and share track geometry and animation profiles with **SlotForge Timing**.

**One browser app for Windows, macOS and Linux. Your designs stay on your computer. No account required.**

[Download Circuit](https://github.com/theDutchmanJames/SlotForgeCircuit/releases/latest) · [See the app](#pictures-of-the-app) · [Explore the features](#features-and-functionality) · [How to install](#how-to-install) · [Report a problem](#reporting-problems)

## SlotForge App Collection

SlotForge Circuit is part of the **SlotForge App Collection**—apps for building tracks, managing your cars, designing their appearance and exploring their performance.

- <img src="https://raw.githubusercontent.com/theDutchmanJames/SlotForgeTiming/main/build/icon.png" alt="" width="24" height="24" align="absmiddle"> **[SlotForge Timing](https://github.com/theDutchmanJames/SlotForgeTiming)** — Lap timing, race management and custom race displays for analogue slot-car tracks.
- <img src="https://raw.githubusercontent.com/theDutchmanJames/SlotForgePaddock/main/assets/icon.png" alt="" width="24" height="24" align="absmiddle"> **[SlotForge Paddock](https://github.com/theDutchmanJames/SlotForgePaddock)** — Organize your slotcar collection, photographs, parts, setups and maintenance in a virtual garage and workshop.
- <img src="https://raw.githubusercontent.com/theDutchmanJames/SlotForgeTelemetry/main/assets/icon.png" alt="" width="24" height="24" align="absmiddle"> **[SlotForge Telemetry](https://github.com/theDutchmanJames/SlotForgeTelemetry)** — Explore gearing, motors, tyres and weight, compare setups, and analyse recorded lap times.
- <img src="https://raw.githubusercontent.com/theDutchmanJames/SlotForgeDecals/main/assets/icon.png" alt="" width="24" height="24" align="absmiddle"> **[SlotForge Decals](https://github.com/theDutchmanJames/SlotForgeDecals)** — Size and arrange artwork into decal sheets, then export a PDF for printing.
- <img src="https://raw.githubusercontent.com/theDutchmanJames/SlotForgeLivery/main/assets/icon.png" alt="" width="24" height="24" align="absmiddle"> **[SlotForge Livery](https://github.com/theDutchmanJames/SlotForgeLivery)** — Plan paint schemes, stripes, race numbers and decals on editable 2D car templates.

Visit each app's repository for its features, downloads and getting-started guide. Circuit was previously called SlotForge Track Builder; its repository is now SlotForgeCircuit.

## Pictures of the app

**Track Builder** — plan a circuit with a locked space guide, lane lengths and a start/finish line.

[![Track Builder showing a complete circuit inside a locked available-space guide](docs/screenshots/track-builder.png)](docs/screenshots/track-builder.png)

| Track packs | Custom-piece editor | Export |
| --- | --- | --- |
| [![Built-in track packs and the custom pack editor](docs/screenshots/track-packs.png)](docs/screenshots/track-packs.png) | [![Custom curve editor with dimensions and matching radius families](docs/screenshots/custom-piece.png)](docs/screenshots/custom-piece.png) | [![Export page with track selection and PDF, SlotForge Timing, PNG and CSV options](docs/screenshots/export.png)](docs/screenshots/export.png) |
| Browse branded packs or create your own. | Define dimensions, lane spacing and matching curves. | Choose a track and the format you need. |

Click any screenshot to view it at full size. These pictures show an earlier interface under the SlotForge Track Builder name; the app is now SlotForge Circuit.

## Features and functionality

### Build with the track pieces you own

Choose a track pack, browse **Straights, Corners, Digital pieces and Extras**, then add pieces to the canvas. Each pack has artwork that reflects its own track system.

The right-hand **Track tools** panel keeps a compact track summary above expandable folders. **Selected piece** puts editing actions first, with position and rotation inside their own folder. Open **Heights & bridges**, **Timing line & direction**, **Lengths & measurements**, **Routed materials & checks**, or **Parts list** as needed. Check badges remain visible on closed folders. **Tune profile** has its own tab.

- **Drag and snap:** magnetic connections join track ends. Side snapping aligns parallel straights and matching nested curves for layouts with more than two lanes. Hold Shift while dragging to bypass snapping.
- **Arrange your layout:** rotate, mirror and duplicate pieces, select several at once, and use Undo/Redo while experimenting. Remembered mirroring makes it easier to keep adding corners in the direction you want.
- **Include the finishing touches:** add matching borders to selected roads and change the foreground/background order where sections overlap.
- **Check the plan:** see open ends, piece quantities, the footprint including borders, and calculated track and lane lengths where the geometry supports them.

Dimensions are physical **millimetres**. A pack's model scale describes the cars and track system; it does not shrink or enlarge the pieces in your plan.

### Built-in track packs

Circuit includes ten manufacturer packs, alongside its routed wood tools and custom pack editor:

| Track system | Model scale | Coverage |
| --- | --- | --- |
| Carrera Evolution / Digital | 1:32 / 1:24 | Core roads and borders, plus selected special pieces |
| Scalextric Sport / Digital | 1:32 | Core roads and borders, plus selected special pieces |
| Policar | 1:32 | Core roads and borders, plus selected special pieces |
| ScaleAuto Pro Track | 1:32 | Core roads and borders, plus selected special pieces |
| Ninco Classic / N-Digital | 1:32 | Core roads and borders, plus selected special pieces |
| SCX Universal / Classic / Advance | 1:32 | Reference artwork and approximate visual planning |
| AFX Racing / Tomy | HO / 1:64 | Flat straights and curves, with special-piece references |
| Carrera GO!!! | 1:43 | Flat straights and R1/R2 curves, with special-piece references |
| Carrera Hybrid | 1:50 | Approximate visual layouts with snapping, artwork and piece counts |
| Fleischmann Auto-Rallye | 1:32 | Historic flat straights and three nested curve families |

The **Track Packs** page brings built-in catalogues and your own packs together. Search by name or scale, filter by **Built-in** or **My packs**, browse pieces, and choose **Use in builder** without replacing your current layout.

To tidy your own packs, choose **Edit pack**. Use **Delete from pack** on a piece, or select several and choose **Delete selected**. Deletion is saved automatically after confirmation. Existing layouts and saved Track Library designs keep their copies; an empty pack stays available for new pieces.

Coverage varies by piece. Where exact geometry is unavailable, reference artwork and adjustable approximate shapes still let you plan a layout and export its picture and parts list. Unknown slot lengths are not presented as measured values. Carrera Hybrid is slotless, so its visual plans do not provide slot lengths or slot-following animation. The AFX pack covers modern Tomy/AFX, not vintage Aurora A/FX.

Pack catalogues identify their dimension sources and assumptions. Calculated lengths are nominal planning values; check actual pieces and physical fit before building.

### Make your own pieces and reusable packs

**Define the dimensions; Circuit draws the piece and its matching icon.** Create a named custom pack and fill it with straights, curves, borders and lane changers. Set the surface width, lane count, slot spacing, road colour and connector family.

For corners, use **matching radius families** to create R1, R2, R3 and larger curves that nest together. The editor shows the inner and outer road radii and previews how the family fits. Slot spacing and road width are separate settings, so you can describe your own system accurately.

Save the set to the **Track Pack Library**, add more pieces later, or export it for another user. Imported packs appear in **My packs**. These packs contain piece definitions and dimensions, not executable plugins; users can add new systems without waiting for an app update.

### Design routed wood tracks

Use **Routed Wood** to plan straights, circular corners and flowing Bézier curves. Work with separate wooden sections or route slots into a continuous tabletop:

- **Individual piece:** each section has its own wood outline and edge clearances.
- **Tabletop routing:** the table defines the boundary, so imaginary section edges do not limit a continuous routed layout.

Set your lane count and spacing, slot width and depth, board thickness, edge clearances, and braid or tape dimensions. Circular corners use the **innermost slot radius**. Flowing curves have draggable handles, direction locks and exact coordinates for controlled adjustments.

Edge clearances belong to the first and last slots. New flowing bend presets match the profile preview, and new routed straights align their margins when connected to a bend. Mirroring is reflected in the section preview; existing saved sections keep their geometry.

Save useful sections into a named pack, add them to a layout, and reuse them on another design. Convert circular corners into editable flowing approximations when you need a less uniform bend.

**Need to close a loop?** Use **Fill closing gap**, **Bridge selected ends** or **Reshape to close**. Preview the proposed connection and adjust it while keeping the other sections in place. Undo lets you try another approach.

**Adjust lane spacing on a straight or bend.** Choose **Squeeze** to bring lanes closer—for example, **100 → 80 → 100 mm**—or **Spread** to move them apart, such as **100 → 140 → 100 mm**. **Smooth midpoint / apex** blends gradually toward the target and restores normal spacing at both ends. New routed spreads keep the bundle centre fixed on straights and the innermost lane fixed on corners, so the other lanes expand outward. You can still choose another anchor. Existing spreads keep their saved settings; use **Lane spacing → Spread outward** to update a corner. The preview, calculated lengths and exports follow the adjusted paths.

Circuit checks for slot and conductor folds or overlaps, highlights tight radii, and estimates slot and conductor lengths. These are design aids; cutter setup, car clearance and construction decisions remain part of the physical build.

**Keep an unfinished idea:** the flowing-curve editor has an **Override folds · planning only** option. It lets you save, edit and snap a section even when its wood edge, slots or braid fold or cross. You can still export pictures and PDF plans with piece counts. Planning-only sections are excluded from calculated lengths and materials; a layout containing one cannot run Live Preview or export SVG/DXF construction geometry. Repair the shape and turn off the override to restore those functions.

### Draw a circuit freely with FreeForm

**Start with one lane. Shape the circuit first, then generate the others.** FreeForm Drawing gives you a dedicated editor for a continuous slot, with smooth Bézier curves instead of a catalogue of fixed pieces.

Place points, drag curve handles and close the loop. Add points without changing the existing curve, move several anchors together, lock finished points, and experiment with Undo/Redo. The **Points, Lanes, Table and Checks** tabs keep the controls organised.

Your drawn slot can become **any lane**. If it is Lane 3 of a four-lane circuit, choose Lane 3, set the spacing and generation side, and Circuit places the other lanes around it. New drawings start with one lane; saved designs retain their settings.

Use **Points → Lane spacing — next stretch** to squeeze or spread the other lanes smoothly toward a straight or curved stretch’s midpoint while leaving the drawn slot in place. For a figure eight, give the upper passage enough height and headroom using the point height controls.

Save unfinished drawings and continue later. Send a finished design to the builder, keep it in the **Track Library**, and use **Edit FreeForm** to return to its editable points. Supported closed loops can use Live Preview and the normal exports.

[FreeForm controls and limits](app/FREEFORM-TOOLS.txt)

### Plan your table, space and bridges

Create a **rectangle or L-shaped table / space guide** with your actual dimensions. For an L shape, choose the removed corner and its cut-out size. Move and resize the guide, then lock it so it stays out of the way while arranging track. Routed and FreeForm plans include the table in fit checks and relevant exports.

**Build a table from boards:** choose **Table Designer** in the table settings. Add boards with your own dimensions, drag and snap their edges together, duplicate them, rotate them 90°, and lock finished boards. The track stays in place while you arrange its support. Fit checks follow the combined surface, including gaps and openings.

**Split it for transport or construction:** select a board and preview a horizontal or vertical cut. The two resulting panels share an exact edge. Open **Splits & stock sheets** to preview suggested cuts that fit your sheet and transport limits. Review the seams over your track before applying; locked boards stay intact.

For flat routed layouts, open **SVG / DXF** and choose a panel to export, or download **all panels as a ZIP**. Each numbered SVG/DXF includes the board outline and the selected slot and braid/tape paths, neatly trimmed at its boundary. The ZIP also includes an assembly PDF and panel positions. Full-size geometry is preserved; no kerf or cutter compensation is applied. Save a stock plan to include sheet layouts with the track geometry arranged in place. Set sheet dimensions, margins, panel gaps and optional 90° rotation; compare the estimated sheet count and material usage. The arrangement is not guaranteed to be optimal. Bridge panel assignment and arbitrary cuts are not yet included.

[Table Designer and panel export guide](app/TABLE-PANELS.txt)

Use **Heights & bridges** on track pieces to set start and end surface heights, deck thickness and required headroom. FreeForm provides the same planning through its point controls. Joined ends need matching heights, and crossings need enough clearance for the lower passage.

The editor remains a **2D planning tool**. Lengths and CAD geometry are plan-view values; Circuit does not engineer ramps, check structural supports or provide a 3D simulation. Reference-piece footprints are approximate.

[Height controls and limitations](app/HEIGHTS-AND-BRIDGES.txt)

### Watch your layout and tune the animation

Run **Live Preview** on a supported closed circuit to watch two cars follow its slots. Adjust the profile's speed, acceleration, braking, cornering and outward visual drift to change how they move through the layout.

In **Tune profile → Car size**, choose **1:32, 1:24, 1:42 or 1:64**, or enter a custom car length and width in millimetres. Both preview cars use those physical dimensions and zoom with the track. The presets scale a generic 4.5 m × 1.8 m car; use Custom for the dimensions of your actual model. Car size is saved with the track and does not change the driving profile.

The profile shapes an illustrative animation. It does not predict real lap times, check collisions or replace physical testing.

### Keep a Track Library

Use **Save to Library** to keep named designs you can reopen, compare, share or export. Your current drawing and custom packs are saved locally as you work; saving to the library keeps a named snapshot.

With the installed launcher, the workspace is stored in a **local SQLite database on your computer**. Closing the browser, restarting or clearing browser data does not remove it. Existing JSON workspaces migrate automatically after verification; their original files are kept. No database setup is needed.

Browse **24 tracks per page**, search by name, and open only the design you need. Cached previews keep browsing lightweight. The installed library supports up to **5,000 tracks**, within a 200 MiB saved-data limit. Custom pack contents are paged too; their existing limits remain 100 packs and 500 custom pieces overall.

The **Storage** button in the **bottom-right footer** shows **Storage: disk** or **Storage: browser**. Open it to check the storage location, download a workspace backup or import a workspace transfer. **Download previous save** lets you recover the preceding saved workspace without changing your current work. Keep a backup on another device as well: recovery history inside the database is not a separate backup.

After migration, the older JSON files are recovery copies from that moment; new edits go into SQLite. Stop the app before copying its data folder, and use workspace exports when moving between installations. [Storage and recovery details](app/SQLITE-STORAGE.txt)

Opening the HTML file directly uses browser storage instead of the installed disk workspace. That workspace can differ between browsers, folders and addresses. Use the installed launcher for consistent local file storage.

### Import, share and export

The **Import & Export** page separates **Tracks** from **Track Packs**, with a selector for exactly what you want to export.

**To share an editable track:** choose your current builder track or a saved Track Library entry, then click **Export track JSON**. The `.slotforge.json` file carries the layout and its piece definitions. On another computer, choose **Import track JSON**, open the file, then **Save to Library** to keep a named copy. Importing offers a chance to export the current track before replacing it.

**To share reusable pieces:** choose **Track Packs**, select a pack and click **Export pack JSON**. **Import pack JSON** adds a pack to My packs without replacing the track being built. Built-in pack exports contain supported piece definitions; some reference-only catalogue artwork is excluded.

| Format | What you can do with it |
| --- | --- |
| Track JSON | Reopen and edit a complete design in Circuit, or transfer supported track data to SlotForge Timing |
| Track pack JSON | Share a reusable collection of pieces |
| PDF | Download a printer-friendly report with the track name, drawing, piece quantities and available calculated lengths; choose portrait or landscape |
| PNG | Save a transparent track picture, with optional borders |
| CSV | Open the parts list in a spreadsheet |
| SVG / DXF | Take routed construction geometry into drawing and CAD software |

PDFs are generated **inside Circuit** and downloaded directly—there is no browser print dialog to configure.

### Take routed designs into CAD

Export slot centrelines, slot edges, braid or tape edges, surface contours and the table on separate SVG/DXF layers.

**SVG** defaults to full size. Choose **Compact page** or a fixed scale for a smaller drawing document; the export dialog tells you how much to enlarge it again. **DXF** uses full-size millimetres and retains native circular arcs. An optional 100 mm scale-check bar helps verify the import.

SVG exports use **clear black lines** by default so the drawing is easy to see on a white page. In **SVG / DXF → SVG appearance**, choose **Layer colours · fine CAD lines** if you prefer coloured construction layers. This also applies to panel and stock-sheet SVGs. The choice changes line appearance only; dimensions, paths and DXF geometry stay the same.

Use your CAD/CAM software to configure cutters, machining depths and toolpaths. Circuit supplies planning geometry, not machine-ready cutting instructions.

[SVG / DXF export details](app/CAD-EXPORTS.txt)

### Connect your design to SlotForge Timing

The **track JSON export** also carries lane routes, timing-line settings and the tuned car-animation profile for [SlotForge Timing](https://github.com/theDutchmanJames/SlotForgeTiming). It provides the design data for track database and Live Tracker integration, so your race display can follow the layout you planned.

The Timing importer must support the features used by the design. Imported lengths are calculated nominal values. During a race, **real sensor crossings remain authoritative**: animation profiles only shape estimated movement and cannot award laps or change results.

### Make Circuit look the way you want

Use the prominent **Light / Dark** switch for a quick change, or open **Settings → App Theme** for the SlotForge theme presets and custom colours. Set backgrounds, panels, text, lines and accents, with an immediate preview.

Track artwork keeps its physical colours, and PDF reports remain printer-friendly regardless of your chosen app theme.

## How to install

**Circuit runs in your browser.** The installer places the app and a local helper on your computer so tracks and custom packs can be saved to disk. You do not need an account, npm or a manual Node.js installation.

1. Open the **[latest release](https://github.com/theDutchmanJames/SlotForgeCircuit/releases/latest)** and download the **complete ZIP package** from its Assets.
2. **Extract the entire ZIP** into a folder.
3. Run the installer for your operating system:

| System | File to run |
| --- | --- |
| Windows | Double-click **Install Windows.cmd** |
| macOS | Open **Install macOS.command** |
| Linux | Run `sh "Install Linux.sh"` in the extracted folder |

The installer opens Circuit in your browser. Choose a track pack or open **Routed Wood** or **FreeForm Drawing** to start designing.

First-time setup needs an internet connection to download the local runtime. **After setup, Circuit works offline.** Next time, use the **SlotForge Circuit** desktop shortcut on Windows, or **Start SlotForge** in the installed folder on macOS/Linux. The installer shows that location.

Windows installation has been tested. The macOS and Linux installers are available for testing but have not yet been tested on those systems.

### Update an installed copy

1. In Circuit, click **Storage: disk** in the **bottom-right corner** and choose **Download workspace backup**. Keep that JSON file somewhere safe.
2. In the same Storage window, choose **Stop local app**, then close the tab.
3. Download and fully extract the latest complete ZIP, then run its installer again. **Your saved data is kept.**

If the footer reads **Storage: browser**, there is no local helper to stop. If saving has failed, use **Storage → Download workspace backup** before reloading or updating.

### Moving to SQLite: automatic, with your originals kept

The installed app now keeps its workspace in **`data/workspace.sqlite`**. SQLite is included with Circuit's local helper: there is nothing extra to install, and your data stays on your computer.

On the first launch after updating, Circuit checks your existing JSON workspace, copies its tracks, custom packs and current drawing into a separate database, and verifies the result before using it. Your original **`workspace.json` and `backups` folder stay untouched**. Saved track identities, custom piece definitions and empty packs are retained.

After that, new saves go into SQLite. The old JSON files are **migration-time recovery copies**, not up-to-date backups. Do not delete the database or start an older app against the same data folder to roll back. If migration reports a problem, keep the complete data folder and report the message; Circuit does not silently replace an invalid database with an empty library.

Use **Storage → Download workspace backup** for a portable backup of your latest work. **Download previous save** retrieves the preceding saved workspace without changing the current one. To copy the data folder itself, stop the local app first, then copy the **whole folder**. The database's built-in recovery history is useful, but does not replace a backup on another drive.

This upgrade also makes the **Track Library** lighter to browse: 24 tracks per page, name search and cached previews, with full designs loaded when needed. Custom pack pieces are paged as well. Opening the HTML directly still uses browser storage; use **Import workspace transfer** to bring that work into an installed copy.

[SQLite storage, migration and recovery details](app/SQLITE-STORAGE.txt)

### Bring your existing work with you

In the original app, choose **Storage → Download workspace backup**. In the installed copy, choose **Storage → Import workspace transfer**, select the file, then **Reload imported workspace**. Imported tracks and packs are added to the library; existing work is kept. You can also transfer tracks and packs individually using JSON exports.

Circuit was previously called SlotForge Track Builder. Older shortcuts still work, and the installation and data folders retain the `SlotForgeTrackBuilder` name so your saved workspace stays intact.

[More setup details](START-HERE.txt) · [Installer and storage details](installer/README.txt)

## Reporting Problems

Found a bug, an incorrect piece or a tool that could work better? **[Open a GitHub issue](https://github.com/theDutchmanJames/SlotForgeCircuit/issues)**. Feature suggestions are welcome too.

Please include:

- Your Circuit version, operating system and browser.
- What you were trying to do, the steps to reproduce it, and what happened instead.
- Any error message and a screenshot where useful.
- For a layout problem, a small exported track JSON that reproduces it.
- For a track-piece problem, its brand, product code and any published dimensions or reference pictures.

If the launcher does not open the browser, check its error message and `data/launcher.log` in the installed folder. Windows shows the local address in its error dialog; macOS/Linux launchers print the log location in the terminal. Re-running the latest installer can repair an older shortcut while keeping saved data.

If a save fails, download a workspace backup from **Storage** before reloading. Only attach files and logs you are comfortable sharing publicly.

## License and Copyright

**Copyright © 2026 theDutchmanJames and contributors.**

Circuit uses the **[SlotForge Source-Available License 1.0 — No Software Sales or Paid Access](LICENSE)**.

- **Free to use**, including personal, educational, club and internal business use.
- **Free to study, modify and share**, with the license and notices retained.
- **Selling the software or charging for access is prohibited**, including modified or hosted versions, without separate written permission from the relevant copyright holders.
- **Your own track designs, custom packs and exports may be used commercially**, subject to rights in any third-party material they contain. This does not permit selling copied stock catalogues or the software itself as an output.

These are **source-available** terms, not an OSI-approved open-source license. Bundled libraries, fonts and the Node.js runtime retain their [own licenses](THIRD-PARTY-NOTICES.txt). The full license controls over this summary.
