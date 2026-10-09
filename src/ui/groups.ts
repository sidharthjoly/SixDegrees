import { cleanName, MAX_NAME_LENGTH } from '../challenge-code';
import { dayKey, dayNumber, plural } from '../logic';
import {
  GROUP_CODE_RE,
  OnlineError,
  compareResults,
  createGroup,
  groupBoard,
  joinGroup,
  leaveGroup,
  myGroups,
  newGroupCode,
  online,
  removeMember,
  type GroupBoard,
  type GroupMember,
  type GroupResult,
  type GroupSummary,
} from '../online';
import { href } from '../router';
import { loadPlayerName, savePlayerName } from '../storage';
import type { Mode } from '../types';
import { h, type Child } from './dom';
import { siteBase } from './share';
import { app, go, isCurrent, onLeave, renderMessage, topBar } from './shell';

/**
 * Groups: a private leaderboard for a group chat. Someone starts one and shares its link;
 * everyone who opens it and joins sees each other's daily results and a weekly table. A
 * group is its code (in the link), so anyone with the link can see the board, like a
 * group chat's own invite link. Needs the server (online.ts); hidden without it.
 */

const MAX_GROUP_NAME = 40;
const GROUPS_KEY = 'sixdeg:groups';

// ------------------------------------------------------------------ remembered groups

/** The groups this browser is in, remembered so the home page can list them straight away. */
function cachedGroups(): GroupSummary[] {
  try {
    const list: unknown = JSON.parse(window.localStorage.getItem(GROUPS_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((g): g is GroupSummary => typeof g?.code === 'string' && GROUP_CODE_RE.test(g.code) && typeof g.name === 'string') : [];
  } catch {
    return [];
  }
}

function rememberGroups(list: GroupSummary[]): void {
  try {
    window.localStorage.setItem(GROUPS_KEY, JSON.stringify(list));
  } catch {
    // Blocked storage: the list is fetched each time instead.
  }
}

const groupHref = (code: string) => `#/g/${code}`;
const inviteUrl = (code: string) => `${siteBase()}${groupHref(code)}`;

function errorText(err: unknown, fallback: string): string {
  if (err instanceof OnlineError && err.code !== null) return err.message;
  return fallback;
}

/** A result in a few words: "2 films", "3 films, 1 hint", "gave up". */
export function resultWords(r: GroupResult | null): string {
  if (!r) return 'not played yet';
  if (r.gaveUp) return 'gave up';
  return r.hints ? `${plural(r.films, 'film')}, ${plural(r.hints, 'hint')}` : plural(r.films, 'film');
}

/** "par", "+1"… beside a result, so a glance shows who did best. */
function overPar(r: GroupResult | null): string {
  if (!r || r.gaveUp) return '';
  const over = r.films - r.par;
  return over <= 0 ? 'par' : `+${over}`;
}

// ------------------------------------------------------------------ home card

/** The home page's Groups card: your groups, and a form to start one. Null when offline. */
export function groupsCard(): HTMLElement | null {
  if (!online) return null;
  const list = h('ul', { class: 'group-list' });
  const draw = (groups: GroupSummary[]) => {
    list.replaceChildren(
      ...groups.map((g) =>
        h('li', null, h('a', { href: groupHref(g.code), class: 'group-link' }, h('span', { class: 'group-link-name' }, g.name), h('span', { class: 'group-link-meta' }, plural(g.members, 'member')))),
      ),
    );
    intro.textContent = groups.length ? 'Your groups:' : 'Start a group for your group chat: everyone plays the daily, and the board shows who did best.';
  };
  const intro = h('p', { class: 'muted' });
  draw(cachedGroups());
  myGroups().then(
    (groups) => {
      rememberGroups(groups);
      draw(groups);
    },
    () => undefined,
  );
  return h('section', { class: 'card groups-card' }, h('h2', null, 'Groups'), intro, list, startForm());
}

let formCount = 0;

function startForm(): HTMLElement {
  const id = ++formCount;
  const groupInput = h('input', { id: `group-name-${id}`, class: 'text-field', type: 'text', maxlength: String(MAX_GROUP_NAME), placeholder: 'e.g. Movie Night', autocomplete: 'off' });
  const nameInput = h('input', { id: `group-you-${id}`, class: 'text-field', type: 'text', maxlength: String(MAX_NAME_LENGTH), placeholder: 'What the board calls you', autocomplete: 'nickname', value: cleanName(loadPlayerName()) });
  const status = h('p', { class: 'form-status', role: 'status' });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Start a group');
  const cancel = h('button', { class: 'link-btn', type: 'button' }, 'Cancel');
  const form = h(
    'form',
    { class: 'group-form' },
    h('label', { class: 'label', for: groupInput.id }, 'Group name'),
    groupInput,
    h('label', { class: 'label', for: nameInput.id }, 'Your name'),
    nameInput,
    h('div', { class: 'row' }, submit, cancel),
    status,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const groupName = groupInput.value.trim().replace(/\s+/g, ' ');
    const you = cleanName(nameInput.value);
    if (!groupName) return void (status.textContent = 'Give the group a name.');
    if (!you) return void (status.textContent = 'Add your name, so the group knows who you are.');
    savePlayerName(you);
    submit.disabled = true;
    status.textContent = 'Starting…';
    try {
      const code = await createGroup(groupName, you);
      rememberGroups([...cachedGroups().filter((g) => g.code !== code), { code, name: groupName, members: 1 }]);
      go(groupHref(code));
    } catch (err) {
      status.textContent = errorText(err, 'Couldn’t start the group. Check your connection and try again.');
      submit.disabled = false;
    }
  });
  const summary = h('summary', { class: 'btn' }, '+ Start a group');
  const details = h('details', { class: 'group-start' }, summary, form);

  // Open, the form folds away again with Cancel, Esc, or a tap anywhere outside it. What was
  // typed stays for next time.
  const close = (refocus: boolean) => {
    details.open = false;
    status.textContent = '';
    if (refocus) summary.focus();
  };
  const onOutside = (e: PointerEvent) => {
    if (!details.contains(e.target as Node)) close(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close(true);
  };
  const stopListening = () => {
    document.removeEventListener('pointerdown', onOutside);
    document.removeEventListener('keydown', onKey);
  };
  details.addEventListener('toggle', () => {
    if (details.open) {
      document.addEventListener('pointerdown', onOutside);
      document.addEventListener('keydown', onKey);
      groupInput.focus();
    } else stopListening();
  });
  cancel.addEventListener('click', () => close(true));
  onLeave(stopListening);
  return details;
}

// ------------------------------------------------------------------ group page

export async function renderGroup(code: string, gen: number): Promise<void> {
  if (!online) return renderMessage('Groups aren’t available', 'This copy of the game isn’t connected to a server, so there are no groups here.');
  if (!GROUP_CODE_RE.test(code)) return renderMessage('No such group', 'That group link isn’t right. Ask for the link again.');
  const note = nextNote;
  nextNote = '';
  const day = dayKey(new Date());
  let board: GroupBoard | null;
  try {
    board = await groupBoard(code, day);
  } catch {
    if (isCurrent(gen)) renderMessage('Couldn’t load the group', 'Check your connection and try again.');
    return;
  }
  if (!isCurrent(gen)) return;
  if (!board) {
    rememberGroups(cachedGroups().filter((g) => g.code !== code));
    return renderMessage('No such group', 'The group has a new link, everyone has left it, or the link isn’t right. Ask for the link again.');
  }
  document.title = `${board.name} · Six Degrees`;
  onLeave(() => (shown = null));
  drawGroup(board, day, 'normal', note);
}

/** The group page as last drawn, while it's open: removals redraw from it (see ownerCard). */
let shown: { board: GroupBoard; day: string; mode: Mode } | null = null;
/** A message for the group's starter on the next group page drawn, after a new code. */
let nextNote = '';

/** `note` is a message for the group's starter, after they've changed something. */
function drawGroup(board: GroupBoard, day: string, mode: Mode, note = ''): void {
  shown = { board, day, mode };
  const me = board.members.find((m) => m.me);
  if (me) rememberGroups([...cachedGroups().filter((g) => g.code !== board.code), { code: board.code, name: board.name, members: board.members.length }]);
  const redraw = (nextMode: Mode) => drawGroup(board, day, nextMode);
  app.replaceChildren(
    topBar(),
    h(
      'header',
      { class: 'page-head' },
      h('h1', { class: 'page-title' }, board.name),
      h('p', { class: 'page-lede' }, `A group of ${plural(board.members.length, 'player')}. Everyone plays the daily; this board shows how it went.`),
      me ? inviteRow(board) : null,
    ),
    me ? '' : joinCard(board, day),
    todayCard(board, day, mode, redraw),
    weekCard(board),
    me ? memberCard(board, me, day) : '',
    me && runsGroup(board) ? ownerCard(board, note) : '',
  );
}

function inviteRow(board: GroupBoard): HTMLElement {
  const status = h('span', { class: 'form-status', role: 'status' });
  const text = `Join “${board.name}” on Six Degrees of Justin Timberlake: ${inviteUrl(board.code)}`;
  const btn = h('button', { class: 'btn primary', type: 'button' }, 'Invite friends');
  btn.addEventListener('click', async () => {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      status.textContent = 'Invite copied. Paste it in your group chat.';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      status.textContent = `Copy this link: ${inviteUrl(board.code)}`;
    }
  });
  return h('div', { class: 'row group-invite' }, btn, h('a', { href: href({ name: 'daily', day: null, mode: 'normal', vs: null }), class: 'btn' }, 'Today’s daily'), status);
}

function joinCard(board: GroupBoard, day: string): HTMLElement {
  const input = h('input', { id: 'group-join-name', class: 'text-field', type: 'text', maxlength: String(MAX_NAME_LENGTH), placeholder: 'What the board calls you', autocomplete: 'nickname', value: cleanName(loadPlayerName()) });
  const status = h('p', { class: 'form-status', role: 'status' });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Join the group');
  const form = h('form', { class: 'group-form' }, h('label', { class: 'label', for: input.id }, 'Your name'), h('div', { class: 'form-row' }, input, submit), status);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = cleanName(input.value);
    if (!name) return void (status.textContent = 'Add your name, so the group knows who you are.');
    savePlayerName(name);
    submit.disabled = true;
    status.textContent = 'Joining…';
    try {
      await joinGroup(board.code, name);
      const fresh = await groupBoard(board.code, day);
      if (fresh) drawGroup(fresh, day, 'normal');
    } catch (err) {
      status.textContent = errorText(err, 'Couldn’t join. Check your connection and try again.');
      submit.disabled = false;
    }
  });
  return h(
    'section',
    { class: 'card group-join' },
    h('h2', null, `Join ${board.name}`),
    h('p', null, 'Your daily results show on this board from now on. Nothing else about you is shared.'),
    h('p', { class: 'muted' }, 'Anyone who hasn’t played a daily within two weeks of joining, or for three months, drops off the board. The invite link brings them back.'),
    form,
  );
}

/** Members ranked by a mode's result for the day, ties keeping the join order. */
export function ranked(members: GroupMember[], mode: Mode): GroupMember[] {
  return [...members].sort((a, b) => compareResults(a[mode], b[mode]));
}

function boardList(members: GroupMember[], mode: Mode, limit = Infinity): HTMLElement {
  const rows = ranked(members, mode);
  const shown = rows.slice(0, limit);
  // Joint places share a number, like a chart.
  let place = 0;
  const items = shown.map((m, i) => {
    if (i === 0 || compareResults(rows[i - 1][mode], m[mode]) !== 0) place = i + 1;
    const r = m[mode];
    return h(
      'li',
      { class: 'board-row' + (m.me ? ' me' : '') + (r ? '' : ' unplayed') },
      h('span', { class: 'board-place' }, r ? String(place) : '–'),
      h('span', { class: 'board-name' }, m.name, m.me ? h('span', { class: 'board-you' }, ' (you)') : null),
      h('span', { class: 'board-result' }, resultWords(r), overPar(r) && h('span', { class: 'board-par' }, overPar(r))),
    );
  });
  return h('ol', { class: 'board' }, ...items, rows.length > shown.length ? h('li', { class: 'board-more muted' }, `+${rows.length - shown.length} more`) : null);
}

function todayCard(board: GroupBoard, day: string, mode: Mode, redraw: (mode: Mode) => void): HTMLElement {
  const anyHard = board.members.some((m) => m.hard);
  const played = board.members.filter((m) => m[mode]).length;
  const tab = (m: Mode, label: string) => h('button', { type: 'button', class: 'chip' + (m === mode ? ' on' : ''), 'aria-pressed': String(m === mode), onclick: () => redraw(m) }, label);
  return h(
    'section',
    { class: 'card group-today' },
    h('h2', null, `Daily #${dayNumber(day)}`),
    anyHard || mode === 'hard' ? h('div', { class: 'chips', role: 'group', 'aria-label': 'Mode' }, tab('normal', 'Normal'), tab('hard', 'Hard')) : null,
    h('p', { class: 'muted' }, played ? `${played} of ${plural(board.members.length, 'member')} played` : 'Nobody has played yet today.'),
    boardList(board.members, mode),
  );
}

function weekCard(board: GroupBoard): HTMLElement {
  const rows = [...board.members].sort((a, b) => b.week.points - a.week.points || b.week.played - a.week.played);
  return h(
    'section',
    { class: 'card group-week' },
    h('h2', null, 'This week'),
    h('p', { class: 'muted' }, 'The last seven dailies in normal mode: 3 points for par, 2 for one over, 1 for two over.'),
    h(
      'table',
      { class: 'week-table' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Player'), h('th', { scope: 'col' }, 'Played'), h('th', { scope: 'col' }, 'Points'))),
      h('tbody', null, ...rows.map((m) => h('tr', { class: m.me ? 'me' : null }, h('th', { scope: 'row' }, m.name, m.me ? ' (you)' : ''), h('td', null, m.week.played), h('td', null, m.week.points)))),
    ),
  );
}

function memberCard(board: GroupBoard, me: GroupMember, day: string): HTMLElement {
  const input = h('input', { id: 'group-rename', class: 'text-field', type: 'text', maxlength: String(MAX_NAME_LENGTH), value: me.name, autocomplete: 'nickname' });
  const status = h('p', { class: 'form-status', role: 'status' });
  const rename = h('button', { class: 'btn', type: 'submit' }, 'Change name');
  const form = h('form', { class: 'group-form' }, h('label', { class: 'label', for: input.id }, 'Your name here'), h('div', { class: 'form-row' }, input, rename), status);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = cleanName(input.value);
    if (!name || name === me.name) return;
    rename.disabled = true;
    try {
      await joinGroup(board.code, name);
      const fresh = await groupBoard(board.code, day);
      if (fresh) drawGroup(fresh, day, 'normal');
    } catch (err) {
      status.textContent = errorText(err, 'Couldn’t change it. Try again.');
      rename.disabled = false;
    }
  });
  const leave = h('button', { class: 'link-btn', type: 'button' }, 'Leave this group');
  leave.addEventListener('click', async () => {
    const handover = runsGroup(board) ? ' Whoever has been in longest takes over running it.' : '';
    if (!confirm(`Leave ${board.name}? You can rejoin with the invite link.${handover}`)) return;
    try {
      await leaveGroup(board.code);
      rememberGroups(cachedGroups().filter((g) => g.code !== board.code));
      go('#/');
    } catch (err) {
      status.textContent = errorText(err, 'Couldn’t leave. Try again.');
    }
  });
  return h('section', { class: 'card group-you' }, h('h2', null, 'You'), form, leave);
}

/** Whether this player started the group, and the server is new enough to let them run it. */
const runsGroup = (board: GroupBoard) => board.owner === true && board.members.every((m) => typeof m.id === 'number');

/**
 * For whoever started the group: take people off the board, one tap each, since a link that
 * got out can bring in dozens. Anyone removed can rejoin with the link until it's replaced.
 */
function ownerCard(board: GroupBoard, note: string): HTMLElement {
  const status = h('p', { class: 'form-status', role: 'status' }, note);
  const others = board.members.filter((m) => !m.me);
  const rows = others.map((m, i) => {
    const remove = h('button', { class: 'link-btn owner-remove', type: 'button', 'aria-label': `Remove ${m.name}` }, 'Remove');
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        await removeMember(board.code, m.id!);
        // From the page as it is now, not as this card was built: quick taps overlap, and each
        // earlier removal has redrawn it since.
        const now = shown;
        if (!now || now.board.code !== board.code) return;
        drawGroup({ ...now.board, members: now.board.members.filter((x) => x.id !== m.id) }, now.day, now.mode, `Removed ${m.name}.`);
        // Stay at the same place in the list, so clearing out several is tap after tap.
        const left = app.querySelectorAll<HTMLButtonElement>('.owner-remove');
        (left[Math.min(i, left.length - 1)] ?? app.querySelector<HTMLElement>('.owner-new-code'))?.focus({ preventScroll: true });
      } catch (err) {
        status.textContent = errorText(err, `Couldn’t remove ${m.name}. Try again.`);
        remove.disabled = false;
      }
    });
    return h('li', { class: 'owner-row' }, h('span', { class: 'board-name' }, m.name), remove);
  });

  const replace = h('button', { class: 'btn owner-new-code', type: 'button' }, 'New invite link');
  replace.addEventListener('click', async () => {
    if (!confirm(`Make a new invite link for ${board.name}? The old one stops working. Everyone already in stays in.`)) return;
    replace.disabled = true;
    try {
      const code = await newGroupCode(board.code);
      rememberGroups([...cachedGroups().filter((g) => g.code !== board.code), { code, name: board.name, members: board.members.length }]);
      nextNote = 'New link made. Send it to anyone who hasn’t joined yet with Invite friends: the old one no longer works.';
      // Replaced rather than pushed: going back to the old code would only find nothing.
      location.replace(groupHref(code));
    } catch (err) {
      status.textContent = errorText(err, 'Couldn’t make a new link. Try again.');
      replace.disabled = false;
    }
  });

  return h(
    'section',
    { class: 'card group-owner' },
    h('h2', null, 'Run the group'),
    h('p', { class: 'muted' }, 'You started this group, so you can take people off the board. They can rejoin with the invite link until you make a new one; everyone already in stays in.'),
    others.length ? h('ul', { class: 'owner-list' }, ...rows) : null,
    h('div', { class: 'row' }, replace),
    status,
  );
}

// ------------------------------------------------------------------ result screen

/**
 * On a daily's result screen: each of the player's groups (up to three), with the day's
 * board so far. `uploaded` settles once the player's own result is in.
 */
export function groupsPanel(day: string, mode: Mode, uploaded: Promise<unknown>): HTMLElement | null {
  if (!online) return null;
  const panel = h('section', { class: 'card groups-panel', hidden: true });
  void (async () => {
    try {
      await uploaded;
      const groups = await myGroups();
      rememberGroups(groups);
      if (groups.length === 0) return;
      const boards = (await Promise.all(groups.slice(0, 3).map((g) => groupBoard(g.code, day).catch(() => null)))).filter((b): b is GroupBoard => !!b);
      if (boards.length === 0) return;
      const parts: Child[] = [h('h2', null, boards.length === 1 ? 'Your group' : 'Your groups')];
      for (const b of boards) {
        parts.push(h('h3', { class: 'group-panel-name' }, h('a', { href: groupHref(b.code) }, b.name)), boardList(b.members, mode, 5));
      }
      panel.replaceChildren(...parts.filter((p): p is Node => p instanceof Node));
      panel.hidden = false;
    } catch {
      // No groups to show.
    }
  })();
  return panel;
}
