// Work streams (inspired by the OPS/HQ model). Each has a display color.
// Tasks are routed here heuristically and can be reassigned in the UI.
export const STREAMS: { name: string; color: string }[] = [
  { name: "Amazon DSP", color: "#c2702f" },     // orange
  { name: "Shopping/GHB", color: "#2f8f87" },   // teal
  { name: "ACA Compliance", color: "#3a4a78" }, // navy
  { name: "Engineering", color: "#7a4a78" },    // plum
  { name: "Section 125", color: "#5c7a4a" },    // sage
  { name: "EaseClasp", color: "#a8852f" },      // wheat
  { name: "General", color: "#6b7280" },        // grey
];

export const STREAM_NAMES = STREAMS.map((s) => s.name);

export function streamColor(name: string): string {
  return STREAMS.find((s) => s.name === name)?.color ?? "#6b7280";
}
