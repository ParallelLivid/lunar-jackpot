/**
 * The tutorial script: short acts, each opening the first time something happens.
 *
 * Acts rather than one continuous script, because a front-loaded script would
 * explain totems and prestige to a player who owns neither. The act is the unit
 * that opens; a step is one card inside it.
 *
 * An act never opens mid-run except the one that is about the run.
 * `presentsDuringRun` says so per act, `validateContent` refuses any other act
 * that sets it, and the engine reads it in one place.
 *
 * Gates are enumerated ids rather than predicates, so they are serialisable,
 * validatable and testable in isolation. `isTutorialGateMet` in
 * `domain/tutorial.ts` is the one table that resolves them.
 */

import type { HelpTopicId } from "./help";

/**
 * Everything the tutorial can wait for. Most read state that already exists; a
 * run condition and a contract are true only during one run, which is why the
 * engine latches gates rather than reading them live.
 */
export const TUTORIAL_GATES = [
  "gate.machine-purchased",
  "gate.expedition-launched",
  "gate.run-banked",
  "gate.chips-held",
  "gate.cache-held",
  "gate.relics-held",
  "gate.trinket-owned",
  "gate.totem-owned",
  "gate.consumable-held",
  "gate.modifier-seen",
  "gate.contract-offered",
  "gate.prestige-available",
  /** A run that ran out of oxygen. Reads the lifetime counter, so it is latched already. */
  "gate.run-failed",
  // A cat met, and the jukebox earned. Both read lifetime statistics rather than
  // flags, so they survive prestige and the act plays once per save.
  "gate.cat-met",
  "gate.jukebox-unlocked",
  // The developer chord, pressed once. A domain gate rather than a UI one: the
  // flag is set by a command, which is refused mid-run, so this can only latch
  // on the surface and its act needs no exemption.
  "gate.dev-menu-opened",
  // The two gates the domain cannot see: which rail windows are open is React
  // state that is not saved, so the dashboard dispatches `ADVANCE_TUTORIAL` and
  // `isTutorialGateMet` returns false for them.
  "gate.window-opened.gambling",
  "gate.window-opened.store",
] as const;

export type TutorialGateId = (typeof TUTORIAL_GATES)[number];

export function isTutorialGateId(value: unknown): value is TutorialGateId {
  return typeof value === "string" && (TUTORIAL_GATES as readonly string[]).includes(value);
}

/** Gates only the UI can answer. See the comment in `TUTORIAL_GATES`. */
export const UI_TUTORIAL_GATES: readonly TutorialGateId[] = [
  "gate.window-opened.gambling",
  "gate.window-opened.store",
];

/**
 * Which rail window each UI gate is asking for, in one table so the two cannot
 * drift. Keyed by gate because that is the direction the dashboard reads it: it
 * has a step and needs the window that would satisfy it.
 */
export const UI_TUTORIAL_GATE_WINDOWS: Partial<Record<TutorialGateId, string>> = {
  "gate.window-opened.gambling": "gambling",
  "gate.window-opened.store": "store",
};

/**
 * What a card may point at, rendered as `data-tutorial-anchor` on the element,
 * which then takes a dashed outline. Nothing is dimmed and nothing is blocked.
 */
export const TUTORIAL_ANCHORS = [
  "resources",
  "casino",
  "machines",
  "expedition",
  // The rail as a whole, then the individual buttons: outlining a column of
  // twelve icons does not tell a new player which one to press. Every rail
  // button carries `rail.<window id>`; these are the ones the script points at.
  "rail",
  "rail.store",
  "rail.gambling",
  "rail.gear",
  "rail.totems",
  "rail.prestige",
  "rail.jukebox",
  // The litterbox, a dashboard panel rather than a rail button. It renders only
  // once there is a cat in it, which is when its act can open.
  "litterbox",
] as const;

export type TutorialAnchorId = (typeof TUTORIAL_ANCHORS)[number];

/** The Company's departments. One voice; the byline carries the variety. */
export const COMPANY_BYLINES = [
  "OPERATIONS",
  "PAYROLL",
  "COMPLIANCE",
  "WELLNESS",
] as const;

export type CompanyByline = (typeof COMPANY_BYLINES)[number];

export interface TutorialStep {
  id: string;
  /** Byline for the card, or null for a card the Company is not speaking on. */
  speaker: CompanyByline | null;
  title: string;
  /** Forty words is the budget, so the card never scrolls. Enforced. */
  body: string;
  anchor: TutorialAnchorId | null;
  /**
   * What advances this step: the Next button, or something the player does. A
   * gated step shows the hint below instead of a button.
   */
  advance: TutorialGateId | "next";
  /** Shown in place of Next on a gated step. Required for one, unused otherwise. */
  hint?: string;
  /**
   * The help topic this card is the short version of: a card is one paragraph
   * under a word budget, and the reference is the same system in full. Optional,
   * since not every card is the short version of something.
   */
  helpTopicId?: HelpTopicId;
}

export interface TutorialAct {
  id: string;
  /** The act line on the card: "Payday — 1 of 3". */
  title: string;
  /**
   * What opens this act, or `"start"` for the one that plays on a fresh save.
   * Checked against the latch rather than live state, so an act can open after
   * the thing that earned it has passed.
   */
  trigger: TutorialGateId | "start";
  /**
   * May this act's cards appear while a run is in flight? False everywhere but
   * the descent, enforced by `validateContent`.
   */
  presentsDuringRun: boolean;
  steps: TutorialStep[];
}

/**
 * Longest a notice's body may be, in words. A modal the player has to dismiss is
 * the worst place for a wall of text, so the validator enforces this.
 */
export const MAXIMUM_STEP_WORDS = 80;

/**
 * The script: fifteen acts, thirty-one cards.
 *
 * Every act is one system, at most three cards, triggered at the first moment
 * the player can act on it. The last rule is the strictest: the trinket act
 * opens when a trinket is owned, not when a cache that might hold one is.
 *
 * The lore is the frame, never the substance. Every card teaches something
 * operational, and the Company's voice is what it is wrapped in.
 */
export const TUTORIAL_ACTS: TutorialAct[] = [
  {
    id: "act.arrival",
    title: "Arrival",
    trigger: "start",
    presentsDuringRun: false,
    steps: [
      {
        id: "step.arrival.welcome",
        speaker: "OPERATIONS",
        title: "Welcome to Lunar Operations",
        body:
          "Welcome to Lunar Operations. Your outstanding balance has been consolidated, restructured, and reclassified as an exciting career opportunity. You will run a casino at the bottom of a gravity well and take the difference out of everyone who lands here. Accommodation is the facility. Departure is available upon settlement of your balance.",
        anchor: null,
        advance: "next",
      },
      {
        id: "step.arrival.floor",
        helpTopicId: "help.floor",
        speaker: null,
        title: "The floor",
        body:
          "These machines are Company assets placed in your care. Each one runs a cycle, pays out in cash, and continues to do so while you are asleep, absent, or otherwise unproductive. The Company considers this an improvement on your previous arrangement.",
        anchor: "casino",
        advance: "next",
      },
      {
        id: "step.arrival.upgrade",
        speaker: null,
        title: "Your first upgrade",
        body:
          "Cash comes off this floor and goes straight back into it. That is not a policy, it is arithmetic: nothing else on this moon produces it. Buy a level on the machine panel and the payout rises permanently, which is the only kind of raise available here.",
        anchor: "machines",
        advance: "gate.machine-purchased",
        hint: "Buy a machine level to continue.",
      },
    ],
  },
  {
    id: "act.machine",
    title: "The machine",
    trigger: "gate.machine-purchased",
    presentsDuringRun: false,
    steps: [
      {
        id: "step.machine.levels",
        helpTopicId: "help.machines",
        speaker: null,
        title: "Levels",
        body:
          "A level raises the payout for good. It is priced in cash, and every fifth level also requires components, which are not sold — they are recovered from the rock by an employee. You are the employee.",
        anchor: "machines",
        advance: "next",
      },
      {
        id: "step.machine.recipes",
        helpTopicId: "help.floor",
        speaker: null,
        title: "Locked positions",
        body:
          "Nine further machines are catalogued and unbuilt. Their recipe pieces are down in the seams, filed under Lost. Each locked position lists how many pieces remain outstanding; the Company is confident you will attend to it.",
        anchor: "casino",
        advance: "next",
      },
      {
        id: "step.machine.research",
        helpTopicId: "help.machines",
        speaker: "COMPLIANCE",
        title: "Research and specs",
        body:
          "Research raises a machine's output along one line and is bought with chips, which a returning expedition pays you in. A spec trades one property of a machine for another, and only one may run at a time. Ambition is permitted. Both at once is not.",
        anchor: "machines",
        advance: "next",
      },
    ],
  },
  {
    id: "act.descent",
    title: "The descent",
    trigger: "gate.expedition-launched",
    // The one act that may present mid-run, and the reason the flag exists: its
    // cards are about oxygen draining and the decision to press on.
    presentsDuringRun: true,
    steps: [
      {
        id: "step.descent.oxygen",
        helpTopicId: "help.oxygen",
        speaker: "OPERATIONS",
        title: "Your tank is Company property",
        body:
          "Oxygen is the clock, and the tank is Company property. It drains while you walk and while you work, it does not pause for deliberation, and it is refilled at no charge on your return. The Company has found this arrangement encourages punctuality.",
        anchor: "expedition",
        advance: "next",
      },
      {
        id: "step.descent.pickaxe",
        helpTopicId: "help.gear",
        speaker: null,
        title: "The pickaxe",
        body:
          "The pickaxe is also Company property. Better ones break rock faster, and every encounter you see through carries you one depth further down, where the ore is worth more and the company is worse. Both facts are load-bearing.",
        anchor: "expedition",
        advance: "next",
      },
      {
        id: "step.descent.decision",
        helpTopicId: "help.expeditions",
        speaker: null,
        title: "Press on, or bank",
        body:
          "Arriving at an encounter commits you to it; there is no reviewing the terms once you are standing in front of them. Afterwards you choose: press on into something you cannot see yet, or turn back and bank what you are carrying. The Company has no preference. The Company is insured.",
        anchor: "expedition",
        advance: "next",
      },
    ],
  },
  {
    id: "act.payday",
    title: "Payday",
    trigger: "gate.run-banked",
    presentsDuringRun: false,
    steps: [
      {
        id: "step.payday.wages",
        helpTopicId: "help.company",
        speaker: "PAYROLL",
        title: "Wages",
        body:
          "Your ore has been received, weighed, and converted at the posted rate. Per your Voluntary Compensation Election — signed on arrival, alongside everything else — wages are remitted in Company chips, redeemable at any Company gaming device on this facility.",
        anchor: "resources",
        advance: "next",
      },
      {
        id: "step.payday.chips",
        helpTopicId: "help.company",
        speaker: "PAYROLL",
        title: "Chips are not redeemable",
        body:
          "Chips buy research, supplies, caches and looks. Chips do not leave the moon, do not become money, and cannot be presented against your balance. The Company appreciates that this may appear circular, and notes that the alternative was no wages at all.",
        anchor: "resources",
        advance: "next",
      },
      {
        id: "step.payday.games",
        helpTopicId: "help.gambling",
        speaker: "WELLNESS",
        title: "The games",
        body:
          "There are four games on this facility. The Company owns all four, sets the odds on all four, and audits all four itself. Your file records an enthusiasm for such things, which is a great deal of why you were selected. Your treatment plan is proceeding on schedule.",
        anchor: "rail.gambling",
        advance: "gate.window-opened.gambling",
        hint: "Open Chip Gambling from the rail.",
      },
    ],
  },
  /*
   * The one card whose job is direction rather than explanation: the acts open
   * off first-time events, and most of the remaining first times are deeper
   * down. It shares `gate.run-banked` with Payday and is declared after it, so
   * the first complete loop reads: here is what you were paid, here is where to
   * take it.
   */
  {
    id: "act.deeper",
    title: "Down",
    trigger: "gate.run-banked",
    presentsDuringRun: false,
    steps: [
      {
        id: "step.deeper.target",
        helpTopicId: "help.expeditions",
        speaker: "OPERATIONS",
        title: "Your target is depth",
        body:
          "From here the objective is depth and nothing else. Deeper bands pay more for the same work, the nine unbuilt machines have their recipe pieces filed in bands you have not reached, and everything this facility has left to show you opens off how far down you have been. Go as deep as the tank allows.",
        anchor: "expedition",
        advance: "next",
      },
    ],
  },
  /*
   * What a failure actually costs, the first time one happens. The run summary
   * lists what the roll took, but not whether that was a partial loss or a wipe.
   * Two cards: the mechanic, and what was never at risk. Declared after
   * `act.deeper` and before the store, so an early first failure opens it alone.
   */
  {
    id: "act.stranded",
    title: "The dark",
    trigger: "gate.run-failed",
    presentsDuringRun: false,
    steps: [
      {
        id: "step.stranded.roll",
        helpTopicId: "help.oxygen",
        speaker: "OPERATIONS",
        title: "The tank reached zero",
        body:
          "The run ended where you stood. Every unbanked unit was then rolled separately against the loss chance the meters print — ore, components, relics, caches and recipe pieces alike, each on its own draw. Some of a haul usually comes home. None of it is promised.",
        anchor: "expedition",
        advance: "next",
      },
      {
        id: "step.stranded.kept",
        helpTopicId: "help.expeditions",
        speaker: "PAYROLL",
        title: "What was never at risk",
        body:
          "The depth you reached still counts. Anything secured on the way down stays secured, selenite and cats included, and nothing you already owned was ever in the roll. The tank is refilled at no charge. A failure costs the cargo and the time, and the Company has recorded both.",
        anchor: "expedition",
        advance: "next",
      },
    ],
  },
  {
    id: "act.store",
    title: "The store",
    trigger: "gate.cache-held",
    presentsDuringRun: false,
    steps: [
      {
        id: "step.store.cache",
        helpTopicId: "help.caches",
        speaker: "OPERATIONS",
        title: "You are carrying a cache",
        body:
          "You are carrying a sealed cache. Everything below the surface is Company property until it has been opened, and opening requires a key, and keys are sold. The Company is aware you found it yourself, and thanks you for your contribution.",
        anchor: "rail.store",
        advance: "gate.window-opened.store",
        hint: "Open The Company Store from the rail.",
      },
      {
        id: "step.store.keys",
        helpTopicId: "help.caches",
        speaker: null,
        title: "Keys and caches",
        body:
          "A key costs 250 cash and opens one cache of either kind. An ordinary cache usually holds a trinket; a deep one usually holds a totem. The Company does not disclose which, and considers the uncertainty part of the entertainment.",
        anchor: "rail.store",
        advance: "next",
      },
      {
        // Also in the help reference: a rule this easy to get wrong is worth
        // saying in both places.
        id: "step.store.supplies",
        helpTopicId: "help.supplies",
        speaker: null,
        title: "Expedition supplies",
        body:
          "Expedition supplies are bought with chips and spent on the next launch, whether or not it comes home. One of each, at most. The Company has priced them so that using one is a decision rather than a formality.",
        anchor: "rail.store",
        advance: "next",
      },
    ],
  },
  {
    id: "act.trinkets",
    title: "Attachments",
    trigger: "gate.trinket-owned",
    presentsDuringRun: false,
    steps: [
      {
        id: "step.trinkets.attach",
        helpTopicId: "help.trinkets",
        speaker: null,
        title: "Trinkets",
        body:
          "A trinket attaches to the oxygen tank or the pickaxe and improves it. Each of those holds up to three, and the later slots open as its level rises. Nothing you attach becomes yours; it becomes an improvement to Company equipment, in your care.",
        anchor: "rail.gear",
        advance: "next",
      },
      {
        id: "step.trinkets.merge",
        helpTopicId: "help.trinkets",
        speaker: null,
        title: "Merging",
        body:
          "Finding a trinket you already hold pays a fragment instead of a duplicate. Fragments raise its grade, from E all the way to SSS — a hundred times the effect it started with. This is the one ladder on the moon with a top.",
        anchor: "rail.gear",
        advance: "next",
      },
    ],
  },
  {
    id: "act.totems",
    title: "Luck",
    trigger: "gate.totem-owned",
    presentsDuringRun: false,
    steps: [
      {
        id: "step.totems.slots",
        helpTopicId: "help.totems",
        speaker: null,
        title: "Totems",
        body:
          "Three totems may be displayed at once. They deal almost entirely in luck, which shifts the odds toward kinder encounters below and a better return at every table above. The Company does not endorse superstition, and does not interfere with results.",
        anchor: "rail.totems",
        advance: "next",
      },
      {
        id: "step.totems.limits",
        helpTopicId: "help.totems",
        speaker: null,
        title: "What they never touch",
        body:
          "Totems never touch tank oxygen or pickaxe damage. Those belong to gear, and gear is bought with relics, and relics are earned. A totem is a blessing, not a requisition, and the Company is careful about the difference.",
        anchor: "rail.totems",
        advance: "next",
      },
    ],
  },
  {
    id: "act.gear",
    title: "The ladders",
    trigger: "gate.relics-held",
    presentsDuringRun: false,
    steps: [
      {
        id: "step.gear.relics",
        helpTopicId: "help.gear",
        speaker: null,
        title: "Relics",
        body:
          "Relics are spent on gear and on nothing else: twelve levels of oxygen tank, and twelve of pickaxe. They are the only currency here that cannot be gambled, which the Company regards as a regrettable oversight in the design of the facility.",
        anchor: "rail.gear",
        advance: "next",
      },
      {
        id: "step.gear.depth",
        helpTopicId: "help.gear",
        speaker: null,
        title: "What a level opens",
        body:
          "A tank level is worth very nearly one depth. The ladder is what reaches the deeper bands, and the deeper bands are where the remaining machines have their recipes. Everything on this moon is arranged so that the way up runs through the way down.",
        anchor: "rail.gear",
        advance: "next",
      },
    ],
  },
  {
    id: "act.conditions",
    title: "Conditions",
    trigger: "gate.modifier-seen",
    presentsDuringRun: false,
    steps: [
      {
        id: "step.conditions.modifiers",
        helpTopicId: "help.conditions",
        speaker: null,
        title: "Run conditions",
        body:
          "Roughly one run in three is issued under a condition, named in the expedition header before you launch. Most give something and take something. The terms are stated in full, which the Company notes is more than it is obliged to do.",
        anchor: "expedition",
        advance: "next",
      },
      {
        id: "step.conditions.contracts",
        helpTopicId: "help.conditions",
        speaker: "OPERATIONS",
        title: "Contracts",
        body:
          "A contract is offered mid-run, for a depth a little further down than you had intended. It states what it will pay. It does not state what it will cost, because that is not the Company's to know. Ignoring one costs nothing at all.",
        anchor: "expedition",
        advance: "next",
      },
    ],
  },
  {
    id: "act.prestige",
    title: "The offer",
    trigger: "gate.prestige-available",
    presentsDuringRun: false,
    steps: [
      {
        id: "step.prestige.severance",
        helpTopicId: "help.prestige",
        speaker: "COMPLIANCE",
        title: "Severance",
        body:
          "You may now prestige. Everything on this cycle is cleared — currencies, machines, both gear ladders — and you are paid in selenite for the inconvenience. Selenite is the only thing on this moon that survives the paperwork.",
        anchor: "rail.prestige",
        advance: "next",
      },
      {
        id: "step.prestige.keep",
        helpTopicId: "help.prestige",
        speaker: "COMPLIANCE",
        title: "What you keep",
        body:
          "You keep every trinket, totem, cat and look, and the selenite, and the perks it buys. Your balance is unchanged. Your contract renews immediately, on the same terms, and the Company thanks you for your continued enthusiasm.",
        anchor: "rail.prestige",
        advance: "next",
      },
    ],
  },
  /*
   * The two incidental acts, for the cat and the jukebox. Declared after the
   * progression and before the console, because declaration order decides which
   * act wins when two triggers latch together and neither of these is
   * progression. Both are one card and both present on the surface: they latch
   * underground, but the litterbox and the jukebox button are up here.
   */
  {
    id: "act.cat",
    title: "Morale",
    trigger: "gate.cat-met",
    presentsDuringRun: false,
    steps: [
      {
        id: "step.cat.met",
        helpTopicId: "help.cats",
        speaker: "WELLNESS",
        title: "An unlisted asset",
        body:
          "A cat has been recorded on this facility. It is not on the manifest, it did not arrive by requisition, and it is not to be removed. Wellness studies indicate a measurable improvement in fortune where one is present, so the Company has reclassified it as equipment. It lives in the litterbox now. Click one to change how it looks.",
        anchor: "litterbox",
        advance: "next",
      },
    ],
  },
  {
    id: "act.jukebox",
    title: "Requests",
    trigger: "gate.jukebox-unlocked",
    presentsDuringRun: false,
    steps: [
      {
        id: "step.jukebox.unlocked",
        helpTopicId: "help.music",
        speaker: "OPERATIONS",
        title: "Audio requisition approved",
        body:
          "Your descent has qualified you for the facility's audio requisition. Any of the six approved recordings may be selected, and it will play everywhere — every depth, every launch, every failure — regardless of what is happening around you. The Company finds a consistent soundtrack reduces reported incidents. Volume remains in Settings.",
        anchor: "rail.jukebox",
        advance: "next",
      },
    ],
  },
  /*
   * The console, noticed. Last in the array on purpose: it is not part of the
   * progression, and an act triggered by a keystroke should never queue in front
   * of one the player earned. `presentsDuringRun` is false and need not be
   * anything else, since the menu is refused mid-run.
   */
  {
    id: "act.devmenu",
    title: "Oversight",
    trigger: "gate.dev-menu-opened",
    presentsDuringRun: false,
    steps: [
      {
        id: "step.devmenu.noticed",
        helpTopicId: "help.save",
        speaker: "COMPLIANCE",
        title: "The maintenance console",
        body:
          "The Company has noted your interest in the maintenance console. Every value in it is real, is saved, and is checked on the way in exactly as a loaded file is. From the first edit this save is marked, permanently. The mark is not an accusation. It is a filing category, and the file is now in it.",
        anchor: null,
        advance: "next",
      },
    ],
  },
];

export const TUTORIAL_ACT_IDS: string[] = TUTORIAL_ACTS.map((act) => act.id);

export function findTutorialAct(actId: string | null): TutorialAct | null {
  return TUTORIAL_ACTS.find((act) => act.id === actId) ?? null;
}

/** Words in a step's body, for the budget the validator enforces. */
export function stepWordCount(step: TutorialStep): number {
  return step.body.trim().split(/\s+/).filter((word) => word.length > 0).length;
}
