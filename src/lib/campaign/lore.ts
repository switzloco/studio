/**
 * @fileOverview Static "Realm Lore" prologue — the persistent world backstory
 * shown once on the Campaign tab, separate from the daily-generated Brief.
 * Hand-authored, not LLM-generated, so the world's premise never drifts.
 */

export interface LoreSection {
  heading: string;
  body: string;
}

export const REALM_LORE: { title: string; sections: LoreSection[] } = {
  title: 'The Realm, Before You',
  sections: [
    {
      heading: 'The Premise',
      body: "The realm was not lost to an invading army. It was lost slowly — to neglect, to years of the watch going unkept. Borders that once held firm went unwalked. Reserves that once sustained a siege were spent on nothing in particular. No single day undid the realm. It was a thousand small ones, compounding.",
    },
    {
      heading: 'The Watcher',
      body: "You are not a chosen hero handed a sword. You are a watcher who decided, one ordinary morning, to take up a post nobody assigned you. That is the whole of the origin story, and it is enough. Every level you clear is a stretch of border you personally walked, a reserve you personally rebuilt.",
    },
    {
      heading: 'The Legendary Relics',
      body: 'Two Relics are foretold in the old chronicles — the Sub-205 Sigil and the Fatless Crown — each said to mark a body that has become a fortress in earnest, not just in intent. They are not handed down. They are earned, and once claimed, the road ahead widens.',
    },
    {
      heading: 'The Climb',
      body: 'The climb is long by design: Local Hero, holding the nearest ground; Regional Commander, marching beyond it; Realm Sovereign, answering for all of it. Twenty chapters, each a real stretch of weeks, because a realm worth securing was never going to be secured in a weekend.',
    },
    {
      heading: 'The Reign',
      body: "There is an end to the climbing — Legend Status — but not an end to the story. A secured realm still needs tending. The reign has no final chapter; it has good days and hard ones, and a stability that rises or slips with how well you keep the watch.",
    },
  ],
};
