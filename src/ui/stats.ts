import { renderMessage } from './shell';

/** Small streak badge for the home page's daily card, or null when there's nothing to show. */
export function statsBadge(): HTMLElement | null {
  return null;
}

/** "Your charts": streaks and score history. Placeholder until the stats feature lands. */
export async function renderStats(_gen: number): Promise<void> {
  renderMessage('Your charts', 'Coming soon.');
}
