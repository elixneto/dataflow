/*
 * The size of a component on the canvas and where its ports are, in canvas px (the grid step is 16). Shared by the
 * node (component-node.tsx) and the auto-connect on drop (auto-connect.ts).
 */

/** every card has this size, in grid steps (4 × 10); the first port is at the middle of its height */
export const CARD_HEIGHT = 64;
export const CARD_WIDTH = 160;
/** the card is drawn this much narrower than its grid width: cards snapped side by side keep this gap (the bump sits in the next one's hole) */
export const SIDE_GAP = 6;
/** a gap between cards stacked one under another: one grid step, so snapped cards line up (64 + 16 = 80) */
export const STACK_GAP = 16;
/** between one port and the next, downwards: a card's height and the gap, so each port lines up with a card below */
export const PORT_GAP = CARD_HEIGHT + STACK_GAP;

/** the port's height from the top of the card */
export const portTop = (i: number) => CARD_HEIGHT / 2 + i * PORT_GAP;
