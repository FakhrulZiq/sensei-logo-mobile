import { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@capacitor-firebase/authentication';
import { currentUser, refreshIdToken, signIn, signOut } from './auth';
import { ApiError, deleteEntry, downloadLogo, listEntries, publishCatalog, saveEntry, uploadLogo, uploadBackgroundLogo, removeBackgroundLogo, type Entry, type EntryInput, type Kind } from './api';
import { imageFrames, LogoCropper, type ImageEdit, type ImageTarget } from './LogoCropper';

const brandMark = import.meta.env.BASE_URL + 'sensei-catalog-mark.svg';

const bankCategories = ['bank', 'foreign_bank', 'digital_bank', 'e_wallet', 'bnpl'];
const brandGroups = ['utility', 'telco', 'loan', 'insurance', 'subscription', 'food', 'grocery', 'shopping', 'transport', 'fuel'];
const commitmentKinds = ['', 'loan', 'bill', 'subscription'];
const loanTypes = ['study', 'vehicle', 'housing', 'personal', 'investment', 'other'];

function blank(kind: Kind): EntryInput {
  return {
    id: '', name: '', short: '', colour: '#315E4A', aliases: [], sortOrder: 0,
    category: kind === 'banks' ? 'bank' : '',
    ...(kind === 'brands' ? { group: 'shopping', commitment: null } : {}),
  };
}

function Logo({ entry }: { entry: Entry }) {
  return <span className="entry-logo" style={{ color: entry.colour }}>
    {entry.logo ? <img src={entry.logo.url} alt="" /> : entry.short.slice(0, 2).toUpperCase()}
  </span>;
}

function useImagePreview(file?: File) {
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return file && preview?.file === file ? preview.url : undefined;
}

function ImageCard({ target, url, status, disabled, onEdit, onChoose }: {
  target: ImageTarget;
  url?: string;
  status: string;
  disabled: boolean;
  onEdit: () => void;
  onChoose: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { label } = imageFrames[target];

  return <div className="image-card">
    <button type="button" className="image-preview checkerboard" disabled={disabled}
      aria-label={`${url ? 'Edit' : 'Choose'} ${label.toLowerCase()}`}
      onClick={() => url ? onEdit() : input.current?.click()}>
      {url ? <>
        <img src={url} alt="" />
        <span className="image-edit-label" aria-hidden="true">Edit</span>
      </> : <span className="image-add" aria-hidden="true">+</span>}
    </button>
    <h4>{label}</h4>
    <p>{status}</p>
    {url && <button className="text-button image-replace" type="button" disabled={disabled}
      aria-label={`Replace ${label.toLowerCase()}`} onClick={() => input.current?.click()}>Replace</button>}
    <input hidden ref={input} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
      const next = event.target.files?.[0];
      event.target.value = '';
      if (next) onChoose(next);
    }} />
  </div>;
}

function Editor({ kind, entry, onClose, onSaved }: {
  kind: Kind; entry: Entry | null; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const isNew = !entry;
  const [draft, setDraft] = useState<EntryInput>(entry ? {
    id: entry.id, name: entry.name, short: entry.short, colour: entry.colour,
    aliases: [...entry.aliases], sortOrder: entry.sortOrder, category: entry.category,
    group: entry.group, commitment: entry.commitment,
  } : blank(kind));
  const [aliasesText, setAliasesText] = useState(entry?.aliases.join(', ') ?? '');
  const [images, setImages] = useState<Partial<Record<ImageTarget, ImageEdit>>>({});
  const [imageEditor, setImageEditor] = useState<{ target: ImageTarget; source: File; previous?: ImageEdit } | null>(null);
  const [loadingImage, setLoadingImage] = useState<ImageTarget | null>(null);
  const [imageError, setImageError] = useState('');
  const [clearBackground, setClearBackground] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [persisted, setPersisted] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const squarePreview = useImagePreview(images.logo?.output) ?? entry?.logo?.url;
  const widePreview = useImagePreview(images.background?.output) ?? entry?.backgroundLogo?.url;
  const hasWideImage = !!images.background || !!entry?.backgroundLogo;
  const useSquare = clearBackground || !hasWideImage;

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  async function editImage(target: ImageTarget) {
    setImageError('');
    const previous = (target === 'background' && clearBackground) ? undefined : images[target];
    if (previous) {
      setImageEditor({ target, source: previous.source, previous });
      return;
    }

    if (target === 'background' && useSquare && images.logo) {
      setImageEditor({ target, source: images.logo.output });
      return;
    }

    const saved = target === 'background' && !useSquare ? entry?.backgroundLogo : entry?.logo;
    if (!saved) return;
    setLoadingImage(target);
    try {
      setImageEditor({ target, source: await downloadLogo(saved.url) });
    } catch (cause) {
      setImageError(cause instanceof Error ? cause.message : 'Could not load the image for editing.');
    } finally {
      setLoadingImage(null);
    }
  }

  function chooseImage(target: ImageTarget, source: File) {
    setImageError('');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(source.type)) {
      setImageError('Choose a PNG, JPEG or WebP image.');
      return;
    }
    if (source.size > 2 * 1024 * 1024) {
      setImageError('Choose an image of 2 MB or less.');
      return;
    }
    setImageEditor({ target, source });
  }

  function set<K extends keyof EntryInput>(key: K, value: EntryInput[K]) {
    setDraft((old) => ({ ...old, [key]: value }));
  }

  async function save() {
    setError('');
    const aliases = aliasesText.split(',').map((value) => value.trim()).filter(Boolean);
    if (!/^[a-z0-9_]{2,40}$/.test(draft.id)) return setError('ID needs 2–40 lowercase letters, numbers, or underscores.');
    if (!draft.name.trim() || !draft.short.trim()) return setError('Name and short name are required.');
    if (!/^#[0-9a-fA-F]{6}$/.test(draft.colour)) return setError('Use a six-digit hex colour.');
    if (aliases.length > 20 || aliases.some((value) => value.length > 60)) return setError('Use up to 20 aliases, each at most 60 characters.');
    if (kind === 'brands' && !draft.category.trim()) return setError('Brand category is required.');
    setBusy(true);
    try {
      const input = { ...draft, name: draft.name.trim(), short: draft.short.trim(), category: draft.category.trim(), aliases };
      if (kind === 'brands') {
        input.commitment = input.commitment?.kind
          ? { kind: input.commitment.kind, ...(input.commitment.kind === 'loan' ? { loanType: input.commitment.loanType || 'other' } : {}) }
          : null;
      } else {
        delete input.group;
        delete input.commitment;
      }
      // The server assigns the sort order for new entries unless one was supplied.
      if (isNew) delete (input as Partial<EntryInput>).sortOrder;
      await saveEntry(kind, input, isNew && !persisted);
      setPersisted(true);
      if (images.logo) await uploadLogo(kind, draft.id, images.logo.output);
      if (!clearBackground && images.background) await uploadBackgroundLogo(kind, draft.id, images.background.output);
      else if (clearBackground) await removeBackgroundLogo(kind, draft.id);
      await onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!entry || !window.confirm(`Delete ${entry.name}? This removes it from the catalog.`)) return;
    setBusy(true);
    setError('');
    try {
      await deleteEntry(kind, entry.id);
      await onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete.');
    } finally {
      setBusy(false);
    }
  }

  const locked = busy || !!loadingImage;

  return <dialog className="sheet" ref={dialog} aria-labelledby="entry-title"
    onCancel={(event) => { event.preventDefault(); if (!locked && !imageEditor) onClose(); }}>
      <header className="sheet-header">
        <div>
          <h2 id="entry-title">{isNew ? `New ${kind === 'banks' ? 'bank' : 'brand'}` : entry.name}</h2>
          <p>{isNew ? 'Add an entry to the SenSei catalog.' : entry.id}</p>
        </div>
        <button type="button" className="icon-button" onClick={onClose} disabled={locked} aria-label="Close entry">×</button>
      </header>
      <div className="sheet-content">
        <section className="asset-field" aria-labelledby="images-title">
          <h3 id="images-title">Catalog images</h3>
          <div className="asset-grid">
            <ImageCard target="logo" url={squarePreview} status={loadingImage === 'logo' ? 'Opening image…' : 'Catalog lists'}
              disabled={locked} onEdit={() => void editImage('logo')} onChoose={(source) => chooseImage('logo', source)} />
            <ImageCard target="background" url={useSquare ? squarePreview : widePreview}
              status={loadingImage === 'background' ? 'Opening image…' : useSquare && squarePreview ? 'Uses square logo' : 'Detail background · optional'}
              disabled={locked} onEdit={() => void editImage('background')} onChoose={(source) => chooseImage('background', source)} />
          </div>
          {hasWideImage && <button type="button" className="text-button asset-fallback" disabled={locked}
            onClick={() => setClearBackground(!clearBackground)}>{clearBackground ? 'Restore wide logo' : 'Use square logo for details'}</button>}
          {imageError && <p className="error" role="alert">{imageError}</p>}
        </section>
        <h3 className="details-title">Entry details</h3>
        <div className="field-row">
          <label>ID<input value={draft.id} disabled={!isNew || persisted} maxLength={40} onChange={(event) => set('id', event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder="maybank" /></label>
          <label>Short name<input value={draft.short} maxLength={40} onChange={(event) => set('short', event.target.value)} placeholder="Maybank" /></label>
        </div>
        <label>Name<input value={draft.name} maxLength={120} onChange={(event) => set('name', event.target.value)} placeholder="Full name" /></label>
        <div className="field-row">
          {kind === 'banks' ? <label>Type<select value={draft.category} onChange={(event) => set('category', event.target.value)}>{bankCategories.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
            : <label>Group<select value={draft.group} onChange={(event) => set('group', event.target.value)}>{brandGroups.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>}
          <label>Colour<div className="colour-field"><input type="color" value={draft.colour} onChange={(event) => set('colour', event.target.value.toUpperCase())} aria-label="Pick colour" /><input value={draft.colour} maxLength={7} onChange={(event) => set('colour', event.target.value)} aria-label="Hex colour" /></div></label>
        </div>
        {kind === 'brands' && <><label>Category<input value={draft.category} maxLength={60} onChange={(event) => set('category', event.target.value)} placeholder="Bills" /></label>
          <div className="field-row"><label>Commitment<select value={draft.commitment?.kind ?? ''} onChange={(event) => set('commitment', event.target.value ? { kind: event.target.value } : null)}>{commitmentKinds.map((value) => <option key={value} value={value}>{value || 'None'}</option>)}</select></label>
            {draft.commitment?.kind === 'loan' && <label>Loan type<select value={draft.commitment.loanType ?? 'other'} onChange={(event) => set('commitment', { kind: 'loan', loanType: event.target.value })}>{loanTypes.map((value) => <option key={value}>{value}</option>)}</select></label>}</div></>}
        <label>Aliases<input value={aliasesText} onChange={(event) => setAliasesText(event.target.value)} placeholder="Comma separated names" /><span className="field-hint">Used when matching receipts and transactions.</span></label>
        {!isNew && <label>Sort order<input type="number" min={0} value={draft.sortOrder} onChange={(event) => set('sortOrder', Number(event.target.value))} /></label>}
      </div>
      {error && <p className="error sheet-error" role="alert">{error}</p>}
      <footer className="sheet-footer">
        {entry && <button className="danger" type="button" onClick={remove} disabled={locked}>Delete</button>}
        <button className="secondary" type="button" onClick={onClose} disabled={locked}>Cancel</button>
        <button className="primary" type="button" onClick={save} disabled={locked}>{busy ? 'Saving…' : 'Save entry'}</button>
      </footer>
      {imageEditor && <LogoCropper {...imageEditor} onApply={(edit) => {
        const { target } = imageEditor;
        setImages((current) => ({ ...current, [target]: edit }));
        if (target === 'background') setClearBackground(false);
        setImageEditor(null);
      }} onCancel={() => setImageEditor(null)} />}
    </dialog>;

}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>();
  const [kind, setKind] = useState<Kind>('banks');
  const [entries, setEntries] = useState<Record<Kind, Entry[]>>({ banks: [], brands: [] });
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Entry | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);

  async function refresh() {
    const [banks, brands] = await Promise.all([listEntries('banks'), listEntries('brands')]);
    setEntries({ banks, brands });
  }

  async function enterCatalog(account: User) {
    // Validate against an admin-only endpoint before showing any catalog screen.
    await refreshIdToken();
    const [banks, brands] = await Promise.all([listEntries('banks'), listEntries('brands')]);
    setEntries({ banks, brands });
    setUser(account);
    setError('');
  }

  async function handleAccessError(cause: unknown, email?: string | null) {
    if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
      await signOut();
      setUser(null);
      setError(cause.status === 403
        ? `${email || 'This Google account'} is not a SenSei catalog admin.`
        : 'Your sign-in expired. Please try again.');
      return;
    }
    setUser(null);
    setError(cause instanceof Error ? cause.message : 'Could not check catalog access.');
  }

  useEffect(() => {
    let active = true;
    currentUser().then(async (account) => {
      if (!active) return;
      if (!account) { setUser(null); return; }
      try { await enterCatalog(account); }
      catch (cause) { if (active) await handleAccessError(cause, account.email); }
    }).catch((cause) => { if (active) { setError(cause instanceof Error ? cause.message : 'Could not check sign-in.'); setUser(null); } });
    return () => { active = false; };
  }, []);

  const visible = useMemo(() => entries[kind].filter((entry) => {
    const q = search.trim().toLowerCase();
    return !q || [entry.id, entry.name, entry.short, ...entry.aliases].some((value) => value.toLowerCase().includes(q));
  }).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)), [entries, kind, search]);

  async function login() {
    setBusy(true); setError('');
    try {
      const account = await signIn();
      if (!account) throw new Error('Google did not return an account.');
      await enterCatalog(account);
    } catch (cause) {
      const account = await currentUser().catch(() => null);
      await handleAccessError(cause, account?.email);
    }
    finally { setBusy(false); }
  }

  async function publish() {
    setBusy(true); setError(''); setNotice('');
    try { const result = await publishCatalog(); setPublishedVersion(result.version); setNotice('Catalog published. The main app can now download these changes.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not publish.'); }
    finally { setBusy(false); }
  }

  if (user === undefined) return <main className="center-state">Checking sign-in…</main>;
  if (!user) return <main className="sign-in"><div className="wordmark"><img className="mark" src={brandMark} alt="" width={32} height={32} /> SenSei</div><h1>Catalog manager</h1><p>Manage the bank and brand names, colours, and logos shown in SenSei.</p><button className="primary" disabled={busy} onClick={login}>{busy ? 'Signing in…' : 'Sign in with Google'}</button>{error && <p className="error" role="alert">{error}</p>}</main>;

  return <main className="app-shell">
    <header className="topbar"><div className="wordmark"><img className="mark" src={brandMark} alt="" width={32} height={32} /> Catalog</div><button className="text-button" onClick={async () => { await signOut(); setUser(null); setEntries({ banks: [], brands: [] }); }} aria-label="Sign out">Sign out</button></header>
    <div className="content"><div className="page-heading"><div><h1>Banks & brands</h1><p>Manage the shared catalog.</p></div><button className="secondary publish" disabled={busy} onClick={publish}>Publish changes</button></div>
      <div className="tabs" role="tablist" aria-label="Catalog type">{(['banks', 'brands'] as Kind[]).map((value) => <button key={value} role="tab" aria-selected={kind === value} className={kind === value ? 'active' : ''} onClick={() => { setKind(value); setSearch(''); }}>{value === 'banks' ? 'Banks' : 'Brands'} <span>{entries[value].length}</span></button>)}</div>
      <div className="toolbar"><input type="search" placeholder={`Search ${kind}…`} aria-label={`Search ${kind}`} value={search} onChange={(event) => setSearch(event.target.value)} /><button className="primary" onClick={() => setEditing('new')}>Add {kind === 'banks' ? 'bank' : 'brand'}</button></div>
      {error && <p className="error banner" role="alert">{error} <button className="text-button" onClick={() => { setError(''); setBusy(true); refresh().catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not reload.')).finally(() => setBusy(false)); }}>Retry</button></p>}
      {notice && <p className="notice" role="status">{notice}{publishedVersion !== null ? ` Version ${publishedVersion}.` : ''}</p>}
      {busy && entries.banks.length + entries.brands.length === 0 ? <p className="empty">Loading catalog…</p> : visible.length === 0 ? <p className="empty">{search ? 'No matching entries.' : `No ${kind} yet.`}</p> : <div className="entry-list">{visible.map((entry) => <button className="entry-row" key={entry.id} onClick={() => setEditing(entry)}><Logo entry={entry} /><span className="entry-main"><strong>{entry.short}</strong><small>{entry.name}</small></span><span className="entry-meta">{entry.group || entry.category.replaceAll('_', ' ')}</span><span className="chevron">›</span></button>)}</div>}
    </div>
    {editing && <Editor key={`${kind}-${editing === 'new' ? 'new' : editing.id}`} kind={kind} entry={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { await refresh(); setNotice('Changes saved. Publish when ready.'); setPublishedVersion(null); }} />}
  </main>;
}
