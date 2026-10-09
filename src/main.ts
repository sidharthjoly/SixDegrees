import '@fontsource/rubik-mono-one/400.css';
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import './styles/base.css';
import './styles/tracks.css';
import './styles/home.css';
import './styles/play.css';
import './styles/result.css';
import './styles/archive.css';
import './styles/stats.css';
import './styles/share.css';
import './styles/squares.css';
import './styles/challenge.css';
import './styles/online.css';
import { dailyStar, loadMeta } from './data';
import { dailyPick, dayKey, isPlayableDay } from './logic';
import { parseRoute } from './router';
import { flushPending } from './online';
import { migrateV1 } from './storage';
import { renderArchive } from './ui/archive';
import { renderGroup } from './ui/groups';
import { renderHome } from './ui/home';
import { startGame } from './ui/play';
import { beginNavigation, isCurrent, renderError, renderMessage } from './ui/shell';
import { renderStats } from './ui/stats';

async function route(): Promise<void> {
  const gen = beginNavigation();
  const r = parseRoute(location.hash);
  try {
    switch (r.name) {
      case 'home':
        return await renderHome(gen);
      case 'daily': {
        const today = dayKey(new Date());
        const day = r.day ?? today;
        if (!isPlayableDay(day, today)) return renderMessage('No daily that day', 'Dailies start on 8 October 2026, and each one opens on its day.');
        if (r.mode === 'star') {
          const star = await dailyStar(day);
          if (!isCurrent(gen)) return;
          if (!star) return renderMessage('No star daily that day', 'Every star was too close to that day’s start to make a game of it. The JT daily is still on.');
          return await startGame({ qid: star.start, day, mode: 'star', vs: r.vs, target: star.star.id }, gen);
        }
        const { daily } = await loadMeta();
        return await startGame({ qid: dailyPick(daily, day), day, mode: r.mode, vs: r.vs }, gen);
      }
      case 'play':
        return await startGame({ qid: r.qid, day: null, mode: r.mode, vs: r.vs, target: r.target }, gen);
      case 'archive':
        return await renderArchive(gen);
      case 'stats':
        return await renderStats(gen);
      case 'group':
        return await renderGroup(r.code, gen);
      case 'unknown':
        return renderMessage('Page not found', 'That link doesn’t lead anywhere in the game.');
    }
  } catch (err) {
    if (isCurrent(gen)) renderError(err);
  }
}

migrateV1();
flushPending();
window.addEventListener('hashchange', () => void route());
void route();
