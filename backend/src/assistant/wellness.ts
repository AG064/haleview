import type { HealthProfile } from "../profile.js";
import type { ChatReference, ToolResult } from "./types.js";

const guidance = {
  sleep: {
    title: "A more consistent sleep routine",
    lines: ["Keep a regular bedtime and wake-up time where possible.", "Use a calm wind-down routine and keep your sleeping space comfortable.", "Avoid caffeine late in the day if it affects your sleep."],
    details: ["Notice whether work, stress or evening habits are affecting your sleep. Try one practical change at a time.", "If sleep problems persist or affect daily life, discuss them with a healthcare professional."],
  },
  activity: {
    title: "Build a sustainable activity routine",
    lines: ["Choose an activity you enjoy and start at a comfortable level.", "Increase activity gradually and include recovery time."],
    details: ["A short walk or a manageable exercise session can be easier to repeat than an ambitious schedule.", "Stop if an activity causes pain or concerning symptoms and seek appropriate medical advice."],
  },
  stretching: {
    title: "Gentle movement and stretching",
    lines: ["Use gentle, comfortable movements without forcing a stretch.", "Stop if movement causes or worsens pain. A physiotherapist can help choose suitable movements for persistent back pain."],
    details: ["Warm up gently and avoid bouncing or holding your breath.", "I cannot assess the cause of pain or prescribe a rehabilitation routine."],
  },
  hydration: {
    title: "Keep fluids accessible",
    lines: ["Drink regularly during the day and pay attention to thirst.", "Keep water available around your meals and activities."],
    details: ["Fluid needs vary with activity and conditions. Follow professional advice if you have a prescribed fluid restriction."],
  },
  stress: {
    title: "Make room for recovery",
    lines: ["Take short breaks and make time for activities you find calming.", "A consistent routine, gentle movement and talking with someone you trust can help."],
    details: ["If stress is persistent, overwhelming or disrupting daily life, seek support from a qualified professional."],
  },
};

export function wellnessGuidance(profile: HealthProfile, topic: NonNullable<ChatReference["wellnessTopic"]>): ToolResult {
  const selected = guidance[topic];
  return { ok: true, section: { ...selected, kind: "wellness", lines: [...selected.lines], details: [...selected.details, `Your saved fitness goal is ${profile.fitnessGoal.replaceAll("_", " ")}. Adapt routine changes to what feels manageable for you.`] }, reference: { topic: "wellness", wellnessTopic: topic } };
}
