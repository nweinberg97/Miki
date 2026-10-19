import { ui } from "../lib/store";
import { modKey } from "../lib/util";
import { Dialog } from "../ui/Dialog";
import { Kbd } from "../ui/ui";

const GROUPS: { title: string; items: [string[], string][] }[] = [
  {
    title: "Anywhere",
    items: [
      [[modKey, "K"], "Search and jump"],
      [["C"], "Plant a thought"],
      [["R"], "Speak a thought"],
      [["G"], "Go to the grove"],
      [["1", "2", "3"], "In a project: Roots, Leaves, Trunk"],
      [["?"], "Show shortcuts"],
    ],
  },
  {
    title: "Writing",
    items: [
      [[modKey, "B"], "Bold"],
      [[modKey, "I"], "Italic"],
      [[modKey, "K"], "Link (with text selected)"],
      [[modKey, "Alt", "2"], "Heading"],
      [[modKey, "Alt", "0"], "Paragraph"],
      [[modKey, "Shift", "8"], "Bulleted list"],
      [[modKey, "Shift", "9"], "Quote"],
      [[modKey, "S"], "Save a named version"],
      [[modKey, "Shift", "F"], "Focus mode"],
      [["#", "Space"], "Heading (also > for quote, - for list)"],
    ],
  },
  {
    title: "Trunk",
    items: [
      [["Enter"], "Open the focused piece"],
      [["Alt", "↑ ↓"], "Move it earlier or later"],
      [["Alt", "← →"], "Move it to the previous or next part"],
      [["Delete"], "Take it off the trunk (undoable)"],
    ],
  },
];

export function ShortcutsDialog() {
  const open = ui.use((s) => s.shortcuts);
  return (
    <Dialog open={open} onClose={() => ui.set({ shortcuts: false })} title="Keyboard shortcuts" size="lg">
      <div className="shortcuts">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="eyebrow">{g.title}</h3>
            <dl>
              {g.items.map(([keys, label]) => (
                <div key={label} className="shortcut-row">
                  <dt>{label}</dt>
                  <dd>
                    {keys.map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
