'use client';
import { useEffect, useRef, useState } from 'react';
import { CHARACTERS, CHARACTER_IDS, CLUES, GAME_TAGLINE, GAME_TITLE, MAX_NIGHTS, awayFor, type CharacterId, type ClueId } from '../lib/game/world';

type Line = { from: 'player' | 'them' | 'system'; text: string; at: number };
type Ending = 'called_home' | 'pushed_away' | 'ran_out';
type ChatReply = { error?: string; replies: string[]; trustChange: number; clues: ClueId[]; reveal: CharacterId[]; signOff: boolean; ending: string };
type Save = {
  version: 1;
  mainName: string;
  alts: string[];
  identity: string;
  night: number;
  clues: ClueId[];
  unlocked: CharacterId[];
  daniReachable: boolean;
  trust: Record<string, number>;
  logs: Record<string, Line[]>;
  signedOff: CharacterId[];
  unread: string[];
  ending: Ending | null;
};

const SAVE_KEY = 'away-message-save-v1';
const AGE_KEY = 'away-message-18-plus';
const SCREEN_NAME = /^[A-Za-z][A-Za-z0-9_]{2,19}$/;
const TOTAL_CLUES = Object.keys(CLUES).length;
const key = (identity: string, id: CharacterId) => `${identity}:${id}`;
const now = () => Date.now();
const time = (at: number) => new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

function newSave(mainName: string): Save {
  return {
    version: 1, mainName, alts: [], identity: mainName, night: 1, clues: [],
    unlocked: CHARACTER_IDS.filter(id => CHARACTERS[id].startsOnList),
    daniReachable: false, trust: {}, signedOff: [], unread: [key(mainName, 'tess')], ending: null,
    logs: {
      [key(mainName, 'tess')]: [
        { from: 'them', text: 'omg have u heard from dani??', at: now() },
        { from: 'them', text: 'its been like 9 days. nobody has seen her and her away msg is getting WEIRD', at: now() },
      ],
    },
  };
}

function loadSave(): Save | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const s = raw ? JSON.parse(raw) as Save : null;
    return s?.version === 1 ? s : null;
  } catch { return null; }
}

function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 4h22a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3H14l-7 6v-6H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z" fill="#ffd84a" stroke="#6b5600" strokeWidth="1.5" />
      <path d="M19 8a5.5 5.5 0 1 0 4.5 8.5A4.5 4.5 0 0 1 19 8z" fill="#26456e" />
    </svg>
  );
}

function Window({ title, children, className = '', onClose }: { title: string; children: React.ReactNode; className?: string; onClose?: () => void }) {
  return (
    <section className={'window ' + className}>
      <div className="titlebar">
        <span className="title-icon">✉</span>
        <strong>{title}</strong>
        <div className="window-controls">
          <span>_</span><span>□</span>
          <button aria-label={'Close ' + title} onClick={onClose} disabled={!onClose}>×</button>
        </div>
      </div>
      {children}
    </section>
  );
}

export default function Game() {
  const [loaded, setLoaded] = useState(false);
  const [ageOk, setAgeOk] = useState(false);
  const [save, setSave] = useState<Save | null>(null);
  const [selected, setSelected] = useState<CharacterId | null>(null);
  const [view, setView] = useState<'buddies' | 'chat' | 'journal'>('buddies');
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [modal, setModal] = useState<'' | 'names' | 'intro' | 'help' | 'newgame' | 'night'>('');
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [sound, setSound] = useState(true);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const saveRef = useRef<Save | null>(null);
  useEffect(() => { saveRef.current = save; }, [save]);

  useEffect(() => {
    // Browser storage can only be read after the page mounts.
    /* eslint-disable react-hooks/set-state-in-effect */
    try { setAgeOk(localStorage.getItem(AGE_KEY) === 'yes'); } catch { /* private mode */ }
    setSave(loadSave());
    setLoaded(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      if (save) localStorage.setItem(SAVE_KEY, JSON.stringify(save));
      else localStorage.removeItem(SAVE_KEY);
    } catch { /* storage blocked */ }
  }, [save, loaded]);

  const log = save && selected ? save.logs[key(save.identity, selected)] ?? [] : [];
  useEffect(() => {
    const t = transcriptRef.current;
    if (t) t.scrollTop = t.scrollHeight;
  }, [log.length, typing, selected]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  function tone(kind: 'message' | 'door' | 'close' = 'message') {
    if (!sound) return;
    try {
      const c = new AudioContext();
      const notes = kind === 'door' ? [523, 659, 784] : kind === 'close' ? [784, 659, 523] : [880, 660, 880];
      notes.forEach((f, i) => {
        const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + i * 0.1;
        o.frequency.value = f;
        g.gain.setValueAtTime(0.06, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.13);
      });
      setTimeout(() => c.close(), 600);
    } catch { /* audio not allowed */ }
  }

  function update(fn: (s: Save) => Save) {
    setSave(s => (s ? fn(s) : s));
  }

  function addLines(identity: string, id: CharacterId, lines: Line[]) {
    const k = key(identity, id);
    update(s => ({ ...s, logs: { ...s.logs, [k]: [...(s.logs[k] ?? []), ...lines] } }));
  }

  function startGame(e: React.FormEvent) {
    e.preventDefault();
    if (!SCREEN_NAME.test(nameInput)) { setError('Use 3–20 letters, numbers, or underscores, starting with a letter.'); return; }
    setError('');
    setSave(newSave(nameInput));
    setNameInput('');
    setModal('intro');
    tone('door');
  }

  function open(id: CharacterId) {
    setSelected(id);
    setView('chat');
    setError('');
    update(s => ({ ...s, unread: s.unread.filter(u => u !== key(s.identity, id)) }));
    setTimeout(() => draftRef.current?.focus(), 50);
  }

  function reachable(s: Save, id: CharacterId) {
    if (s.signedOff.includes(id)) return false;
    return id !== 'dani' || s.daniReachable;
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const s = saveRef.current;
    const text = draft.trim();
    if (!s || !selected || !text || typing || s.ending) return;
    const id = selected, identity = s.identity, k = key(identity, id);
    const playerLine: Line = { from: 'player', text, at: now() };
    setDraft('');
    addLines(identity, id, [playerLine]);
    draftRef.current?.focus();

    if (!reachable(s, id)) {
      const c = CHARACTERS[id];
      const auto = s.signedOff.includes(id)
        ? `${c.screenName} is signed off. Try again tomorrow night.`
        : `Auto response from ${c.screenName}: ${awayFor(id, s.night)}`;
      setTimeout(() => addLines(identity, id, [{ from: 'system', text: auto, at: now() }]), 400);
      return;
    }

    setTyping(true);
    setError('');
    try {
      const history = [...(s.logs[k] ?? []), playerLine].filter(l => l.from !== 'system').map(l => ({ from: l.from, text: l.text }));
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character: id, identity: { screenName: identity, main: identity === s.mainName }, night: s.night, trust: s.trust[k] ?? 0, clues: s.clues, history }),
      });
      const d = await r.json() as ChatReply;
      if (!r.ok) throw new Error(d.error || 'Connection dropped. Try again.');

      for (const reply of d.replies as string[]) {
        await new Promise(res => setTimeout(res, Math.min(2200, 500 + reply.length * 25)));
        addLines(identity, id, [{ from: 'them', text: reply, at: now() }]);
        tone();
      }

      const newClues = d.clues.filter(c => !s.clues.includes(c));
      const newBuddies = d.reveal.filter(b => !s.unlocked.includes(b));
      const daniOpened = newBuddies.includes('dani');
      const notes: Line[] = [];
      if (newClues.length) notes.push({ from: 'system', text: `📓 New in your journal: ${newClues.map(c => CLUES[c]).join(' ')}`, at: now() });
      for (const b of newBuddies) {
        notes.push({ from: 'system', text: b === 'dani' ? `💫 ${CHARACTERS.dani.screenName} might actually answer now.` : `➕ ${CHARACTERS[b].screenName} was added to your Buddy List.`, at: now() });
      }
      if (notes.length) setToast(notes.map(n => n.text).join('  '));
      if (d.signOff) notes.push({ from: 'system', text: `${CHARACTERS[id].screenName} has signed off.`, at: now() });
      if (notes.length) addLines(identity, id, notes);
      if (d.signOff) tone('close');

      update(cur => ({
        ...cur,
        clues: [...cur.clues, ...newClues.filter(c => !cur.clues.includes(c))],
        unlocked: [...cur.unlocked, ...newBuddies.filter(b => !cur.unlocked.includes(b))],
        daniReachable: cur.daniReachable || daniOpened,
        trust: { ...cur.trust, [k]: Math.max(-5, Math.min(5, (cur.trust[k] ?? 0) + d.trustChange)) },
        signedOff: d.signOff ? [...cur.signedOff, id] : cur.signedOff,
        ending: d.ending === 'called_home' || d.ending === 'pushed_away' ? d.ending : cur.ending,
      }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTyping(false);
    }
  }

  function nextNight() {
    const night = (save?.night ?? 1) + 1;
    update(s => ({ ...s, night, signedOff: [], ending: night > MAX_NIGHTS ? 'ran_out' : s.ending }));
    setModal('');
    tone('door');
    if (night <= MAX_NIGHTS) setToast(`Night ${night}. Away messages have changed.`);
  }

  function addAlt(e: React.FormEvent) {
    e.preventDefault();
    if (!save) return;
    const taken = [save.mainName, ...save.alts, ...CHARACTER_IDS.map(id => CHARACTERS[id].screenName)].map(n => n.toLowerCase());
    if (!SCREEN_NAME.test(nameInput)) { setError('Use 3–20 letters, numbers, or underscores, starting with a letter.'); return; }
    if (taken.includes(nameInput.toLowerCase())) { setError('That screen name is taken.'); return; }
    setError('');
    update(s => ({ ...s, alts: [...s.alts, nameInput], identity: nameInput }));
    setSelected(null);
    setNameInput('');
    setModal('');
    tone('door');
  }

  if (!loaded) return <main className="desktop" />;

  if (!ageOk || !save) {
    return (
      <main className="desktop start-screen">
        <Window title={`Sign On • ${GAME_TITLE}`} className="dialog signon-window">
          <div className="dialog-content">
            <div className="signon-brand"><Logo size={56} /><div><b>{GAME_TITLE}</b><small>{GAME_TAGLINE}</small></div></div>
            {!ageOk ? (
              <>
                <p>Every person you talk to in this game is played by AI, and the story is written for adults.</p>
                <p><b>You must be 18 or older to play.</b></p>
                <div className="dialog-actions">
                  <button className="yellow-button" onClick={() => { try { localStorage.setItem(AGE_KEY, 'yes'); } catch { /* ok */ } setAgeOk(true); }}>I’m 18 or older</button>
                  <a className="classic-button" href="https://www.google.com">Leave</a>
                </div>
              </>
            ) : (
              <form onSubmit={startGame}>
                <p>October 2004. Your best friend Dani hasn’t signed on in nine days. Her away message keeps changing.</p>
                <label>Pick your screen name
                  <input autoFocus value={nameInput} onChange={e => setNameInput(e.target.value)} placeholder="xXYourNameXx" maxLength={20} />
                </label>
                {error && <p className="form-error">{error}</p>}
                <button className="yellow-button">Sign On ➜</button>
                <small>Your progress saves in this browser.</small>
              </form>
            )}
          </div>
        </Window>
      </main>
    );
  }

  const s = save;
  const night = Math.min(s.night, MAX_NIGHTS);
  const buddies = [...s.unlocked.filter(id => id !== 'dani'), 'dani' as const].map(id => CHARACTERS[id]);
  const status = (id: CharacterId) => !reachable(s, id) ? 'off' : awayFor(id, s.night) ? 'away' : 'on';
  const online = buddies.filter(b => status(b.id) !== 'off');
  const offline = buddies.filter(b => status(b.id) === 'off');
  const sel = selected ? CHARACTERS[selected] : null;
  const selAway = sel ? awayFor(sel.id, s.night) : '';
  const isAlt = s.identity !== s.mainName;
  const modalTitles = { names: 'Screen Names', intro: `Welcome to ${GAME_TITLE}`, help: 'How to Play', newgame: 'New Game', night: 'Log Off for the Night' };

  return (
    <main className="desktop" data-view={view}>
      <header className="desktop-heading">
        <div className="wordmark"><Logo /><span>{GAME_TITLE}</span><span className="edition">NIGHT {night} OF {MAX_NIGHTS} · {s.clues.length}/{TOTAL_CLUES} CLUES</span></div>
        <button className="sound-toggle" onClick={() => setSound(!sound)}>{sound ? '♫ Sound on' : '♪ Sound off'}</button>
      </header>

      <nav className="mobile-nav" aria-label="Game views">
        {([['buddies', 'Buddies'], ['chat', 'IM'], ['journal', `Journal ${s.clues.length}/${TOTAL_CLUES}`]] as const).map(([k, label]) => (
          <button key={k} aria-pressed={view === k} onClick={() => setView(k)}>{label}{k === 'buddies' && s.unread.length ? ' •' : ''}</button>
        ))}
      </nav>

      <div className="workspace">
        <Window title={`${s.identity}’s Buddy List`} className="buddy-window">
          <nav className="menubar">
            <button onClick={() => { setError(''); setModal('names'); }}>Screen Names</button>
            <button onClick={() => setModal('night')}>End Night</button>
            <button onClick={() => setModal('help')}>Help</button>
          </nav>
          <div className="screenname"><span className={'status-dot ' + (isAlt ? 'away' : '')} />{s.identity}{isAlt && <small className="alt-tag">alt</small>}</div>
          <div className="buddy-list">
            <div className="group-heading">▾ Buddies ({online.length}/{buddies.length})</div>
            {online.map(b => (
              <button className="buddy" key={b.id} onClick={() => open(b.id)}>
                <span>{status(b.id) === 'away' ? '🗒' : b.icon}</span><b>{b.screenName}</b>
                {s.unread.includes(key(s.identity, b.id)) && <em>IM</em>}
              </button>
            ))}
            <div className="group-heading offline-heading">▾ Offline ({offline.length})</div>
            {offline.map(b => (
              <button className="buddy offline" key={b.id} onClick={() => open(b.id)}>
                ◯ <b>{b.screenName}</b>{b.id === 'dani' && !s.daniReachable && <small>9 days</small>}
              </button>
            ))}
          </div>
          <div className="buddy-footer">
            <span className="status-dot" />Night {night} of {MAX_NIGHTS}
            <button onClick={() => setModal('newgame')}>New Game</button>
          </div>
        </Window>

        <div className="main-windows">
          <Window title={sel ? `${sel.screenName} • Instant Message` : 'Instant Message'} className="im-window" onClose={sel ? () => { setSelected(null); setView('buddies'); } : undefined}>
            <div className="im-recipient"><b>To</b><span>{sel ? sel.screenName : 'Pick someone from your Buddy List'}</span><span className="im-type">AS {s.identity}</span></div>
            {sel && selAway && <div className="away-banner">🗒 Away message · {selAway}</div>}
            <div className="transcript" aria-live="polite" ref={transcriptRef}>
              {!sel ? (
                <div className="conversation-empty">
                  <div className="message-art">✉<span>✦</span></div>
                  <h2>Somebody knows something.</h2>
                  <p>Pick a buddy to start an IM.<br />Ask good questions. Be a good friend.</p>
                </div>
              ) : (
                <>
                  {log.map((l, i) => l.from === 'system'
                    ? <div className="system-line" key={i}>{l.text}</div>
                    : (
                      <div className="message-line" key={i}>
                        <b className={l.from === 'them' ? 'them' : 'you'}>{l.from === 'them' ? sel.screenName : s.identity} <small>({time(l.at)})</small>:</b> <span>{l.text}</span>
                      </div>
                    ))}
                  {typing && <div className="system-line typing">{sel.screenName} is typing…</div>}
                </>
              )}
            </div>
            <form onSubmit={send}>
              <textarea
                id="message" ref={draftRef} aria-label="Message" maxLength={500}
                placeholder={sel ? 'Type a message…' : 'Pick a buddy first…'}
                value={draft} disabled={!sel || !!s.ending}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              />
              <div className="sendbar">
                <span>{error ? <span className="form-error">{error}</span> : sel ? 'Enter to send · Shift + Enter for a new line' : ''}</span>
                <button className="classic-button send" disabled={!sel || !draft.trim() || typing || !!s.ending}>{typing ? 'Waiting…' : 'Send'}</button>
              </div>
            </form>
          </Window>

          <Window title="Journal" className="journal-window">
            <div className="journal">
              <p className="journal-kicker">WHAT YOU KNOW · {s.clues.length} OF {TOTAL_CLUES}</p>
              {s.clues.length ? <ol>{s.clues.map(c => <li key={c}>{CLUES[c]}</li>)}</ol> : <p className="journal-empty">Nothing yet. Start with whoever IMed you first.</p>}
              <p className="journal-kicker">DANI’S AWAY MESSAGES</p>
              <ul className="away-history">
                {Array.from({ length: night }, (_, i) => <li key={i}><small>Night {i + 1}</small> {awayFor('dani', i + 1)}</li>)}
              </ul>
            </div>
          </Window>
        </div>
      </div>

      <footer className="taskbar">
        <button className="start-button" onClick={() => setModal('help')}><Logo size={20} /><b>start</b></button>
        <div className="task-divider" />
        <button className="task" onClick={() => setView('buddies')}>📒 Buddy List</button>
        {sel && <button className="task active-task" onClick={() => draftRef.current?.focus()}>✉ {sel.screenName}</button>}
        <span className="taskbar-note">Signed on as {s.identity}</span>
        <div className="clock">Night {night}</div>
      </footer>

      {toast && <div className="error-toast" role="status">{toast}<button aria-label="Dismiss" onClick={() => setToast('')}>×</button></div>}

      {s.ending && (
        <div className="modal-shade">
          <Window title="The End" className="dialog">
            <div className="dialog-content">
              {s.ending === 'called_home' && <><h2>She called home.</h2><p>Dani is still on the road, but her parents know the truth now, and so do you. Some nights the static really does sound like home.</p></>}
              {s.ending === 'pushed_away' && <><h2>She signed off.</h2><p>Dani is safe, but she isn’t ready to hear it from you. Her away message stays the same for a long time.</p></>}
              {s.ending === 'ran_out' && <><h2>A week of away messages.</h2><p>Seven nights went by and you never reached Dani. Maybe someone on your list knew more than they said.</p></>}
              <p>You found {s.clues.length} of {TOTAL_CLUES} clues.</p>
              <div className="dialog-actions"><button className="yellow-button" onClick={() => { setSave(null); setSelected(null); }}>Play again</button></div>
            </div>
          </Window>
        </div>
      )}

      {modal && !s.ending && (
        <div className="modal-shade">
          <Window title={modalTitles[modal]} className="dialog" onClose={() => { setModal(''); setError(''); }}>
            <div className="dialog-content">
              {(modal === 'intro' || modal === 'help') && (
                <>
                  <Logo size={48} />
                  <h2>{modal === 'intro' ? 'Nine days of silence.' : 'How to play'}</h2>
                  {modal === 'intro' && <p>Dani was your best friend freshman year. Nobody has seen her in nine days, and her away message changes every night. Your buddies each know a piece of what happened.</p>}
                  <p>Everyone you IM is played by AI and remembers what you say. Ask good questions and be kind. Clues go in your Journal.</p>
                  <p>Make an extra screen name to talk to people as a stranger. They won’t know it’s you, and they’ll act differently.</p>
                  <p>When you run out of leads, end the night. Away messages change and people come back online. You have {MAX_NIGHTS} nights.</p>
                  <button className="yellow-button" onClick={() => setModal('')}>{modal === 'intro' ? 'Check my IMs ➜' : 'Got it'}</button>
                </>
              )}
              {modal === 'names' && (
                <>
                  <h2>Who are you tonight?</h2>
                  <div className="directory">
                    {[s.mainName, ...s.alts].map(n => (
                      <div key={n}>
                        <span><span className={'status-dot ' + (n === s.mainName ? '' : 'away')} />{n}{n === s.mainName ? ' (you)' : ' (alt)'}</span>
                        <button className="classic-button" disabled={n === s.identity} onClick={() => { update(x => ({ ...x, identity: n })); setSelected(null); setModal(''); tone('door'); }}>
                          {n === s.identity ? 'Signed on' : 'Sign on'}
                        </button>
                      </div>
                    ))}
                  </div>
                  {s.alts.length < 2 ? (
                    <form onSubmit={addAlt}>
                      <label>Make a new screen name<input value={nameInput} onChange={e => setNameInput(e.target.value)} placeholder="mysteryfan_04" maxLength={20} /></label>
                      {error && <p className="form-error">{error}</p>}
                      <button className="classic-button">Create and sign on</button>
                    </form>
                  ) : <p>You can have up to two extra screen names.</p>}
                </>
              )}
              {modal === 'night' && (
                <>
                  <h2>{s.night >= MAX_NIGHTS ? 'This is the last night.' : 'Call it a night?'}</h2>
                  <p>{s.night >= MAX_NIGHTS ? 'If you log off now, the story ends.' : 'Tomorrow, away messages change and everyone who signed off comes back.'}</p>
                  <div className="dialog-actions">
                    <button className="yellow-button" onClick={nextNight}>Log off</button>
                    <button className="classic-button" onClick={() => setModal('')}>Stay up</button>
                  </div>
                </>
              )}
              {modal === 'newgame' && (
                <>
                  <h2>Start over?</h2>
                  <p>This erases your conversations, clues, and screen names.</p>
                  <div className="dialog-actions">
                    <button className="classic-button" onClick={() => { setSave(null); setSelected(null); setModal(''); }}>Erase and start over</button>
                    <button className="classic-button" onClick={() => setModal('')}>Cancel</button>
                  </div>
                </>
              )}
            </div>
          </Window>
        </div>
      )}
    </main>
  );
}
